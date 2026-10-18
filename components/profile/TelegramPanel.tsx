"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Unlink } from "lucide-react";
import { toast } from "sonner";
import {
    createTelegramLink,
    disconnectTelegram,
    getTelegramStatus,
    sendTelegramTest,
    updateTelegramPrefs,
    type TelegramStatus,
} from "@/lib/actions/notification.actions";
import type { NotificationPrefs } from "@/database/models/notification.model";
import { cn } from "@/lib/utils";
import { enabledStrategies } from "@/lib/strategies";

const STRATEGY_DETAIL: Record<string, string> = {
    ema_supertrend: 'when a watched stock turns into an entry, trim or exit',
    breakout: 'a fresh breakout entry or exit on a watched stock, with its quant score and evidence',
};

const OPTIONS: { key: keyof NotificationPrefs; label: string; detail: string }[] = [
    { key: 'alerts', label: 'Price alerts', detail: 'The moment one of your alerts triggers' },
    { key: 'daily', label: 'Daily summary', detail: 'Your watchlist after each US market close' },
    // One switch per strategy that is turned on; a strategy that is off never appears here
    ...enabledStrategies().map((s) => ({ key: s.telegramPref, label: `${s.label}: ${s.name}`, detail: STRATEGY_DETAIL[s.id] })),
    { key: 'earnings', label: 'Earnings', detail: 'The day before a watched stock reports, then beat or miss' },
];

export default function TelegramPanel({ initial }: { initial: TelegramStatus }) {
    const [status, setStatus] = useState(initial);
    const [busy, setBusy] = useState<string | null>(null);
    const [waiting, setWaiting] = useState(false);
    const poll = useRef<ReturnType<typeof setInterval> | null>(null);

    // After opening the bot, check every 3 seconds (for up to 3 minutes) whether Start was pressed
    useEffect(() => () => { if (poll.current) clearInterval(poll.current); }, []);
    const startPolling = () => {
        setWaiting(true);
        const started = Date.now();
        if (poll.current) clearInterval(poll.current);
        poll.current = setInterval(async () => {
            const next = await getTelegramStatus().catch(() => null);
            if (next?.connected || Date.now() - started > 180_000) {
                clearInterval(poll.current!);
                setWaiting(false);
                if (next?.connected) {
                    setStatus(next);
                    toast.success('Telegram connected');
                }
            }
        }, 3000);
    };

    const connect = async () => {
        setBusy('connect');
        // Open the tab before awaiting so Safari doesn't block it as a pop-up
        const tab = window.open('', '_blank');
        const res = await createTelegramLink();
        setBusy(null);
        if ('error' in res) {
            tab?.close();
            toast.error(res.error);
            return;
        }
        if (tab) tab.location.href = res.url;
        else window.location.href = res.url;
        startPolling();
    };

    const toggle = async (key: keyof NotificationPrefs) => {
        const prefs = { ...status.prefs, [key]: !status.prefs[key] };
        setStatus({ ...status, prefs });
        await updateTelegramPrefs({ [key]: prefs[key] }).catch(() => {
            setStatus(status);
            toast.error('Could not save. Try again.');
        });
    };

    const test = async () => {
        setBusy('test');
        const res = await sendTelegramTest();
        setBusy(null);
        if ('error' in res) toast.error(res.error);
        else toast.success('Sent. Check Telegram.');
    };

    const disconnect = async () => {
        setBusy('disconnect');
        await disconnectTelegram();
        setBusy(null);
        setStatus({ ...status, connected: false, name: undefined });
    };

    if (!status.enabled) {
        return <p className="p-4 text-[13px] text-faint">Telegram messages aren’t set up on this server yet.</p>;
    }

    if (!status.connected) {
        return (
            <div className="flex flex-col gap-3 p-4">
                <p className="text-[13px] text-muted-foreground">
                    Get price alerts, a daily watchlist summary, trade signals from the strategies you pick and earnings reminders in Telegram. Free, and you can stop any time.
                </p>
                <ol className="list-decimal pl-5 text-[13px] text-muted-foreground">
                    <li>Tap <b>Connect Telegram</b>. Telegram opens.</li>
                    <li>Press <b>Start</b> in the chat with our bot.</li>
                </ol>
                <button type="button" onClick={connect} disabled={busy !== null} className="btn btn-primary self-start">
                    {busy === 'connect' ? <Loader2 className="animate-spin" /> : <Send />} Connect Telegram
                </button>
                {waiting && (
                    <p className="flex items-center gap-2 text-[12.5px] text-faint">
                        <Loader2 className="size-3.5 animate-spin" /> Waiting for you to press Start in Telegram…
                    </p>
                )}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3 p-4">
            <p className="flex items-center gap-2 text-[13px]">
                <span className="pill is-up">Connected</span>
                <span className="text-muted-foreground">{status.name || 'Telegram'}</span>
            </p>
            <ul className="flex flex-col gap-1" aria-label="Messages to send">
                {OPTIONS.map((o) => (
                    <li key={o.key}>
                        <label className="flex cursor-pointer items-center gap-3 rounded-[8px] px-1 py-1.5 hover:bg-hover">
                            <input type="checkbox" checked={status.prefs[o.key]} onChange={() => toggle(o.key)} className="peer sr-only" />
                            <span aria-hidden className={cn(
                                'relative h-5 w-9 flex-none rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--brand)]',
                                status.prefs[o.key] ? 'bg-brand' : 'bg-hover shadow-[inset_0_0_0_1px_var(--line)]',
                            )}>
                                <span className={cn('absolute top-0.5 size-4 rounded-full bg-white transition-all', status.prefs[o.key] ? 'left-[18px]' : 'left-0.5')} />
                            </span>
                            <span className="min-w-0">
                                <span className="block text-[13px] font-semibold">{o.label}</span>
                                <span className="block text-[12px] text-faint">{o.detail}</span>
                            </span>
                        </label>
                    </li>
                ))}
            </ul>
            <div className="flex flex-wrap gap-2">
                <button type="button" onClick={test} disabled={busy !== null} className="btn btn-ghost">
                    {busy === 'test' ? <Loader2 className="animate-spin" /> : <Send />} Send a test
                </button>
                <button type="button" onClick={disconnect} disabled={busy !== null} className="btn btn-ghost">
                    {busy === 'disconnect' ? <Loader2 className="animate-spin" /> : <Unlink />} Disconnect
                </button>
            </div>
        </div>
    );
}
