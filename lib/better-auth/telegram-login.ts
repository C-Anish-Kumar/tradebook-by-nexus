import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { connectToDatabase } from "@/database/mongoose";
import { TelegramLogin } from "@/database/models/telegram-login.model";
import { NotificationSettings } from "@/database/models/notification.model";
import { telegramEmail } from "@/lib/mail-config";

/**
 * Sign in by Telegram: consumes an approved login (one use), finds the account linked to that chat or makes a new one,
 * and starts a normal Better Auth session. The email on a Telegram-made account is a placeholder that can't receive mail.
 */
export const telegramLogin = () => ({
    id: "telegram-login",
    endpoints: {
        signInTelegram: createAuthEndpoint("/sign-in/telegram", { method: "POST" }, async (ctx) => {
            const body = ctx.body as { code?: unknown } | undefined;
            const code = typeof body?.code === "string" ? body.code : "";
            await connectToDatabase();
            const login = code.length === 32
                ? await TelegramLogin.findOneAndDelete({ code, status: "approved", expiresAt: { $gt: new Date() } }).lean()
                : null;
            if (!login?.chatId) throw APIError.from("UNAUTHORIZED", { code: "TELEGRAM_LOGIN_NOT_APPROVED", message: "Sign-in was not approved." });

            const linked = await NotificationSettings.findOne({ telegramChatId: login.chatId }, { userId: 1 }).lean();
            let user = linked ? await ctx.context.internalAdapter.findUserById(linked.userId) : null;
            if (!user) {
                user = await ctx.context.internalAdapter.createUser({
                    email: telegramEmail(login.chatId),
                    emailVerified: true,
                    name: login.tgName?.replace(/^@/, "") || "Telegram user",
                    country: "CA",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                });
                await NotificationSettings.updateMany({ telegramChatId: login.chatId }, { $unset: { telegramChatId: 1, telegramName: 1 } });
                await NotificationSettings.updateOne(
                    { userId: user.id },
                    { $set: { telegramChatId: login.chatId, telegramName: login.tgName ?? "" } },
                    { upsert: true },
                );
            }
            const session = await ctx.context.internalAdapter.createSession(user.id);
            if (!session) throw APIError.from("INTERNAL_SERVER_ERROR", { code: "SESSION_FAILED", message: "Could not start a session." });
            await setSessionCookie(ctx, { session, user });
            return ctx.json({ ok: true });
        }),
    },
});
