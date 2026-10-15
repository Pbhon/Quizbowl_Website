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
export function calendarTimestamp(value: unknown): string {
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof value.toDate === "function"
  )
    return calendarDate(value.toDate().toISOString());
  return calendarDate(
    typeof value === "string" ? value.replace(/(?<=:\d{2})Z$/, ".000Z") : value,
  );
}
export function assignmentDeadline(
  id: string,
  data: Record<string, unknown>,
  uid: string,
  isAdmin: boolean,
): CalendarEvent | null {
  if (
    data.published !== true ||
    (!isAdmin &&
      data.audience !== "team" &&
      !(
        data.audience === "students" &&
        Array.isArray(data.studentUids) &&
        data.studentUids.includes(uid)
      ))
  )
    return null;
  let startsAt: string;
  try {
    startsAt = calendarTimestamp(data.dueAt);
  } catch {
    return null;
  }
  return {
    id: `assignment:${id}`,
    title: String(data.title || "Assignment"),
    description: String(data.description || ""),
    location: "",
    type: "assignment",
    startsAt,
    endsAt: null,
    published: true,
    rsvpEnabled: false,
  };
}
