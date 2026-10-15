import { isValidObjectId } from "mongoose";
import { connectToDatabase } from "@/database/mongoose";
import { Analysis } from "@/database/models/analysis.model";
import { getSession } from "@/lib/better-auth/auth";

// The full TradingAgents report, served as its own page. The HTML comes from the analyst
// service, so the CSP sandbox keeps it from running scripts or reaching this origin.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session?.user) return new Response('Unauthorized', { status: 401 });

    const { id } = await params;
    if (!isValidObjectId(id)) return new Response('Not found', { status: 404 });

    await connectToDatabase();
    const analysis = await Analysis.findOne({ _id: id, userId: session.user.id }).select('reportHtml').lean();
    if (!analysis?.reportHtml) return new Response('Not found', { status: 404 });

    return new Response(analysis.reportHtml, {
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'private, no-store',
        },
    });
}
