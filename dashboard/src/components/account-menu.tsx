"use client";

import { ChevronsUpDown, LogOut, Monitor, Moon, Palette, Sun } from "lucide-react";
import { logout } from "@/app/login/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/hooks/use-theme";
import { isTheme } from "@/lib/theme";

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

export function AccountMenu() {
  const [theme, setTheme] = useTheme();

  return (
    <DropdownMenu>
      {/* Avatar only on small screens, where the sidebar is a top bar. */}
      <DropdownMenuTrigger className="flex cursor-pointer items-center gap-2.5 rounded-md p-2 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-accent md:w-full">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
          A
        </span>
        <span className="hidden min-w-0 flex-1 flex-col leading-tight md:flex">
          <span className="truncate text-sm font-medium">Admin</span>
          <span className="truncate text-xs text-muted-foreground">Dashboard</span>
        </span>
        <ChevronsUpDown className="hidden size-4 shrink-0 text-muted-foreground md:block" />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side="top"
        align="start"
        className="w-(--radix-dropdown-menu-trigger-width) min-w-52"
      >
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Signed in as admin
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Palette className="text-muted-foreground" />
            Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={theme ?? undefined}
              onValueChange={(value) => isTheme(value) && setTheme(value)}
            >
              {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  <Icon className="text-muted-foreground" />
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        {/* A real form submit: works without JS, and the server action does the redirect. */}
        <form action={logout}>
          <DropdownMenuItem variant="destructive" asChild>
            <button type="submit" className="w-full">
              <LogOut />
              Sign out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
