import "server-only";

export function siteTeam() {
  const id = process.env.SITE_TEAM_ID || process.env.ADMIN_SIGNUP_TEAM_ID;
  if (!id || !/^[a-zA-Z0-9_-]{1,80}$/.test(id))
    throw new Error("The school's team is not configured.");
  return {
    id,
    name: (process.env.NEXT_PUBLIC_TEAM_NAME || "Your high school")
      .trim()
      .slice(0, 120),
  };
}
