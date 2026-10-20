import { betterAuth } from "better-auth";
import {mongodbAdapter} from "better-auth/adapters/mongodb";
import {connectToDatabase} from "@/database/mongoose";
import {nextCookies} from "better-auth/next-js";
import { headers } from "next/headers";
import { cache } from "react";
import { inngest } from "@/lib/inngest/client";
import { APIError } from "better-auth/api";
import { ObjectId } from "mongodb";
import { ACCESS_DENIED, isAllowedEmail } from "@/lib/better-auth/access";


type MongoDb = Parameters<typeof mongodbAdapter>[0];

// Typed from the real config, so additional user fields (country, ...) show up in session types
const denied = () => new APIError('FORBIDDEN', { code: ACCESS_DENIED, message: 'This account is not allowed to sign in.' });

const createAuth = (database: MongoDb) => betterAuth({
        database: mongodbAdapter(database),
       secret: process.env.BETTER_AUTH_SECRET,
        baseURL: process.env.BETTER_AUTH_URL,
        // Onboarding answers live on the user so the profile page can show and edit them
        user: {
            additionalFields: {
                country: { type: "string", required: false },
                investmentGoals: { type: "string", required: false },
                riskTolerance: { type: "string", required: false },
                preferredIndustry: { type: "string", required: false },
            },
        },
        // Google is the only way in: no passwords to forget and no emails to deliver. Accounts made with a
        // password before the switch keep their data and are attached to Google by email (linking below).
        emailAndPassword: { enabled: false },
        databaseHooks: {
            user: {
                create: {
                    // Private deployment: sign-ups from anyone but the owner are refused
                    before: async (user) => {
                        if (!isAllowedEmail(user.email)) throw denied();
                    },
                    // New accounts get the AI-written welcome email (the sign-up form used to send this)
                    after: async (user) => {
                        await inngest.send({ name: 'app/user.created', data: { email: user.email, name: user.name } })
                            .catch((error) => console.error('Failed to send app/user.created', error));
                    },
                },
            },
            // Accounts created before the lock-down still exist; refuse them a session
            session: {
                create: {
                    before: async (session) => {
                        const id = session.userId;
                        const user = await database.collection('user').findOne(
                            { _id: (ObjectId.isValid(id) ? new ObjectId(id) : id) as ObjectId },
                            { projection: { email: 1 } },
                        );
                        if (!isAllowedEmail(user?.email)) throw denied();
                    },
                },
            },
        },
        // Signed session cookie for 5 min: pages stop paying a MongoDB round trip per request.
        // Trade-off: a revoked session can stay valid for up to 5 minutes.
        session: {
            cookieCache: { enabled: true, maxAge: 5 * 60 },
        },
        // Signing in with Google attaches to an existing account with the same address, so people who signed
        // up with a password keep their watchlist. Only Google is trusted for this: it verifies the address,
        // and with password sign-up gone nobody can pre-register someone else's email any more.
        account: {
            accountLinking: { enabled: true, trustedProviders: ['google'] },
        },
        // Providers stay disabled until their env vars are set
        socialProviders: {
            google: {
                enabled: !!process.env.GOOGLE_CLIENT_ID,
                clientId: process.env.GOOGLE_CLIENT_ID as string,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
            },
        },
        plugins: [nextCookies()],
});

let authInstance: ReturnType<typeof createAuth> | null = null;

export const getAuth = async () => {
    if (authInstance) return authInstance;

    const mongoose = await connectToDatabase();
    const database = mongoose.connection.db;
    if (!database) {
        throw new Error("MongoDB connection not found!");
    }

    authInstance = createAuth(database);
    return authInstance;
}

export const auth = await getAuth();

// One session lookup per request, shared by layouts, pages and actions. A session that belongs to anyone
// but the owner (made before the lock-down, or still in a 5-minute cookie cache) counts as signed out.
export const getSession = cache(async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    return session && isAllowedEmail(session.user.email) ? session : null;
});

// Server actions are public endpoints: never trust a userId sent from the client.
export const requireUserId = async () => {
    const session = await getSession();
    if (!session?.user) throw new Error("Unauthorized");
    return session.user.id;
}
