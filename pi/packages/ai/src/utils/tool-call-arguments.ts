import type { ToolCall } from "../types.ts";

/** Internal provider evidence. Deliberately excluded from JSON, replay, and UI payloads. */
export interface ToolCallArgumentSource {
	raw: string;
	state: "complete" | "interrupted";
	source: "delta" | "arguments_done" | "output_item_done" | "terminal_response";
}

const argumentSources = new WeakMap<ToolCall, Readonly<ToolCallArgumentSource>>();

/** A complete argument event does not establish the assistant message's final stop reason. */
export function getToolCallArgumentSource(toolCall: ToolCall): Readonly<ToolCallArgumentSource> | undefined {
	return argumentSources.get(toolCall);
}

/** Callers cloning a live tool call must explicitly transfer its internal evidence. */
export function setToolCallArgumentSource(toolCall: ToolCall, source: ToolCallArgumentSource): void {
	argumentSources.set(toolCall, Object.freeze({ ...source }));
}

/** Transfer live evidence across an explicitly chosen in-process clone boundary. */
export function copyToolCallArgumentSource(sourceCall: ToolCall, targetCall: ToolCall): void {
	const source = argumentSources.get(sourceCall);
	if (source) argumentSources.set(targetCall, source);
}
