"use client";

import { X } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

import { cn } from "@/lib/utils";

/**
 * The search panel's tag field: dark chips and the typing cursor share one
 * soft box. Same behaviour as `TagInput` (Enter or a comma adds, Backspace on
 * an empty draft removes the last, pasting "a, b" adds both); this one only
 * lays the chips inside the field, which suits a narrow panel.
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
        "bg-input focus-within:bg-card focus-within:border-foreground/80 flex min-h-11 flex-wrap items-center gap-1.5 rounded-[14px] border border-transparent px-2 py-1.5 transition-colors",
      )}
    >
      {value.map((item) => (
        <span
          key={item}
          className="bg-primary text-primary-foreground inline-flex h-7 items-center gap-1 rounded-full pr-1.5 pl-3 text-[12.5px] font-semibold"
        >
          {item}
          <button
            type="button"
            aria-label={`Remove ${item}`}
            className="text-primary-foreground/60 hover:text-primary-foreground rounded-full p-0.5 transition-colors"
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
        className="placeholder:text-muted-foreground h-7 min-w-24 flex-1 bg-transparent px-1.5 text-sm font-medium outline-none"
      />
    </div>
  );
}
