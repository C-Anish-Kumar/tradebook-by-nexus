import Link from "next/link";
import React from "react";
import Logo from "@/components/Logo";
import { BRAND_FULL } from "@/lib/brand";
import {redirect} from "next/navigation";
import {getSession} from "@/lib/better-auth/auth";
import ProductPreview from "@/components/landing/ProductPreview";
import { SocialProvidersProvider } from "@/components/forms/SocialAuthButtons";
import { TelegramLoginEnabled } from "@/components/forms/TelegramLoginButton";
import { telegramEnabled } from "@/lib/telegram";

const Layout = async ({ children }: { children : React.ReactNode }) => {

    const session = await getSession();

    if (session?.user) redirect('/dashboard')

    // Same condition that enables the providers in lib/better-auth/auth.ts
    const socialProviders = [
        ...(process.env.GOOGLE_CLIENT_ID ? ['google' as const] : []),
        ...(process.env.GITHUB_CLIENT_ID ? ['github' as const] : []),
    ];
    return (
        <main className="auth-layout">
            <section className="auth-left-section scrollbar-hide-default">
                <Link href="/" className="auth-logo flex items-center gap-2">
                    <Logo />
                </Link>

                <div className="pb-6 lg:pb-8 flex-1">
                    <TelegramLoginEnabled.Provider value={telegramEnabled}>
                        <SocialProvidersProvider enabled={socialProviders}>{children}</SocialProvidersProvider>
                    </TelegramLoginEnabled.Provider>
                </div>
            </section>
            <section className="auth-right-section">
                <div className="z-10 relative lg:mt-4 lg:mb-16">
                    <p className="kicker text-brand-ink">{BRAND_FULL}</p>
                    <blockquote className="auth-blockquote mt-3">
                        Live prices, your watchlist, and an AI analyst team that debates every stock before it rates it.
                    </blockquote>
                </div>
                <div className="relative flex-1" aria-hidden>
                    <div className="auth-dashboard-preview absolute top-0">
                        <ProductPreview />
                    </div>
                </div>
            </section>

        </main>
    )
}
export default Layout
