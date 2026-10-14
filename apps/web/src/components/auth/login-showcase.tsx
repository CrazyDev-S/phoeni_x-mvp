import { Brand } from "@/components/brand";
import { navFor } from "@/components/portal/nav";
import { PORTAL_IDS, PORTALS, type PortalId } from "@/lib/portals";
import { cn } from "@/lib/utils";

/**
 * The dark half of the sign-in page: the pitch, and what each portal is for -
 * its own tagline and the pages inside it, in the portal's own accent.
 */
export function LoginShowcase({ className }: { className?: string }) {
  return (
    <section
      aria-label="About PhoeniX"
      className={cn(
        "bg-panel text-panel-foreground relative flex flex-col overflow-hidden rounded-[44px] p-10 xl:px-14 xl:py-[52px]",
        className,
      )}
    >
      <Brand size="default" className="-ml-1.5 self-start" />
      <h2 className="mt-10 max-w-[760px] text-[clamp(2.75rem,5vw,4.5rem)] leading-[1.04] font-medium tracking-[-0.025em]">
        Tailor, track and follow through on{" "}
        <em className="text-brand not-italic">every application.</em>
      </h2>

      <div className="mt-12 grid items-stretch gap-5 xl:mt-auto xl:grid-cols-2">
        {[...PORTAL_IDS].reverse().map((id) => (
          <PortalPanel key={id} portal={id} />
        ))}
      </div>
    </section>
  );
}

function PortalPanel({ portal }: { portal: PortalId }) {
  const { name, tagline } = PORTALS[portal];
  const pages = navFor(portal)[0].items.filter((item) => !item.exact);
  return (
    <div data-portal={portal} className="flex flex-col">
      <div className="text-panel-muted mb-3.5 flex items-center gap-2.5 text-[13px] font-bold tracking-[0.06em] uppercase">
        <span className="bg-brand size-2.5 rounded-full" />
        {name}
      </div>
      <div className="bg-brand text-brand-foreground flex flex-1 flex-col justify-between gap-8 rounded-[32px] p-7">
        <p className="max-w-sm text-[1.375rem] leading-snug font-semibold tracking-tight text-balance">
          {tagline}
        </p>
        <ul className="flex flex-wrap gap-2">
          {pages.map(({ href, label, Icon }) => (
            <li
              key={href}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-white/65 px-4 text-[13.5px] font-bold"
            >
              <Icon className="size-3.5" />
              {label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
