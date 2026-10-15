import { inngest } from "@/lib/inngest/client";
import { connectToDatabase } from "@/database/mongoose";
import { Analysis } from "@/database/models/analysis.model";
import { AnalystJobMissingError, getAnalystJob, startAnalystJob } from "@/lib/analyst";

// A run usually takes 5-15 minutes; give up after about 45
const POLL_INTERVAL = '30s';
const MAX_POLLS = 90;

const setFields = async (analysisId: string, fields: Record<string, unknown>) => {
    await connectToDatabase();
    await Analysis.updateOne({ _id: analysisId }, { $set: fields });
};

export const runAnalysis = inngest.createFunction(
    {
        id: 'run-ai-analysis',
        triggers: [{ event: 'app/analysis.requested' }],
        onFailure: async ({ event, error }) => {
            const analysisId = event.data.event.data.analysisId as string;
            await setFields(analysisId, { status: 'error', error: error.message.slice(0, 500) });
        },
    },
    async ({ event, step }) => {
        const analysisId = event.data.analysisId as string;

        const job = await step.run('start-job', async () => {
            await connectToDatabase();
            const analysis = await Analysis.findById(analysisId).lean();
            if (!analysis) throw new Error(`Analysis ${analysisId} not found`);
            const { id } = await startAnalystJob(analysis.symbol, analysis.tradeDate);
            await setFields(analysisId, { status: 'running', jobId: id });
            return { id };
        });

        for (let i = 0; i < MAX_POLLS; i++) {
            await step.sleep(`wait-${i}`, POLL_INTERVAL);

            const outcome = await step.run(`poll-${i}`, async () => {
                try {
                    const result = await getAnalystJob(job.id);
                    if (result.status === 'done') {
                        await setFields(analysisId, {
                            status: 'done',
                            rating: result.rating,
                            reportHtml: result.report_html,
                        });
                        return 'done';
                    }
                    if (result.status === 'error') {
                        await setFields(analysisId, { status: 'error', error: result.error ?? 'Analysis failed' });
                        return 'error';
                    }
                    return 'pending';
                } catch (error) {
                    if (error instanceof AnalystJobMissingError) {
                        await setFields(analysisId, { status: 'error', error: error.message });
                        return 'error';
                    }
                    // A sleeping Space or a network blip: keep polling
                    console.warn('Analyst poll failed, will retry:', error);
                    return 'pending';
                }
            });

            if (outcome !== 'pending') return { analysisId, outcome };
        }

        await step.run('time-out', () =>
            setFields(analysisId, { status: 'error', error: 'The analysis took too long and was stopped' }));
        return { analysisId, outcome: 'timeout' };
    }
);
