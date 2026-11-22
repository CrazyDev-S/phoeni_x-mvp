/**
 * The emoji and symbol picker's set: what reads well in a proposal or a
 * profile, each with the words it is found by. "glyph words…|glyph words…".
 */

export interface Glyph {
  char: string;
  words: string;
}

export interface GlyphGroup {
  id: string;
  label: string;
  icon: string;
  glyphs: Glyph[];
}

const parse = (list: string): Glyph[] =>
  list.split("|").map((entry) => {
    const at = entry.indexOf(" ");
    return at === -1 ? { char: entry, words: "" } : { char: entry.slice(0, at), words: entry.slice(at + 1) };
  });

const group = (id: string, label: string, icon: string, list: string): GlyphGroup => ({ id, label, icon, glyphs: parse(list) });

export const GLYPH_GROUPS: GlyphGroup[] = [
  group("picks", "Proposal picks", "✨",
    "✅ check done yes tick|🚀 rocket launch ship fast|💡 idea bulb insight|⚡ lightning fast performance speed|🎯 target goal focus aim|📈 chart growth up results|🔐 lock security secure compliance|🛠️ tools build fix|⭐ star rating top|✨ sparkles new shine|🔥 fire hot popular|👋 wave hello hi|🤝 handshake deal partner|📌 pin note important|📊 chart data analytics|💼 briefcase work business|🧩 puzzle piece integration|🏆 trophy win award|⏱️ stopwatch time deadline|📅 calendar date schedule|💬 chat message talk|👉 point right here|✔️ check mark|☑️ checkbox done|🙌 raised hands celebrate|💪 strong muscle|🧠 brain smart thinking|🌟 glowing star"),
  group("faces", "Smileys & hands", "😊",
    "😀 grin smile happy|😃 smile happy|😄 laugh smile|😁 beam grin|😊 blush smile|🙂 slight smile|😉 wink|😍 love heart eyes|🤩 star struck wow|😎 cool sunglasses|🤓 nerd geek|🤔 thinking hmm|😅 sweat relief|😂 joy laugh tears|🥳 party celebrate|😇 innocent halo|🙃 upside down|😌 relieved calm|👍 thumbs up yes like|👎 thumbs down no|👌 ok perfect|✌️ peace victory|🤞 fingers crossed luck|👏 clap applause|🙏 thanks please pray|✍️ writing hand|🫡 salute|🤗 hug|❤️ heart love red|🧡 heart orange|💛 heart yellow|💚 heart green|💙 heart blue|💜 heart purple|🖤 heart black|🤍 heart white"),
  group("work", "Work & tech", "💻",
    "💻 laptop computer code|🖥️ desktop monitor|📱 phone mobile app|⌨️ keyboard typing|🖱️ mouse click|🤖 robot ai bot automation|⚙️ gear settings config|🔧 wrench fix|🔨 hammer build|🧱 bricks foundation|🗄️ cabinet database storage|☁️ cloud aws hosting|🌐 globe web internet|📦 package box deliver|🚢 ship deploy|🐛 bug issue|🔒 lock locked private|🔑 key access|🛡️ shield protect|📡 antenna signal api|🧪 test lab experiment|🧬 dna science|🔍 search magnify|📝 memo notes write|📎 paperclip attach|🔗 link chain url|🗂️ folders organize|📁 folder files|🎨 palette design art|🎬 video film|🎮 game controller gaming|📷 camera photo|🎧 headphones audio|🧭 compass direction|🗺️ map plan roadmap"),
  group("business", "Business & time", "💰",
    "💰 money bag budget|💵 dollar cash|💳 card payment|📉 chart down|🏢 office company|🗓️ calendar plan|⏰ alarm clock|⏳ hourglass waiting|📞 phone call|✉️ envelope email mail|📧 email|📣 megaphone announce|🧾 receipt invoice|🥇 gold first medal|🥈 silver second|🥉 bronze third|🎉 party popper celebrate|🎁 gift bonus|🌍 world europe africa|🌎 world americas|🌏 world asia|🏁 finish flag done|🚩 flag milestone|📍 location pin|🕒 three clock time|☕ coffee|🌱 seedling growth start|💎 gem diamond premium|🔔 bell notify|📢 loudspeaker"),
  group("symbols", "Symbols & bullets", "★",
    "• bullet dot|◦ bullet hollow|▪ square small|▸ triangle right small|► pointer right|➤ arrow head|➜ arrow right|→ arrow right|⇒ double arrow|↳ arrow down right reply|✓ check|✔ heavy check|✗ cross no|✘ heavy cross|★ star black|☆ star white|✦ four star sparkle|✧ four star white|◆ diamond black|◇ diamond white|● circle black|○ circle white|■ square black|□ square white|▶ play|❯ chevron|❖ diamond four|※ reference mark|§ section|¶ paragraph|† dagger|° degree|± plus minus|× times multiply|÷ divide|≈ approx|≠ not equal|≤ less equal|≥ greater equal|∞ infinity|™ trademark|® registered|© copyright|— em dash|– en dash|… ellipsis|« quote left|» quote right|❝ quote open|❞ quote close"),
  group("lines", "Dividers", "━",
    "─────────── thin line divider|═══════════ double line divider|━━━━━━━━━━━ heavy line divider|┄┄┄┄┄┄┄┄┄┄┄ dashed line divider|• • • dots divider|✦ ✦ ✦ stars divider|◆ ◆ ◆ diamonds divider|▬▬▬▬▬▬ bar divider|⋆⋅☆⋅⋆ star dots divider|─── ✦ ─── star line divider"),
];

/** Glyphs whose char or words hold every term. */
export function searchGlyphs(query: string): Glyph[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const seen = new Set<string>();
  return GLYPH_GROUPS.flatMap((g) => g.glyphs).filter((g) => {
    if (seen.has(g.char)) return false;
    const hit = terms.every((t) => g.words.includes(t) || g.char === t);
    if (hit) seen.add(g.char);
    return hit;
  });
}
