# Action Standard

The single, enforceable pattern for every action outside a modal footer.
Companion to [`modal-standard.md`](modal-standard.md) — that doc governs modals,
whose footers were the one governed action surface in the plugin; this one
extends the same discipline to everything else: page headers, card footers,
settings bars, inspector panels, list rows, the transition rail, and the
notifications page. The amendments made when this standard was adopted are
recorded at the bottom.

Every action is a `Button` from `@wordpress/components`, or a DataViews action
descriptor. There is no other action primitive. The rules below govern how one
is weighted, ordered, placed, sized, labeled, and confirmed.

[`settings-standard.md`](settings-standard.md) completes the series: it governs
the shape of a settings screen, and it narrows this document's rules for save
actions specifically — one Save per screen, in a `SettingsFooter`, with a label
that never changes.

## TL;DR

| Concern | Rule |
|---|---|
| Every action | A WPDS `Button` or a DataViews action descriptor. No raw `<button>`, no `role="button"` div, no clickable `<tr>`. |
| Weight | `variant` encodes **consequence**, not emphasis. At most one `primary` per action group. |
| Destructive | `isDestructive` marks **irreversible or data-losing** actions only. It is a modifier on the variant the weight rule chose — never a signal on its own, and never a "be careful" flag on reversible actions. |
| Order | Dismiss/secondary first → primary last (rightmost, or lowest in a stacked group). Destructive actions are never rightmost beside a safe primary. |
| Alignment | Right-aligned in every container, via `ActionRow`. |
| Stretch | Hug by default. Stretch only in a column narrower than ~280px — and there, every button in the group stretches. |
| Size | Default (40px) in modal footers, page headers, settings bars, inspectors. `size="small"` in card footers and table cells. `size="compact"` only in the sub-280px columns (rail, sidebar panel, inspector). |
| Icon | `icon={ importedIcon }` from `@wordpress/icons`, before the label. Never a dashicon string, never a glyph in a translated string, never an icon as `children`. |
| Icon-only | Always `label` **and** `showTooltip`. `title` alone is never sufficient. |
| Busy | `isBusy` + `disabled`. Never spinner-as-label. |
| Labels | Sentence case. One verb per concept — see the vocabulary table. |
| Confirms | `useConfirm` with `isDestructive: true` for irreversible actions. No other confirm mechanic. |
| Focus | Never hand-write a focus ring on a `Button`. Custom controls use the shared focus-ring rule owned by the WPDS usage cleanup campaign. |

## Weight — what `variant` means

`variant` answers **"what happens if I click this?"**, not "how much do I want
you to."

| Variant | Means | Rule |
|---|---|---|
| `primary` | *The* action of this surface — the thing the user came here to do. | **At most one per group.** A group with no obvious primary gets none; do not promote arbitrarily. |
| `secondary` | A real action, but not the point of the surface. | Any number. |
| `tertiary` | Retreat, dismiss, or a low-stakes utility. | `Cancel` is always `tertiary`. |
| `link` | Navigates away or reveals more; changes nothing. | Never for an action that mutates state. |
| `isDestructive` | Irreversible or data-losing. A modifier applied on top of the variant the weight rule already chose. | Required on every irreversible action, including inside menus and confirms. **Not** for consequential-but-reversible acts: a publish-crossing transition or a proceed-past-warnings button is weighted and confirmed, never painted destructive. Diluting the red treatment is how it stops meaning anything. |

Surface-specific consequences:

- **Transition rail:** a stage's transition is `primary` only when the stage
  offers exactly one transition and that transition is not locked; everything
  else is `secondary`. A lone locked move promotes nobody — a disabled button
  cannot be the surface's point — and neither does the one performable move
  among locked siblings. Consequence rides the confirm flow
  (`warnings_pending`), not the palette — a move that skips work its siblings
  do looks like any other, because nothing in the sequence says which those
  are.
- **Cards:** the screen's leading verb is `primary` at the `SummaryCard` call
  site (Jobs → `Run now`, Sequences → `Edit`); utilities are `tertiary`.
- **DataViews quick actions:** first `primary`, rest `secondary` — never N
  primaries in one cell.

## Order and alignment — `ActionRow`

Everywhere — card footers, page headers, settings bars, inspector panels — the
same shape modal footers already have:

```jsx
import { ActionRow } from '../components/ActionRow';

<ActionRow>
	<Button variant="tertiary">Cancel</Button>
	<Button variant="secondary">Export</Button>
	<Button variant="primary">Save</Button>
</ActionRow>
```

`ActionRow` (`src/common/ActionRow.js`) renders
`Stack direction="row" justify="flex-end" gap="sm"`, or a stretched column with
`stretch`. `ModalActions` is an alias over it, so modals need no change. The
row owns its own layout; consumers never style it or its children for spacing —
if a variant is needed, it becomes a prop, exactly as the modal standard says.

Right-aligned, DOM order left → right, primary last. In a stacked group,
primary goes lowest.

**Destructive actions are the one exception to "primary last":** a destructive
action is never the rightmost button in a group that also holds a safe primary.
It goes leftmost, into a danger zone (`InspectorDangerZone`), or into an
overflow menu.

## Stretch vs hug

Buttons hug their content. Stretch is permitted **only** in a container
narrower than ~280px where a hugging button would look orphaned: the editor
sidebar panel, the graph inspector, the transition rail, the ideation assistant
panel. In those containers **all** buttons in the group stretch — never a mix.
No `margin-left:auto` on individual buttons to fake alignment; fix the
container.

## Size

| Context | Size |
|---|---|
| Modal footer, page header, settings bar, inspector | omit `size` (40px default) |
| Card footer, table/DataViews cell, hover toolbar | `size="small"` |
| The sub-280px columns (transition rail, sidebar panel, inspector rows) | `size="compact"` permitted — density is the point of those columns |
| Anywhere else | never `compact` |

No hand-invented heights. A button whose height is set in CSS is a bug.

## Icons

- Always `icon={ imported }` from `@wordpress/icons`. No dashicon strings, no
  icons composed as `children`, no `+`/`▶` glyphs inside translated strings.
- Icons go **before** the label, never after.
- One icon per concept, fixed: `plus` add · `trash` delete · `external` open
  elsewhere · `update` refresh/re-run · `cog` settings · `edit` edit ·
  `download` export.
- Reserve icons for actions that repeat across surfaces or appear icon-only. A
  footer `Save` needs no icon.
- **Icon-only requires both `label` and `showTooltip`.**

## Vocabulary

One verb per concept. Sentence case throughout (`Add source`, not
`Add Source`). A dialog's confirm button repeats the trigger's verb exactly.

| Concept | Use | Retire |
|---|---|---|
| Persist edits | **Save** | `Submit`; `Save {noun}` only where two Saves share a screen. Exception: **Submit** stays on transition-completing inputs (a note or assignment captured *as part of* a workflow transition) — the action isn't persisting edits, it's handing the input to the transition. |
| Retreat from a dialog with choices | **Cancel** | `Go Back`, `Back`, `Keep editing`. Exception: **Back** stays as step navigation inside a multi-step flow — retreating one step is not retreating from the dialog. |
| Dismiss an informational dialog | **Close** | `Got it`, `OK` |
| Decline an offered flow | **Skip** | `Continue without workflow` |
| Release a claim | **Release** | — (a claim is released, not "removed") |
| Hide a suggestion, recoverably | **Dismiss** | — (a dismissed card restores; calling it Remove would lie) |
| Reversible removal | **Remove** | `Clear`, `Move to Trash` stays core vocabulary |
| Irreversible destruction | **Delete** | `Delete permanently` (the confirm carries the permanence), `Remove "X"` where irreversible |
| Abandon unsaved edits | **Discard** | `Start over` |
| Open an item | **Open** | `View`, `View post`, `View Post`, `View source`, `View full result` |
| Open for editing | **Edit** | `Edit Post` |
| Proceed past a warning | **Continue** | `Move anyway`, `Proceed Anyway`, `Ignore Warnings, Continue` |
| Run again | **Retry** | `Try again`, `Re-check`, `Retry Processing` |
| Produce new AI output | **Regenerate** | `Re-analyze` on an already-analyzed item |
| Apply a result | **Use this** | `Use This` |
| Create | **Add {noun}** / **New {noun}** | `Create your first sequence` (→ `New sequence`) |

Dynamic labels are built with `sprintf()` and a translator comment — never
string concatenation.

## Destructive confirmation

One mechanic: `useConfirm`, with `isDestructive: true`. The armed double-click
(press once to arm, again to fire) is retired.

- The confirm button repeats the trigger's verb: `Delete` → `Delete`.
- The cancel button is always `Cancel`.
- Reversible removals (trash, dismiss) need no confirm. Irreversible ones
  always do.

## Focus

Never write a focus ring on a `Button` — WPDS ships one. Custom controls use a
shared focus-ring rule so the treatment stays consistent across components.

## Accessibility floor

- Every clickable thing is a `<button>` or `<a>`. No `role="button"` divs, no
  clickable `<tr>`. Where nested interactive content makes a real `<button>`
  invalid HTML, the interactive element inside the region carries the action.
- Icon-only ⇒ `label` + `showTooltip`.
- Every drag handle and node port gets an `aria-label`.
- Destructive items in menus are visually distinguishable from constructive
  ones.

## Migration checklist (per surface)

- [ ] Actions are WPDS `Button`s / DataViews descriptors; no raw elements.
- [ ] One `primary` at most, and it is the surface's actual point.
- [ ] `isDestructive` on every irreversible action — and on nothing reversible.
- [ ] Buttons live in an `ActionRow` (or `ModalActions`); primary last; no consumer styling of the row.
- [ ] Size follows the table; no CSS heights.
- [ ] Icons via `icon={ imported }`; icon-only has `label` + `showTooltip`.
- [ ] Labels use the vocabulary table, sentence case.
- [ ] Busy is `isBusy` + `disabled`.
- [ ] Irreversible actions confirm through `useConfirm`.

## Amendments from the audit draft

Adopted 2026-08-17 with four deliberate departures from the draft in the
audit's Part 5, so nobody reads the difference as drift:

1. **`isDestructive` stays strictly irreversible.** The draft marked bypass
   transitions and the warnings-modal Continue; both are consequential but
   destroy nothing, and marking them would contradict the definition one table
   up. Their consequence is carried by the confirm flow.
2. **Three vocabulary retirements were dropped.** `Release` and `Dismiss` stay
   as named concepts (an unclaim is not a removal; a restorable dismissal is
   not a removal), and informational dialogs close with `Close`, not `Cancel`.
3. **`compact` survives in the sub-280px columns.** The draft banned it
   outright; the rail and sidebar use it deliberately, the same carve-out the
   stretch rule already makes.
4. **Focus-ring consolidation moved into the WPDS cleanup campaign** rather
   than running as a parallel sweep, so components are touched once.
5. **Two vocabulary carve-outs made explicit (2026-08-17).** The vocabulary
   sweep kept `Submit` on transition-completing inputs and `Back` for step
   navigation as implementation judgments; the table rows now say so, because
   an exception that lives only in a component's docblock reads as a violation
   to every reviewer who checks it against this table.
