import { Schema, model, models, type Model } from 'mongoose';

export type NotificationPrefs = { alerts: boolean; daily: boolean; signals: boolean; earnings: boolean };

export interface INotificationSettings {
    userId: string;
    telegramChatId?: string;
    telegramName?: string;
    // One-time code the user sends the bot with /start to link their chat
    linkCode?: string;
    linkCodeExpires?: Date;
    prefs: NotificationPrefs;
}

const NotificationSettingsSchema = new Schema<INotificationSettings>(
    {
        userId: { type: String, required: true, unique: true },
        telegramChatId: { type: String, index: true },
        telegramName: { type: String },
        linkCode: { type: String, index: true },
        linkCodeExpires: { type: Date },
        prefs: {
            alerts: { type: Boolean, default: true },
            daily: { type: Boolean, default: true },
            signals: { type: Boolean, default: true },
            earnings: { type: Boolean, default: true },
        },
    },
    { timestamps: true, versionKey: false }
);

export const NotificationSettings: Model<INotificationSettings> =
    (models?.NotificationSettings as Model<INotificationSettings>) ||
    model<INotificationSettings>('NotificationSettings', NotificationSettingsSchema);
