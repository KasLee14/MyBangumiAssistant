import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { stream as streamCompletions } from "../src/api/openai-completions.ts";
import { convertResponsesMessages, processResponsesStream } from "../src/api/openai-responses-shared.ts";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "../src/providers/faux.ts";
import type { AssistantMessage, Model, ToolCall } from "../src/types.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";
import {
	copyToolCallArgumentSource,
	getToolCallArgumentSource,
	setToolCallArgumentSource,
} from "../src/utils/tool-call-arguments.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

const mockState = vi.hoisted(() => ({ chunks: [] as unknown[], fail: false }));
vi.mock("openai", () => {
	class FakeOpenAI {
		chat = {
			completions: {
				create: () => {
					const data = {
						async *[Symbol.asyncIterator]() {
							for (const chunk of mockState.chunks) yield chunk;
							if (mockState.fail) throw new Error("interrupted");
						},
					};
					return { withResponse: async () => ({ data, response: { status: 200, headers: new Headers() } }) };
				},
			},
		};
	}
	return { default: FakeOpenAI };
});

const model: Model<"openai-completions"> = {
	id: "test",
	name: "test",
	api: "openai-completions",
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1000,
	maxTokens: 500,
};
const responsesModel: Model<"openai-responses"> = { ...model, api: "openai-responses" };
const context = normalizeContext({ messages: [{ role: "user", content: "hello", timestamp: 0 }] });
function toolFrom(message: AssistantMessage): ToolCall {
	const tool = message.content.find((block) => block.type === "toolCall");
	if (!tool || tool.type !== "toolCall") throw new Error("Expected tool call");
	return tool;
}
function output(): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "openai-responses",
		provider: "openai",
		model: "test",
		stopReason: "pending",
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
async function* events(rows: unknown[]): AsyncIterable<ResponseStreamEvent> {
	for (const row of rows) yield row as ResponseStreamEvent;
}
const item = (raw: string) => ({
	type: "function_call",
	id: "fc_one",
	call_id: "call_one",
	name: "present_text",
	arguments: raw,
});

describe("internal original tool argument evidence", () => {
	beforeEach(() => {
		mockState.chunks = [];
		mockState.fail = false;
	});
	it("gives structured faux calls complete raw evidence and retains explicit malformed fixture bytes", async () => {
		const faux = createFauxCore({});
		const structured = fauxToolCall("present_text", { text: "structured" });
		const malformed = fauxToolCall("present_text", { text: "preview" });
		setToolCallArgumentSource(malformed, {
			raw: '{"text":"original"',
			state: "complete",
			source: "output_item_done",
		});
		faux.setResponses([fauxAssistantMessage([structured, malformed], { stopReason: "toolUse" })]);
		const result = await faux.stream(faux.getModel(), context).result();
		const calls = result.content.filter((block) => block.type === "toolCall");
		expect(calls).toHaveLength(2);
		expect(getToolCallArgumentSource(calls[0])).toEqual({
			raw: '{"text":"structured"}',
			state: "complete",
			source: "terminal_response",
		});
		expect(getToolCallArgumentSource(calls[1])).toEqual(getToolCallArgumentSource(malformed));
		expect(JSON.stringify(result)).not.toContain("original");
	});
	it("preserves completion bytes despite preview escape repair and never serializes evidence", async () => {
		const raw = '{ "text": "bad\\q", "text": "final"';
		mockState.chunks = [
			{
				choices: [
					{ delta: { tool_calls: [{ index: 0, id: "one", function: { name: "present_text", arguments: raw } }] } },
				],
			},
			{ choices: [{ delta: {}, finish_reason: "tool_calls" }] },
		];
		const result = await streamCompletions(model, context, { apiKey: "test" }).result();
		const tool = toolFrom(result);
		expect(getToolCallArgumentSource(tool)).toEqual({ raw, state: "complete", source: "delta" });
		expect(tool).not.toHaveProperty("partialArgs");
		expect(JSON.stringify(tool)).not.toContain(raw);
		let replay: unknown;
		mockState.chunks = [{ choices: [{ delta: {}, finish_reason: "stop" }] }];
		await streamCompletions(model, normalizeContext({ messages: [result] }), {
			apiKey: "test",
			onPayload: (payload) => {
				replay = payload;
			},
		}).result();
		expect(JSON.stringify(replay)).not.toContain("bad\\\\q");
		expect(JSON.stringify(replay)).not.toContain("argumentSource");
	});
	it("captures terminal completion tool messages without delta events", async () => {
		const raw = '{ "text": "terminal" }';
		mockState.chunks = [
			{
				choices: [
					{
						message: { tool_calls: [{ id: "one", function: { name: "present_text", arguments: raw } }] },
						delta: {
							tool_calls: [
								{ id: "one", function: { name: "present_text", arguments: '{"text":"stale delta"}' } },
							],
						},
						finish_reason: "tool_calls",
					},
				],
			},
		];
		const result = await streamCompletions(model, context, { apiKey: "test" }).result();
		expect(getToolCallArgumentSource(toolFrom(result))).toEqual({
			raw,
			state: "complete",
			source: "terminal_response",
		});
	});
	it("keeps interrupted completion raw for diagnosis without marking it complete", async () => {
		mockState.chunks = [
			{
				choices: [
					{
						delta: {
							tool_calls: [
								{ index: 0, id: "one", function: { name: "present_text", arguments: '{"text":"partial' } },
							],
						},
					},
				],
			},
		];
		mockState.fail = true;
		const result = await streamCompletions(model, context, { apiKey: "test" }).result();
		expect(result.stopReason).toBe("error");
		expect(getToolCallArgumentSource(toolFrom(result))).toEqual({
			raw: '{"text":"partial',
			state: "interrupted",
			source: "delta",
		});
	});
	it("uses Responses done replacement, even when it is not a prefix extension", async () => {
		const raw = '{ "text":"authoritative", "text":"duplicate"';
		const result = output();
		await processResponsesStream(
			events([
				{ type: "response.output_item.added", output_index: 0, item: item("") },
				{ type: "response.function_call_arguments.delta", output_index: 0, delta: '{"text":"wrong"}' },
				{ type: "response.function_call_arguments.done", output_index: 0, arguments: '{"text":"done"}' },
				{ type: "response.output_item.done", output_index: 0, item: item(raw) },
				{ type: "response.completed", response: { id: "resp_one", status: "completed" } },
			]),
			result,
			new AssistantMessageEventStream(),
			responsesModel,
		);
		expect(getToolCallArgumentSource(toolFrom(result))).toEqual({
			raw,
			state: "complete",
			source: "output_item_done",
		});
		expect(toolFrom(result)).not.toHaveProperty("partialJson");
		const replay = convertResponsesMessages(
			responsesModel,
			normalizeContext({ messages: [result] }),
			new Set(["openai"]),
		);
		const call = replay.find((row) => row.type === "function_call");
		expect(call).toHaveProperty("arguments", JSON.stringify(toolFrom(result).arguments));
		expect(JSON.stringify(replay)).not.toContain("argumentSource");
	});
	it("captures a terminal-only Responses call and terminal replacements", async () => {
		const result = output(),
			raw = '{ "text":"terminal raw" }';
		await processResponsesStream(
			events([
				{ type: "response.completed", response: { id: "resp_one", status: "completed", output: [item(raw)] } },
			]),
			result,
			new AssistantMessageEventStream(),
			responsesModel,
		);
		expect(result.content).toHaveLength(1);
		expect(result.stopReason).toBe("toolUse");
		expect(getToolCallArgumentSource(toolFrom(result))).toEqual({
			raw,
			state: "complete",
			source: "terminal_response",
		});
	});
	it("retains incomplete terminal status and does not add evidence to clones without explicit transfer", async () => {
		const result = output(),
			raw = '{"text":"complete value"';
		await processResponsesStream(
			events([
				{
					type: "response.incomplete",
					response: {
						id: "resp_one",
						status: "incomplete",
						incomplete_details: { reason: "max_output_tokens" },
						output: [item(raw)],
					},
				},
			]),
			result,
			new AssistantMessageEventStream(),
			responsesModel,
		);
		const call = toolFrom(result),
			clone = structuredClone(call);
		expect(result.stopReason).toBe("length");
		expect(getToolCallArgumentSource(call)?.state).toBe("interrupted");
		expect(getToolCallArgumentSource(clone)).toBeUndefined();
		copyToolCallArgumentSource(call, clone);
		expect(getToolCallArgumentSource(clone)).toEqual(getToolCallArgumentSource(call));
		setToolCallArgumentSource(call, { raw: "changed", state: "complete", source: "delta" });
		expect(getToolCallArgumentSource(clone)?.raw).toBe(raw);
	});
	it("replaces finalized Responses argument evidence with authoritative terminal output without duplicating calls", async () => {
		const result = output(),
			raw = '{ "text": "terminal replacement" }';
		await processResponsesStream(
			events([
				{ type: "response.output_item.done", output_index: 0, item: item('{"text":"earlier done"}') },
				{ type: "response.completed", response: { id: "resp_one", status: "completed", output: [item(raw)] } },
			]),
			result,
			new AssistantMessageEventStream(),
			responsesModel,
		);
		expect(result.content).toHaveLength(1);
		expect(getToolCallArgumentSource(toolFrom(result))).toEqual({
			raw,
			state: "complete",
			source: "terminal_response",
		});
		expect(toolFrom(result).arguments).toEqual({ text: "terminal replacement" });
	});
});
