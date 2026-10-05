import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { TOOL_DEFINITIONS } from "../mcp/catalog.js";
import { APPLICATION_SKILLS_DIR } from "../strategies/native-skills.js";
import { traceHash } from "./redact.js";
import { TraceRecorder, traceModel } from "./recorder.js";

let sourceFingerprint: Promise<string | null> | undefined;
function applicationFingerprint(): Promise<string | null> {
  sourceFingerprint ??= (async () => {
    try {
      const directory = fileURLToPath(new URL("../", import.meta.url));
      const files = (await readdir(directory, { recursive: true }))
        .filter((file) => /\.(js|ts)$/.test(file))
        .sort();
      const hashes: Record<string, string> = {};
      for (const file of files)
        hashes[file.replaceAll("\\", "/")] = traceHash(
          await readFile(join(directory, file), "utf8"),
        );
      return traceHash(hashes);
    } catch {
      return null;
    }
  })();
  return sourceFingerprint;
}

/** 所有事件只观察，不返回 context/payload 替换值，不改变 Pi 的消息和执行计划。 */
export function registerTraceHooks(
  pi: ExtensionAPI,
  recorder: TraceRecorder,
): void {
  const observe = (operation: () => void): void => {
    recorder.observe(operation);
  };
  pi.on("session_start", async () => {
    const skills: Record<string, string> = {};
    try {
      const files = await readdir(APPLICATION_SKILLS_DIR, { recursive: true });
      for (const file of files.filter((file) => file.endsWith(".md")).sort()) {
        const path = join(APPLICATION_SKILLS_DIR, file);
        skills[relative(APPLICATION_SKILLS_DIR, path).replaceAll("\\", "/")] =
          traceHash(await readFile(path, "utf8"));
      }
    } catch {
      /* manifest 未取得的情况明确保留，不影响 Skill 的原生加载。 */
    }
    const sourceHash = await applicationFingerprint();
    observe(() =>
      recorder.configure({
        application: "MyBangumiAssistant",
        application_version: "0.1.0",
        pi_version: VERSION,
        application_source_hash: sourceHash,
        mcp_contract_hash: traceHash(TOOL_DEFINITIONS),
        skill_manifest: skills,
        skill_manifest_status: Object.keys(skills).length
          ? "captured"
          : "unavailable",
      }),
    );
  });
  pi.on("input", (event) => {
    observe(() => {
      if (!event.text.trimStart().startsWith("/"))
        recorder.input({
          text: event.text,
          source: event.source,
          streamingBehavior: event.streamingBehavior ?? null,
          ...(event.images ? { images: event.images } : {}),
        });
    });
  });
  pi.on("before_agent_start", (event, ctx) =>
    observe(() =>
      recorder.start(ctx, { prompt: event.prompt, images: event.images ?? [] }),
    ),
  );
  pi.on("turn_start", (event) =>
    observe(() => recorder.current?.turnStart(event.turnIndex)),
  );
  pi.on("context_with_system", (event, ctx) =>
    observe(() => {
      recorder.watchSignal(ctx.signal);
      recorder.current?.llmStart(
        event.messages,
        traceModel(ctx),
        pi.getThinkingLevel(),
      );
    }),
  );
  pi.on("before_provider_request", (event) =>
    observe(() => {
      recorder.current?.providerPayload(event.payload);
    }),
  );
  pi.on("after_provider_response", (event) =>
    observe(() =>
      recorder.current?.emit("llm.http_response", { status: event.status }),
    ),
  );
  pi.on("message_update", (event) =>
    observe(() => recorder.current?.llmPartial(event.message)),
  );
  pi.on("message_end", (event) => {
    observe(() => {
      if (event.message.role === "assistant")
        recorder.current?.llmEnd(event.message);
      if (event.message.role === "toolResult")
        recorder.current?.toolResult(
          event.message.toolCallId,
          event.message.toolName,
          { content: event.message.content },
          event.message.isError,
        );
      if (event.message.role === "user")
        recorder.current?.emit("input.delivered", {
          message_ref: recorder.current.payload(event.message),
        });
    });
  });
  pi.on("tool_execution_start", (event) =>
    observe(() => {
      recorder.current?.toolRequested(
        event.toolCallId,
        event.toolName,
        event.args,
      );
    }),
  );
  pi.on("tool_execution_end", (event) =>
    observe(() =>
      recorder.current?.toolResult(
        event.toolCallId,
        event.toolName,
        event.result,
        event.isError,
      ),
    ),
  );
  pi.on("turn_end", (event) =>
    observe(() =>
      recorder.current?.turnEnd({
        turn_index: event.turnIndex,
        message_entry_id: event.messageEntryId,
        tool_result_entry_ids: event.toolResultEntryIds,
        outcome: event.outcome,
        continued: event.continue,
      }),
    ),
  );
  pi.on("agent_end", () => observe(() => recorder.current?.emit("agent.end")));
  pi.on("agent_before_settle", (event) =>
    observe(() => recorder.current?.boundary(event.outcome)),
  );
  pi.on("session_compact", (event) =>
    recorder.record("session.compact", event),
  );
  pi.on("model_select", (event) =>
    recorder.record("model.select", {
      provider: event.model.provider,
      model: event.model.id,
      source: event.source,
    }),
  );
  pi.on("thinking_level_select", (event) =>
    recorder.record("thinking.select", {
      level: event.level,
      source: "runtime",
    }),
  );
  pi.on("agent_settled", (_event, ctx) => recorder.settle(ctx));
  pi.on("session_shutdown", (_event, ctx) => recorder.shutdown(ctx));
}
