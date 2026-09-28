import { useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import type { Note } from "@/lib/notes";
import { formatWallClock } from "@/lib/wall-clock";
import { cn } from "@/lib/utils";

const CONTENT_MAX_LENGTH = 2000;

const controlClass =
  "inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-sm transition-colors hover:bg-white/20";
const dangerControlClass =
  "inline-flex items-center gap-1.5 rounded-lg border border-red-400/40 bg-red-900/40 px-3 py-1.5 text-sm text-red-200 transition-colors hover:bg-red-900/60";

type Mode = "view" | "edit" | "confirm-delete";

interface Props {
  note: Note;
  childId: string;
}

export default function NoteItem({ note, childId }: Props) {
  const [mode, setMode] = useState<Mode>("view");
  const [content, setContent] = useState(note.content);

  // One form carries both mutations — the clicked submit button supplies `intent` — because
  // HTML cannot issue PUT or DELETE. It is rendered in every state, so the note's id is in the
  // markup as action="/api/notes/<id>" whether or not the row has been interacted with.
  return (
    <form
      method="POST"
      action={`/api/notes/${note.id}`}
      className="rounded-lg border border-white/10 bg-white/5 px-4 py-3"
    >
      <input type="hidden" name="child_id" value={childId} />

      {/* Display-only in every state: an edit changes the text, never the moment. */}
      <p className="mb-2 text-xs text-blue-100/60">{formatWallClock(note.occurred_at)}</p>

      {mode === "edit" ? (
        <textarea
          name="content"
          aria-label="Treść notatki"
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
          }}
          rows={4}
          maxLength={CONTENT_MAX_LENGTH}
          className={cn(
            "w-full resize-y rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white",
            "placeholder-white/40 transition-colors focus:ring-2 focus:ring-purple-400 focus:outline-none",
          )}
        />
      ) : (
        <p className="break-words whitespace-pre-wrap">{note.content}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {mode === "view" && (
          <>
            <button
              type="button"
              className={controlClass}
              onClick={() => {
                setMode("edit");
              }}
            >
              <Pencil className="size-3.5" />
              Edytuj
            </button>
            <button
              type="button"
              className={controlClass}
              onClick={() => {
                setMode("confirm-delete");
              }}
            >
              <Trash2 className="size-3.5" />
              Usuń
            </button>
          </>
        )}

        {mode === "edit" && (
          <>
            <button type="submit" name="intent" value="save" className={controlClass}>
              <Check className="size-3.5" />
              Zapisz
            </button>
            <button
              type="button"
              className={controlClass}
              onClick={() => {
                setContent(note.content);
                setMode("view");
              }}
            >
              <X className="size-3.5" />
              Anuluj
            </button>
          </>
        )}

        {mode === "confirm-delete" && (
          <>
            <button type="submit" name="intent" value="delete" className={dangerControlClass}>
              <Trash2 className="size-3.5" />
              Potwierdź usunięcie
            </button>
            <button
              type="button"
              className={controlClass}
              onClick={() => {
                setMode("view");
              }}
            >
              <X className="size-3.5" />
              Anuluj
            </button>
          </>
        )}
      </div>
    </form>
  );
}
