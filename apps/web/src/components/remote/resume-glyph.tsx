import {
  BriefcaseBusiness,
  Brain,
  FileBadge,
  Folder,
  GraduationCap,
  Globe,
  IdCard,
  Link as LinkIcon,
  Mail,
  MapPin,
  Phone,
  type LucideIcon,
} from "lucide-react";

export interface IconLook {
  style: "chip" | "disc" | "ring" | "glyph";
  fg: string;
  bg: string | null;
}

// Keyed by the names the server sends. These are the same shapes the .docx
// icons are rasterized from (scripts/resume-icons.mjs), so a resume looks the
// same here and in the file.
const ICONS: Record<string, LucideIcon> = {
  mail: Mail,
  phone: Phone,
  pin: MapPin,
  link: LinkIcon,
  summary: IdCard,
  experience: BriefcaseBusiness,
  education: GraduationCap,
  skills: Brain,
  languages: Globe,
  certifications: FileBadge,
  projects: Folder,
};

// How much of a chip, disc or ring the glyph fills; matches icons.py.
const GLYPH_IN_SHAPE = 0.58;

/** A resume icon, `heightPt` tall: bare, or set in a chip, disc or ring. */
export function Glyph({ name, look, heightPt }: { name: string; look: IconLook; heightPt: number }) {
  const Icon = ICONS[name];
  if (!Icon) return null;
  const size = `${heightPt}pt`;
  const colour = `#${look.fg}`;

  // Sits on the baseline like the picture in the .docx does.
  const box = {
    display: "inline-block",
    width: size,
    height: size,
    lineHeight: 0,
    verticalAlign: "baseline",
    flexShrink: 0,
  } as const;

  if (look.style === "glyph") {
    return (
      <span aria-hidden style={box}>
        <Icon style={{ display: "block", width: "100%", height: "100%" }} color={colour} strokeWidth={2} />
      </span>
    );
  }

  return (
    <span
      aria-hidden
      style={{
        ...box,
        display: "inline-grid",
        placeItems: "center",
        boxSizing: "border-box",
        borderRadius: look.style === "chip" ? "24%" : "50%",
        background: look.bg ? `#${look.bg}` : undefined,
        border: look.style === "ring" ? `${heightPt * 0.07}pt solid ${colour}` : undefined,
      }}
    >
      <Icon
        style={{ display: "block", width: `${GLYPH_IN_SHAPE * 100}%`, height: `${GLYPH_IN_SHAPE * 100}%` }}
        color={colour}
        strokeWidth={2}
      />
    </span>
  );
}
