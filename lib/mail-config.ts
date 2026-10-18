/** Email can go out only when SMTP credentials exist. Verification is enforced only then, so a server without mail never locks people out. */
export const mailConfigured = Boolean(process.env.NODEMAILER_EMAIL && process.env.NODEMAILER_PASSWORD);
