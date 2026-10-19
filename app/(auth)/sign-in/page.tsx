import SocialAuthButtons from "@/components/forms/SocialAuthButtons";
import { ACCESS_DENIED } from "@/lib/better-auth/access";

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
    const { error } = await searchParams;
    return (
        <>
            <h1 className="form-title mb-2">Sign in</h1>
            <p className="mb-8 text-faint">Private workspace.</p>
            {error && (
                <p role="alert" className="mb-5 rounded-lg border border-line p-3 text-sm text-muted-foreground">
                    {error === ACCESS_DENIED ? 'That Google account does not have access.' : 'Sign in failed. Try again.'}
                </p>
            )}
            <SocialAuthButtons />
        </>
    );
}
