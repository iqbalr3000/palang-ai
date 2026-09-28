"use client";

import { KeyRound, LayoutDashboard, ScrollText, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const GROUPS = [
  {
    label: "Monitor",
    links: [
      { href: "/", label: "Overview", icon: LayoutDashboard },
      { href: "/events", label: "Events", icon: ScrollText },
    ],
  },
  {
    label: "Manage",
    links: [
      { href: "/keys", label: "API keys", icon: KeyRound },
      { href: "/config", label: "Config", icon: SlidersHorizontal },
    ],
  },
] as const;

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 md:flex-col md:gap-5">
      {GROUPS.map((group) => (
        <div key={group.label} className="flex gap-1 md:flex-col">
          <p className="hidden px-3 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase md:block">
            {group.label}
          </p>
          {group.links.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                  active &&
                    "bg-primary/10 font-medium text-nav-active-foreground hover:bg-primary/10 hover:text-nav-active-foreground dark:bg-primary/15",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
