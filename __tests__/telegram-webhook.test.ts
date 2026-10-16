import { describe, it, expect, vi, beforeEach } from "vitest";

const sendTelegram = vi.fn().mockResolvedValue({});
const findOneAndUpdate = vi.fn();
const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 0 });
const findOne = vi.fn();

vi.mock("@/database/mongoose", () => ({ connectToDatabase: vi.fn().mockResolvedValue({}) }));
vi.mock("@/database/models/notification.model", () => ({
    NotificationSettings: { findOneAndUpdate, updateMany, findOne: () => ({ lean: findOne }) },
}));
vi.mock("@/lib/notify", () => ({
    buildWatchlistSummary: vi.fn().mockResolvedValue("<b>summary</b>"),
    watchlistsFor: vi.fn().mockResolvedValue(new Map([["u1", ["NVDA"]]])),
}));
vi.mock("@/lib/telegram", () => ({
    sendTelegram,
    WEBHOOK_SECRET: "s3cret",
    escapeHtml: (s: string) => s,
}));

const { POST } = await import("@/app/api/telegram/route");

const call = (text: string, secret = "s3cret") =>
    POST(new Request("http://x/api/telegram", {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": secret },
        body: JSON.stringify({ message: { text, chat: { id: 42, username: "anish" } } }),
    }));

describe("Telegram webhook", () => {
    beforeEach(() => vi.clearAllMocks());

    it("rejects requests without Telegram's secret header", async () => {
        const res = await call("/start abc", "wrong");
        expect(res.status).toBe(403);
        expect(findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("links the chat when /start carries a valid, unexpired code", async () => {
        findOneAndUpdate.mockResolvedValue({ userId: "u1" });
        const res = await call("/start abc123");
        expect(res.status).toBe(200);
        const [filter, update] = findOneAndUpdate.mock.calls[0];
        expect(filter.linkCode).toBe("abc123");
        expect(filter.linkCodeExpires.$gt).toBeInstanceOf(Date);
        expect(update.$set).toMatchObject({ telegramChatId: "42", telegramName: "@anish" });
        expect(sendTelegram.mock.calls[0][1]).toContain("Connected");
    });

    it("does not link with an unknown or expired code", async () => {
        findOneAndUpdate.mockResolvedValue(null);
        await call("/start nope");
        expect(sendTelegram.mock.calls[0][1]).toContain("Connect Telegram");
        expect(updateMany).not.toHaveBeenCalled();
    });

    it("sends the watchlist summary for a linked chat", async () => {
        findOne.mockResolvedValue({ userId: "u1" });
        await call("/summary");
        expect(sendTelegram).toHaveBeenCalledWith("42", "<b>summary</b>");
    });

    it("unlinks on /stop", async () => {
        updateMany.mockResolvedValue({ modifiedCount: 1 });
        await call("/stop");
        expect(updateMany.mock.calls[0][0]).toEqual({ telegramChatId: "42" });
        expect(sendTelegram.mock.calls[0][1]).toContain("Unlinked");
    });
});
