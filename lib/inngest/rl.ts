import { inngest } from "@/lib/inngest/client";
import { connectToDatabase } from "@/database/mongoose";
import { RlRun } from "@/database/models/rl-run.model";
import { NexusJobMissingError, getNexusJob, startNexusJob, type Algo } from "@/lib/nexus";

// A run takes 2-15 minutes and a sweep up to an hour on a free Space; give up after about 90
const POLL_INTERVAL = '30s';
const MAX_POLLS = 180;

const setFields = async (runId: string, fields: Record<string, unknown>) => {
    await connectToDatabase();
    await RlRun.updateOne({ _id: runId }, { $set: fields });
};

export const runRlJob = inngest.createFunction(
    {
        id: 'run-rl-job',
        triggers: [{ event: 'app/rl.requested' }],
        onFailure: async ({ event, error }) => {
            const runId = event.data.event.data.runId as string;
            await setFields(runId, { status: 'error', error: error.message.slice(0, 500) });
        },
    },
    async ({ event, step }) => {
        const runId = event.data.runId as string;

        const job = await step.run('start-job', async () => {
            await connectToDatabase();
            const run = await RlRun.findById(runId).lean();
            if (!run) throw new Error(`RL run ${runId} not found`);
            const { id } = await startNexusJob(run.kind, {
                template: run.template,
                tickers: run.tickers.length ? run.tickers : undefined,
                timesteps: run.timesteps,
                ...(run.kind === 'sweep'
                    ? { algos: run.algos as Algo[], seeds: run.seeds }
                    : { algo: run.algos[0] as Algo }),
            });
            await setFields(runId, { status: 'running', jobId: id });
            return { id };
        });

        for (let i = 0; i < MAX_POLLS; i++) {
            await step.sleep(`wait-${i}`, POLL_INTERVAL);

            const outcome = await step.run(`poll-${i}`, async () => {
                try {
                    const result = await getNexusJob(job.id);
                    if (result.status === 'done') {
                        await setFields(runId, { status: 'done', result: result.result });
                        return 'done';
                    }
                    if (result.status === 'error') {
                        await setFields(runId, { status: 'error', error: result.error ?? 'Training failed' });
                        return 'error';
                    }
                    return 'pending';
                } catch (error) {
                    if (error instanceof NexusJobMissingError) {
                        await setFields(runId, { status: 'error', error: error.message });
                        return 'error';
                    }
                    // A sleeping Space or a network blip: keep polling
                    console.warn('Nexus poll failed, will retry:', error);
                    return 'pending';
                }
            });

            if (outcome !== 'pending') return { runId, outcome };
        }

        await step.run('time-out', () =>
            setFields(runId, { status: 'error', error: 'Training took too long and was stopped' }));
        return { runId, outcome: 'timeout' };
    }
);
