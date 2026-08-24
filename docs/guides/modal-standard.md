# Modal Standard

The single, enforceable pattern for every modal in the plugin. Companion to
[`wpds-usage-audit-patterns.md`](wpds-usage-audit-patterns.md) — that doc covers
WPDS usage broadly; this one nails down modals specifically because they had
drifted into ~33 instances with five sizing strategies, four footer
conventions, and inconsistent button order/variants.

Every modal uses the WPDS `Modal` from `@wordpress/components`. There is no
other dialog primitive. The rules below govern everything *around* it.

For screen-level structure — tabs, sections, cards, helper text and where saving
happens — see [`settings-standard.md`](settings-standard.md).

## TL;DR

| Concern | Rule |
|---|---|
| Header title | A plain localized **string** in `title`. Never JSX/markup. |
| Header actions | Buttons beside the close button go in the `headerActions` prop, never inside `title`. |
| Header icon | None. Modal headers carry no `icon`. |
| Long titles | Dynamic/user-supplied titles add `vip-workflow-modal--truncate-title` (single-line ellipsis). |
| Width | `size` prop only — `small` / `medium` / `large` / `fill`. Never CSS `max-width`/`min-width`, never inline `minWidth`. |
| Footer | `<ModalActions>` (`src/common/ModalActions.js`). Never a raw `<div>` or ad-hoc `Stack`. |
| Button order | Cancel (left) → primary action (right). Primary is always rightmost. |
| Button variants | Cancel = `tertiary`. Primary action = `primary`. Destructive = `primary` + `isDestructive`. |
| Pending state | `isBusy` + `disabled` on the action button. Never `{ busy ? <Spinner/> : label }`. |
| Errors | `<Notice status="error" isDismissible={ false }>` at the top of the body. |
| Content | `Text` for prose, `Badge intent` for status, tokens for all color/spacing. No hardcoded hex, no inline `style` except runtime-dynamic values fed as CSS vars. |
| Form controls | Always `__next40pxDefaultSize` + `__nextHasNoMarginBottom`. |
| Dismissibility | Dismissible by default. Blocking modals set the trio (see below). |

## Header

The Modal renders its own header from props — never hand-build one in the body.

- **Title** is a plain localized string passed to `title`. Do not pass JSX
  (a `<span>`, an icon, a button) — a long inline header breaks the fixed-height
  header layout.
- **Header actions** (a button next to the close button — e.g. "View in day
  view") go in the `headerActions` prop:

  ```jsx
  <Modal
    title={ format( day, 'EEEE, MMMM d, yyyy' ) }
    headerActions={
      <Button __next40pxDefaultSize icon="calendar-alt" label={ … } onClick={ … } />
    }
    onRequestClose={ onClose }
    size="medium"
  />
  ```

- **No icon.** Modal headers do not use the `icon` prop. (Iconography, including
  the purple AI accent, stays in the body, not the header.)
- **Long titles truncate.** The WPDS header is a fixed-height bar, so a long
  title clips. Modals whose title is dynamic or user-supplied (post titles,
  source titles, tool labels…) add the `vip-workflow-modal--truncate-title`
  class (defined in `src/styles/modal-header.css`, shared across bundles)
  alongside their own modal className for consistent single-line ellipsis.
  Static, hand-authored titles are short and don't need it.

## Width — `size` only

WPDS exposes width as a first-class prop. Use it. Map by content:

| `size` | Use for |
|---|---|
| `small` | confirms, single text/textarea field, short forms |
| `medium` | standard forms, detail panels |
| `large` | search results, data grids, rich/multi-column content |
| `fill` | rare; near-full-screen working surfaces |

```jsx
<Modal title={ … } onRequestClose={ onClose } size="medium">
```

**Banned:** `.vip-workflow-x .components-modal__content { max-width: … }`,
`style={ { maxWidth: … } }` on the Modal, and `<div style={ { minWidth: … } }>`
wrappers. If a preset width is wrong for a case, that is a conversation about
which `size` to use — not a CSS override. (The one tolerated `__content`
override is `padding: 0` for a full-bleed `DataViews` body, e.g. the Calendar
day-posts modal.)

## Footer — `<ModalActions>`

```jsx
import { ModalActions } from '../../components/ModalActions';

<ModalActions>
	<Button variant="tertiary" onClick={ onClose } disabled={ saving }>
		{ __( 'Cancel', 'vip-workflow' ) }
	</Button>
	<Button variant="primary" onClick={ onSave } isBusy={ saving } disabled={ saving }>
		{ saving ? __( 'Saving…', 'vip-workflow' ) : __( 'Save', 'vip-workflow' ) }
	</Button>
</ModalActions>
```

`<ModalActions>` is a thin wrapper over `ActionRow` (the shared action group
from [`action-standard.md`](action-standard.md), itself a
`Stack direction="row" justify="flex-end" gap="sm"`) that also owns the top
spacing between body and footer (token-based, so no per-modal `marginTop:16px`).
Children appear left→right; put cancel first so the primary lands on the right.

A single-button acknowledge footer is still `<ModalActions>` with one `primary`
button.

**All footer actions are right-aligned**, in DOM order (secondary actions before
the primary, primary rightmost). A secondary action — even one that navigates,
like "View source" — is a `Button` (`variant="tertiary"`, with `href`/`target`
if it's a link), not a bare `Link`, so it matches the other footer buttons.

**The footer owns its own layout.** Consumers must NOT style the footer or its
contents in place — no `className` on the buttons for spacing, no
`margin-right: auto`, no per-modal footer CSS. If a real footer variant is ever
needed, add a prop to `ModalActions` — never restyle it from the consumer.

## Body layout

Wrap the body in **`<ModalBody>`** — the body counterpart to `<ModalActions>`. It
is a vertical `Stack` that owns the spacing between content blocks, so no
per-child margins or ad-hoc `Stack`s. Prose is `Text`; there is no raw
`<p>`/`<h4>`/`<span>` for body copy.

```jsx
<Modal title={ … } onRequestClose={ onClose } size="medium">
	<ModalBody>
		{ error && (
			<Notice status="error" isDismissible={ false }>{ error }</Notice>
		) }
		{ /* fields, or Text for prose */ }
	</ModalBody>
	<ModalActions>{ /* buttons */ }</ModalActions>
</Modal>
```

`<ModalBody>` takes an optional `gap` (default `md`). **Exceptions** that skip it:
a full-bleed `DataViews` grid (owns its own padding) and static documentation
modals.

## Pending / busy

The action button shows progress via `isBusy` and is `disabled` while pending.
Hand-rolled `{ busy ? <Spinner/> : 'Label' }` inside a button is banned. A
`Spinner` is only for loading the modal **body content** (e.g. fetching options),
never as a button's label.

## Errors

Surface form/submit errors with `<Notice status="error" isDismissible={ false }>`
at the top of the body. Do **not** use a control's `help={ error }` as the error
channel (it reads as guidance, not failure).

## Dismissibility

Dismissible by default — rely on Modal defaults. A **blocking** modal (one the
user must resolve, e.g. "you must pick a workflow") sets all three:

```jsx
<Modal
	isDismissible={ false }
	shouldCloseOnEsc={ false }
	shouldCloseOnClickOutside={ false }
	onRequestClose={ undefined }
	…
/>
```

That is the only sanctioned reason to touch these props.

## Shared components

Reach for these before hand-rolling; they encode the rules above.

| Component | Path | For |
|---|---|---|
| `ModalBody` | `src/common/ModalBody.js` | every modal body container |
| `ModalActions` | `src/common/ModalActions.js` | every modal footer |
| `useConfirm` | `src/common/use-confirm.js` | confirm / acknowledge dialogs; accepts a rich `message` (string or node) |
| `TransitionTextInputPopover` / `TransitionAssignmentPopover` | `src/editor/components/TransitionInputPopover.js` | collecting one text/textarea value, or an assignee plus notes, for a transition that requires input — side-anchored beside the rail, not a modal over the screen |
| `HowToModal` | `src/admin/components/HowToModal.js` | "Creating Custom X" documentation modals (admin-only; wraps `InstallSkillButton`) |
| `ToolFailuresModal` | `src/common/ToolFailuresModal.js` | transition-blocked / soft-warning lists (editor + admin) |

**Don't reinvent these.** A new "OK"/acknowledge dialog is `useConfirm`. A new
docs modal is `HowToModal`. A new blocked-transition modal is `ToolFailuresModal`.

## Migration checklist (per modal)

- [ ] `title` is a plain string; header buttons use `headerActions`; no header `icon`.
- [ ] Dynamic/user-supplied title carries `vip-workflow-modal--truncate-title`.
- [ ] Width is a `size` prop; CSS/inline width overrides deleted.
- [ ] Footer is `<ModalActions>`; cancel `tertiary` first, primary last.
- [ ] Action button uses `isBusy` + `disabled`; no spinner-as-label.
- [ ] Errors via `Notice status="error"`.
- [ ] Body prose is `Text`; status is `Badge intent`; no hardcoded hex.
- [ ] Form controls have `__next40pxDefaultSize` + `__nextHasNoMarginBottom`.
- [ ] No inline `style` except runtime-dynamic values (fed as CSS vars).
- [ ] Duplicated/doc/acknowledge modals routed through the shared component.
