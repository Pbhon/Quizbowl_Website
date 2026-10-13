"use client";
import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { useAuth } from "./auth-provider";
import { AccountGuard } from "./account-guard";
import { PageHeading } from "./page-heading";
import { FormField, Notice } from "./form-field";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import type {
  AssignmentWorkspace,
  PracticeAssignment,
} from "@/lib/assignments";

async function requestAssignments(
  user: User,
  body?: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const response = await fetch("/api/assignments", {
    method: body ? "POST" : "GET",
    cache: "no-store",
    signal,
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Please retry.");
  return data;
}
export function Assignments() {
  const { user, access } = useAuth();
  return (
    <AccountGuard staff>
      {user && (
        <Workspace
          key={`${user.uid}:${access.role}:${access.teamId}`}
          user={user}
        />
      )}
    </AccountGuard>
  );
}
function Workspace({ user }: { user: User }) {
  const [data, setData] = useState<AssignmentWorkspace | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<PracticeAssignment | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    requestAssignments(user, undefined, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setData(value);
          setError("");
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, [user, revision]);
  return (
    <div className="space-y-6">
      <PageHeading
        title="Practice assignments"
        description="Create and publish practice work for your school."
      />
      <Button
        variant="outline"
        onClick={() => {
          setData(null);
          setError("");
          setRevision((n) => n + 1);
        }}
      >
        Refresh assignments
      </Button>
      {error && <Notice error>{error}</Notice>}
      {!data && !error && <Notice>Loading assignments…</Notice>}
      {data && (
        <>
          <AssignmentForm
            key={editing?.id || "new"}
            user={user}
            assignment={editing}
            data={data}
            done={() => {
              setEditing(null);
              setRevision((n) => n + 1);
            }}
          />
          {editing && (
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel editing
            </Button>
          )}
          {!data.assignments.length && <Notice>No assignments yet.</Notice>}
          {data.assignments.map((assignment) => (
            <Card key={assignment.id}>
              <CardContent className="space-y-3 pt-6">
                <h2 className="text-lg font-semibold">{assignment.title}</h2>
                <p className="whitespace-pre-wrap">{assignment.description}</p>
                <p>
                  {assignment.published ? "Published" : "Draft"} ·{" "}
                  {assignment.questionCount} {assignment.type} questions
                </p>
                <Button
                  variant="outline"
                  onClick={() => setEditing(assignment)}
                >
                  Edit assignment
                </Button>
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
function AssignmentForm({
  user,
  assignment,
  data,
  done,
}: {
  user: User;
  assignment: PracticeAssignment | null;
  data: AssignmentWorkspace;
  done: () => void;
}) {
  const [title, setTitle] = useState(assignment?.title || "");
  const [description, setDescription] = useState(assignment?.description || "");
  const [published, setPublished] = useState(assignment?.published || false);
  const [questionCount, setQuestionCount] = useState(
    assignment?.questionCount ?? 10,
  );
  const [difficultyMin, setDifficultyMin] = useState(
    assignment?.difficultyMin ?? 0,
  );
  const [difficultyMax, setDifficultyMax] = useState(
    assignment?.difficultyMax ?? 10,
  );
  const [type, setType] = useState(assignment?.type ?? "tossup");
  const [audience, setAudience] = useState(assignment?.audience || "team");
  const [studentUids, setStudentUids] = useState<string[]>(
    assignment?.studentUids || [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  return (
    <Card>
      <CardContent className="pt-6">
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            setError("");
            setNotice("");
            try {
              await requestAssignments(user, {
                action: assignment ? "update" : "create",
                id: assignment?.id,
                title,
                description,
                published,
                questionCount,
                difficultyMin,
                difficultyMax,
                type,
                audience,
                studentUids,
              });
              setNotice("Assignment saved.");
              if (!assignment) {
                setTitle("");
                setDescription("");
                setPublished(false);
              }
              done();
            } catch (failure) {
              setError(
                failure instanceof Error ? failure.message : "Please retry.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <h2 className="text-lg font-semibold">
            {assignment ? "Edit assignment" : "Create assignment"}
          </h2>
          <fieldset disabled={busy} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField id="assignment-count" label="Question count">
                <Input
                  id="assignment-count"
                  type="number"
                  required
                  min={1}
                  max={500}
                  value={questionCount}
                  onChange={(event) =>
                    setQuestionCount(Number(event.target.value))
                  }
                />
              </FormField>
              <FormField id="assignment-min" label="Minimum difficulty">
                <Input
                  id="assignment-min"
                  type="number"
                  required
                  min={0}
                  max={10}
                  value={difficultyMin}
                  onChange={(event) =>
                    setDifficultyMin(Number(event.target.value))
                  }
                />
              </FormField>
              <FormField id="assignment-max" label="Maximum difficulty">
                <Input
                  id="assignment-max"
                  type="number"
                  required
                  min={difficultyMin}
                  max={10}
                  value={difficultyMax}
                  onChange={(event) =>
                    setDifficultyMax(Number(event.target.value))
                  }
                />
              </FormField>
            </div>
            <FormField id="assignment-type" label="Question type">
              <select
                id="assignment-type"
                className="form-select"
                value={type}
                onChange={(event) =>
                  setType(event.target.value as "tossup" | "bonus")
                }
              >
                <option value="tossup">Tossup</option>
                <option value="bonus">Bonus</option>
              </select>
            </FormField>
            <FormField id="assignment-title" label="Title">
              <Input
                id="assignment-title"
                required
                maxLength={120}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </FormField>
            <FormField id="assignment-description" label="Instructions">
              <textarea
                id="assignment-description"
                className="form-select min-h-24"
                maxLength={2000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </FormField>
            <label className="flex items-center gap-2">
              <span>Assign to</span>
              <select
                aria-label="Assign to"
                className="form-select"
                value={audience}
                onChange={(event) => {
                  setAudience(event.target.value as "team" | "students");
                  setStudentUids([]);
                }}
              >
                <option value="team">Entire team</option>
                <option value="students">Selected students / group</option>
              </select>
            </label>
            {audience === "students" && (
              <fieldset className="space-y-2">
                <legend>Students / group</legend>
                <p className="text-sm text-muted-foreground">
                  Select one student or a group of current students. This
                  selection is saved with the assignment.
                </p>
                {data.students.map((student) => (
                  <label key={student.uid} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={studentUids.includes(student.uid)}
                      onChange={(event) =>
                        setStudentUids(
                          event.target.checked
                            ? [...studentUids, student.uid]
                            : studentUids.filter((uid) => uid !== student.uid),
                        )
                      }
                    />
                    {student.displayName}
                  </label>
                ))}
                {!data.students.length && <Notice>No current students.</Notice>}
              </fieldset>
            )}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={published}
                onChange={(event) => setPublished(event.target.checked)}
              />
              Publish assignment
            </label>
            <Button type="submit">
              {busy ? "Saving…" : "Save assignment"}
            </Button>
          </fieldset>
          {error && <Notice error>{error}</Notice>}
          {notice && <Notice>{notice}</Notice>}
        </form>
      </CardContent>
    </Card>
  );
}
