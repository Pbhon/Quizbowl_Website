"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  CalendarDays,
  GraduationCap,
  History,
  LayoutDashboard,
  Layers,
  Menu,
  Settings,
  Users,
  UserRound,
  X,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "./auth-provider";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

import { teamName } from "@/lib/team";

const workspaceLinks = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/practice", label: "Practice", icon: BookOpen },
  { href: "/decks", label: "Study decks", icon: Layers },
  { href: "/calendar", label: "Team calendar", icon: CalendarDays },
];
export function Navigation() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const { user, profile, access, loading, logout } = useAuth();
  const links = [
    ...workspaceLinks,
    ...(user
      ? [
          { href: "/dashboard", label: "My dashboard", icon: LayoutDashboard },
          { href: "/history", label: "Question history", icon: History },
          { href: "/profile", label: "Profile", icon: UserRound },
          { href: "/settings", label: "Settings", icon: Settings },
          ...(access.role !== "student"
            ? [{ href: "/team", label: "Team dashboard", icon: Users }]
            : []),
        ]
      : []),
  ];
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-5 py-4 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:gap-3"
        >
          <span className="rounded-xl bg-primary p-2 text-primary-foreground">
            <GraduationCap aria-hidden size={22} />
          </span>
          QuizBowl
          <span className="ml-1 hidden border-l pl-4 text-sm font-normal text-muted-foreground lg:inline">
            {teamName}
          </span>
        </Link>
        <div className="flex items-center gap-2">
          {loading ? (
            <span role="status" className="text-xs text-muted-foreground">
              Checking session…
            </span>
          ) : user ? (
            <>
              <Link
                href="/profile"
                className="hidden max-w-48 truncate text-sm text-muted-foreground sm:block"
                title={user.email || undefined}
              >
                {profile?.displayName || user.displayName || user.email}
              </Link>
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(false);
                  try {
                    await logout();
                    setOpen(false);
                  } catch {
                    setError(true);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Signing out…" : "Sign out"}
              </Button>
            </>
          ) : (
            <Button asChild variant="outline">
              <Link href="/login">Sign in</Link>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={open ? "Close navigation" : "Open navigation"}
            aria-expanded={open}
            aria-controls="primary-navigation"
            onClick={() => setOpen(!open)}
          >
            {open ? <X /> : <Menu />}
          </Button>
        </div>
      </div>
      {error && (
        <p
          role="alert"
          className="mx-auto max-w-7xl px-5 pb-3 text-sm text-destructive"
        >
          Sign out failed. Please try again.
        </p>
      )}
      <nav
        id="primary-navigation"
        aria-label="Main navigation"
        className={cn(
          "mx-auto max-w-7xl gap-1 px-5 pb-3 sm:px-8 md:flex md:flex-wrap",
          open ? "flex flex-col" : "hidden",
        )}
      >
        {links.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            aria-current={pathname === href ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-muted",
              pathname === href
                ? "bg-accent text-primary"
                : "text-muted-foreground",
            )}
          >
            <Icon size={16} aria-hidden />
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
