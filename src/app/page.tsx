import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Layers,
  Sparkles,
} from "lucide-react";
import { WorkspaceAction } from "@/components/workspace-action";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const areas = [
  {
    href: "/practice",
    title: "Practice with purpose",
    description:
      "Practice real tossups and bonuses, check your answers, and track your progress.",
    icon: BookOpen,
    label: "Explore practice",
  },
  {
    href: "/decks",
    title: "Build your knowledge",
    description:
      "Keep your study materials in one place. Custom decks are coming in a later phase.",
    icon: Layers,
    label: "Explore study decks",
  },
  {
    href: "/calendar",
    title: "Stay in the loop",
    description:
      "A home for team practices and tournaments. Shared events will appear here once enabled.",
    icon: CalendarDays,
    label: "View team calendar",
  },
];

export default function Home() {
  return (
    <div className="space-y-10">
      <section className="grid overflow-hidden rounded-2xl border bg-card md:grid-cols-[1.5fr_1fr]">
        <div className="p-7 sm:p-12">
          <p className="eyebrow mb-5">Your next clue starts here</p>
          <h1 className="max-w-xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Curiosity becomes
            <br />
            your competitive edge.
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground">
            A shared home for your quizbowl team. Make room for focused
            practice, thoughtful study, and everything you learn along the way.
          </p>
          <WorkspaceAction />
        </div>
        <div className="flex flex-col justify-center gap-6 border-t bg-highlight-soft p-8 sm:p-12 md:border-t-0 md:border-l">
          <Sparkles size={36} className="text-highlight" aria-hidden />
          <p className="text-2xl font-medium leading-relaxed tracking-tight">
            Great answers begin
            <br />
            with good questions.
          </p>
          <p className="text-sm leading-6 text-muted-foreground">
            Your account and team access are ready. Connect with your team, set
            up your profile, and prepare for what comes next.
          </p>
        </div>
      </section>
      <section aria-labelledby="workspace-heading">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
          <h2
            id="workspace-heading"
            className="text-2xl font-semibold tracking-tight"
          >
            Your workspace
          </h2>
          <span className="text-sm text-muted-foreground">
            A place for every part of preparation
          </span>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {areas.map(({ href, title, description, icon: Icon, label }) => (
            <Card key={href}>
              <CardHeader>
                <Icon className="mb-3 text-primary" size={25} aria-hidden />
                <CardTitle>{title}</CardTitle>
                <CardDescription className="leading-6">
                  {description}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link
                  href={href}
                  className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
                >
                  {label}
                  <ArrowRight size={16} aria-hidden />
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
