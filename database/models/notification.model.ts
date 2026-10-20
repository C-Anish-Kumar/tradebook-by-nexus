import { Schema, model, models, type Model } from 'mongoose';

// signals = Strategy 1; setups = Strategy 2; the rest are the playbook strategies (each opt-in)
export type NotificationPrefs = {
    alerts: boolean; daily: boolean; signals: boolean; earnings: boolean;
    setups: boolean; maPullback: boolean; goldenCross: boolean; breakoutRetest: boolean; volumeBounce: boolean;
    rsiDip: boolean; bbSnapback: boolean; macdTrend: boolean; tdExhaustion: boolean;
};

export interface INotificationSettings {
    userId: string;
    telegramChatId?: string;
    telegramName?: string;
    // One-time code the user sends the bot with /start to link their chat
    linkCode?: string;
    linkCodeExpires?: Date;
    prefs: NotificationPrefs;
    // Setup messages below this quant score (0-100) are skipped; 0 sends everything
    minScore?: number;
}

const NotificationSettingsSchema = new Schema<INotificationSettings>(
    {
        userId: { type: String, required: true, unique: true },
        telegramChatId: { type: String, index: true },
        telegramName: { type: String },
        linkCode: { type: String, index: true },
        linkCodeExpires: { type: Date },
        minScore: { type: Number, default: 0, min: 0, max: 100 },
        prefs: {
            alerts: { type: Boolean, default: true },
            daily: { type: Boolean, default: true },
            signals: { type: Boolean, default: true },
            earnings: { type: Boolean, default: true },
            // Opt-in: breakout setups are hypotheses, so nobody gets them without asking
            setups: { type: Boolean, default: false },
            maPullback: { type: Boolean, default: false },
            goldenCross: { type: Boolean, default: false },
            breakoutRetest: { type: Boolean, default: false },
            volumeBounce: { type: Boolean, default: false },
            rsiDip: { type: Boolean, default: false },
            bbSnapback: { type: Boolean, default: false },
            macdTrend: { type: Boolean, default: false },
            tdExhaustion: { type: Boolean, default: false },
        },
    },
    { timestamps: true, versionKey: false }
);

export const NotificationSettings: Model<INotificationSettings> =
    (models?.NotificationSettings as Model<INotificationSettings>) ||
    model<INotificationSettings>('NotificationSettings', NotificationSettingsSchema);
