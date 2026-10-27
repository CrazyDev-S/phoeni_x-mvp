import type { ReactNode } from "react";

/** An empty list: one line saying what is empty, and the action that fills it. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
      {icon && <div className="text-muted-foreground [&_svg]:size-5">{icon}</div>}
      <p className="text-[13px] font-semibold">{title}</p>
      {description && <p className="text-muted-foreground max-w-sm text-xs text-balance">{description}</p>}
      {action}
    </div>
  );
}
