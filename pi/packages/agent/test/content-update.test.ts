import {
	type AssistantMessage,
	type AssistantMessageEvent,
	EventStream,
	type Message,
	type Model,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { Agent } from "../src/agent.ts";
import { runAgentLoop } from "../src/agent-loop.ts";
import type { AgentEvent, AgentMessage, AgentTool } from "../src/types.ts";

const model: Model<"openai-responses"> = {
	id: "mock",
	name: "mock",
	api: "openai-responses",
	provider: "openai",
	baseUrl: "https://example.invalid",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8192,
	maxTokens: 2048,
};

// Applications register their types separately. Deserialize their wire content here
// without globally augmenting the Pi-only test compilation with a sample component.
function message(content: unknown[], stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
	return JSON.parse(
		JSON.stringify({
			role: "assistant",
			content,
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason,
			timestamp: 1,
		}),
	) as AssistantMessage;
}

function response(events: AssistantMessageEvent[]) {
	const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
		(event) => event.type === "done" || event.type === "error",
		(event) => {
			if (event.type === "done") return event.message;
			if (event.type === "error") return event.error;
			throw new Error("Unexpected event type");
		},
	);
	queueMicrotask(() => {
		for (const event of events) stream.push(event);
	});
	return stream;
}

function convertToLlm(messages: AgentMessage[]): Message[] {
	return messages.filter(
		(item) =>
			item.role === "system" || item.role === "user" || item.role === "assistant" || item.role === "toolResult",
	);
}

describe("application assistant content updates", () => {
	it("forwards placeholders and completed components through the existing message_update lifecycle", async () => {
		const placeholder = message([
			{ type: "text", text: "", nextType: "subjects" },
			{ type: "subjects", pending: false, props: {} },
		]);
		const text = message([
			{ type: "text", text: "作品列表", nextType: "subjects" },
			{ type: "subjects", pending: false, props: {} },
		]);
		const completed = message([
			{ type: "text", text: "作品列表", nextType: "subjects" },
			{ type: "subjects", pending: true, props: { title: "相关条目", layout: "grid", items: [] } },
		]);
		const updates: Extract<AgentEvent, { type: "message_update" }>[] = [];
		const agent = new Agent({
			initialState: { model },
			streamFn: () =>
				response([
					{ type: "start", partial: message([]) },
					{ type: "content_update", contentIndex: 1, partial: placeholder },
					{ type: "text_delta", contentIndex: 0, delta: "作品列表", partial: text },
					{ type: "content_update", contentIndex: 1, partial: completed },
					{ type: "done", reason: "stop", message: completed },
				]),
		});
		agent.subscribe((event) => {
			if (event.type !== "message_update") return;
			expect(agent.state.streamingMessage).toBe(event.message);
			updates.push(event);
		});

		await agent.prompt("列出作品");

		expect(updates.map((event) => event.assistantMessageEvent.type)).toEqual([
			"content_update",
			"text_delta",
			"content_update",
		]);
		expect(updates[0].message.role === "assistant" ? updates[0].message.content : undefined).toEqual(
			placeholder.content,
		);
		expect(updates[2].message.role === "assistant" ? updates[2].message.content : undefined).toEqual(
			completed.content,
		);
		const savedMessage = agent.state.messages.at(-1);
		expect(savedMessage?.role === "assistant" ? savedMessage.content : undefined).toEqual(completed.content);
		expect(agent.state.streamingMessage).toBeUndefined();
	});

	it("preserves native thinking and tool events alongside application content and executes only native tools", async () => {
		const toolCall = { type: "toolCall" as const, id: "call-1", name: "read", arguments: {} };
		const first = message(
			[
				{ type: "thinking", thinking: "query", thinkingSignature: "signed-thinking" },
				{ type: "subjects", pending: true, props: { layout: "grid", items: [] } },
				toolCall,
			],
			"toolUse",
		);
		const final = message([{ type: "text", text: "done", nextType: null }]);
		let executions = 0;
		const tool: AgentTool = {
			name: "read",
			label: "read",
			description: "Read test data",
			parameters: Type.Object({}),
			async execute() {
				executions++;
				return { content: [{ type: "text", text: "data" }], details: {} };
			},
		};
		let requests = 0;
		const events: AgentEvent[] = [];
		const result = await runAgentLoop(
			[{ role: "user", content: "query", timestamp: 1 }],
			{ messages: [], tools: [tool] },
			{ model, convertToLlm },
			(event) => {
				events.push(event);
			},
			undefined,
			() => {
				requests++;
				return requests === 1
					? response([
							{ type: "start", partial: message([]) },
							{ type: "thinking_end", contentIndex: 0, content: "query", partial: first },
							{ type: "content_update", contentIndex: 1, partial: first },
							{ type: "toolcall_end", contentIndex: 2, toolCall, partial: first },
							{ type: "done", reason: "toolUse", message: first },
						])
					: response([{ type: "done", reason: "stop", message: final }]);
			},
		);

		const updates = events.filter((event) => event.type === "message_update");
		expect(updates.map((event) => event.assistantMessageEvent.type)).toEqual([
			"thinking_end",
			"content_update",
			"toolcall_end",
		]);
		expect(
			updates.map((event) =>
				"contentIndex" in event.assistantMessageEvent ? event.assistantMessageEvent.contentIndex : undefined,
			),
		).toEqual([0, 1, 2]);
		expect(executions).toBe(1);
		expect(requests).toBe(2);
		expect(result.filter((item) => item.role === "assistant")[0].content).toEqual(first.content);
	});
});
