# WPDS Component Usage — Audit Patterns

Working notes for auditing how the plugin's React components consume the
WordPress Design System (`@wordpress/components`, `@wordpress/ui`, and the
`--wpds-*` design tokens). These patterns are intended to seed a future
**WPDS usage audit skill**.

> Source case study: `vip-workflows/src/admin/components/GeneralSettings.js`
> + `GeneralSettings.css` (the shared `vip-workflows-settings-*` chrome).

## Guiding principle

A component built on WPDS should rely on the **default styles the components
ship with** and the **props they expose** ~99% of the time. CSS overrides and
custom class names should be rare and should represent either:

1. **Novel composition** WPDS doesn't provide, or
2. **Styling genuinely required** for the plugin to function/look correct.

Everything else — spacing, typography, color, layout that a component or
layout primitive already expresses — should be deleted in favor of defaults +
props. Duplicating a WPDS token value in hand-written CSS is a smell, not a
feature.

## Strict convention: no CSS-in-JS

**Styling lives in CSS, not in JS.** Do not inject visual styling through JS where
it hides from the stylesheet — inline `style={{ … }}` objects, runtime class
string-building for appearance, `css`/`styled`/`sx`, etc. Static visual styling
belongs in a CSS class (or, better, a component prop — `Stack gap`, `Text
variant`). There must be a **strong structural reason** to keep raw styles in JS.

Order of preference:

1. **Component prop** — `Stack gap`, `Text variant`, control props. (best)
2. **CSS class** in the component's `.css` file, on tokens.
3. **Inline `style`** — last resort, only for genuinely **runtime-dynamic**
   values that cannot be authored statically.

### The only legitimate exception

A value that is **computed at runtime and unknowable at authoring time** — e.g. a
drag transform, a measured width, a data-driven percentage or position. Even
then, prefer to **feed a CSS custom property from JS and consume it in CSS**, so
the styling rules stay in the stylesheet:

```jsx
// JS only supplies the value…
<div className="vip-workflows-bar" style={ { '--vip-bar-fill': `${ pct }%` } } />
```
```css
/* …CSS owns the actual styling */
.vip-workflows-bar { width: var( --vip-bar-fill ); }
```

**Not** legitimate: `style={{ display:'flex', gap:'10px', padding:'20px' }}` —
that's static layout with off-token literals; it's a `Stack` (anti-pattern D/E).

## Installed API constraints (`@wordpress/ui@0.9.0`)

**"Exported" ≠ "recommended."** A component can ship as an `@wordpress/ui`
export yet be absent from the MCP `get_components` list — that means "ships but
don't use yet." Always check BOTH: that it exists (`node -e "const
ui=require('@wordpress/ui'); console.log('Fieldset' in ui)"`) AND that it's in
the MCP recommended list. This table was wrong once (it mislabeled
`Collapsible`/`Fieldset`). As of 0.9.0, three buckets:

| Bucket | Components | Guidance |
|---|---|---|
| **Recommended** (in MCP) | `Stack`, `Text`, `Card`, `Link`, `Badge`, `Collapsible`, `CollapsibleCard`, `Tabs`, `Tooltip`, `VisuallyHidden` | Use these. |
| **Ships but NOT recommended** (export present, absent from MCP) | `Field`, `Fieldset`, `Input`, `InputLayout`, `Select`, `Textarea`, `Dialog`, `IconButton` | Don't adopt yet → use `@wordpress/components` controls (`SelectControl`, `TextareaControl`), `Modal`/`ConfirmDialog` (not `Dialog`), `Button` (not `IconButton`), raw `<fieldset>`. |
| **Genuinely absent** | `Heading`, `HStack`/`VStack`/`Flex`, `Divider`, `Spacer` | `Heading`→`Text variant="heading-*" render={<h3/>}`; flex→`Stack direction`; no `Divider`→token border. |

Hand-rolled disclosure/accordion (restyled `Button` + chevron + `useState`) →
`Collapsible`/`CollapsibleCard` (recommended). Hand-rolled dialog → `Modal`.

`Stack` and `Text` `gap`/`variant` consume tokens directly — that's the point.
`render` swaps the underlying element while keeping component styles/semantics
(e.g. `<Text render={<legend/>}>`), so semantic HTML is preserved.

WP 7.0 components are **margin-free by default**; spacing is the consumer's job
via a layout parent. Controls already opt in with `__nextHasNoMarginBottom`.

## Anti-patterns to weed out

### A. Child margins for inter-element spacing
Spacing applied as `margin-bottom`/`margin-top` on children (cards, sections,
fields, action rows) instead of a parent `Stack gap`.

> **Tell:** a second class that exists only to *undo* the child margin and
> re-own the gap (e.g. `.settings-stack .settings-card { margin-bottom: 0 }`).
> That's proof the margin approach fights itself.

**Fix:** parent `<Stack direction="column" gap="…">`; children carry no margin.

### B. Reaching into `.components-*` internals
Selectors like `.components-toggle-control { margin }`,
`.components-checkbox-control__label { font-size }` override WPDS component
internals — usually spacing or font — for no semantic reason, often while
`__nextHasNoMarginBottom` is already set.

**Fix:** delete; let the control use its defaults, let a `Stack` own spacing.

### C. Hand-rolled typography that maps to a `Text` variant
`<h3>` / `<p>` / `<span>` / `<legend>` + `font-size` / `font-weight` / `color`
CSS that a `Text variant` reproduces.

**Fix:** `<Text variant="heading-sm" render={<h3/>}>` etc. Delete the CSS rule.
Semantic colors (warning/success/error tone) may remain as a token on the
`Text` — that's a legit prop-driven override.

### D. Raw `<div>` flex / inline-style that is a `Stack`
`<div style={{display:'flex', gap:'10px', padding:'20px'}}>` — especially with
**off-token literal values** (`10px`, `20px`).

**Fix:** `<Stack direction gap align justify>` with token `gap`.

### E. Off-token literal values anywhere
Hardcoded px that bypass the token scale (`gap:'10px'`, `border-radius:3px`,
`font-weight:600` when the weight token is 499, `min-width:300px`). Snap to the
nearest token or to a `Stack`/`Text` prop. A hardcoded value also stops
tracking the token when the design system retunes it.

### F. Re-styling a raw element to mimic an existing WPDS component/prop
The broadest and most valuable pattern: a raw element (or an overridden
component) is hand-styled to reproduce something WPDS already ships as a
**component or a prop**. "Could this CSS be a prop?" — often it already *is* one.

| Smell | Use instead |
|---|---|
| `<a className="…link">` + brand-color CSS | `<Link href>` (`@wordpress/ui`) |
| `<button>` styled `border:none;background:none` to look like a link | `<Button variant="link">` |
| Hand-inlined `<svg>` for a shipped glyph | `<Icon icon={ … } />` (`@wordpress/icons`) |
| `<Badge>` + categorical color classes whose hues are **semantic tones** | `Badge` `intent` (`high`/`medium`/`low`/`stable`/`informational`/`draft`/`none`) |

**Tell:** a prop is set and then *masked* by CSS — e.g. `intent="draft"`
overridden by a `.badge--x { background … }` rule. Map the value to the prop and
delete the CSS. Keep a custom class only for a value with **no** component
equivalent (e.g. the project AI/purple hue — no `Badge` intent for it).

> Nuance: categorical vs. semantic. If a set of variants carries semantic tone
> (success/error/warning/info), prefer the component's `intent`/`tone` prop. Keep
> custom color only for genuinely tone-less categories.

### G. No-op / dead-*applied* classes
Two directions the dead-CSS sweep alone misses:
- A rule that sets a property to **its own default** (`margin-right: 0`,
  `flex-direction: row`) — does nothing; the class toggling it in JS is pointless.
- A class **string-built/toggled in JS but defined in no CSS** (a stray state
  class). Often the behavior is already driven by conditional rendering.

**Fix:** delete the rule *and* the JS that applies it.

### H. Magic-number duplication
The same literal repeated across rules (e.g. a `320px` panel width used as width,
as a sibling's offset, and as a `:has()` trigger) — and often equal to a token
anyway (`320px` == `--wpds-dimension-surface-width-sm`).

**Fix:** one local custom property aliased to the token
(`--vip-panel-width: var(--wpds-dimension-surface-width-sm)`), consumed everywhere.

### I. Cross-file / cross-*bundle* class ownership
A component renders classes whose CSS lives in **another file** — or worse,
another **bundle** (an `src/admin/*` component styled by `src/editor/style.css`).
If that bundle isn't loaded on the page, the markup renders unstyled.

**Fix:** co-locate the styles with the component (or a shared admin stylesheet
the page actually loads). The audit must resolve each class to its owning
stylesheet — never assume same-file.

*Variant — shared utility re-declared in N files:* a utility class (e.g.
`vip-workflows-card-surface`) defined identically in many stylesheets instead of
once. Define it a single time in the shared admin stylesheet and reuse.

## Genuine overrides to KEEP (the real 1%)

- **CSS Grid** (`display:grid; grid-template-columns: repeat(auto-fill, …)`).
  `Stack` is 1-D flex and cannot express auto-fill responsive grids.
- **App-shell / scroll-container layout** — `flex: 1`, `overflow-y: auto`,
  `min-height: 0`, and `position` context for absolutely-positioned children.
  This is layout *plumbing* beyond `Stack`. `Stack` owns **content spacing and
  alignment**, not flex sizing/overflow/positioning — don't force-convert these.
- **Overlays / imposters** — `position: fixed/absolute; inset: 0; z-index;
  backdrop-filter`. Stack can't express positioning; keep as CSS (tokenize the
  values it can).
- **Separators/dividers** — no `Divider` in 0.9, so a thin `border-top/bottom`
  with a token color is acceptable until a component exists.
- **Semantic status color** on text (warning/success tone tokens).
- **Accessibility grouping** — `<fieldset>` / `<legend>` for related control
  groups is correct and should not be removed (see DataForm note below).
- **`DataViews` chrome** — on a DataViews screen, the table/filter/search/
  pagination/empty UI comes from the component; custom CSS should cover only the
  **custom field cell renders** and any modal. Don't restyle the table chrome.
  (Its stylesheet ships separately — copied to `build/` and enqueued — not
  imported in JS; that's expected, not a cross-bundle bug.)

> **Color caveat:** there are no alpha/opacity tokens, so an `rgba(brand, .08)`
> overlay tint has no token — but **don't hardcode the rgb** (`rgba(56,88,233,…)`
> duplicates the brand value). Prefer `color-mix(in srgb, var(--wpds-…) 8%,
> transparent)` so the base color still tracks the token.

## wp-admin ↔ WPDS cascade-layer conflicts (why DS styles get overridden)

**Symptom.** A `@wordpress/ui` component renders correctly and injects its CSS —
you can see the rule in DevTools under `@layer wp-ui-components` — yet a plain
wp-admin selector wins anyway. Classic case: `<Text variant="body-sm">` rendered
as a `<p>` gets its typography clobbered by `common.css`'s `p {}`; a heading
loses to `.wrap h1`. Raising specificity does **nothing**.

**Root cause — layers, not specificity.** `@wordpress/ui` declares
`@layer wp-ui-utilities, wp-ui-components, wp-ui-compositions, wp-ui-overrides;`
and styles its components *inside* those layers (`Text`'s `.body-sm` sets `font-*`
in `@layer wp-ui-components`). wp-admin's `common.css` is **unlayered**. In the
cascade, an **unlayered *normal* declaration beats *any* layered one regardless of
specificity** — layer origin outranks specificity. So the DS's specific, hashed
selector still loses to a bare `p {}`. You can't out-specify it; you have to win
the *unlayered* contest.

**The fix — canonical implementation: the "wp-admin typography reset" block in
[`vip-workflows/src/admin/admin-page.css`](../../vip-workflows/src/admin/admin-page.css).**
An **unlayered**, canvas-scoped rule that (a) out-specifies wp-admin's globals and
(b) hands the property back to the DS layer:

```css
.wrap:has( .vip-workflows-admin-page )
	:where( p, h1, h2, h3, h4, h5, h6 ):where( :not( .description ) ) {
	font: revert-layer; /* wpds-allow R5 -- defer to @layer wp-ui-components */
	margin: 0;          /* wpds-allow R2 -- DS is margin-free; Stack owns spacing */
}
```

Each decision is load-bearing:

- **Unlayered + `.wrap:has( … )` → specificity (0,2,0).** Enough to clear
  wp-admin's `.wrap h1` / `.wrap p` (0,1,1). A bare `.vip-workflows-admin-page`
  scope is only (0,1,0) and still loses to `.wrap h1`.
- **`revert-layer`, not a hardcoded token.** DS classes are hashed CSS-module
  names — no stable hook to target — so you can't re-declare the DS value; you
  *defer* to it. `revert-layer` rolls the property back to the previous layer's
  value (`wp-ui-components`), keeping the DS `variant` the single source of truth.
- **`:where()` around the tags keeps element weight at 0.** The rule stays exactly
  (0,2,0), so each component's own layered styles — and explicit per-instance
  overrides (e.g. the `__title` rule below it) — still win over the reset. It
  clears wp-admin without becoming a new bully.
- **`margin: 0`, not `revert-layer`.** DS components are margin-free (WP 7.0);
  `revert-layer` on margin would resurrect the UA `1em`. Explicit `0` is the DS
  intent — the surrounding `Stack` owns spacing.
- **Exclude wp-admin-classed helpers (`.description`, …).** `revert-layer` rolls
  back past *every* unlayered rule, not just wp-admin's bare-tag ones — so on a
  `.description` it would strip its 13px/italic. Add any intentionally
  wp-admin-styled flow element to the `:not()` list (as a zero-specificity
  `:where( :not( … ) )` so the (0,2,0) math holds).

**Expect to resolve this again.** It recurs whenever:

- a **new surface** renders WPDS components **outside `.vip-workflows-admin-page`**
  — modals and the slideout portal elsewhere in the DOM and don't inherit this
  reset, so they need their own equivalent scoped to their root;
- a **new bare tag** starts colliding — extend the `:where( … )` tag list (kept
  narrow on purpose; structural tags like `ul`/`ol`/`table` are left to their
  components);
- a wp-admin rule is **ID-scoped** (`#wpbody-content …`, (1,0,1)) and out-specifies
  (0,2,0) — that collision needs its own targeted override, not the blanket reset.

**Gate annotation.** The gate reads `font: revert-layer` as raw type styling
(R5) — it isn't — so annotate it `wpds-allow R5` with the "defers to the DS
layer" reason.

### Detecting new cases (runtime audit)

A CSS linter can't find these — the conflict is a cross-stylesheet cascade
interaction that only exists against real DOM. The detector is therefore a
runtime e2e audit: [`tests/e2e/wpds-cascade-audit.spec.js`](../../vip-workflows/tests/e2e/wpds-cascade-audit.spec.js)
(logic in [`helpers/wpds-cascade-audit.js`](../../vip-workflows/tests/e2e/helpers/wpds-cascade-audit.js)).

```bash
npm run test:e2e -- wpds-cascade-audit      # from vip-workflows/
```

It visits each DS admin surface (plus the AI slideout portal) and flags every
element where a `@layer wp-ui-*` declaration co-exists with an unlayered
wp-admin declaration for the same property and no covering "ours" rule — i.e.
the exact signature of a needed reset. It's informational by default (known gaps
are expected); `WPDS_AUDIT_STRICT=1` makes it fail on any finding, for use as a
regression guard once a surface is clean. Add new screens to the spec's `SCREENS`
list. The two finding shapes it surfaces map to the recurrence cases above:

- **Portal surfaces** (the slideout, modals) — a DS element outside
  `.vip-workflows-admin-page` that the canvas reset never reaches → give that root
  its own scoped reset.
- **`.description`-carrying DS elements** — a `<Text>` that also has
  `className="description"`. Our reset excludes `.description` by design, so
  wp-admin's `p.description` wins. Resolve the contradiction in code: drop the DS
  variant (keep the wp-admin help-text look) *or* drop `.description` (let the DS
  variant own it, and the reset then covers it).

### How WordPress core 7.0 actually handles this (verified)

Checked against a live WP 7.0 + Gutenberg-trunk env, using the new design-system
admin screens as the reference — `wp-admin/font-library.php` (a real core 7.0
entry point) and its `@wordpress/boot` "pages" siblings (`dashboard`,
`content-types`, `options-connectors`, `media-editor`). There is **no systemic
cascade-layer fix to adopt**; core sidesteps the conflict structurally instead:

- **Core did NOT layer-wrap `common.css`.** There is no `@layer` anywhere in
  `wp-admin/css` in 7.0, and `@wordpress/ui` is not registered as a consumable
  core style handle. The unlayered-beats-layered problem is real and unaddressed
  at the platform level — so our earlier guess that "Core wraps legacy CSS in a
  lower layer" was **wrong**; it hasn't shipped.
- **Page strategy = takeover, not coexistence.** The Font Library screen keeps
  the admin menu chrome but `display:none`s *all* legacy content
  (`#wpbody-content > div:not(.boot-layout-container)`) and `#wpfooter`, then
  mounts a **single** React app into one container (`@wordpress/boot`
  `initSinglePage`). It never interleaves DS components with classic markup, so
  the conflict surface is tiny by construction.
- **Component strategy = unlayered per-component resets, not `revert-layer`.**
  Each boot component that renders a bare tag bakes in its own reset — the
  heading is `:is(h1,h2,h3,h4,h5,h6).<hash>__heading { color: var(--wpds-…);
  font-size: inherit; font-weight: var(--wpds-…); margin: 0 }` at specificity
  **(0,1,1)**, unlayered — just enough to tie `.wrap h1` and win on source order.
  Inputs reset `border/background/padding` the same way. Values come from
  `--_gcd-*` custom properties with wp-neutralizing fallbacks. (The bundled
  `@wordpress/ui` `Text` is still *layered* and would lose to `common.css`; the
  takeover is what saves it, not a layer trick.)

**Why we don't just copy core.** The boot/`gcd` component set (with resets baked
in) isn't a published package we can consume, and the **takeover** is the
opposite of `AdminPage`'s intentional "live inside classic wp-admin chrome"
design (real breadcrumbs/header/footer in the DOM). Our reset is the *same idea*
core applies per-component — defer typography, zero margins, beat unlayered
`common.css` on specificity — just applied as one canvas-level blanket because
`@wordpress/ui@0.9` `Text` ships no reset and we render interleaved rather than
taking the page over. Our (0,2,0) is in fact stronger than core's (0,1,1)+order.
The one genuinely different option core validates — for a *future* surface with
heavy conflicts that can tolerate isolation — is the takeover itself (hide legacy
content, mount one isolated app); that's a structural choice, not a CSS tweak.

## Structural smells to flag (beyond pure styling)

- **Componentization:** near-identical blocks (e.g. two tool-failure `<Modal>`s
  rendering the same list shape) → extract a component. Large modal/JSX islands
  embedded in a page component are extraction candidates.
- **Inconsistent feedback:** a hand-rendered `<Snackbar>` alongside
  `createErrorNotice({ type:'snackbar' })` elsewhere — standardize on the
  `@wordpress/notices` store.

## DataForm consideration (form groups)

Hand-rolled form groups (a `<fieldset>` of related `CheckboxControl`s, etc.) are
*candidates to flag* — not auto-convert — for `DataForm` (`@wordpress/dataviews`).

- `DataForm` auto-generates a form from `data` + `fields` + `form` layout config
  and is canonically used to edit **items of a dataset** (often beside
  `DataViews`). The plugin already uses DataViews in several admin screens.
- It is a **larger architectural choice**, not a CSS cleanup: you'd model the
  *whole* settings panel as one DataForm, not surgically swap one `<fieldset>`.
- Weaker fit when there's **conditional UI** (fields shown only when another is
  on), bespoke controls (a responsive role-checkbox grid), or **singleton
  config** semantics rather than a dataset record.
- **Audit stance:** keep `<fieldset>`/`<legend>` for the accessible cleanup;
  log "consider DataForm" as a separate spec decision.

## Forms & Inputs Playbook

Most of the admin UI is forms. Decide the approach **once, up front**, per form.

### Decision: `DataForm` vs hand-built

**Reach for `DataForm`** (`@wordpress/dataviews`) when most are true:
- You're editing an **item/record** that is (or resembles) a row in a dataset —
  especially if `DataViews` already lists those items (edit drawer / inline).
- The fields are **describable as data**: standard types + enum `elements`.
- Layout is regular/sectioned with **little conditional logic**.
- You want **config-driven, extensible** forms (fields defined as data) — aligns
  with the plugin's "sequences drive everything" ethos.
- Built-in **validation** (`isValid`) and consistent layout pay off, or the same
  schema is edited in **multiple places**.

**Build by hand** (controls + `<form>`/`<fieldset>`) when any is strongly true:
- **Singleton config / settings panels** (not dataset records).
- Significant **conditional / dependent fields**, dynamic add-remove sections,
  or **multi-step wizards**.
- **Bespoke controls or layout** that `DataForm` would need custom `Edit`
  renders for (which negates the savings).
- Small **one-off** forms where config overhead exceeds the boilerplate saved.

**Gray zone:** a field-heavy panel with uniform fields and little conditionality
can go either way — lean `DataForm` if the schema is stable and data-describable.

### Hand-built form anatomy

1. Wrap in a native **`<form onSubmit>`** — there is no WPDS `<Form>`; the native
   element gives you enter-to-submit and correct semantics.
2. Group related controls in **`<fieldset>` + `<legend>`** — `@wordpress/ui`
   ships `Fieldset`/`Field`, but that form set isn't recommended yet, so raw
   `<fieldset>`/`<legend>` is the correct accessibility grouping for now.
3. Use a **`@wordpress/components` control for every input** (see map below).
4. Lay controls out with **`@wordpress/ui` `Stack`** (gap owns spacing) and use
   **`Text`** for labels/help/headings via `variant` + `render`.
5. For a **novel control**, wrap the element in **`BaseControl` +
   `useBaseControlProps`** so label/help/`aria-describedby` are wired correctly —
   never hand-roll `<label>` association.

### Input need → component map (`@wordpress/components@32.x`)

| Need | Component |
|---|---|
| Single-line text | `TextControl` (or `__experimentalInputControl`) |
| Multi-line text | `TextareaControl` |
| Number / unit | `__experimentalNumberControl` / `__experimentalUnitControl` |
| Single select | `SelectControl`, `CustomSelectControl`, `ComboboxControl`, `TreeSelect` |
| Multi-select / tags | `FormTokenField` |
| Boolean | `ToggleControl` (settings), `CheckboxControl` (in a set) |
| One-of-N | `RadioControl`, `__experimentalToggleGroupControl` |
| Range | `RangeControl` |
| Search | `SearchControl` |
| Color | `ColorPalette` / `ColorPicker` / `GradientPicker` |
| Date / time | `DateTimePicker` / `DatePicker` / `TimePicker` |
| File / drop | `FormFileUpload` / `DropZone` |
| Custom control shell | `BaseControl` + `useBaseControlProps` |

> Some controls are still `__experimental`-prefixed (`InputControl`,
> `NumberControl`, `UnitControl`, `ToggleGroupControl`). Confirm the export name
> via the WPDS MCP before importing.

### Raw HTML — when it's legitimate

`@wordpress/components` provides a control for **every standard input type**, so a
raw `<input>` for standard types is an anti-pattern. Raw HTML is correct only for:

- **`<form>`** — no WPDS form wrapper.
- **`<fieldset>` / `<legend>`** — `Fieldset`/`Field` exist in 0.9 but aren't
  recommended yet, so raw `<fieldset>`/`<legend>` is still correct.
- A **raw element inside `BaseControl`** only when WPDS genuinely lacks the
  control type (rare; you're building a novel control).

Everything else — labels, help text, descriptions, headings, layout — goes
through a component (`Text`, `Stack`, `BaseControl`), not raw `<p>`/`<div>`/`<h*>`.

### Grouped controls: fieldset without a legend (decision)

WPDS's dedicated **form component set** (`Field`/`Fieldset`/`Input`/`Select`/
`Textarea`) ships in `@wordpress/ui@0.9` but is **not recommended yet** (unstable
API). That instability is a real cost, but it is not the interesting part of this
decision — the interesting part is that a **native `<legend>` does not work**,
and any local wrapper built on one inherits the same two defects.

**Measured in Chromium**, a `display: flex` fieldset with a 40px `gap`:

| Markup | gap applied | role | accessible name |
| --- | --- | --- | --- |
| `<fieldset>` + `<legend>` | **0px** | `group` | the legend text |
| `<fieldset aria-labelledby>` + `<div>` | **40px** | `group` | the div text |

A `<legend>` is not a flex item of its own fieldset, so `gap` silently does
nothing and every space around it has to become a margin. Swapping it for a
`<div>` wired through `aria-labelledby` gives an **identical** accessibility
mapping — same `group` role, same computed name — and the box starts behaving
like a normal flex child.

The second defect is independent of the legend. `<fieldset>` carries a UA
`min-inline-size: min-content`, so it refuses to shrink and overflows a
constrained flex or grid parent: **203px** where it was given 50px, in both
markups. Only `min-inline-size: 0` fixes it, and `@wordpress/ui`'s Fieldset does
**not** set it — that stylesheet zeroes `border`, `margin` and `padding` and
stops. The canvas and modal resets in `src/admin/admin-page.css` and
`src/styles/modal-reset.css` carry it for every fieldset on the page.

**So: group with `@wordpress/ui`'s `Fieldset`.**

- `Fieldset.Root` renders a real `<fieldset>` — you keep `role="group"` *and* the
  native `disabled` cascade to every descendant — with `aria-labelledby` pointing
  at `Fieldset.Legend`, which is a `<div>`. There is no `<legend>` element.
- Put the group's context in `Fieldset.Description`, never inside the legend.
  Nested there it joins the group's accessible **name**, so a screen reader reads
  the title and the whole description on entry. `Fieldset.Description` is wired
  through `aria-describedby`, which is where context belongs.
- Do not hand-roll `<fieldset><legend>`. It is the one shape that measurably
  fails, and it is what the previous version of this section prescribed.

**If the unstable API becomes a problem**, the escape is small and known: a local
wrapper on the same technique — real `<fieldset>`, a `<div>` label plus
`aria-labelledby`, a description plus `aria-describedby`, and a reset that
includes `min-inline-size: 0`. That is all `Fieldset` is doing. Swap the three
call sites, keep the semantics. Do not build it pre-emptively.

## Audit checklist (seed for the skill)

For each component file + its CSS:

1. List every custom class applied on top of a WPDS component.
2. For each class, classify: (A) child-margin spacing, (B) reaches into
   `.components-*`, (C) typography→`Text` variant, (D) flex `<div>`→`Stack`,
   (E) off-token literal, or **KEEP** (grid / divider / semantic color / a11y).
3. Replace A–E with layout primitives (`Stack`), `Text` variants, and exposed
   props; delete the CSS.
3a. Grep the JS for **CSS-in-JS**: inline `style={{ … }}`, appearance-driven
    class string-building, `css`/`styled`/`sx`. Move static styling to a prop or
    CSS class; allow inline `style` only for runtime-dynamic values (prefer the
    CSS-custom-property pattern). Flag every remaining inline `style`.
3b. Scan for **component mimicry** (F): raw `<a>`/`<button>`/`<svg>` or a
    component overridden via CSS to reproduce an existing WPDS component/prop
    (`Link`, `Button variant="link"`, `Icon`, `Badge intent`). Map to the
    component/prop; flag any prop *masked* by CSS.
3c. Cross-check **class → stylesheet ownership** (I): every class the component
    renders must resolve to a rule in a stylesheet the page loads; flag
    applied-but-undefined classes (G) and cross-file/cross-bundle ownership.
3d. Flag **no-op rules** (a property set to its default) and the JS that toggles
    them (G); flag **repeated literals** → local custom property aliased to a
    token (H).
4. Note shared-chrome classes — a class used by multiple consumers must be
   migrated across **all** consumers together, not one file at a time.
5. Flag hand-rolled form groups as possible `DataForm` candidates (don't
   auto-convert).
