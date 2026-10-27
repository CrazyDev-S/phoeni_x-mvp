"use client";

import { ApplicationDetailView } from "@/components/remote/applications/application-detail";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/** The application, opened beside the table so the list stays where it was. */
export function ApplicationSheet({
  id,
  title,
  onClose,
}: {
  id: string | null;
  title?: string;
  onClose: () => void;
}) {
  return (
    <Sheet open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-[26rem]"
      >
        <SheetHeader className="sr-only">
          {/* Names the dialog without a second heading: the view renders the visible one. */}
          <SheetTitle asChild>
            <span>{title ?? "Application"}</span>
          </SheetTitle>
          <SheetDescription>Application details</SheetDescription>
        </SheetHeader>
        {id && (
          <div className="p-3">
            <ApplicationDetailView id={id} layout="sheet" onDeleted={onClose} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
