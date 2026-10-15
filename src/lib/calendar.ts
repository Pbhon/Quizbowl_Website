export type CalendarEvent = {
  id: string;
  title: string;
  description: string;
  location: string;
  type: "event" | "competition" | "practice" | "assignment";
  startsAt: string;
  endsAt: string | null;
  published: boolean;
  rsvpEnabled: boolean;
  response?: string;
  responses?: { uid: string; name: string; response: string }[];
};
export type Announcement = {
  id: string;
  title: string;
  description: string;
  published: boolean;
};
export type CalendarWorkspace = {
  isAdmin: boolean;
  events: CalendarEvent[];
  announcements: Announcement[];
};

export function calendarDate(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new Error("Enter a valid date and time.");
  return value;
}
