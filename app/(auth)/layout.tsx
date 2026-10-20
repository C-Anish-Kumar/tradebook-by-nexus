import React from "react";
import Logo from "@/components/Logo";
import {redirect} from "next/navigation";
import {getSession} from "@/lib/better-auth/auth";
import { SocialProvidersProvider } from "@/components/forms/SocialAuthButtons";

const Layout = async ({ children }: { children : React.ReactNode }) => {

    const session = await getSession();

    if (session?.user) redirect('/')

    // Same condition that enables the provider in lib/better-auth/auth.ts
    const socialProviders = process.env.GOOGLE_CLIENT_ID ? ['google' as const] : [];
    return (
        <main className="grid min-h-dvh place-items-center bg-page px-6">
            <section className="w-full max-w-sm">
                <div className="mb-10"><Logo /></div>
                <SocialProvidersProvider enabled={socialProviders}>{children}</SocialProvidersProvider>
            </section>
        </main>
    )
}
export default Layout
