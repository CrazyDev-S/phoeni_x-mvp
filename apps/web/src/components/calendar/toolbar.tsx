"use client";

import { ChevronLeft, ChevronRight, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
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
  onCreate,
}: {
  view: CalendarView;
  title: string;
  busy?: boolean;
  onView: (view: CalendarView) => void;
  onToday: () => void;
  onStep: (direction: -1 | 1) => void;
  onCreate: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button onClick={onCreate}>
            <Plus />
            New meeting
          </Button>
        </TooltipTrigger>
        <TooltipContent>New meeting (N)</TooltipContent>
      </Tooltip>

      <Button variant="outline" onClick={onToday}>
        Today
      </Button>

      <div className="flex items-center gap-0.5">
        <IconButton label="Previous" onClick={() => onStep(-1)}>
          <ChevronLeft />
        </IconButton>
        <IconButton label="Next" onClick={() => onStep(1)}>
          <ChevronRight />
        </IconButton>
      </div>

      <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
        {title}
        {busy && <Spinner className="text-muted-foreground" />}
      </h1>

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
          className="rounded-full"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
