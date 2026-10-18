'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { pollTelegramLogin, startTelegramLogin } from '@/lib/actions/telegram-login.actions';

// Set by the auth layout (a server component) so the button only appears when the bot is configured
export const TelegramLoginEnabled = createContext(false);

type Pending = { code: string; match: string; url: string };

export default function TelegramLoginButton() {
    const enabled = useContext(TelegramLoginEnabled);
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [pending, setPending] = useState<Pending | null>(null);
    const timer = useRef<ReturnType<typeof setInterval> | null>(null);

    const stop = () => { if (timer.current) clearInterval(timer.current); timer.current = null; };
    useEffect(() => stop, []);

    if (!enabled) return null;

    const begin = async () => {
        setBusy(true);
        // Open the tab first so Safari doesn't block it as a pop-up
        const tab = window.open('', '_blank');
        const res = await startTelegramLogin().catch(() => ({ error: 'Check your connection and try again.' }));
        setBusy(false);
        if ('error' in res) { tab?.close(); toast.error('Telegram sign-in failed', { description: res.error }); return; }
        if (tab) tab.location.href = res.url;
        setPending(res);
        stop();
        const started = Date.now();
        timer.current = setInterval(async () => {
            const r = await pollTelegramLogin(res.code).catch(() => null);
            if (r?.status === 'ok') { stop(); router.push('/dashboard'); router.refresh(); }
            else if (r?.status === 'expired' || Date.now() - started > 10 * 60_000) {
                stop(); setPending(null);
                toast.error('Sign-in expired', { description: 'Start again when you are ready.' });
            }
        }, 2500);
    };

    if (pending) {
        return (
            <div className="mb-5 rounded-lg border border-line p-4 text-[13px] text-muted-foreground">
                <p>In Telegram, tap <b className="text-foreground">Approve</b> if the bot shows this number:</p>
                <p className="num my-3 text-center text-[34px] text-foreground">{pending.match}</p>
                <p className="flex items-center gap-2 text-faint"><Loader2 className="size-3.5 animate-spin" /> Waiting for approval…</p>
                <div className="mt-3 flex gap-3">
                    <a href={pending.url} target="_blank" rel="noreferrer" className="footer-link">Open Telegram again</a>
                    <button type="button" className="footer-link" onClick={() => { stop(); setPending(null); }}>Cancel</button>
                </div>
            </div>
        );
    }

    return (
        <Button type="button" onClick={begin} disabled={busy} className="yellow-btn mb-5 w-full gap-2">
            {busy ? <Loader2 className="animate-spin" /> : <Send className="size-5" />} Continue with Telegram
        </Button>
    );
}
