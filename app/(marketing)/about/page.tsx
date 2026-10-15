import { Bot, Code, Globe } from 'lucide-react';
import PageHero from '@/components/marketing/PageHero';
import SectionHead from '@/components/marketing/SectionHead';
import IconCard from '@/components/marketing/IconCard';
import { REPO_URL } from '@/lib/constants';
import { BRAND_FULL, BRAND_NAME, UPSTREAM_NAME, UPSTREAM_URL } from '@/lib/brand';

export const metadata = {
    title: `About | ${BRAND_FULL}`,
    description: `What ${BRAND_FULL} is and what it is built on.`,
};

const PRINCIPLES = [
    { icon: Globe, title: 'No paywall', body: 'Charts, live prices, watchlists, alerts and AI analysis, free to use.' },
    { icon: Bot, title: 'Research, not tips', body: 'The AI analyst shows its whole debate so you can judge the reasoning yourself. It is never financial advice.' },
    { icon: Code, title: 'Open source', body: 'Every line is public under AGPL-3.0. Read it, run it yourself, or suggest a change.' },
];

export default function AboutPage() {
    return (
        <>
            <PageHero
                kicker="About"
                title="A market terminal for everyone."
                sub={`${BRAND_FULL} brings the tools traders pay for into one free app, with an AI analyst team on call for any stock.`}
            >
                <a href={REPO_URL} target="_blank" rel="noreferrer" className="btn btn-primary h-11 px-5 text-[15px]">See the code</a>
            </PageHero>

            <section className="mx-auto mt-20 max-w-[1200px] px-5">
                <SectionHead kicker="Principles" title="What we won’t compromise on." />
                <div className="grid gap-3 md:grid-cols-3">
                    {PRINCIPLES.map(({ icon, title, body }) => <IconCard key={title} icon={icon} title={title}>{body}</IconCard>)}
                </div>
            </section>

            <section className="mx-auto mt-24 max-w-[1200px] px-5">
                <div className="hatch">
                    <div className="card flex flex-col gap-4 p-8 md:p-12">
                        <p className="kicker text-brand-ink">Built on open source</p>
                        <h2 className="text-[30px] font-bold leading-tight tracking-[-0.04em]">Standing on good foundations.</h2>
                        <p className="max-w-3xl text-[16px] leading-relaxed text-muted-foreground">
                            {BRAND_NAME} is built on <a href={UPSTREAM_URL} target="_blank" rel="noreferrer" className="font-semibold text-brand-ink hover:underline">{UPSTREAM_NAME}</a>,
                            an open-source market app released under AGPL-3.0, and uses{' '}
                            <a href="https://github.com/TauricResearch/TradingAgents" target="_blank" rel="noreferrer" className="font-semibold text-brand-ink hover:underline">TradingAgents</a>{' '}
                            by Tauric Research (Apache-2.0) for its AI analyst. Thank you to both communities.
                        </p>
                    </div>
                </div>
            </section>
        </>
    );
}
