import { StudyDecks } from "@/components/study-decks";
import { PageHeading } from "@/components/page-heading";
export default function TeacherDecksPage() {
  return (
    <div className="space-y-6">
      <PageHeading
        title="Teacher-curated decks"
        description="Curate original questions and study notes. Share decks with your school's students or keep them private."
      />
      <StudyDecks teacherCurated />
    </div>
  );
}
