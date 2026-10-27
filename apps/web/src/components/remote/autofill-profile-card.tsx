"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Save, Trash2, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";

import { ErrorAlert } from "@/components/error-alert";
import { FormField } from "@/components/form-field";
import { Hint } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { request } from "@/lib/api";

interface AutofillData {
  fields: Record<string, string>;
  extra_notes_markdown: string | null;
}

interface Row {
  key: string;
  value: string;
}

/**
 * The questions an ATS asks that a resume does not answer.
 *
 * These are the defaults because they are what actually appears on Greenhouse,
 * Lever, Ashby and Workday forms; a blank profile is why the extension reports
 * "not present in your profile" on almost every field.
 */
const SUGGESTED = [
  "Full name",
  "Email",
  "Phone",
  "LinkedIn",
  "GitHub",
  "Portfolio",
  "Location",
  "Notice period",
  "Earliest start date",
  "Preferred work mode",
  "How did you hear about us",
  "Why this company",
];

function toRows(fields: Record<string, string>): Row[] {
  const rows = Object.entries(fields).map(([key, value]) => ({ key, value }));
  return rows.length
    ? rows
    : SUGGESTED.slice(0, 6).map((key) => ({ key, value: "" }));
}

export function AutofillProfile() {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["autofill-profile"],
    queryFn: () => request<AutofillData>("/api/v1/settings/autofill-profile"),
  });

  useEffect(() => {
    if (data && rows === null) {
      setRows(toRows(data.fields));
      setNotes(data.extra_notes_markdown ?? "");
    }
  }, [data, rows]);

  const save = useMutation({
    mutationFn: (body: AutofillData) =>
      request<AutofillData>("/api/v1/settings/autofill-profile", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: (result) => {
      setSaved(true);
      setRows(toRows(result.fields));
      queryClient.setQueryData(["autofill-profile"], result);
      window.setTimeout(() => setSaved(false), 2500);
    },
  });

  if (isLoading || rows === null) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  const filled = rows.filter((r) => r.key.trim() && r.value.trim()).length;
  const unused = SUGGESTED.filter(
    (s) => !rows.some((r) => r.key.trim().toLowerCase() === s.toLowerCase()),
  );

  const update = (index: number, patch: Partial<Row>) =>
    setRows(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-3">
      {filled === 0 && (
        <div className="bg-warning/12 text-warning flex items-start gap-2 rounded-md px-3 py-2 text-[13px]">
          <Wand2 className="mt-0.5 size-4 shrink-0" />
          <p className="leading-relaxed">
            Nothing stored yet — that is why autofill reports “not present in
            your profile”. Fill in at least your contact details.
          </p>
        </div>
      )}

      <ul className="space-y-1.5">
        {rows.map((row, index) => (
          <li
            key={index}
            className="grid grid-cols-[minmax(0,1fr)_32px] items-center gap-1.5 sm:grid-cols-[minmax(0,250px)_minmax(0,1fr)_32px]"
          >
            <Input
              aria-label={`Question ${index + 1}`}
              value={row.key}
              placeholder="Question"
              onChange={(e) => update(index, { key: e.target.value })}
              className="bg-muted/50 font-medium"
            />
            <Input
              aria-label={`Answer for ${row.key || `question ${index + 1}`}`}
              value={row.value}
              placeholder="Your answer"
              onChange={(e) => update(index, { value: e.target.value })}
              className="max-sm:col-start-1 max-sm:row-start-2"
            />
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground max-sm:col-start-2 max-sm:row-span-2 max-sm:row-start-1"
              aria-label={`Remove ${row.key || `question ${index + 1}`}`}
              onClick={() => setRows(rows.filter((_, i) => i !== index))}
            >
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRows([...rows, { key: "", value: "" }])}
        >
          <Plus />
          Add a row
        </Button>
        {unused.slice(0, 4).map((suggestion) => (
          <Chip
            key={suggestion}
            size="sm"
            onClick={() => setRows([...rows, { key: suggestion, value: "" }])}
          >
            <Plus />
            {suggestion}
          </Chip>
        ))}
      </div>

      <FormField label="Anything else the filler should know">
        {(control) => (
          <Textarea
            {...control}
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Open to remote US-hours roles. Happy to relocate for the right team."
            className="field-sizing-fixed min-h-16 resize-none"
          />
        )}
      </FormField>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={save.isPending}
          onClick={() =>
            save.mutate({
              fields: Object.fromEntries(
                rows
                  .filter((r) => r.key.trim() && r.value.trim())
                  .map((r) => [r.key.trim(), r.value.trim()]),
              ),
              extra_notes_markdown: notes.trim() || null,
            })
          }
        >
          {save.isPending ? <Spinner /> : <Save />}
          Save profile
        </Button>
        {saved && (
          <span className="text-success flex items-center gap-1.5 text-xs font-medium">
            <Check className="size-4 stroke-[2.4]" />
            Saved
          </span>
        )}
        <Hint quiet className="ml-auto text-xs tabular-nums">
          {filled} answer{filled === 1 ? "" : "s"} stored
        </Hint>
      </div>

      {save.isError && <ErrorAlert>{(save.error as Error).message}</ErrorAlert>}
    </div>
  );
}
