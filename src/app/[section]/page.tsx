import { notFound } from "next/navigation";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeading } from "@/components/page-heading";

const sections = {
  calendar: {
    title: "Team calendar",
    icon: CalendarDays,
    description:
      "Team practices, competitions, and assignment deadlines will appear here when shared events are enabled.",
  },
};
export function generateStaticParams() {
  return Object.keys(sections).map((section) => ({ section }));
}
export default async function SectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!Object.hasOwn(sections, section)) notFound();
  const {
    title,
    description,
    icon: Icon,
  } = sections[section as keyof typeof sections];
  return (
    <div className="space-y-8">
      <PageHeading title={title} description={description} />
      <Card>
        <CardContent className="py-10 text-center">
          <span className="mx-auto inline-flex rounded-2xl bg-accent p-4 text-primary">
            <Icon size={30} aria-hidden />
          </span>
          <h2 className="mt-6 text-xl font-semibold">
            A little more preparation is underway
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-muted-foreground">
            This part of your workspace is coming in a later project phase. Your
            account and team access are ready to use.
          </p>
          <Button asChild variant="outline" className="mt-6">
            <Link href="/">Return to overview</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
