import { transporter } from "@/lib/nodemailer";
import { escapeHtml } from "@/lib/utils";

const encodeUnsafeUrlChars = (url: string) =>
    url.replace(/[^A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]/g, encodeURIComponent);

export const sendVerificationEmail = async ({ email, name, verifyUrl }: { email: string; name?: string | null; verifyUrl: string }) => {
    if (!transporter || !process.env.NODEMAILER_EMAIL) throw new Error('Email credentials not configured');
    const firstName = escapeHtml(name?.trim().split(' ')[0] || 'there');
    const url = encodeUnsafeUrlChars(verifyUrl);
    const html = `
        <div style="background:#000;padding:32px;font-family:Arial,sans-serif;color:#fff;">
            <div style="max-width:560px;margin:0 auto;border:1px solid #333;border-radius:12px;padding:32px;background:#111;">
                <h1 style="margin:0 0 16px;font-size:28px;">Confirm your email</h1>
                <p style="margin:0 0 16px;color:#d4d4d8;">Hi ${firstName},</p>
                <p style="margin:0 0 24px;color:#d4d4d8;line-height:1.6;">Tap the button to confirm this address and finish setting up Apex Tradebook.</p>
                <a href="${escapeHtml(url)}" style="display:inline-block;background:#facc15;color:#111827;padding:12px 20px;border-radius:9999px;text-decoration:none;font-weight:700;">Confirm email</a>
                <p style="margin:24px 0 0;color:#a1a1aa;line-height:1.6;">If you didn't create an account, ignore this email.</p>
            </div>
        </div>`;
    return transporter.sendMail({
        from: `"Apex Tradebook" <${process.env.NODEMAILER_EMAIL}>`,
        to: email,
        subject: 'Confirm your Apex Tradebook email',
        text: `Confirm your email: ${url}`,
        html,
    });
};
