import { expect, it } from "vitest";
import { CLOUDFLARE_AI_GATEWAY_MODELS } from "../src/providers/cloudflare-ai-gateway.models.ts";

// stream.test.ts uses this exact catalog fixture; checking its existence needs no credentials or live endpoint.
it("resolves the Cloudflare Anthropic BYOK Sonnet fixture from the local catalog", () => {
	const model = CLOUDFLARE_AI_GATEWAY_MODELS["claude-sonnet-4.5"];
	expect(model.id).toBe("claude-sonnet-4.5");
	expect(model.api).toBe("anthropic-messages");
	expect(model.baseUrl).toContain("/anthropic");
});
