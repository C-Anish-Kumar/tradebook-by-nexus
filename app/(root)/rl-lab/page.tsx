import { BrainCircuit } from 'lucide-react';
import { getRlRun, listRlRuns } from '@/lib/actions/rl.actions';
import { nexusEnabled } from '@/lib/nexus';
import RlLab from '@/components/rl/RlLab';
import Panel from '@/components/Panel';

export const metadata = { title: 'RL Lab | Tradebook by Nexus' };

export default async function RlLabPage() {
    const runs = nexusEnabled ? await listRlRuns() : [];
    // Open on the newest run that has a result
    const latestDone = runs.find((r) => r.status === 'done');
    const latest = latestDone ? await getRlRun(latestDone.id) : null;

    return (
        <>
            <header className="page-head">
                <div>
                    <h1 className="page-title">RL Lab</h1>
                    <p className="page-sub">Train a trading agent on history, then see if it beats buying and holding on data it never saw</p>
                </div>
            </header>
            {nexusEnabled ? (
                <RlLab initialRuns={runs} initialSelected={latest} />
            ) : (
                <Panel>
                    <div className="empty-state py-14">
                        <span className="empty-icon"><BrainCircuit className="size-5" /></span>
                        <h3>RL Lab is off</h3>
                        <p className="max-w-80 text-[13px]">It runs on the Nexus service. Set NEXUS_SERVICE_URL and NEXUS_API_KEY to turn it on.</p>
                    </div>
                </Panel>
            )}
        </>
    );
}
