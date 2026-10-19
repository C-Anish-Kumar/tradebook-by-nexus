import { auth } from "@/lib/better-auth/auth";
import { toNextJsHandler } from "better-auth/next-js";

// Needed for OAuth callbacks (/api/auth/callback/google)
export const { GET, POST } = toNextJsHandler(auth);
