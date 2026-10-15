"use client";
import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { useAuth } from "./auth-provider";
import { AccountGuard } from "./account-guard";
import { PageHeading } from "./page-heading";
import { Notice } from "./form-field";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import type { CalendarWorkspace } from "@/lib/calendar";
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
      {data && !data.events.length && <Notice>No team events yet.</Notice>}
      {data?.events.map((event) => (
        <Card key={event.id}>
          <CardContent className="space-y-3 pt-6">
            <h2 className="text-lg font-semibold">{event.title}</h2>
            <p>{new Date(event.startsAt).toLocaleString()}</p>
            <p>
              {event.published ? "Published" : "Draft"} · {event.type}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
