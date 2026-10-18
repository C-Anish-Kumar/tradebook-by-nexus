import { Schema, model, models, type Model } from 'mongoose';

// A sign-in started in a browser and approved in Telegram. The code is secret to that browser; `match` is the
// two-digit number shown on both screens so a person can't be tricked into approving someone else's request.
export interface ITelegramLogin {
    code: string;
    match: string;
    status: 'pending' | 'approved';
    chatId?: string;
    tgName?: string;
    expiresAt: Date;
}

const TelegramLoginSchema = new Schema<ITelegramLogin>(
    {
        code: { type: String, required: true, unique: true },
        match: { type: String, required: true },
        status: { type: String, enum: ['pending', 'approved'], default: 'pending' },
        chatId: String,
        tgName: String,
        // MongoDB removes the document shortly after this time
        expiresAt: { type: Date, required: true, index: { expires: 0 } },
    },
    { versionKey: false },
);

export const TelegramLogin: Model<ITelegramLogin> =
    (models?.TelegramLogin as Model<ITelegramLogin>) || model<ITelegramLogin>('TelegramLogin', TelegramLoginSchema);
