"use client";

import { X } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A list of short values typed one at a time.
 *
 * Enter or a comma adds the value; Backspace on an empty field removes the
 * last one. Pasting "a, b, c" adds all three. It is a plain input rather than
 * a combobox so it works for skills, countries and search terms alike.
 */
export function TagInput({
  id,
  value,
  onChange,
  placeholder,
  className,
  "aria-describedby": describedBy,
}: {
  id?: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  className?: string;
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
    <div className={cn("space-y-2", className)}>
      <Input
        id={id}
        aria-describedby={describedBy}
        value={draft}
        placeholder={placeholder}
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
      />
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((item) => (
            <li
              key={item}
              className="bg-secondary text-secondary-foreground inline-flex h-6 items-center gap-1 rounded-md pr-1 pl-2 text-xs font-medium"
            >
              {item}
              <button
                type="button"
                aria-label={`Remove ${item}`}
                className="hover:bg-background/60 rounded-sm p-0.5 transition-colors"
                onClick={() => onChange(value.filter((v) => v !== item))}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
