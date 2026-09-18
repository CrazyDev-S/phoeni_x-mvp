"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Save, Trash2, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";

import { ErrorAlert } from "@/components/error-alert";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { request } from "@/lib/api";

interface AutofillProfile {
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
  return rows.length ? rows : SUGGESTED.slice(0, 6).map((key) => ({ key, value: "" }));
}

export function AutofillProfileCard() {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["autofill-profile"],
    queryFn: () => request<AutofillProfile>("/api/v1/settings/autofill-profile"),
  });

  useEffect(() => {
    if (data && rows === null) {
      setRows(toRows(data.fields));
      setNotes(data.extra_notes_markdown ?? "");
    }
  }, [data, rows]);

  const save = useMutation({
    mutationFn: (body: AutofillProfile) =>
      request<AutofillProfile>("/api/v1/settings/autofill-profile", {
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
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const filled = rows.filter((r) => r.key.trim() && r.value.trim()).length;
  const unused = SUGGESTED.filter(
    (s) => !rows.some((r) => r.key.trim().toLowerCase() === s.toLowerCase()),
  );

  const update = (index: number, patch: Partial<Row>) =>
    setRows(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Autofill profile</CardTitle>
        <CardDescription>
          What the extension answers application forms with. The form filler is not allowed
          to invent a phone number or a notice period — if it is not here, it hands the
          field back to you.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {filled === 0 && (
          <div className="border-warning/40 bg-warning/10 text-warning flex items-start gap-2.5 rounded-lg border p-3 text-sm">
            <Wand2 className="mt-0.5 size-4 shrink-0" />
            <p className="leading-relaxed">
              Nothing stored yet — that is why autofill reports “not present in your
              profile”. Fill in at least your contact details.
            </p>
          </div>
        )}

        <ul className="space-y-2">
          {rows.map((row, index) => (
            <li key={index} className="flex items-center gap-2">
              <Input
                aria-label={`Question ${index + 1}`}
                value={row.key}
                placeholder="Question"
                onChange={(e) => update(index, { key: e.target.value })}
                className="w-1/3 min-w-32"
              />
              <Input
                aria-label={`Answer for ${row.key || `question ${index + 1}`}`}
                value={row.value}
                placeholder="Your answer"
                onChange={(e) => update(index, { value: e.target.value })}
                className="flex-1"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${row.key || `question ${index + 1}`}`}
                onClick={() => setRows(rows.filter((_, i) => i !== index))}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRows([...rows, { key: "", value: "" }])}
          >
            <Plus />
            Add a row
          </Button>
          {unused.slice(0, 4).map((suggestion) => (
            <Button
              key={suggestion}
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setRows([...rows, { key: suggestion, value: "" }])}
            >
              <Plus />
              {suggestion}
            </Button>
          ))}
        </div>

        <FormField
          label="Anything else the filler should know"
          hint="Free text, used only as context — it is never pasted into a field verbatim."
        >
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Open to remote US-hours roles. Happy to relocate for the right team."
              className="field-sizing-fixed min-h-20"
            />
          )}
        </FormField>

        <div className="flex items-center gap-3">
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
            <span className="text-success flex items-center gap-1.5 text-sm">
              <Check className="size-4" />
              Saved
            </span>
          )}
          <span className="text-subtle ml-auto text-xs tabular-nums">
            {filled} answer{filled === 1 ? "" : "s"} stored
          </span>
        </div>

        {save.isError && <ErrorAlert>{(save.error as Error).message}</ErrorAlert>}
      </CardContent>
    </Card>
  );
}
