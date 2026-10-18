import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/cache", () => ({ cached: vi.fn(), readCache: vi.fn(), writeCache: vi.fn() }));
vi.mock("@/lib/ai-provider", () => ({ callAIProviderWithFallback: vi.fn() }));
const { parseModelJson } = await import("@/lib/market-intel");

describe("parseModelJson", () => {
    it("parses plain JSON", () => {
        expect(parseModelJson('{"headline": "Up"}')).toEqual({ headline: "Up" });
    });

    it("strips code fences and surrounding text", () => {
        expect(parseModelJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
        expect(parseModelJson('Here you go: {"a": 1} hope that helps')).toEqual({ a: 1 });
    });

    it("forgives the trailing comma that broke the Oct 16 brief", () => {
        const text = '{"headline": "Mixed", "bullets": [{"title": "Tech", "detail": "Down 0.18%."},], "watch": "",}';
        expect(parseModelJson(text)).toEqual({ headline: "Mixed", bullets: [{ title: "Tech", detail: "Down 0.18%." }], watch: "" });
    });

    it("does not touch commas inside strings", () => {
        expect(parseModelJson('{"summary": "a, b,}"}')).toEqual({ summary: "a, b,}" });
    });

    it("still throws on something that isn't JSON", () => {
        expect(() => parseModelJson("no json here")).toThrow();
    });
});
