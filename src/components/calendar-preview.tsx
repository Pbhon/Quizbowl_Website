"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { User } from "firebase/auth";
import type { CalendarWorkspace } from "@/lib/calendar";
import { calendarRequest } from "./team-calendar";
import { Notice } from "./form-field";
export function CalendarPreview({
  user,
  announcementsOnly = false,
}: {
  user: User;
  announcementsOnly?: boolean;
}) {
  const [now] = useState(() => Date.now());
  const [data, setData] = useState<CalendarWorkspace | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    calendarRequest(user, undefined, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, [user]);
  const events = data?.events
    .filter((event) => event.published && Date.parse(event.startsAt) >= now)
    .slice(0, 5);
  return (
    <section className="space-y-3 rounded-xl border bg-card p-5">
      <h2 className="text-lg font-semibold">
        {announcementsOnly
          ? "Team announcements"
          : "Upcoming team events and announcements"}
      </h2>
      {error && <Notice error>{error}</Notice>}
      {!data && !error && <Notice>Loading team events…</Notice>}
      {!announcementsOnly &&
        events?.map((event) => (
          <p key={event.id}>
            <Link className="text-primary underline" href="/calendar">
              {event.title}
            </Link>{" "}
            · {new Date(event.startsAt).toLocaleString()}
          </p>
        ))}
      {!announcementsOnly && events?.length === 0 && (
        <p>No upcoming published events.</p>
      )}
      {data?.announcements
        .filter((item) => item.published)
        .slice(0, 3)
        .map((item) => (
          <article key={item.id}>
            <h3 className="font-semibold break-words">{item.title}</h3>
            <p className="whitespace-pre-wrap break-words">
              {item.description}
            </p>
          </article>
        ))}
      {announcementsOnly &&
        data &&
        !data.announcements.some((item) => item.published) && (
          <p>No published announcements.</p>
        )}
      <Link className="text-primary underline" href="/calendar">
        Open team calendar
      </Link>
    </section>
  );
}
