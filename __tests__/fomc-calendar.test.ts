import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";

vi.mock("@/lib/cache", () => ({ cached: vi.fn(), readCache: vi.fn(), writeCache: vi.fn() }));
vi.mock("@/lib/ai-provider", () => ({ callAIProviderWithFallback: vi.fn() }));
const { parseFomcDates } = await import("@/lib/market-intel");

describe("parseFomcDates", () => {
    it("reads decision days (last day of each meeting) from the Fed's calendar page", () => {
        const html = readFileSync(path.join(__dirname, "fixtures/fomc.html"), "utf8");
        const dates = parseFomcDates(html);
        expect(dates).toContain("2026-10-28");
        expect(dates).toContain("2026-12-09");
        expect(dates.filter((d) => d.startsWith("2026"))).toHaveLength(8);
    });

    it("puts a meeting that spans two months on the second month", () => {
        const html = `<h4>2024 FOMC Meetings</h4>
            <div class="fomc-meeting__month col"><strong>Apr/May</strong></div>
            <div class="fomc-meeting__date col">30-1</div>`;
        expect(parseFomcDates(html)).toEqual(["2024-05-01"]);
    });

    it("skips notation votes", () => {
        const html = `<h4>2025 FOMC Meetings</h4>
            <div class="fomc-meeting__month col"><strong>August</strong></div>
            <div class="fomc-meeting__date col">22 (notation vote)</div>
            <div class="fomc-meeting__month col"><strong>September</strong></div>
            <div class="fomc-meeting__date col">16-17*</div>`;
        expect(parseFomcDates(html)).toEqual(["2025-09-17"]);
    });
});
