import "server-only";
import { createHash } from "node:crypto";
import type { CalendarEvent } from "@/lib/calendar";
import { calendarDate } from "@/lib/calendar";
function text(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}
function fold(line: string) {
  const parts: string[] = [];
  let current = "",
    size = 0;
  for (const char of line) {
    const bytes = Buffer.byteLength(char, "utf8");
    if (size + bytes > 75) {
      parts.push(current);
      current = " ";
      size = 1;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n");
}
const date = (value: string) =>
  calendarDate(value)
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
// RFC 5545: UTC times, escaped TEXT, CRLF and UTF-8-safe 75-octet folding.
export function calendarICS(
  events: CalendarEvent[],
  teamId: string,
  now = new Date(),
) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//QuizBowl//Team Calendar//EN",
    "CALSCALE:GREGORIAN",
  ];
  for (const event of events.filter((event) => event.published)) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${createHash("sha256").update(`${teamId}\0${event.id}`).digest("hex")}@quizbowl`,
      `DTSTAMP:${date(now.toISOString())}`,
      `DTSTART:${date(event.startsAt)}`,
    );
    if (event.endsAt) lines.push(`DTEND:${date(event.endsAt)}`);
    lines.push(
      `SUMMARY:${text(event.title)}`,
      `DESCRIPTION:${text(event.description || "")}`,
      `LOCATION:${text(event.location || "")}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
