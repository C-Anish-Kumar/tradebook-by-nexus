import { describe, it, expect, vi, beforeEach } from "vitest";

const findOneAndDelete = vi.fn();
const setSessionCookie = vi.fn();

vi.mock("better-auth/api", async (orig) => {
    const real = await orig<typeof import("better-auth/api")>();
    // Expose the raw handler so the test can call it with a hand-made ctx
    return { ...real, createAuthEndpoint: (_path: string, _opts: unknown, handler: unknown) => handler };
});
vi.mock("better-auth/cookies", () => ({ setSessionCookie }));
vi.mock("@/database/mongoose", () => ({ connectToDatabase: vi.fn().mockResolvedValue({}) }));
vi.mock("@/database/models/telegram-login.model", () => ({ TelegramLogin: { findOneAndDelete: () => ({ lean: findOneAndDelete }) } }));
vi.mock("@/database/models/notification.model", () => ({
    NotificationSettings: { findOne: () => ({ lean: () => Promise.resolve({ userId: "u1" }) }), updateMany: vi.fn(), updateOne: vi.fn() },
}));
vi.mock("@/lib/mail-config", () => ({ telegramEmail: (id: string) => `${id}@telegram.invalid` }));

const { APIError } = await import("better-auth/api");
const { telegramLogin } = await import("@/lib/better-auth/telegram-login");
type Handler = (ctx: unknown) => Promise<unknown>;
const handler = telegramLogin().endpoints.signInTelegram as unknown as Handler;

const makeCtx = (code: string) => {
    const createSession = vi.fn().mockResolvedValue({ id: "s1", token: "t" });
    const ctx = {
        body: { code },
        headers: new Headers({ "user-agent": "test" }),
        json: (v: unknown) => v,
        context: { internalAdapter: { findUserById: vi.fn().mockResolvedValue({ id: "u1" }), createUser: vi.fn(), createSession } },
    };
    return { ctx, createSession };
};

describe("Telegram sign-in endpoint", () => {
    beforeEach(() => vi.clearAllMocks());

    it("passes the request ctx to createSession (better-auth reads headers from it)", async () => {
        findOneAndDelete.mockResolvedValue({ chatId: "42", tgName: "@anish" });
        const { ctx, createSession } = makeCtx("a".repeat(32));
        await expect(handler(ctx)).resolves.toEqual({ ok: true });
        expect(createSession).toHaveBeenCalledWith("u1", ctx);
        expect(setSessionCookie).toHaveBeenCalled();
    });

    it("rejects an unapproved code with a 401 APIError, not a crash", async () => {
        findOneAndDelete.mockResolvedValue(null);
        const { ctx } = makeCtx("b".repeat(32));
        const err = await handler(ctx).catch((e) => e);
        expect(err).toBeInstanceOf(APIError);
        expect(err.status).toBe("UNAUTHORIZED");
    });
});
