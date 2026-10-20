'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { saveTradingSettings } from '@/lib/actions/risk.actions';
import { RISK_PCT_LIMITS, UNIVERSES } from '@/config/universes';
import type { EffectiveUniverse, TradingSettingsData, UniverseOverride } from '@/lib/risk';

type Draft = { accountSize: string; universes: Record<string, Record<string, string | boolean>> };

const toDraft = (settings: TradingSettingsData, universes: Record<string, EffectiveUniverse>): Draft => ({
    accountSize: String(settings.accountSize),
    universes: Object.fromEntries(UNIVERSES.map((u) => {
        const e = universes[u.id];
        return [u.id, {
            riskPctPerTrade: String(e.risk.riskPctPerTrade),
            maxOpenPositions: String(e.risk.maxOpenPositions),
            maxSectorExposurePct: String(e.risk.maxSectorExposurePct),
            maxTotalExposurePct: String(e.risk.maxTotalExposurePct),
            regimeGate: e.regimeGate,
            telegramEnabled: e.telegram.enabled,
            minScore: String(e.telegram.minScore),
        }];
    })),
});

const COLUMNS: { key: string; label: string; hint: string; step?: string }[] = [
    { key: 'riskPctPerTrade', label: 'Risk / trade %', hint: `Lost if the stop is hit, ${RISK_PCT_LIMITS.min}-${RISK_PCT_LIMITS.max}%`, step: '0.05' },
    { key: 'maxOpenPositions', label: 'Max positions', hint: 'Open at once in this universe' },
    { key: 'maxSectorExposurePct', label: 'Sector cap %', hint: 'Of the account in one sector' },
    { key: 'maxTotalExposurePct', label: 'Universe cap %', hint: "Of the account in this universe's positions" },
    { key: 'minScore', label: 'Telegram min score', hint: 'Entries below this are not sent' },
];

/** Account size and per-universe overrides of config/universes.ts. Saved per user; the screener uses them at once. */
export default function AccountSettingsForm({ settings, universes }: { settings: TradingSettingsData; universes: Record<string, EffectiveUniverse> }) {
    const router = useRouter();
    const [draft, setDraft] = useState(() => toDraft(settings, universes));
    const [busy, setBusy] = useState(false);
    const field = 'h-9 w-full min-w-20 rounded-[10px] bg-page px-3 text-[13px] text-foreground shadow-[inset_0_0_0_1px_var(--line)] outline-none focus:shadow-[inset_0_0_0_1px_var(--brand)]';

    const setU = (id: string, key: string, value: string | boolean) =>
        setDraft((d) => ({ ...d, universes: { ...d.universes, [id]: { ...d.universes[id], [key]: value } } }));

    const save = async () => {
        setBusy(true);
        const overrides: Record<string, UniverseOverride> = Object.fromEntries(UNIVERSES.map((u) => {
            const v = draft.universes[u.id];
            return [u.id, {
                riskPctPerTrade: Number(v.riskPctPerTrade),
                maxOpenPositions: Number(v.maxOpenPositions),
                maxSectorExposurePct: Number(v.maxSectorExposurePct),
                maxTotalExposurePct: Number(v.maxTotalExposurePct),
                regimeGate: Boolean(v.regimeGate),
                telegram: { enabled: Boolean(v.telegramEnabled), minScore: Number(v.minScore) },
            }];
        }));
        const res = await saveTradingSettings({ accountSize: Number(draft.accountSize), overrides });
        setBusy(false);
        if ('error' in res) {
            toast.error(res.error);
            return;
        }
        // Show what was actually stored (out-of-range values are pulled back into range)
        setDraft((d) => ({ ...d, accountSize: String(res.settings.accountSize) }));
        toast.success('Saved. The screener uses these from now on.');
        router.refresh();
    };

    return (
        <div className="flex flex-col gap-4 p-4 text-[13px]">
            <label className="flex max-w-60 flex-col gap-1 text-[12px] text-faint">
                Account size ($)
                <input inputMode="decimal" className={field} value={draft.accountSize} onChange={(e) => setDraft({ ...draft, accountSize: e.target.value })} />
            </label>
            <div className="overflow-x-auto">
                <table className="data-table text-[13px]">
                    <thead>
                        <tr>
                            <th>Universe</th>
                            {COLUMNS.map((c) => <th key={c.key} title={c.hint}>{c.label}</th>)}
                            <th title="Only take new entries while SPY closes above its 200-day average">Regime gate</th>
                            <th>Telegram</th>
                        </tr>
                    </thead>
                    <tbody>
                        {UNIVERSES.map((u) => (
                            <tr key={u.id}>
                                <td className="whitespace-nowrap py-2 text-foreground">{u.name}</td>
                                {COLUMNS.map((c) => (
                                    <td key={c.key}>
                                        <input inputMode="decimal" aria-label={`${u.name} ${c.label}`} className={field}
                                               value={String(draft.universes[u.id][c.key])} onChange={(e) => setU(u.id, c.key, e.target.value)} />
                                    </td>
                                ))}
                                <td><input type="checkbox" aria-label={`${u.name} regime gate`} checked={Boolean(draft.universes[u.id].regimeGate)} onChange={(e) => setU(u.id, 'regimeGate', e.target.checked)} /></td>
                                <td><input type="checkbox" aria-label={`${u.name} Telegram alerts`} checked={Boolean(draft.universes[u.id].telegramEnabled)} onChange={(e) => setU(u.id, 'telegramEnabled', e.target.checked)} /></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="flex flex-wrap items-center gap-3">
                <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
                    {busy ? <Loader2 className="animate-spin" /> : <Check />} Save settings
                </button>
                <span className="text-[12px] text-faint">
                    Defaults live in config/universes.ts. Position size = account × risk % ÷ (entry − stop), never more than the cash you have.
                </span>
            </div>
        </div>
    );
}
