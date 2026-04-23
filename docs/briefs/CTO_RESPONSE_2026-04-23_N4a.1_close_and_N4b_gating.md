# CTO_RESPONSE — N4a.1 CLOSE ratification + N4b gating

**From:** CTO · 2026-04-23 (response to `CTO_N4a.1_CLOSE_BRIEF.md`)

## Status

N4a fully closed (10/10 smoke across both rotations, Debt 24 closed, Debt 23 live-validated, zero G-violations). Partial-close → hotfix → full-close pattern working as designed.

## §2 deviations — all RATIFIED

- **D1 cwd-does-not-exist fallback** (`ensureProjectByCwd` skip file-write when `!existsSync(cwd)`). Sharp catch on `mkdir({recursive: true})` auto-creation; SMOKE_DISCIPLINE v1.2 §3.4.2 connection is real.
- **D2 concurrent-race reconciliation** (post-race file-rewrite + per-call unique tmp names). Best-effort framing is honest. Defense-in-depth addition meaningful.
- **D3 N4a existing test vocabulary updates** (dual-form `OR` lookups). Ratified + informs Q2 below.

## Q1 — Debt 26 routing: option (b), fold into N4b T10

**N4b T10 scope expands to:** multi-workspace + hidden-workspace suspension + sidebar affordances + **kanban edit UI** (selector + DnD + animation). CTO scopes when drafting N4b.

**Three reasons for fold-not-split:**
1. Surface cohesion — selector + DnD + animation all touch card + kanban state; N4b T10 is already touching this surface.
2. DnD tool pick (`@dnd-kit/core` vs `@atlaskit/pragmatic-drag-and-drop`) deserves deliberation inside a rotation already working the surface, not a rushed PM small-scope.
3. Dogfood window (Q3) will give real signal on whether DnD is needed vs selector-only.

## Q2 — Hotfix dispatch template: ADD test-vocabulary-alignment bullet

Literal text for PM internal drafting template (not a standards-doc change):

> **Test vocabulary alignment.** If this hotfix changes data shape (column semantic, schema, query pattern, API contract), enumerate pre-existing tests whose assertions will need re-alignment. "Assertions" means test vocabulary (SELECT clauses, expected values, mock data shape) where test INTENT remains correct but LITERAL assertion needs updating. CODER updates alignment without separate CTO approval; any change altering test LOGIC or coverage routes through CTO as a deviation.

PM folds into internal drafting discipline. Applies on every hotfix dispatch going forward.

## Q3 — N4b gating: 24-48h dogfood window RATIFIED

**Rationale:** four major surfaces in 18h rotation is a lot; cumulative UX shape hasn't been lived with; Debt 26's selector-vs-DnD is UX-empirical, not engineering. PM goes pure-receive-mode per existing memory.

**Observation-capture shape (Jose during dogfood):**
```
[context] [action attempted] [actual result] [expected/wanted result]
```
Short + specific beats polished. Capture as it happens; synthesis at window end.

**Post-dogfood flow:**
1. Jose relays accumulated observations to PM.
2. PM synthesizes structured observation list with priority tagging: **blocker / friction / polish / N5+**.
3. CTO drafts N4b factoring dogfood signal into scope. T10 expands with Debt 26 affordances. DnD-vs-selector-only call made with real usage evidence.
4. Standard dispatch flow resumes.

## Standing orders

No PM action until Jose signals dogfood complete OR routes something mid-window needing CTO attention.
