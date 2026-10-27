"use client";

import { X } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

import { cn } from "@/lib/utils";

/**
 * The filter sheet's tag field: chips and the typing cursor share one box. Same
 * behaviour as `TagInput` (Enter or a comma adds, Backspace on an empty draft
 * removes the last, pasting "a, b" adds both); this one lays the chips inside
 * the field, which suits a narrow sheet.
 */
export function FilterTags({
  id,
  value,
  onChange,
  placeholder,
  "aria-describedby": describedBy,
}: {
  id?: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  "aria-describedby"?: string;
}) {
  const [draft, setDraft] = useState("");

  function commit(raw: string) {
    const parts = raw
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const part of parts) {
      if (!next.some((v) => v.toLowerCase() === part.toLowerCase())) next.push(part);
    }
    onChange(next);
    setDraft("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit(draft);
    } else if (event.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div
      className={cn(
        "bg-card border-input focus-within:border-ring focus-within:ring-ring/25 flex min-h-8 flex-wrap items-center gap-1 rounded-md border px-1.5 py-1 transition-colors focus-within:ring-2",
      )}
    >
      {value.map((item) => (
        <span
          key={item}
          className="bg-primary text-primary-foreground inline-flex h-5 items-center gap-1 rounded pr-1 pl-2 text-xs font-medium"
        >
          {item}
          <button
            type="button"
            aria-label={`Remove ${item}`}
            className="text-primary-foreground/60 hover:text-primary-foreground rounded p-0.5 transition-colors"
            onClick={() => onChange(value.filter((v) => v !== item))}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        aria-describedby={describedBy}
        value={draft}
        placeholder={value.length ? undefined : placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commit(draft)}
        onPaste={(event) => {
          const text = event.clipboardData.getData("text");
          if (text.includes(",")) {
            event.preventDefault();
            commit(text);
          }
        }}
        className="placeholder:text-muted-foreground h-5 min-w-24 flex-1 bg-transparent px-1 text-[13px] outline-none"
      />
    </div>
  );
}
