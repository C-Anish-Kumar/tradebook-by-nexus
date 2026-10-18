/** Email can go out only when SMTP credentials exist. Verification is enforced only then, so a server without mail never locks people out. */
export const mailConfigured = Boolean(process.env.NODEMAILER_EMAIL && process.env.NODEMAILER_PASSWORD);

/** Placeholder address for accounts made by signing in with Telegram: unique per chat, never deliverable. */
export const telegramEmail = (chatId: string) => `tg${chatId}@telegram.invalid`;
export const hasRealEmail = (email?: string | null): email is string => Boolean(email) && !email!.endsWith('@telegram.invalid');
