import React, { useState, useSyncExternalStore } from "react";
import { User, Calendar, Plus } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";

const NAME_MAX_LENGTH = 100;

interface Props {
  serverError?: string | null;
}

// Browser-local date as YYYY-MM-DD (toISOString would give the UTC date).
function localToday() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function subscribeNoop() {
  return () => undefined;
}

export default function AddChildForm({ serverError }: Props) {
  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  // Undefined on the server so the server-rendered markup (UTC) doesn't mismatch the browser's local date.
  const maxDate = useSyncExternalStore(subscribeNoop, localToday, () => undefined);
  const [errors, setErrors] = useState<{ name?: string; birthDate?: string }>({});

  function validate() {
    const next: typeof errors = {};
    const trimmed = name.trim();
    if (!trimmed) {
      next.name = "Imię jest wymagane";
    } else if (trimmed.length > NAME_MAX_LENGTH) {
      next.name = `Imię może mieć maksymalnie ${NAME_MAX_LENGTH} znaków`;
    }
    if (birthDate && birthDate > localToday()) {
      next.birthDate = "Data urodzenia nie może być w przyszłości";
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
    <form method="POST" action="/api/children" className="space-y-4" onSubmit={handleSubmit} noValidate>
      <FormField
        id="name"
        label="Imię"
        value={name}
        onChange={(v) => {
          setName(v);
          clearError("name");
        }}
        placeholder="np. Ola"
        maxLength={NAME_MAX_LENGTH}
        error={errors.name}
        icon={<User className="size-4" />}
      />

      <FormField
        id="birth_date"
        type="date"
        label="Data urodzenia (opcjonalnie)"
        value={birthDate}
        onChange={(v) => {
          setBirthDate(v);
          clearError("birthDate");
        }}
        max={maxDate}
        error={errors.birthDate}
        icon={<Calendar className="size-4" />}
      />

      <ServerError message={serverError} />

      <SubmitButton pendingText="Dodawanie..." icon={<Plus className="size-4" />}>
        Dodaj dziecko
      </SubmitButton>
    </form>
  );
}
