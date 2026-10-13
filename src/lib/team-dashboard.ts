import type { TeamMember } from "@/components/team-dashboard";
import type { buildStatistics } from "./statistics";
export type TeamStatistics = ReturnType<typeof buildStatistics>;
export type TeamDashboardData = {
  members: TeamMember[];
  students: (TeamMember & { statistics: TeamStatistics })[];
  team: TeamStatistics;
  generatedAt: string;
};
