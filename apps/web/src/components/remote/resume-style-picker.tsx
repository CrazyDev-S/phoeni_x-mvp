"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Pipette } from "lucide-react";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { request } from "@/lib/api";
import { setResumeStyle, useResumeStyle } from "@/lib/resume-style";
import { cn } from "@/lib/utils";

interface Templates {
  default: string;
  templates: { key: string; label: string; accent: string }[];
  palette: { name: string; value: string }[];
}

/** Which of the server's templates and colours a designed resume wears. */
export function useResumeTemplates() {
  return useQuery({
    queryKey: ["resume-templates"],
    queryFn: () => request<Templates>("/api/v1/remote/export/templates"),
    staleTime: Infinity,
  });
}

/**
 * Pick a template from its thumbnail, then a colour. The choice is shared with
 * every download button (see lib/resume-style), so the file matches the preview.
 */
export function ResumeStylePicker() {
  const style = useResumeStyle();
  const { data } = useResumeTemplates();
  if (!data) return null;

  const current = data.templates.find((t) => t.key === (style.template ?? data.default)) ?? data.templates[0];
  const accent = (style.accent ?? current.accent).toUpperCase();
  const inPalette = data.palette.some((s) => s.value === accent);

  // Choosing the template's own colour is the same as no override.
  const pickAccent = (value: string) =>
    setResumeStyle({ accent: value.toUpperCase() === current.accent ? null : value.toUpperCase() });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Resume style">
          <span aria-hidden className="size-3 rounded-full ring-1 ring-black/15" style={{ background: `#${accent}` }} />
          {current.label}
          <ChevronDown />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-[27rem] gap-3">
        <div className="grid grid-cols-4 gap-2.5">
          {data.templates.map((t) => {
            const selected = t.key === current.key;
            return (
              <button
                key={t.key}
                type="button"
                aria-pressed={selected}
                // A new template starts in its own colours; nothing carries over.
                onClick={() => setResumeStyle({ template: t.key, accent: null })}
                className="group flex flex-col gap-1 text-left outline-none"
              >
                <span
                  className={cn(
                    "bg-muted relative block aspect-[1/1.414] overflow-hidden rounded-md ring-1 ring-foreground/12 transition duration-150",
                    "group-hover:-translate-y-0.5 group-hover:ring-foreground/30 group-active:scale-95",
                    "group-focus-visible:ring-2 group-focus-visible:ring-ring",
                    selected && "ring-primary ring-2 group-hover:ring-primary",
                  )}
                >
                  <Image
                    src={`/resume-templates/${t.key}.webp`}
                    alt=""
                    width={420}
                    height={594}
                    sizes="96px"
                    className="size-full object-cover object-top"
                  />
                  {selected && (
                    <span className="bg-primary text-primary-foreground animate-in zoom-in-50 absolute top-1 right-1 grid size-4 place-items-center rounded-full duration-150">
                      <Check className="size-2.5" strokeWidth={3} />
                    </span>
                  )}
                </span>
                <span className={cn("text-xs", selected ? "font-semibold" : "text-muted-foreground")}>
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>

        <div className="border-t pt-3">
          <div className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-wide uppercase">
            Colour
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {data.palette.map((s) => {
              const selected = s.value === accent;
              return (
                <button
                  key={s.value}
                  type="button"
                  title={s.name}
                  aria-label={s.name}
                  aria-pressed={selected}
                  onClick={() => pickAccent(s.value)}
                  className={cn(
                    "grid size-6 place-items-center rounded-full ring-1 ring-black/15 transition duration-150 outline-none",
                    "hover:scale-110 active:scale-90 focus-visible:ring-2 focus-visible:ring-ring",
                    selected && "ring-foreground ring-2 ring-offset-2 ring-offset-popover",
                  )}
                  style={{ background: `#${s.value}` }}
                >
                  {selected && <Check className="size-3 text-white drop-shadow" strokeWidth={3} />}
                </button>
              );
            })}

            {/* Any other colour: the native picker, dressed as one more swatch. */}
            <label
              title="Custom colour"
              className={cn(
                "relative grid size-6 cursor-pointer place-items-center rounded-full ring-1 ring-black/15 transition duration-150",
                "hover:scale-110 active:scale-90 focus-within:ring-2 focus-within:ring-ring",
                !inPalette && "ring-foreground ring-2 ring-offset-2 ring-offset-popover",
              )}
              style={{
                background: inPalette
                  ? "conic-gradient(#f43f5e, #f59e0b, #22c55e, #0ea5e9, #8b5cf6, #f43f5e)"
                  : `#${accent}`,
              }}
            >
              <Pipette className="size-3 text-white drop-shadow" />
              <input
                type="color"
                aria-label="Custom colour"
                value={`#${accent}`}
                onChange={(e) => pickAccent(e.target.value.slice(1))}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
              />
            </label>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
