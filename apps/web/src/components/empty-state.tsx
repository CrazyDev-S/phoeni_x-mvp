import type { ReactNode } from "react";

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
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      {icon && (
        <div className="bg-accent text-accent-foreground flex size-12 items-center justify-center rounded-2xl [&_svg]:size-5">
          {icon}
        </div>
      )}
      <div className="space-y-1">
        <p className="text-lg font-semibold tracking-tight">{title}</p>
        {description && (
          <p className="text-muted-foreground mx-auto max-w-md text-sm font-medium text-balance">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
