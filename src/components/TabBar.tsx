"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Market", icon: MarketIcon },
  { href: "/create", label: "Build", icon: BuildIcon },
  { href: "/you", label: "You", icon: YouIcon },
] as const;

export function TabBar() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ink/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex w-full max-w-lg">
        {TABS.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-1 py-3 text-[11px] font-medium transition-colors ${
                active ? "text-text" : "text-faint"
              }`}
            >
              <Icon active={active} />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

type IconProps = { active: boolean };

function MarketIcon({ active }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 17.5 9 11l4 4 8-8.5"
        stroke={active ? "var(--color-brand)" : "currentColor"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M15 6.5h6v6" stroke={active ? "var(--color-brand)" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BuildIcon({ active }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8.5" stroke={active ? "var(--color-brand)" : "currentColor"} strokeWidth="2" />
      <path d="M12 8v8M8 12h8" stroke={active ? "var(--color-brand)" : "currentColor"} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function YouIcon({ active }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8.5" r="3.5" stroke={active ? "var(--color-brand)" : "currentColor"} strokeWidth="2" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" stroke={active ? "var(--color-brand)" : "currentColor"} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
