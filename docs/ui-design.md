# UI design: the dense workbench

PhoeniX holds long lists (jobs, applications, resumes, proposals, bids). The
interface is built to show many rows at once and to get out of the way. The
previous design spent its space on chrome: a 68px floating bar, an 88px rail,
46px titles, 100px rows in floating cards, pill buttons at 40-48px.

## Principles

1. **Rows, not cards.** Lists are tables or table-like rows of 32-36px, inside one
   bordered panel with a sticky header. A screen shows 25-35 records, not 10.
2. **One line of header.** A page opens with a single 40px row: title, inline
   counts, actions at the far end. No hero, no description, no tips.
3. **Flat and ruled.** 1px borders and tint changes carry structure. No shadows,
   no floating cards, no pill shapes. Radius is 6px on controls, 8px on panels.
4. **Everything is a size smaller.** Root font 14px, body text 13px, controls 32px
   (`sm` 28px, `xs` 24px), table cells 13px. Numbers are tabular.
5. **Full width.** No max-width column. Content runs to the window edge with 16px
   padding. Filters live in a toolbar above the data, not in a third of the screen.
6. **Only real content.** No tips, how-it-works bands, helper paragraphs, empty
   decoration, or placeholder values. An empty list says what is empty in one line.

## Shell

- Left sidebar, 200px, labelled, collapsible to 52px (remembered in
  `localStorage` as `ra.sidebar`). Wordmark on top, workspace pages, a rule,
  tools, Settings at the foot. The active page is an accent wash.
- Top bar, 44px, flat with a bottom border: portal switch (segmented), the next
  call as one line, bell, account.
- On a phone the sidebar becomes a 48px icon bar along the bottom.

## Tokens

The colour tokens and the nine palettes are unchanged; only their use is calmer.
Accent colour marks the active item, the lead action, and focus. Panels are
`bg-card` with `border`. The canvas is lighter than before so borders carry.

| Thing | Value |
|---|---|
| Root font | 14px (Inter) |
| Body / table text | 13px |
| Page title | 18px / 600 |
| Panel title | 13px / 600 |
| Control height | 32px (28 / 24) |
| Table row | 36px (dense: 32px) |
| Table head | 32px, 11px caps, muted, sticky |
| Radius | 6px controls, 8px panels, 8px dialogs |
| Page padding | 16px; gap between blocks 12px |

## Page shapes

- **List page** (jobs, applications, resumes, proposals, maintenance): header row,
  toolbar row (search, filter chips/selects, view switch), then one table panel.
- **Detail page**: header row with back arrow and record name, then a two-column
  grid: main content and a 320px fact column. No stacked full-width cards.
- **Overview**: a row of compact stat cells (label, number), then two columns of
  tables (recent, upcoming). No steps bands.
- **Forms** (settings, profile): two-column label/field rows, 32px inputs.
