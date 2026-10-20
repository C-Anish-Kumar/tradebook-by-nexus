'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { resetAccountKillSwitch, resetKillSwitch } from '@/lib/actions/risk.actions';

/** Resets a kill switch: its drawdown is measured afresh from today. A strategy's or the account's history is kept. */
export default function ResetButton({ strategy, universe, label = 'Reset' }: { strategy?: string; universe?: string; label?: string }) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const reset = async () => {
        if (!confirm('Reset this kill switch? Its drawdown starts again from today. Do this only after you have looked at why it tripped.')) return;
        setBusy(true);
        const res = strategy && universe ? await resetKillSwitch(strategy, universe) : await resetAccountKillSwitch();
        setBusy(false);
        if ('error' in res) toast.error(res.error);
        else router.refresh();
    };
    return (
        <button type="button" className="btn btn-ghost h-7 px-2 text-[12px]" onClick={reset} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />} {label}
        </button>
    );
}
