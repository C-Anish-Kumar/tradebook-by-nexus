import { cache } from "react";
import { REPO_URL } from "@/lib/constants";

// Real repo numbers for the public site, refreshed daily. Null hides the stat instead of guessing.
export const getRepoStats = cache(async () => {
    try {
        const res = await fetch(REPO_URL.replace('https://github.com/', 'https://api.github.com/repos/'), {
            next: { revalidate: 86400 },
            signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) return null;
        const repo = await res.json();
        return { stars: repo.stargazers_count as number, forks: repo.forks_count as number, license: repo.license?.spdx_id as string | undefined };
    } catch {
        return null;
    }
});

export const formatCount = (n: number) =>
    new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
