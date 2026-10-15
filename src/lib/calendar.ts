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
