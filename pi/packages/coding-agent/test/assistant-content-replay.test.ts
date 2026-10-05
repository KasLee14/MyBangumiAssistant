import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AssistantMessage, TextContent, ThinkingContent, ToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { estimateContextTokens, estimateTokens } from "../src/core/compaction/compaction.ts";
import { serializeConversation } from "../src/core/compaction/utils.ts";
import { convertToLlm } from "../src/core/messages.ts";
import { SessionManager } from "../src/core/session-manager.ts";

function message(content: unknown[]): AssistantMessage {
	// Read application-owned content without registering a test-specific global type.
	return JSON.parse(
		JSON.stringify({
			role: "assistant",
			content,
			api: "openai-responses",
			provider: "openai",
			model: "mock",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: 1,
		}),
	) as AssistantMessage;
}

const component = {
	type: "subjects",
	pending: true,
	props: {
		title: "相关条目",
		layout: "grid",
		items: [{ id: 42, name: "作品", type: "anime", score: 8.2 }],
	},
};

describe("application assistant content replay", () => {
	it("serializes component facts for model requests and compaction without altering native signed blocks or state", () => {
		const text: TextContent = { type: "text", text: "以下作品", nextType: "subjects", textSignature: "signed-text" };
		const thinking: ThinkingContent = { type: "thinking", thinking: "reason", thinkingSignature: "signed-thinking" };
		const tool: ToolCall = { type: "toolCall", id: "call-1", name: "read", arguments: { id: 42 } };
		const original = message([text, component, thinking, tool]);
		const originalContent = structuredClone(original.content);
		const result = convertToLlm([original]);
		const replay = result[0];
		if (replay.role !== "assistant") throw new Error("Expected assistant replay");

		expect(replay.content[0]).toBe(original.content[0]);
		expect(replay.content[1]).toEqual({ type: "text", text: JSON.stringify(component) });
		expect(replay.content[2]).toBe(original.content[2]);
		expect(replay.content[3]).toBe(original.content[3]);
		expect(original.content).toEqual(originalContent);
		const summary = serializeConversation(result);
		expect(summary).toContain('"id":42');
		expect(summary).toContain('"score":8.2');
		expect(summary).toContain("以下作品");
		expect(summary).toContain("[Assistant thinking]: reason");
		expect(summary).toContain("read(id=42)");
	});

	it("keeps messages containing only native content unchanged", () => {
		const original = message([{ type: "text", text: "native", textSignature: "signed" }]);
		expect(convertToLlm([original])[0]).toBe(original);
	});

	it("includes component facts in token estimates when provider usage is unavailable", () => {
		const original = message([{ type: "text", text: "以下作品" }, component]);
		const tokens = Math.ceil(("以下作品".length + JSON.stringify(component).length) / 4);
		expect(estimateTokens(original)).toBe(tokens);
		expect(estimateContextTokens([original]).tokens).toBe(tokens);
	});

	it("persists and restores application content without serializing it into display text", () => {
		const tempDir = mkdtempSync(join(tmpdir(), "pi-content-replay-"));
		const path = resolve(tempDir);
		if (!path.startsWith(`${resolve(tmpdir())}\\`) && !path.startsWith(`${resolve(tmpdir())}/`)) {
			throw new Error("Temporary directory escaped the system temp root");
		}
		try {
			const session = SessionManager.create(tempDir, tempDir);
			const original = message([{ type: "text", text: "以下作品", nextType: "subjects" }, component]);
			session.appendMessage(original);
			const file = session.getSessionFile();
			if (!file) throw new Error("Expected session file");
			const restored = SessionManager.open(file, tempDir).buildSessionContext();
			const restoredMessage = restored.messages[0];
			expect(restoredMessage.role === "assistant" ? restoredMessage.content : undefined).toEqual(original.content);
		} finally {
			rmSync(path, { recursive: true, force: true });
		}
	});
});
