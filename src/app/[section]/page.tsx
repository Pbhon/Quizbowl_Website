import { notFound } from "next/navigation";
import Link from "next/link";
import { BookOpen, CalendarDays, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";

const sections = {
  practice: { title: "Practice", icon: BookOpen, description: "Tossup and bonus practice will be available here after the question reader is connected." },
  decks: { title: "Study decks", icon: Layers, description: "Your saved questions and custom study decks will live here once deck creation is enabled." },
  calendar: { title: "Team calendar", icon: CalendarDays, description: "Team practices, competitions, and assignment deadlines will appear here when shared events are enabled." },
};
export function generateStaticParams() { return Object.keys(sections).map(section => ({ section })); }
export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!(section in sections)) notFound();
  const {title, description, icon: Icon} = sections[section as keyof typeof sections];
  return <><p className="text-sm font-medium text-primary">Team workspace</p><h1 className="mt-3 text-4xl font-semibold tracking-tight">{title}</h1><div className="mt-8 rounded-xl border bg-white px-6 py-16 text-center"><Icon className="mx-auto text-primary" size={38} aria-hidden /><h2 className="mt-6 text-xl font-semibold">A little more preparation is underway</h2><p className="mx-auto mt-3 max-w-md leading-7 text-muted-foreground">{description}</p><Button asChild variant="outline" className="mt-6"><Link href="/">Return to overview</Link></Button></div></>;
}
