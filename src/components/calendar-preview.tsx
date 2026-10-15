"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { User } from "firebase/auth";
import type { CalendarWorkspace } from "@/lib/calendar";
import { calendarRequest } from "./team-calendar";
import { Notice } from "./form-field";
export function CalendarPreview({ user }: { user: User }) {
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
    .filter(
      (event) => event.published && Date.parse(event.startsAt) >= Date.now(),
    )
    .slice(0, 5);
  return (
    <section className="space-y-3 rounded-xl border bg-card p-5">
      <h2 className="text-lg font-semibold">Upcoming team events</h2>
      {error && <Notice error>{error}</Notice>}
      {!data && !error && <Notice>Loading team events…</Notice>}
      {events?.map((event) => (
        <p key={event.id}>
          <Link className="text-primary underline" href="/calendar">
            {event.title}
          </Link>{" "}
          · {new Date(event.startsAt).toLocaleString()}
        </p>
      ))}
      {events?.length === 0 && <p>No upcoming published events.</p>}
      <Link className="text-primary underline" href="/calendar">
        Open team calendar
      </Link>
    </section>
  );
}
