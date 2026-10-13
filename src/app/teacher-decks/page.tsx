import { StudyDecks } from "@/components/study-decks";
import { PageHeading } from "@/components/page-heading";
export default function TeacherDecksPage() {
  return (
    <div className="space-y-6">
      <PageHeading
        title="Teacher-curated decks"
        description="Create private collections of original questions, organize topic tags, and edit study notes. Add questions from practice or history."
      />
      <StudyDecks teacherCurated />
    </div>
  );
}
