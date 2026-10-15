"use client";
import { useState } from "react";
import type { User } from "firebase/auth";
import type { Announcement, CalendarWorkspace } from "@/lib/calendar";
import { calendarRequest } from "./team-calendar";
import { FormField, Notice } from "./form-field";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
export function TeamAnnouncements({
  data,
  user,
  done,
}: {
  data: CalendarWorkspace;
  user: User;
  done: () => void;
}) {
  const [editing, setEditing] = useState<Announcement | null>(null);
  return (
    <section className="space-y-4 rounded-xl border bg-card p-5">
      <h2 className="text-lg font-semibold">Team announcements</h2>
      {data.isAdmin && (
        <AnnouncementForm
          key={editing?.id || "new"}
          user={user}
          announcement={editing}
          done={() => {
            setEditing(null);
            done();
          }}
        />
      )}
      {editing && (
        <Button variant="outline" onClick={() => setEditing(null)}>
          Cancel announcement editing
        </Button>
      )}
      {!data.announcements.length && <p>No announcements yet.</p>}
      {data.announcements.map((item) => (
        <article key={item.id} className="space-y-2 border-t pt-3">
          <h3 className="font-semibold break-words">
            {item.title} {!item.published && "(Draft)"}
          </h3>
          <p className="whitespace-pre-wrap break-words">{item.description}</p>
          {data.isAdmin && (
            <Button variant="outline" onClick={() => setEditing(item)}>
              Edit announcement
            </Button>
          )}
        </article>
      ))}
    </section>
  );
}
function AnnouncementForm({
  user,
  announcement,
  done,
}: {
  user: User;
  announcement: Announcement | null;
  done: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const element = e.currentTarget,
          form = new FormData(element);
        setBusy(true);
        setError("");
        try {
          await calendarRequest(user, {
            kind: "announcement",
            action: announcement ? "update" : "create",
            id: announcement?.id,
            title: form.get("title"),
            description: form.get("description"),
            published: form.get("published") === "on",
          });
          if (!announcement) element.reset();
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
      <h3 className="font-semibold">
        {announcement ? "Edit announcement" : "Create announcement"}
      </h3>
      <fieldset disabled={busy} className="space-y-3">
        <FormField id="announcement-title" label="Announcement title">
          <Input
            id="announcement-title"
            name="title"
            required
            maxLength={120}
            defaultValue={announcement?.title}
          />
        </FormField>
        <FormField id="announcement-body" label="Announcement message">
          <textarea
            id="announcement-body"
            name="description"
            className="form-select min-h-24"
            required
            maxLength={2000}
            defaultValue={announcement?.description}
          />
        </FormField>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="published"
            defaultChecked={announcement?.published}
          />
          Publish announcement
        </label>
        <Button type="submit">{busy ? "Saving…" : "Save announcement"}</Button>
      </fieldset>
      {error && <Notice error>{error}</Notice>}
    </form>
  );
}
