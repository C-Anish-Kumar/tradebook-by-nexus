import { Metadata } from 'next';
import { BookOpen, ChevronDown, Code2, Github } from 'lucide-react';
import PageHero from '@/components/marketing/PageHero';
import SectionHead from '@/components/marketing/SectionHead';
import IconCard from '@/components/marketing/IconCard';
import { REPO_URL } from '@/lib/constants';
import { BRAND_FULL, BRAND_NAME, SUPPORT_EMAIL } from '@/lib/brand';

export const metadata: Metadata = {
    title: `Help | ${BRAND_FULL}`,
    description: `Answers and support for ${BRAND_FULL}.`,
};

const FAQS = [
    {
        question: `Is ${BRAND_NAME} really free?`,
        answer: 'Yes. Charts, live prices, watchlists, price alerts and AI analysis are free to use. Each account can run a few AI analyses a day.',
    },
    {
        question: 'How does the AI analyst work?',
        answer: 'On any stock page, press Analyze. Analyst agents study the price action, news, fundamentals and social chatter, bull and bear researchers debate, and a trader and risk team settle on a rating from Buy to Sell. It takes 5 to 15 minutes and the full report is saved for you. It is research, not financial advice.',
    },
    {
        question: 'How do I add a stock to my watchlist?',
        answer: 'Press ⌘K (or Search stocks in the sidebar), open the company, then press Watch. It shows up in your watchlist and in the sidebar.',
    },
    {
        question: 'Where does the market data come from?',
        answer: 'Charts come live from TradingView. Quotes, watchlist prices and alerts come from Finnhub; on this site they refresh every 15 seconds and every price shows when it was last traded.',
    },
    {
        question: 'Which markets are supported?',
        answer: 'US stocks, crypto and forex live; Canada and Australia delayed; India (through BSE) and Germany end of day. Alerts work for US stocks and crypto.',
    },
    {
        question: 'My alert hasn’t fired.',
        answer: 'Alerts are checked every five minutes and emailed to your account address when the price crosses your target. Check the alert’s status on the watchlist page, and your spam folder.',
    },
    {
        question: 'Can I see the code?',
        answer: `Yes. ${BRAND_NAME} is open source under AGPL-3.0; the link is in the footer of every page.`,
    },
];

export default function HelpPage() {
    return (
        <>
            <PageHero kicker="Help" title="How can we help?" sub="Answers to the common questions, and where to go next." />

            <section className="mx-auto mt-14 grid max-w-[1200px] gap-3 px-5 md:grid-cols-3">
                <IconCard icon={BookOpen} title="How it works" footer={<a href="/api-docs" className="btn btn-ghost w-full">Read the architecture</a>}>
                    Data sources, background jobs and the AI behind the emails.
                </IconCard>
                <IconCard icon={Code2} title="Source code" footer={<a href={REPO_URL} target="_blank" rel="noreferrer" className="btn btn-ghost w-full">View on GitHub</a>}>
                    Read how everything works, or run your own copy.
                </IconCard>
                <IconCard icon={Github} title="Report a bug" footer={<a href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer" className="btn btn-ghost w-full">Open an issue</a>}>
                    Found something broken? Tell us on GitHub.
                </IconCard>
            </section>

            <section className="mx-auto mt-24 max-w-[1200px] px-5">
                <SectionHead kicker="FAQ" title="Common questions." />
                <div className="hatch">
                    <div className="card row-list overflow-hidden">
                        {FAQS.map(({ question, answer }) => (
                            <details key={question} className="group">
                                {/* Padding lives on the summary so the whole row is the click target, in every browser */}
                                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-semibold text-foreground transition-colors hover:bg-hover/40 [&::-webkit-details-marker]:hidden">
                                    {question}
                                    <ChevronDown className="size-4 flex-none text-faint transition-transform duration-200 group-open:rotate-180" />
                                </summary>
                                <p className="max-w-3xl px-5 pb-5 text-[15px] leading-relaxed text-muted-foreground">{answer}</p>
                            </details>
                        ))}
                    </div>
                </div>
            </section>

            {SUPPORT_EMAIL && (
                <section className="mx-auto mt-24 max-w-[1200px] px-5">
                    <div className="hatch">
                        <div className="card flex flex-col items-start justify-between gap-5 p-8 md:flex-row md:items-center">
                            <div>
                                <h2 className="text-[22px] font-bold tracking-[-0.03em]">Still stuck?</h2>
                                <p className="mt-1 text-muted-foreground">Send us an email and we’ll get back to you.</p>
                            </div>
                            <a href={`mailto:${SUPPORT_EMAIL}`} className="btn btn-primary h-11 px-5 text-[15px]">Email support</a>
                        </div>
                    </div>
                </section>
            )}
        </>
    );
}
