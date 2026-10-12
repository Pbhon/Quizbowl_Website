export type Role = "student" | "teacher" | "admin";
export type Preferences = {
  theme: "light" | "dark" | "system";
  reducedMotion: boolean;
};
export type Profile = {
  displayName: string;
  bio: string;
  grade: string;
  preferences: Preferences;
};
export type Access = { role: Role; teamId: string | null };

export const defaultPreferences: Preferences = {
  theme: "system",
  reducedMotion: false,
};
export const roleLabels: Record<Role, string> = {
  student: "Student",
  teacher: "Teacher",
  admin: "Administrator",
};
export const grades = [
  "",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
  "college",
  "other",
];
