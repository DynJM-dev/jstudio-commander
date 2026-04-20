# Phase P Track C — UI/UX Audit

**Generated:** 2026-04-17 · **Auditor:** /ui-expert · **Scope:** `client/src` read-only
**Target:** "VS Code-quality IDE" per CTO brief · **HEAD:** `557cbd2`

## Executive Summary

Commander's current client is a well-executed **single-theme dark glass dashboard** for watching Claude Code sessions, not yet an IDE. Design-system adherence is strong on the fundamentals the shipped shell already uses (glass surfaces, Montserrat inline, lucide-react only, no native selects, no `dark:` prefix). The gap to VS Code quality is not about polish of what exists — it is about **layout primitives that do not exist yet**: no draggable tab reorder, no editor groups, no split-in-any-direction, no command palette, no keyboard shortcut layer, no settings page, no light theme. Accessibility has concrete holes (zero focus rings, four of five modals lack `role="dialog"` + `aria-modal`, tables do not degrade to card stacks, touch targets as small as 22 px on ContextBar controls). State coverage is uneven — loading skeletons exist but error/empty paths are sometimes plain text in a glass-card instead of the themed `EmptyState` component.

Counts: **5 Critical · 7 High · 9 Medium · 6 Low** (27 total).

---

## VS Code Quality Gap Analysis

What a VS Code user expects vs. what Commander ships today. These are **structural** gaps — none is a small fix.

- **Draggable tab reorder** — VS Code: drag a tab left/right, or onto another tab group. Commander: server-ordered by `created_at`, no drag handles, no dnd library installed (`TopCommandBar.tsx:51-56`, `SplitChatLayout.tsx:135`). See CTO_SNAPSHOT §5.
- **Drag-to-split / editor groups** — VS Code: drag a tab to the edge to create a new group. Commander: hard-coded 2-pane split (left = PM, right = one of ≤3 teammates), no concept of additional groups (`SplitChatLayout.tsx:20, 390-421`).
- **Close / switch / new-tab shortcuts** — VS Code: `Cmd+W`, `Cmd+Shift+T`, `Cmd+1..9`, `Ctrl+Tab`. Commander: no keyboard shortcut system anywhere — zero matches for `keydown` tab handling except the global ESC interrupt (`ChatPage.tsx:316-341`). `grep -r 'Cmd\+W\|Ctrl\+Tab'` → 0.
- **Command palette** (`Cmd+Shift+P`) — VS Code's centerpiece. Commander: no palette, no fuzzy-finder, no "quick open session" surface. Sidebar `Search/Spotlight` slot from the /ui-expert skill is unimplemented (`Sidebar.tsx:119-136`).
- **Settings page** — VS Code: searchable settings UI with per-workspace overrides. Commander: scattered preferences persisted via `usePreference` (sidebar collapsed, split-state, auto-split-on-spawn) with no UI to review or change them centrally.
- **Light theme + high-contrast** — VS Code ships 3+ built-in themes. Commander: dark-only. Zero `[data-theme]` selectors in codebase; `@theme` block defines one palette (`index.css:6-57`).
- **Minimap, breadcrumbs, outline** — VS Code standards for navigating long content. Commander: `ChatThread` has no minimap for a 10 k-message transcript, no breadcrumbs on `/chat/:sessionId` (just a back chevron implicit in the session tabs), no outline panel.
- **Resizable panels in any direction** — VS Code: drag any edge. Commander: one 30–70 % horizontal drag handle between PM and teammate (`SplitChatLayout.tsx:399-415`); no vertical split, no sidebar resize, no four-way docking.
- **Activity bar / sidebar icons with tooltip + badge counts** — VS Code: Bell count on Source Control, problems badge, etc. Commander sidebar: active-pill styling only (`Sidebar.tsx:120-136`); no badges on `Sessions` (waiting count), `Projects` (phase-complete count), `Chat` (unread).
- **Persistent command history / search in chat** — VS Code's terminal: ↑/↓ recall, search box. Commander: `ChatPage` has no in-transcript search, no slash-command history, no `/` keyboard recall.

---

## Critical

### C1 — Zero focus rings on any focusable element
`index.css:1-609`; every modal, button, input, sidebar nav item.
Global CSS has no `:focus-visible` rule; `grep ring-2\|focus:ring\|focus-visible` → 0 matches. Multiple inputs call `outline-none` with nothing in its place (`ChatPage.tsx:582`, `SessionCard.tsx:193`, `CreateSessionModal.tsx:219, 251`, `PermissionPrompt.tsx:1`, `PinGate.tsx:120`). A keyboard user literally cannot see where focus is. This is the single biggest a11y failure.

### C2 — Modals do not announce themselves as dialogs
`CreateSessionModal.tsx:129-135`, `ContextLowToast.tsx:56-87`, `MobileOverflowDrawer.tsx:60-83`, `PinGate.tsx:86-146`.
Only `ForceCloseTeammateModal.tsx:72-74` sets `role="dialog" aria-modal="true" aria-labelledby`. Screen readers will not trap focus or announce context for the other four. No focus-trap helper (nothing imports `focus-trap-react` or hand-rolls one), and background content is not `aria-hidden`ed. CreateSessionModal is the most-used one on the Sessions page.

### C3 — Tables do not degrade to card stacks on mobile
`SessionCostTable.tsx:30-75` wraps a `<table>` in `overflow-x-auto` only — no `hidden md:block` / `md:hidden` pair. The JStudio rule mandates both render paths. At 375 px a user must swipe horizontally on the Analytics page. Global search confirms this is the only table in the app today, but the pattern will repeat (DGII reports, audit logs). There is no reference implementation yet.

### C4 — Touch targets below 44 px on the primary surface
`index.css:527` sets `.session-tab { height: 32px }` — every top-bar session tab. `ContextBar.tsx:544-547` (refresh button 26 × 22), `SessionCard.tsx:358-361` (split-view button 32 × 32), `CreateSessionModal.tsx:147` (close X 32 × 32), `TerminalTabs.tsx:48-50` (new-session button 32 × 32). Users on mobile (375 px breakpoint) will mis-tap. MobileNav itself hits 44 px, but above that bar the entire session-tab dropdown lives at 32 px.

### C5 — Editor layout is cosmetically VS-Code-like but structurally frozen
`SplitChatLayout.tsx:20, 73-388`; `TopCommandBar.tsx:15-18, 51-56`.
Two disjoint tab systems — top-bar (`MAX_TABS_LG=5, MAX_TABS_MD=3`) and in-pane teammates (`MAX_TEAMMATES=3`) — with separate state stores. Right pane is always a single teammate; cannot add a second editor group; cannot drag a tab between them; cannot split vertically. Per CTO_SNAPSHOT §5 + §7 this is acknowledged as "not incremental, it's a rewrite." Blocks the stated "VS Code quality" goal.

---

## High

### H1 — No `[data-theme="dark"]` / theme system, so no light theme
`index.css:6-57`. Only one `@theme` block; no `[data-theme="dark"]`, no `[data-theme="light"]`, no prefs-color-scheme bridge. The codebase is correct about NOT using Tailwind `dark:` (0 runtime matches) but there is no replacement switcher either. To meet the /ui-expert rule ("Dark mode via `[data-theme="dark"]` selectors") **and** give Jose a light mode for daylight debugging, both palettes need to live in CSS and a `<html data-theme>` attribute needs wiring. Global rule says light+dark on every screen.

### H2 — `overflow-x-auto` used where JStudio rule mandates `flex-wrap`
`SplitChatLayout.tsx:439` (teammate tabs inside the split pane), `TerminalTabs.tsx:16`. Neither Commander tab strip wraps — they side-scroll, which hides tabs on narrow viewports. User rule: "tabs use `flex-wrap` via TabBar, NEVER `overflow-x-auto`." The session overflow dropdown in `TopCommandBar` partially mitigates on top-bar, but teammate tabs and terminal tabs are exposed.

### H3 — `font-mono-stats` used for primary headings/body in several places
`ChatPage.tsx:611`, `SessionCard.tsx:173`, `TokenCard.tsx` (analytics). Montserrat is required for all text surfaces; mono is acceptable only for numeric/stats content (`font-variant-numeric: tabular-nums`). Current use is sometimes correct (token counts) and sometimes drifts (tmux-name pill on SessionCard at `173` — fine, pill) but e.g. `TerminalTabs.tsx:30-38` titles use Montserrat correctly, while code blocks inside `ChatThread` live in system mono via `CodeBlock.tsx`. Audit the handful of mono-stats labels for any heading misuse.

### H4 — Empty states inconsistent — sometimes themed, sometimes a text div
`SessionsPage.tsx:106-114` uses `EmptyState` (good). `ChatPage.tsx:346-361` uses `EmptyState` (good). `SessionCostTable.tsx:19-27` renders a plain italic `<span>` ("No session cost data yet") with no icon, no action. `ModelBreakdown.tsx` likely similar (not read). `ProjectsPage.tsx:132-146` uses `EmptyState` (good). Analytics inner-card empties do not follow the shared component.

### H5 — `<select>` native avoided (good) but effort-level dropdown is hand-rolled without keyboard support
`ContextBar.tsx:649-705`. Dropdown opens on click only — no arrow-key navigation, no Enter to select, no typeahead, no `role="listbox"`/`role="option"` markup. Same pattern repeats on `TopCommandBar.tsx` overflow menu (`164-237`) and `SplitChatLayout.tsx` more-actions menu (`550-602`). All custom popovers need the `Select` primitive from `packages/ui` (doesn't exist in this repo — `client/` has no `packages/ui` import path; it's a one-off Commander client) or a keyboard-aware local helper.

### H6 — Animation load in ChatThread is heavy on long transcripts
`ChatThread.tsx:411-497`. Every group renders with inline `animate-pulse` on the last dot (line 451) and nested `AnimatePresence` for `liveComposing`/`liveThinking`. With 500+ messages and the timeline rerendering on every new append, jank risk is real. No windowed virtualization (`react-virtual`, `react-window`) is imported. VS Code's diff editor virtualizes everything past the viewport — Commander does not.

### H7 — PinGate `inputMode="numeric"` but rendered in a `password` field — iOS zoom risk mitigated, UX compromised
`PinGate.tsx:113-128`. `text-2xl` overrides the 16 px rule that prevents iOS auto-zoom; tracking is `0.5em`. Input style has `outline-none` with only `borderColor` change on focus — on iOS Safari the keyboard and zoom behavior need a visible focus indicator to be compliant. Same `outline-none` shortcut seen in CreateSessionModal inputs (`219`, `251`).

---

## Medium

### M1 — `overflowX: 'hidden'` on page wrappers missing
Global rule for iOS Safari. `grep overflowX.*hidden` → 0. Page wrappers in `SessionsPage.tsx:85`, `ProjectsPage.tsx:80`, `AnalyticsPage.tsx:67`, `CityPage.tsx:12`, `TerminalPage.tsx:69`, `ChatPage.tsx:365` all use `p-4 lg:p-6 pb-24 lg:pb-6` but none sets `overflowX: 'hidden'`. Horizontal scroll bounce bug likely on any child that overflows (Recharts on Analytics, long `tmuxSession` string on SessionCard).

### M2 — StatusBadge color duplicates but also hard-codes hex
`StatusBadge.tsx:11-17`. `TEAMMATE_STATUS_COLORS` ships literal hex (`#22C55E`, `#6B7280`, `#F59E0B`, `#EF4444`) instead of `var(--color-working)` etc. One palette shift to the `@theme` block silently leaves teammate badges on the old colors. `GlassCard.tsx` is clean. `SessionCard.tsx:154` and the ProtocolMessageCards color through CSS vars correctly.

### M3 — SessionCard information density is borderline over-stuffed
`SessionCard.tsx:147-408`. Header row (status + heartbeat + tmux name) · title row (label + PM pill + team name + rename hover icon) · project path · pill row (model + effort) · optional activity line · optional last-message preview · divider · stats row (tokens + uptime + last activity) · action row (command input + split-view button + delete/menu) · nested teammate rows. On mobile this easily exceeds 400 px tall. VS Code would surface most of this in hover cards. Consider collapsing activity+stats+command-input into a one-line collapsed view when `isStopped`.

### M4 — No breadcrumbs on detail pages
`ChatPage.tsx` / `SplitChatLayout.tsx`. Current navigation leaves the user with only the top session-tab row to know "which session am I in" — fine when there are 2 sessions, poor when there are 12 and overflow-drop hides names. Global rule: "Breadcrumbs on all detail pages (not just a back arrow)." Missing on Chat, Projects detail, Terminal session.

### M5 — Skeleton types only cover 4 variants; no list-with-avatar, no message-thread
`LoadingSkeleton.tsx:38-43`. `card | list | text | chart`. `ChatPage.tsx:369` uses a single `Loader2` spinner instead of a message-thread skeleton, which creates a blank screen while messages hydrate. Add a `thread` variant with alternating bubble skeletons.

### M6 — Global keyboard handling is ESC-only; no `Escape` focus restoration
`ChatPage.tsx:316-341`, `SplitChatLayout.tsx` modals. ESC closes active modal/dropdown via `data-escape-owner`, but focus is not returned to the trigger button. After closing the effort dropdown, focus lands on document body. This is observable with a screen reader.

### M7 — HeartbeatDot + StatusBadge render close visually, teach similar info
`SessionCard.tsx:168-171`. The green-pulsing `HeartbeatDot` (6 × 6 + "Xs ago") sits next to `StatusBadge` (8 × 8 dot + optional label). Two concentric-looking green dots right next to each other is visually noisy when the session is working. Consider merging into one component that shows either "status + heartbeat age" or "status + staleness warning" — or adding more spatial separation.

### M8 — Timeline line in ChatThread breaks when messages are hidden by systemEventsMode
`ChatThread.tsx:400-408`. Continuous vertical line rendered via absolute-positioned div. When `systemEventsMode === 'hide'` collapses fragment clusters (`renderUserFragments:222-234`), the line still renders at full height of parent, including gaps the hidden fragments would have filled. Visible gap/jump on fragment transitions.

### M9 — ContextBar has too many controls on a single 34 px row
`ContextBar.tsx:433-707`. Status dot + icon + label + elapsed + stop button + refresh button + tokens + rate + cost + context bar + warning + effort dropdown. At 1024 px several are `hidden sm:inline`. At widths just above `sm:` the row gets crowded; below `sm:` the user loses cost + rate + warning. Consider a kebab menu for less-used controls (rate, warning, refresh). Same row also repeats the "token count" metric that already exists on `TopCommandBar.tsx:271-275` — redundant signal.

---

## Low

### L1 — `GlassCard` default `hover = false` but default className hover is "ceiling"
`GlassCard.tsx:11-26`. Default `hover === false` still ships a fallback `hover:border-[rgba(255,255,255,0.08)] hover:shadow-[var(--shadow-glass)]` that negates the base `.glass-card:hover` accent-glow in `index.css:87-90`. Subtle bug — calling `<GlassCard>` without `hover` kills the global accent glow the CSS file promises.

### L2 — `PinGate` "Connecting..." screen has no spinner
`PinGate.tsx:69-80`. Plain text "Connecting..." for ~50–300 ms. Compare to `HealthBanner.tsx:77-81` which includes `Loader2 className="animate-spin"`. Add a spinner for consistency.

### L3 — `main.tsx` missing `overflow: hidden` on the root
`main.tsx:1-5`. `document.getElementById('root')` is not styled; `DashboardLayout.tsx:14` applies `overflow-hidden` but only on its own div. Root body has no overscroll-behavior. Safari rubber-band scroll is reachable at page level.

### L4 — Animation cost: `animate-pulse` runs on every idle session's waiting-tab-alarm
`index.css:186-201`. `waiting-tab-alarm` uses `!important` to override `session-tab`'s box-shadow. When 5 sessions are waiting simultaneously (realistic for a PM with 3 coders), 5 concurrent keyframe animations run on mostly identical elements. Not a bug but profiling worth doing — a shared CSS variable breath rather than five per-element box-shadow animations would be cheaper.

### L5 — "PM" pill on SessionCard hard-codes `rgba(42, 183, 182, ...)` instead of `color-mix(accent)`
`SessionCard.tsx:213-222`. Elsewhere (e.g. `278`) the file uses `color-mix(in srgb, var(--color-accent) ...)` — good. The PM pill bakes the current accent hex. One-line consistency fix when the theme refactor happens.

### L6 — Emoji-adjacent characters (`✽` spinner, `·` separator) authored inline instead of from constants
`ContextBar.tsx:481-483`, `SessionCard.tsx:301-304`, `TopCommandBar.tsx:273`. Each component re-writes `· ` as a literal middle-dot. One constant/token across the app (e.g. `export const DOT = ' · '`) simplifies i18n later. Not emoji (lucide-only compliance holds — 0 matches for the common emoji set), but character literals spread thin.

---

## What's Actually Good (so we don't regress it)

- `index.css` is disciplined: `@theme` block with tokens, no Tailwind `dark:` prefix, glass classes (`.glass-nav`, `.glass-card`, `.glass-modal`) match the spec, `prefers-reduced-motion` fallback exists (`index.css:332-342`).
- Montserrat applied via `const M = 'Montserrat, sans-serif'` + inline `style={{ fontFamily: M }}` in essentially every component. `grep -c Montserrat` hits 30+ files, all inline.
- `lucide-react` is the only icon library. Zero emoji in authored UI.
- No `<StrictMode>` in `main.tsx` — compliant with the JStudio rule that prevents the Supabase navigator.locks deadlock (inherited caution from the broader stack).
- PWA-style viewport behavior: `MobileNav.tsx:29-41` respects `env(safe-area-inset-bottom)`, `MobileOverflowDrawer.tsx:80` does the same.
- `LoadingSkeleton` is themed (not blank divs) and branched by variant.
- Framer Motion is used for the right things — modal enter/exit, teammate tab layout animation (`SplitChatLayout.tsx:440-474` with `layout` prop), page transitions (`App.tsx:25-30`), scroll-reveal on Analytics cards (`AnalyticsPage.tsx:113-149`). Not decoration.
- Global `active:scale(0.97)` tap feedback + `-webkit-tap-highlight-color: transparent` (`index.css:135-146`). Global rule honored.
- `ForceCloseTeammateModal.tsx` is the reference-quality modal — `role="dialog"`, `aria-modal`, `aria-labelledby`, friction checkbox, disabled submit, reset-on-open, fire-and-forget toast. Copy this pattern to the other modals.
- Dead-native-select adherence: 0 `<select>` tags in runtime code. All dropdowns are hand-rolled overlays (accessibility gap flagged above, but the intent is correct).

---

## Priority Suggestions (non-prescriptive, flag-only)

1. **Focus ring pass (C1).** One CSS file, one `:focus-visible` rule referencing `--color-accent-glow`. Unblocks a11y compliance at a scale nothing else on this list does.
2. **Modal dialog semantics (C2).** Copy `ForceCloseTeammateModal`'s three a11y attrs into `CreateSessionModal`, `PinGate`, `MobileOverflowDrawer`, `ContextLowToast` (latter is a toast not a modal, but still warrants `role="alert"`).
3. **Decide: light theme now or later.** If deferred, add a single-line comment in `index.css` saying "dark-only intentional pending Phase X." If now, bracket the `@theme` contents with `[data-theme="dark"]` + add a `light` sibling.
4. **Tab rewrite scoping.** CTO_SNAPSHOT §5 already flags this as a rewrite, not an increment. Phase P Track C confirms the surface is too small to bolt drag-to-reorder onto without refactoring the two tab systems into one shared `TabBar` primitive.
5. **Command palette** as the first new primitive — lands the biggest VS-Code-feel win per line of code, unlocks future shortcuts without a global listener sprawl.

— end —
