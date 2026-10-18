import { cn } from "@/lib/utils";
import { BRAND_NAME } from "@/lib/brand";

// Ledger-and-candle mark plus the wordmark; the site font keeps it crisp at any size
export const LogoMark = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 32 32" className={cn('size-8 flex-none', className)} aria-hidden>
        <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--brand)" />
        <path d="M9 8v16" stroke="var(--on-brand)" strokeWidth="2.2" strokeLinecap="round" />
        <rect x="7" y="11" width="4" height="7" rx="1.2" fill="var(--on-brand)" />
        <path d="M16 7v18" stroke="var(--on-brand)" strokeWidth="2.2" strokeLinecap="round" />
        <rect x="14" y="13" width="4" height="8" rx="1.2" fill="var(--on-brand)" />
        <path d="M23 9v12" stroke="var(--on-brand)" strokeWidth="2.2" strokeLinecap="round" />
        <rect x="21" y="10" width="4" height="6" rx="1.2" fill="var(--on-brand)" />
    </svg>
);

const Logo = ({ className }: { className?: string }) => (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
        <LogoMark />
        <span className="flex flex-col leading-none">
            <span className="text-[19px] font-bold tracking-[-0.04em] text-foreground">{BRAND_NAME}</span>
        </span>
    </span>
);

export default Logo;
