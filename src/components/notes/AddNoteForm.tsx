import React, { useState, useSyncExternalStore } from "react";
import { Clock, NotebookPen, Plus } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { TextAreaField } from "@/components/auth/TextAreaField";
import { SubmitButton } from "@/components/auth/SubmitButton";

const CONTENT_MAX_LENGTH = 2000;

interface Props {
  childId: string;
}

// Browser-local wall clock as YYYY-MM-DDTHH:mm — the shape a `datetime-local` field submits
// and the shape `occurred_at` stores. toISOString would give UTC, which is a different minute.
function localNow() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `${date}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function subscribeNoop() {
  return () => undefined;
}

export default function AddNoteForm({ childId }: Props) {
  const [content, setContent] = useState("");
  // Undefined on the server so the server-rendered markup (UTC) doesn't mismatch the browser's
  // local time. Without JavaScript the field stays empty and the endpoint defaults it.
  const now = useSyncExternalStore(subscribeNoop, localNow, () => undefined);
  const [touchedOccurredAt, setTouchedOccurredAt] = useState<string | null>(null);
  const occurredAt = touchedOccurredAt ?? now ?? "";
  const [errors, setErrors] = useState<{ content?: string; occurredAt?: string }>({});

  function validate() {
    const next: typeof errors = {};
    const trimmed = content.trim();
    if (!trimmed) {
      next.content = "Treść notatki jest wymagana";
    } else if (trimmed.length > CONTENT_MAX_LENGTH) {
      next.content = `Notatka może mieć maksymalnie ${CONTENT_MAX_LENGTH} znaków`;
    }
    if (occurredAt && occurredAt > localNow()) {
      next.occurredAt = "Data i godzina nie mogą być w przyszłości";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function clearError(field: keyof typeof errors) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
    }
  }

  return (
    <form method="POST" action="/api/notes" className="space-y-4" onSubmit={handleSubmit} noValidate>
      <input type="hidden" name="child_id" value={childId} />

      <TextAreaField
        id="content"
        label="Notatka"
        value={content}
        onChange={(v) => {
          setContent(v);
          clearError("content");
        }}
        placeholder="np. Zjadła całą marchewkę bez marudzenia"
        maxLength={CONTENT_MAX_LENGTH}
        rows={4}
        error={errors.content}
        icon={<NotebookPen className="size-4" />}
      />

      <FormField
        id="occurred_at"
        type="datetime-local"
        label="Kiedy to było"
        value={occurredAt}
        onChange={(v) => {
          setTouchedOccurredAt(v);
          clearError("occurredAt");
        }}
        max={now}
        error={errors.occurredAt}
        icon={<Clock className="size-4" />}
      />

      <SubmitButton pendingText="Zapisywanie..." icon={<Plus className="size-4" />}>
        Dodaj notatkę
      </SubmitButton>
    </form>
  );
}
