// This is a private, single-user deployment: only these Google accounts may sign in.
// ALLOWED_EMAILS (comma-separated) overrides the default owner.
const DEFAULT_OWNER = 'anish03209@gmail.com';

export const allowedEmails = (): string[] =>
    (process.env.ALLOWED_EMAILS || DEFAULT_OWNER)
        .split(',')
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean);

export const isAllowedEmail = (email: string | null | undefined): boolean =>
    !!email && allowedEmails().includes(email.trim().toLowerCase());

// Better Auth appends ?error=<code> to the sign-in URL when a hook rejects the sign-in
export const ACCESS_DENIED = 'ACCESS_DENIED';
