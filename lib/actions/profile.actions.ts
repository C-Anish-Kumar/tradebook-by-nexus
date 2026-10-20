'use server';

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/better-auth/auth";

export type ProfileInput = {
    name: string;
    country: string;
};

// Every call acts on the signed-in user's own session; nothing here takes a user id from the client.
export async function updateProfile(input: ProfileInput) {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 80) return { success: false, error: 'Name must be 2 to 80 characters.' };
    if (!/^[A-Z]{2}$/.test(input.country)) return { success: false, error: 'Pick a country.' };

    try {
        await auth.api.updateUser({
            headers: await headers(),
            body: {
                name,
                country: input.country,
            },
        });
        revalidatePath('/', 'layout');
        return { success: true };
    } catch (e) {
        console.error('Profile update failed', e);
        return { success: false, error: 'Couldn’t save your profile.' };
    }
}
