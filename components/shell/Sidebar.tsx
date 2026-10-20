'use client';

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Briefcase, Crosshair, Gauge, LayoutDashboard, ListFilter, LogOut, MessageSquare, Search, Star } from "lucide-react";
import { openSearch } from "@/components/SearchCommand";
import { signOut } from "@/lib/actions/auth.actions";
import { cn } from "@/lib/utils";
import Logo from "@/components/Logo";
import { BRAND_FULL } from "@/lib/brand";

type SidebarProps = {
    user: User;
    watchlist: { symbol: string; company: string }[];
};

const Sidebar = ({ user, watchlist }: SidebarProps) => {
    const pathname = usePathname();
    const router = useRouter();

    const handleSignOut = async () => {
        await signOut();
        router.push('/sign-in');
    };

    return (
        <aside className="sidebar">
            <Link href="/" className="px-2 pt-1 pb-2" aria-label={`${BRAND_FULL} screener`}>
                <Logo />
            </Link>

            <button type="button" onClick={openSearch} className="side-cta">
                <Search className="size-4" strokeWidth={2.5} />
                <span className="flex-1 text-left">Search stocks</span>
                <kbd className="kbd bg-on-brand/10">⌘K</kbd>
            </button>

            <nav className="flex flex-col gap-0.5">
                <Link href="/" className={cn('side-item', pathname === '/' && 'is-active')}>
                    <ListFilter /> Screener
                </Link>
                <Link href="/positions" className={cn('side-item', pathname === '/positions' && 'is-active')}>
                    <Briefcase /> Positions
                </Link>
                <Link href="/performance" className={cn('side-item', pathname === '/performance' && 'is-active')}>
                    <Gauge /> Performance
                </Link>
                <Link href="/dashboard" className={cn('side-item', pathname === '/dashboard' && 'is-active')}>
                    <LayoutDashboard /> Market
                </Link>
                <Link href="/watchlist" className={cn('side-item', pathname === '/watchlist' && 'is-active')}>
                    <Star /> <span className="flex-1">Watchlist</span>
                    <span className="num text-xs text-faint">{watchlist.length}</span>
                </Link>
                <Link href="/setups" className={cn('side-item', pathname === '/setups' && 'is-active')}>
                    <Crosshair /> Setups
                </Link>
                <Link href="/chat" className={cn('side-item', pathname === '/chat' && 'is-active')}>
                    <MessageSquare /> Ask
                </Link>
            </nav>

            <div className="flex min-h-0 flex-col gap-1">
                <p className="side-label shrink-0">Watching</p>
                {watchlist.length === 0 ? (
                    <p className="px-2.5 text-[12.5px] text-faint">Star a stock to pin it here.</p>
                ) : (
                    <ul className="scrollbar-hide-default flex min-h-0 flex-col gap-0.5 overflow-y-auto">
                        {watchlist.map(({ symbol, company }) => (
                            <li key={symbol}>
                                <Link
                                    href={`/stocks/${symbol}`}
                                    title={company}
                                    className={cn('side-item h-8 font-medium', pathname === `/stocks/${symbol}` && 'is-active')}
                                >
                                    <span className="mono w-14 shrink-0 text-[12.5px] font-semibold text-foreground">{symbol}</span>
                                    {company !== symbol && <span className="truncate text-[12.5px] text-faint">{company}</span>}
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <div className="mt-auto flex items-center gap-2.5 border-t border-line pt-3 px-1">
                <Link href="/profile" className={cn('-m-1 flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] p-1 transition-colors hover:bg-white/5', pathname === '/profile' && 'bg-white/5')}>
                    <span className="grid size-8 flex-none place-items-center rounded-full bg-brand-soft text-[13px] font-bold text-brand-ink">
                        {user.name?.[0]?.toUpperCase() ?? '?'}
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-foreground">{user.name}</span>
                        <span className="block truncate text-[12px] text-faint">{user.email}</span>
                    </span>
                </Link>
                <button type="button" onClick={handleSignOut} className="icon-btn" title="Sign out" aria-label="Sign out">
                    <LogOut />
                </button>
            </div>
        </aside>
    );
};

export default Sidebar;
