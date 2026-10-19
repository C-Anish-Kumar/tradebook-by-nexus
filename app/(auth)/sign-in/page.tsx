import SocialAuthButtons from "@/components/forms/SocialAuthButtons";

export default function SignIn() {
    return (
        <>
            <h1 className="form-title mb-2">Welcome</h1>
            <p className="mb-8 text-faint">Sign in with your Google account to get to your watchlist and alerts. New here? The same button creates your account.</p>
            <SocialAuthButtons />
            <p className="mt-6 text-[12.5px] text-faint">
                Signed up with an email and password before? Use Google with that same address and you&rsquo;ll land in your existing account.
            </p>
        </>
    );
}
