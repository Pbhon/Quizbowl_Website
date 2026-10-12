import { PageHeading } from "@/components/page-heading";
import { Practice } from "@/components/practice";
export default function PracticePage() {
  return (
    <div className="space-y-8">
      <PageHeading
        title="Practice"
        description="Build a session of QBReader tossups or bonuses, buzz in, and check your answers."
      />
      <Practice />
    </div>
  );
}
