"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { dayLabel, isSameMonth, type DayKey } from "@/lib/calendar";

export type CalendarView = "day" | "week" | "month";

export const VIEWS: { value: CalendarView; label: string; hint: string }[] = [
  { value: "day", label: "Day", hint: "Day view (D)" },
  { value: "week", label: "Week", hint: "Week view (W)" },
  { value: "month", label: "Month", hint: "Month view (M)" },
];

/** "8 – 14 September 2026", collapsing whatever the two ends share. */
export function rangeTitle(view: CalendarView, anchor: DayKey, days: DayKey[]): string {
  if (view === "day") return dayLabel(anchor, "EEEE d MMMM yyyy");
  if (view === "month") return dayLabel(anchor, "MMMM yyyy");

  const [first] = days;
  const last = days[days.length - 1];
  if (isSameMonth(first, last)) {
    return `${dayLabel(first, "d")} – ${dayLabel(last, "d MMMM yyyy")}`;
  }
  const samePattern = first.slice(0, 4) === last.slice(0, 4) ? "d MMM" : "d MMM yyyy";
  return `${dayLabel(first, samePattern)} – ${dayLabel(last, "d MMM yyyy")}`;
}

export function Toolbar({
  view,
  title,
  busy,
  onView,
  onToday,
  onStep,
}: {
  view: CalendarView;
  title: string;
  busy?: boolean;
  onView: (view: CalendarView) => void;
  onToday: () => void;
  onStep: (direction: -1 | 1) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-3">
      <div className="flex items-center gap-1.5">
        <StepButton label="Previous" onClick={() => onStep(-1)}>
          <ChevronLeft />
        </StepButton>
        <StepButton label="Next" onClick={() => onStep(1)}>
          <ChevronRight />
        </StepButton>
      </div>

      <h2 className="mx-1.5 flex items-center gap-2 text-2xl font-medium tracking-tight sm:text-[1.625rem]">
        {title}
        {busy && <Spinner className="text-muted-foreground" />}
      </h2>

      <Chip onClick={onToday} className="bg-card h-10">
        Today
      </Chip>

      <Tabs
        value={view}
        onValueChange={(next) => onView(next as CalendarView)}
        className="ml-auto"
      >
        <TabsList>
          {VIEWS.map((option) => (
            <TabsTrigger key={option.value} value={option.value} title={option.hint}>
              {option.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}

/** The round white paging button beside the range title. */
function StepButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="secondary"
          size="icon"
          aria-label={label}
          onClick={onClick}
          className="size-11"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** A small ghost round button, for the mini calendar and popover. */
export function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          onClick={onClick}
          className="bg-foreground/6 hover:bg-foreground/10 size-9 rounded-full"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
