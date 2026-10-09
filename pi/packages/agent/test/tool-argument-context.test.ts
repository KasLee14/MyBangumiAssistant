import { type AssistantMessage, getToolCallArgumentSource, setToolCallArgumentSource } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { runToolCall } from "../src/agent-loop.ts";
import type { AgentTool, AgentToolCall } from "../src/types.ts";

const schema = Type.Object({ text: Type.String() });
const call: AgentToolCall = { type: "toolCall", id: "one", name: "present_text", arguments: {} };
function message(): AssistantMessage {
	return {
		role: "assistant",
		content: [call],
		api: "openai-completions",
		provider: "openai",
		model: "test",
		stopReason: "toolUse",
		timestamp: 0,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
}
describe("tool argument preparation context", () => {
	it("passes original raw, final message and cancellation signal before schema validation", async () => {
		setToolCallArgumentSource(call, { raw: '{ "text": "final" }', state: "complete", source: "terminal_response" });
		const assistantMessage = message(),
			controller = new AbortController();
		const tool: AgentTool<typeof schema> = {
			name: "present_text",
			label: "text",
			description: "text",
			parameters: schema,
			prepareArguments(args, context) {
				expect(args).toBe(call.arguments);
				expect(context?.toolCall).toBe(call);
				expect(context?.assistantMessage).toBe(assistantMessage);
				expect(context?.signal).toBe(controller.signal);
				if (!context) throw new Error("Missing context");
				return JSON.parse(getToolCallArgumentSource(context.toolCall)!.raw) as { text: string };
			},
			async execute(_id, args) {
				return { content: [{ type: "text", text: args.text }], details: {} };
			},
		};
		const result = await runToolCall(call, {
			assistantMessage,
			tools: [tool],
			context: { messages: [], tools: [tool] },
			signal: controller.signal,
		});
		expect(result.isError).toBe(false);
		expect(result.result.content).toEqual([{ type: "text", text: "final" }]);
	});
	it("retains existing single-argument tool preparation behavior", async () => {
		const tool: AgentTool<typeof schema> = {
			name: "present_text",
			label: "text",
			description: "text",
			parameters: schema,
			prepareArguments(args) {
				return { text: JSON.stringify(args) };
			},
			async execute(_id, args) {
				return { content: [{ type: "text", text: args.text }], details: {} };
			},
		};
		const result = await runToolCall(call, {
			assistantMessage: message(),
			tools: [tool],
			context: { messages: [], tools: [tool] },
		});
		expect(result.isError).toBe(false);
		expect(result.result.content).toEqual([{ type: "text", text: "{}" }]);
	});
});
