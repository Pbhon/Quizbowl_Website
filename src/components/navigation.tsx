"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, CalendarDays, GraduationCap, LayoutDashboard, Layers, Menu, X } from "lucide-react";
import { useState } from "react";
import { useAuth } from "./auth-provider";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/practice", label: "Practice", icon: BookOpen },
  { href: "/decks", label: "Study decks", icon: Layers },
  { href: "/calendar", label: "Team calendar", icon: CalendarDays },
];

export function Navigation() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const { user, loading, logout } = useAuth();
  return <header className="border-b bg-white">
    <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
      <Link href="/" className="flex items-center gap-3 font-semibold tracking-tight text-xl"><span className="rounded-xl bg-primary p-2 text-primary-foreground"><GraduationCap aria-hidden size={24} /></span>QuizBowl<span className="hidden text-sm font-normal text-muted-foreground sm:inline"> / Team workspace</span></Link>
      <div className="flex items-center gap-2">
        {loading ? <span role="status" className="text-sm text-muted-foreground">Checking session…</span> : user ? <><span className="hidden max-w-48 truncate text-sm text-muted-foreground sm:block" title={user.email || undefined}>Signed in · {user.displayName || user.email}</span><Button variant="outline" onClick={async () => { try { await logout(); } catch { setError(true); } }}>Sign out</Button></> : <><span className="hidden rounded-full bg-highlight-soft px-3 py-1 text-xs font-medium text-highlight sm:inline">Guest preview</span><Button asChild variant="outline"><Link href="/login">Sign in</Link></Button></>}
        <Button variant="ghost" size="icon" className="md:hidden" aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} aria-controls="primary-navigation" onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</Button>
      </div>
    </div>
    {error && <p role="alert" className="px-5 text-sm text-destructive">Sign out failed. Please try again.</p>}
    <nav id="primary-navigation" aria-label="Main navigation" className={cn("mx-auto max-w-7xl gap-1 px-5 pb-3 sm:px-8 md:flex", open ? "flex flex-col" : "hidden")}>
      {links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setOpen(false)} aria-current={pathname === href ? "page" : undefined} className={cn("flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors hover:bg-muted", pathname === href ? "bg-accent text-primary" : "text-muted-foreground")}><Icon size={17} aria-hidden />{label}</Link>)}
    </nav>
  </header>;
}
