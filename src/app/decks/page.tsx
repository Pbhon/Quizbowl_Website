import { StudyDecks } from "@/components/study-decks";
import { PageHeading } from "@/components/page-heading";
export default function DecksPage() {
  return (
    <div className="space-y-8">
      <PageHeading
        title="Study decks"
        description="Collect original questions, organize topics, and study full-question flashcards."
      />
      <StudyDecks />
    </div>
  );
}
