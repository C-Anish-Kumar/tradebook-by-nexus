import nodemailer from 'nodemailer';
import {
    WELCOME_EMAIL_TEMPLATE,
    STOCK_ALERT_UPPER_EMAIL_TEMPLATE,
    STOCK_ALERT_LOWER_EMAIL_TEMPLATE,
} from "@/lib/nodemailer/templates";
import { escapeHtml, formatPrice } from "@/lib/utils";
import { withMailRetry } from "@/lib/nodemailer/retry";

type EmailSendResult =
    | { status: 'skipped' }
    | { status: 'sent'; messageId: string };

const hasEmailConfig = Boolean(process.env.NODEMAILER_EMAIL && process.env.NODEMAILER_PASSWORD);

if (!hasEmailConfig) {
    console.warn('⚠️ Email credentials are not configured. Welcome and news summary emails are disabled until NODEMAILER_EMAIL and NODEMAILER_PASSWORD are set.');
}

export const transporter = hasEmailConfig
    ? nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.NODEMAILER_EMAIL!,
            pass: process.env.NODEMAILER_PASSWORD!,
        },
        // No pool: on Vercel a pooled connection sits idle while the function is frozen and comes back dead.
        // A fresh connection per email costs a moment and email volume here is low.
    })
    : null;

/** sendMail with retries for dropped connections. Every email in the app goes through this. */
export const sendMail = (options: Parameters<NonNullable<typeof transporter>["sendMail"]>[0]) => {
    if (!transporter) throw new Error('Email credentials not configured');
    return withMailRetry(() => transporter.sendMail(options));
};

if (transporter) {
    transporter.verify((error) => {
        if (error) {
            console.error('❌ Nodemailer transporter verification failed:', error);
        } else {
            console.log('✅ Nodemailer transporter is ready to send emails');
        }
    });
}

export const sendWelcomeEmail = async ({ email, name, intro }: WelcomeEmailData) => {
    try {
        if (!transporter) {
            console.warn('⚠️ Welcome email skipped: email credentials are not configured.');
            return { status: 'skipped' } satisfies EmailSendResult;
        }

        const htmlTemplate = WELCOME_EMAIL_TEMPLATE
            .replace('{{name}}', name)
            .replace('{{intro}}', intro);

        const mailOptions = {
            from: `"Apex Tradebook" <${process.env.NODEMAILER_EMAIL}>`,
            to: email,
            subject: `Welcome to Apex Tradebook - your stock market toolkit`,
            text: 'Thanks for joining Apex Tradebook',
            html: htmlTemplate,
        };

        const info = await sendMail(mailOptions);
        console.log('✅ Welcome email sent successfully:', info.messageId);
        return { status: 'sent', messageId: info.messageId } satisfies EmailSendResult;
    } catch (error) {
        console.error('❌ Failed to send welcome email:', error);
        throw error;
    }
}

export const sendStockAlertEmail = async (
    { email, symbol, currentPrice, targetPrice, condition }:
    { email: string; symbol: string; currentPrice: number; targetPrice: number; condition: 'ABOVE' | 'BELOW' }
) => {
    try {
        if (!transporter) {
            console.warn('⚠️ Stock alert email skipped: email credentials are not configured.');
            return { status: 'skipped' } satisfies EmailSendResult;
        }

        const isUpper = condition === 'ABOVE';
        // Binance pairs are quoted in USDT, everything else Finnhub prices here is USD
        const money = (value: number) => symbol.startsWith('BINANCE:')
            ? `${value.toLocaleString('en-US', { maximumFractionDigits: value < 1 ? 6 : 2 })} USDT`
            : formatPrice(value);
        const htmlTemplate = (isUpper ? STOCK_ALERT_UPPER_EMAIL_TEMPLATE : STOCK_ALERT_LOWER_EMAIL_TEMPLATE)
            .replaceAll('{{symbol}}', escapeHtml(symbol))
            .replaceAll('{{company}}', '') // Alerts don't store the company name
            .replaceAll('{{currentPrice}}', money(currentPrice))
            .replaceAll('{{targetPrice}}', money(targetPrice))
            .replaceAll('{{timestamp}}', new Date().toUTCString());

        const mailOptions = {
            from: `"Apex Tradebook" <${process.env.NODEMAILER_EMAIL}>`,
            to: email,
            subject: `🔔 Price Alert: ${symbol} is ${isUpper ? 'above' : 'below'} ${money(targetPrice)}`,
            text: `${symbol} is now ${money(currentPrice)}, ${isUpper ? 'above' : 'below'} your target of ${money(targetPrice)}.`,
            html: htmlTemplate,
        };

        const info = await sendMail(mailOptions);
        console.log('✅ Stock alert email sent successfully:', info.messageId);
        return { status: 'sent', messageId: info.messageId } satisfies EmailSendResult;
    } catch (error) {
        console.error('❌ Failed to send stock alert email:', error);
        throw error;
    }
};
