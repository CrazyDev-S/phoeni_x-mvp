"use client";

import { useState } from "react";

import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { ApplicationDetail } from "./shared";

// Radix Select cannot hold an empty string, so "not set" needs a stand-in.
const UNSET = "unset";
const WORK_MODES: [string, string][] = [
  [UNSET, "Not set"],
  ["remote", "Remote"],
  ["hybrid", "Hybrid"],
  ["onsite", "On-site"],
];

/** The company and job facts, editable in one place. */
export function EditApplicationDialog({
  open,
  detail,
  pending,
  error,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  detail: ApplicationDetail;
  pending: boolean;
  error: Error | null;
  onOpenChange: (open: boolean) => void;
  onSave: (body: Record<string, unknown>) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {open && (
          <EditForm
            detail={detail}
            pending={pending}
            error={error}
            onCancel={() => onOpenChange(false)}
            onSave={onSave}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditForm({
  detail,
  pending,
  error,
  onCancel,
  onSave,
}: {
  detail: ApplicationDetail;
  pending: boolean;
  error: Error | null;
  onCancel: () => void;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState({
    company_name: detail.company_name,
    company_domain: detail.company_domain ?? "",
    role_title: detail.role_title,
    job_url: detail.job_url ?? "",
    location: detail.location ?? "",
    work_mode: detail.work_mode ?? UNSET,
    salary_min: detail.salary_min?.toString() ?? "",
    salary_max: detail.salary_max?.toString() ?? "",
    salary_currency: detail.salary_currency ?? "USD",
    job_description_text: detail.job_description_text ?? "",
  });
  const set =
    (key: keyof typeof form) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));
  const blank = (value: string) => value.trim() || null;
  const amount = (value: string) => {
    const parsed = Number(value.replace(/[^\d.]/g, ""));
    return value.trim() && Number.isFinite(parsed) ? Math.round(parsed) : null;
  };
  const invalid = !form.company_name.trim() || !form.role_title.trim();

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (invalid) return;
        onSave({
          company_name: form.company_name.trim(),
          company_domain: blank(form.company_domain),
          role_title: form.role_title.trim(),
          job_url: blank(form.job_url),
          location: blank(form.location),
          work_mode: form.work_mode === UNSET ? null : form.work_mode,
          salary_min: amount(form.salary_min),
          salary_max: amount(form.salary_max),
          salary_currency: blank(form.salary_currency)?.toUpperCase().slice(0, 3) ?? null,
          job_description_text: blank(form.job_description_text),
        });
      }}
    >
      <DialogHeader>
        <DialogTitle>Edit details</DialogTitle>
        <DialogDescription>The company and the job, as you know them now.</DialogDescription>
      </DialogHeader>

      <FieldGroup className="gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Company">
            {(control) => (
              <Input {...control} value={form.company_name} onChange={set("company_name")} />
            )}
          </FormField>
          <FormField label="Website">
            {(control) => (
              <Input
                {...control}
                placeholder="acme.com"
                value={form.company_domain}
                onChange={set("company_domain")}
              />
            )}
          </FormField>
          <FormField label="Role">
            {(control) => (
              <Input {...control} value={form.role_title} onChange={set("role_title")} />
            )}
          </FormField>
          <FormField label="Job link">
            {(control) => (
              <Input
                {...control}
                inputMode="url"
                placeholder="https://…"
                value={form.job_url}
                onChange={set("job_url")}
              />
            )}
          </FormField>
          <FormField label="Location">
            {(control) => (
              <Input {...control} value={form.location} onChange={set("location")} />
            )}
          </FormField>
          <FormField label="Work mode">
            {(control) => (
              <Select
                value={form.work_mode}
                onValueChange={(work_mode) => setForm((current) => ({ ...current, work_mode }))}
              >
                <SelectTrigger {...control} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WORK_MODES.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
        </div>

        <div className="grid grid-cols-[1fr_1fr_6rem] gap-3">
          <FormField label="Salary from">
            {(control) => (
              <Input
                {...control}
                inputMode="numeric"
                placeholder="150000"
                value={form.salary_min}
                onChange={set("salary_min")}
              />
            )}
          </FormField>
          <FormField label="to">
            {(control) => (
              <Input
                {...control}
                inputMode="numeric"
                placeholder="190000"
                value={form.salary_max}
                onChange={set("salary_max")}
              />
            )}
          </FormField>
          <FormField label="Currency">
            {(control) => (
              <Input
                {...control}
                maxLength={3}
                value={form.salary_currency}
                onChange={set("salary_currency")}
              />
            )}
          </FormField>
        </div>

        <FormField label="Job description">
          {(control) => (
            <Textarea
              {...control}
              rows={6}
              className="field-sizing-fixed max-h-72"
              value={form.job_description_text}
              onChange={set("job_description_text")}
            />
          )}
        </FormField>
      </FieldGroup>

      {error && <p className="text-destructive text-sm">{error.message}</p>}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={invalid || pending}>
          {pending && <Spinner />}
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
