import { useState, type SubmitEvent } from "react";
import { Button } from "@/components/ui/button";

interface Note {
  id: string;
  content: string;
  createdAt: Date;
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function NotesApp() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [content, setContent] = useState("");

  function handleAdd(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed) return;

    setNotes((prev) => [{ id: crypto.randomUUID(), content: trimmed, createdAt: new Date() }, ...prev]);
    setContent("");
  }

  return (
    <div>
      <form onSubmit={handleAdd} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="note-content" className="mb-1 block text-sm text-blue-100/80">
            New note
          </label>
          <textarea
            id="note-content"
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
            }}
            placeholder="Write a note..."
            rows={2}
            className="w-full resize-none rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder-white/40 transition-colors focus:ring-2 focus:ring-purple-400 focus:outline-none"
          />
        </div>
        <Button
          type="submit"
          disabled={!content.trim()}
          className="bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-40"
        >
          Add
        </Button>
      </form>

      <ul className="mt-6 space-y-3">
        {notes.length === 0 ? (
          <li className="text-center text-sm text-blue-100/50">No notes yet — add your first one above.</li>
        ) : (
          notes.map((note) => (
            <li key={note.id} className="rounded-lg border border-white/10 bg-white/5 p-4">
              <p className="whitespace-pre-wrap text-white">{note.content}</p>
              <p className="mt-2 text-xs text-blue-100/50">{dateFormatter.format(note.createdAt)}</p>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
