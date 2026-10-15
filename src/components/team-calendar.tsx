"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { User } from "firebase/auth";
import { useAuth } from "./auth-provider";
import { AccountGuard } from "./account-guard";
import { PageHeading } from "./page-heading";
import { FormField, Notice } from "./form-field";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import type { CalendarWorkspace, CalendarEvent } from "@/lib/calendar";
export async function calendarRequest(
  user: User,
  body?: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const response = await fetch("/api/calendar", {
    method: body ? "POST" : "GET",
    cache: "no-store",
    signal,
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Please retry.");
  return data;
}
export function TeamCalendar() {
  const { user, access } = useAuth();
  return (
    <AccountGuard>
      {user && (
        <Calendar
          key={`${user.uid}:${access.role}:${access.teamId}`}
          user={user}
        />
      )}
    </AccountGuard>
  );
}
function Calendar({ user }: { user: User }) {
  const [data, setData] = useState<CalendarWorkspace | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    calendarRequest(user, undefined, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setData(value);
          setError("");
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, [user, revision]);
  return (
    <div className="space-y-6">
      <PageHeading
        title="Team calendar"
        description="Shared school events and team plans. Times use your local time zone."
      />
      <Button
        variant="outline"
        onClick={() => {
          setData(null);
          setError("");
          setRevision((n) => n + 1);
        }}
      >
        Refresh calendar
      </Button>
      {error && <Notice error>{error}</Notice>}
      {!data && !error && <Notice>Loading calendar…</Notice>}
      {data && <MonthView events={data.events} />}
      {data?.isAdmin && (
        <EventForm
          key={editing?.id || "new"}
          user={user}
          event={editing}
          done={() => {
            setEditing(null);
            setRevision((n) => n + 1);
          }}
        />
      )}
      {editing && (
        <Button variant="outline" onClick={() => setEditing(null)}>
          Cancel editing
        </Button>
      )}
      {data && !data.events.length && <Notice>No team events yet.</Notice>}
      {data?.events.map((event) => (
        <Card key={event.id} id={`calendar-${event.id}`}>
          <CardContent className="space-y-3 pt-6">
            <h2 className="text-lg font-semibold">{event.title}</h2>
            {event.location && <p>Location: {event.location}</p>}
            {event.description && (
              <p className="whitespace-pre-wrap break-words">
                {event.description}
              </p>
            )}
            <p>{new Date(event.startsAt).toLocaleString()}</p>
            <p>
              {event.published ? "Published" : "Draft"} · {event.type}
            </p>
            {event.endsAt && (
              <p>Until {new Date(event.endsAt).toLocaleString()}</p>
            )}
            {event.type === "assignment" && (
              <Link className="text-primary underline" href="/assignments">
                View assignment
              </Link>
            )}
            {data.isAdmin && event.type !== "assignment" && (
              <Button variant="outline" onClick={() => setEditing(event)}>
                Edit event
              </Button>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function MonthView({ events }: { events: CalendarEvent[] }) {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const offset = month.getDay();
  return (
    <section
      aria-label="Monthly calendar"
      className="space-y-3 rounded-xl border bg-card p-3 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="outline"
          onClick={() =>
            setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
          }
        >
          Previous month
        </Button>
        <h2 aria-live="polite" className="font-semibold">
          {month.toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          })}
        </h2>
        <Button
          variant="outline"
          onClick={() =>
            setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
          }
        >
          Next month
        </Button>
      </div>
      <div className="grid grid-cols-7 text-center text-xs" aria-hidden>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <div key={day} className="py-2">
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: offset + days }, (_, index) => {
          const day = index - offset + 1;
          if (day < 1) return <div key={index} />;
          const date = new Date(month.getFullYear(), month.getMonth(), day);
          const items = events.filter(
            (event) =>
              new Date(event.startsAt).toDateString() === date.toDateString(),
          );
          return (
            <div
              key={index}
              className="min-h-20 min-w-0 rounded border p-1 text-xs sm:p-2"
            >
              <time
                dateTime={`${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`}
              >
                {day}
              </time>
              {items.map((event) => (
                <a
                  key={event.id}
                  href={`#calendar-${event.id}`}
                  title={event.title}
                  className="mt-1 block truncate rounded bg-accent p-1 text-primary"
                >
                  {event.title}
                </a>
              ))}
            </div>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">
        Choose an event to read its details below. Refresh to see team updates.
      </p>
    </section>
  );
}

function localDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
function EventForm({
  user,
  event,
  done,
}: {
  user: User;
  event: CalendarEvent | null;
  done: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Card>
      <CardContent className="pt-6">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            const form = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            try {
              await calendarRequest(user, {
                action: event ? "update" : "create",
                id: event?.id,
                title: form.get("title"),
                description: form.get("description"),
                location: form.get("location"),
                type: form.get("type"),
                startsAt: new Date(String(form.get("startsAt"))).toISOString(),
                endsAt: form.get("endsAt")
                  ? new Date(String(form.get("endsAt"))).toISOString()
                  : null,
                published: form.get("published") === "on",
              });
              done();
            } catch (failure) {
              setError(
                failure instanceof Error ? failure.message : "Please retry.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <h2 className="text-lg font-semibold">
            {event ? "Edit event" : "Create event"}
          </h2>
          <fieldset disabled={busy} className="space-y-4">
            <FormField id="event-type" label="Event type">
              <select
                id="event-type"
                name="type"
                className="form-select"
                defaultValue={event?.type || "event"}
              >
                <option value="event">Other event</option>
                <option value="competition">Competition / tournament</option>
                <option value="practice">Team practice</option>
              </select>
            </FormField>
            <FormField id="event-title" label="Event title">
              <Input
                id="event-title"
                name="title"
                required
                maxLength={120}
                defaultValue={event?.title}
              />
            </FormField>
            <FormField id="event-start" label="Starts at">
              <Input
                id="event-start"
                name="startsAt"
                type="datetime-local"
                required
                defaultValue={localDate(event?.startsAt)}
              />
            </FormField>
            <FormField id="event-location" label="Location">
              <Input
                id="event-location"
                name="location"
                maxLength={300}
                defaultValue={event?.location}
              />
            </FormField>
            <FormField id="event-description" label="Description">
              <textarea
                id="event-description"
                name="description"
                className="form-select min-h-24"
                maxLength={2000}
                defaultValue={event?.description}
              />
            </FormField>
            <FormField id="event-end" label="Ends at (optional)">
              <Input
                id="event-end"
                name="endsAt"
                type="datetime-local"
                defaultValue={localDate(event?.endsAt)}
              />
            </FormField>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="published"
                defaultChecked={event?.published}
              />
              Publish event
            </label>
            <Button type="submit">{busy ? "Saving…" : "Save event"}</Button>
          </fieldset>
          {error && <Notice error>{error}</Notice>}
        </form>
      </CardContent>
    </Card>
  );
}
