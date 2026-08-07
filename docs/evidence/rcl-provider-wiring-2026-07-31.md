# pankosmia-rcl: where the SSE-to-context wiring lives (2026-07-31)

**Question (owner):** is the context-provider wiring exported separately from the
visual components?

**Answer: NO.** [VERIFIED — source read at `pankosmia/core-client-rcl` `ffbe964`
(merged 2026-07-31, matches npm 0.4.5); npm tarball export list confirmed. Note:
`pankosmia-rcl` is retired as a repo name — the live source is
`pankosmia/core-client-rcl` (`src/rcl/`), which publishes to npm as `pankosmia-rcl`
[VERIFIED 2026-08-04: `pankosmia/pankosmia-rcl` 404s; `core-client-rcl` pushed
2026-08-03; npm 0.4.7 published 2026-08-03].]

The layering, from source:

1. **Context objects** (`src/rcl/contexts/*.js`) — bare `createContext(...)`,
   one file each, no logic. All 14 are exported. Trivially importable.
2. **`Spa`** (`src/rcl/App/Spa.jsx`, 460 lines) — THE infrastructure component
   that carries the platform wiring:
   - holds every context's state (`useState` + ref per context);
   - subscribes to **`GET /api/notifications`** (SSE) with
     `@microsoft/fetch-event-source` and dispatches 8 event types —
     `misc, status, bcv, auth, languages, typography, current_project,
     alignment` — into those states;
   - builds the `{value, setValue, ref}` objects for every context;
   - renders `SnackbarProvider` (notistack, MUI-styled toasts for `misc`
     events) around `AppWrapper`.
3. **`AppWrapper`** (`src/rcl/App/AppWrapper.jsx`, 156 lines) — a PASSIVE
   provider stack: every context value arrives as a prop; it adds the MUI
   `ThemeProvider` (fetches `/api/app-resources/themes/default.json`), the
   notistack display effect, and a full-height `Box`. No SSE here.
4. **`SpSpa`** — a 21-line wrapper around `Spa` (title/requireNet furniture).

**Consequence for tC4 (D29 adopted "contexts only"):** importing the 14 context
objects gives EMPTY contexts — nothing fills them without `Spa`. The wiring and
the (mild) visual layer are fused: using `Spa` drags in MUI + emotion +
notistack and platform-themed toasts; not using it means re-implementing the
~150 relevant lines of SSE dispatch against their context objects.

**Options, ranked:**
- **(c) Upstream ask:** a headless `SpaProviders` split out of `Spa` — SSE wiring
  + provider stack, no MUI/notistack/theme/Box — which `Spa` itself then uses.
  Small, issue-sized, would benefit every non-MUI client. Owner-routed if raised
  at all. **Not available — see the 2026-07-31 update below.**
- **(b) Fallback:** a thin tC4 provider (~150 lines) that runs
  `fetchEventSource('/api/notifications')` with the same 8-event dispatch and
  feeds THEIR imported context objects; toasts in our own design. Bounded and
  now well-understood because the reference implementation has been read — but
  it is a copy that can drift when upstream adds event types.
- **(a) Rejected:** mounting their `Spa`/`AppWrapper` whole — reverses D29
  (MUI theme + toast chrome + bundle weight) for little gain over (c).

**Watch item:** the SSE event vocabulary (8 types today) is the coupling
surface. Whichever option lands, pin the rcl version exactly and re-read the
dispatch list at every pin move (the library released 4 versions in 2 days this
week).

---

## Update 2026-07-31 (later): the headless split is not available — option (a-lite)

**Owner report:** upstream will not separate the visual layer from
`Spa`/`AppWrapper`. Option (c) is off the table. Re-evaluation of option (a), verified
against source [core-client-rcl mirror matching npm 0.4.5; AppWrapper.jsx +
Spa.jsx read in full]:

**Option (a-lite): mount `Spa` + `AppWrapper` as an INVISIBLE infrastructure
shell; render only tC4's own components inside.** The MUI/notistack chrome only
touches what those two components themselves render, which is exactly three
things:

1. **MUI `ThemeProvider`** — affects MUI components only; tC4's own components
   are untouched. The theme spec loads from `/api/app-resources/themes/
   default.json`, which the APP ships — and the rig's file already carries the
   tC4 design tokens (primary Ocean `#014263`, secondary Inspire `#31ADE3`)
   [VERIFIED — `dev-env/app-resources/app_resources/themes/default.json`].
2. **notistack toasts** for `misc` events — `Spa` hardcodes pastel MUI-alert
   colors in `CustomSnackbarContent` (styled, NOT theme-driven). Overrideable
   only via global CSS targeting `.notistack-MuiContent-*` classes; position
   fixed bottom-right, maxSnack 6. The residual seam.
3. **`<Box height:100vh overflow:hidden>`** around children — acceptable for a
   full-viewport desktop app; tC4 manages layout inside it.

`AppWrapper` also OWNS `messagesContext` state internally (useState + snackbar
effect) — any homegrown replacement must re-home it; using the shell gets it
for free.

**Bundle cost of carrying MUI+emotion+notistack while rendering none of it
(estimates, not measured):** tree-shaken imports (Box, ThemeProvider,
createTheme, Snackbar machinery, styled) ≈ 60–100 KB min+gzip JS incl. the
emotion runtime; notistack ~8 KB; fetch-event-source ~3 KB. In an
Electronite-packaged desktop app served from localhost this is negligible at
runtime; the real costs are hygiene: a second styling runtime (emotion)
coexisting with tC4 CSS, a larger dependency-audit surface (TEST-PLAN), and
exact-pin discipline on the rcl + its peer deps.

**Standing rank once (c) was ruled out:** (a-lite) vs (b) is now the live choice.
(a-lite) buys upstream-maintained SSE dispatch (no drift risk) at the price of
the toast seam + dep surface; (b) buys zero MUI at the price of a copied
dispatch that must track upstream event-vocabulary changes. D29's "no visual
components" intent is preserved under (a-lite) — tC4 still renders zero MUI
components of its own; the shell is wiring. Owner decision pending.

**RESOLVED [decided 2026-07-31 — D33]:** the owner ruled for option (a-lite) —
use the Spa providers via the invisible shell, conditioned on UX neutrality
(toast CSS restyle, app-shipped theme tokens, exact-pin re-reads, fall back to
option (b) if a shell update adds unstyleable chrome). Conditions are normative
in STATE.md D33; this file remains the technical reference.
