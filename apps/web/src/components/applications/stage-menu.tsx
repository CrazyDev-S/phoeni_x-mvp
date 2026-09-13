"use client";

import { CalendarClock, CalendarPlus, Video } from "lucide-react";
import type { ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Meeting } from "@/lib/calendar";
import { formatDateTime } from "@/lib/format";
import { STAGE_STATUSES, stageStatus, type Stage } from "./shared";

/**
 * Everything you can do to one interview step, wherever the step is shown.
 *
 * Non-modal, because two of its items open a dialog: a modal menu still
 * closing when the dialog mounts leaves pointer events disabled on the page.
 */
export function StageMenu({
  stage,
  children,
  align = "start",
  disabled,
  onStatus,
  onSchedule,
  onEditMeeting,
}: {
  stage: Stage;
  children: ReactNode;
  align?: "start" | "end";
  disabled?: boolean;
  onStatus: (status: string) => void;
  onSchedule: () => void;
  onEditMeeting: (meeting: Meeting) => void;
}) {
  const booked = stage.meetings.filter((m) => m.status === "scheduled");
  const call = booked.find((m) => m.conferencing_url);

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-64">
        <DropdownMenuLabel className="truncate">{stage.name}</DropdownMenuLabel>
        {booked.map((meeting) => (
          <DropdownMenuItem key={meeting.id} onSelect={() => onEditMeeting(meeting)}>
            <CalendarClock />
            <span className="truncate">
              Edit · {formatDateTime(meeting.starts_at, "EEE d MMM, HH:mm")}
            </span>
          </DropdownMenuItem>
        ))}
        {call?.conferencing_url && (
          <DropdownMenuItem asChild>
            <a href={call.conferencing_url} target="_blank" rel="noreferrer">
              <Video />
              Join call
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onSchedule}>
          <CalendarPlus />
          {booked.length ? "Schedule another meeting" : "Schedule a meeting"}
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
          Set status
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={stage.status}
          onValueChange={(value) => value !== stage.status && onStatus(value)}
        >
          {STAGE_STATUSES.map((status) => {
            const { label, Icon } = stageStatus(status);
            return (
              <DropdownMenuRadioItem key={status} value={status}>
                <Icon className="text-muted-foreground" />
                {label}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
