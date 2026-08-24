# Settings Standard

The single, enforceable pattern for every settings screen in the plugin.
Third in the series after [`modal-standard.md`](modal-standard.md) (dialogs) and
[`action-standard.md`](action-standard.md) (buttons). Those two govern
*components*; this one governs a *screen shape* — how a settings page is
divided, what earns a container, where saving happens, and what a control is
allowed to say about itself.

It exists because the settings surfaces drifted much further than modals ever
did. The plugin currently ships **four different section-heading treatments**,
**three save-button placements**, **two error channels**, **three loading
renders**, and **up to three badges stacked in one card header** — several of
them inside the same screen. The measured findings are in
[Appendix A](#appendix-a--audit-findings-2026-08-17).

The reference throughout is WordPress core, primarily the Gutenberg
**Preferences modal** (`packages/preferences`) — core's most-refined settings
surface — and the **DataForm** layouts in `@wordpress/dataviews`, which are the
sanctioned primitive for schema-driven forms. Where the two disagree with our
current code, core wins.

## TL;DR

| Concern | Rule |
|---|---|
| Page shell | `AdminPage` with `constrained`. Purpose is stated **once**, in `subtitle`. No repeat intro paragraph. |
| Tabs | Group by **topic**, not by type of thing. One word or short noun phrase, sentence case. One tab strip per screen — never nested. |
| Sections | A **titled group of controls**, not a card. `SettingsSection` (title + optional description + controls). Flat, borderless, separated by space. |
| Cards | A card is earned by a **repeating, independently-actionable entity** (a tool, an agent, a channel). Never by a section of one screen's own settings. In a tab panel, a card is a list item or it is nothing. |
| Card title | The entity's own name, never the section or page name. One `Card.Title`, `render={ <h2 /> }`. |
| Headings | `h1` = page (AdminPage). `h2` = section / card title. `h3` = sub-group inside a section. One `Text` variant per level — see the table. Levels never skip and never collide: cards nested under a section heading are the sign the section should have been a tab. |
| Helper text | The control's `help` prop. Never a sibling `<p>`, never a legend, never a badge. Group-level context goes in the section `description`. |
| Save | **One save per screen**, in a sticky `SettingsFooter` at the bottom — or in `AdminPage actions` when the screen already has a header action. Never per-card, never per-section. Toggles that take effect immediately have no save at all — and then the screen has none. |
| Save feedback | `isBusy` + `disabled` on a **static** `Save` label, plus one snackbar on success. No label swapping, no "Saved!", no `UnsavedChangesHint`. |
| Errors | One inline `<Notice status="error">` at the top of the panel. `onRemove`, never the deprecated `onDismiss`. Never `console.error` as the only channel. |
| Badges | Reserved for **runtime state the user must act on**. Never for a category, a type, a capability, or a fact the section heading already states. |
| Icons / emoji | `@wordpress/icons` only. **No emoji anywhere** — not in labels, not in `get_icon()`, not in docs samples. |
| Labels | Sentence case. Vocabulary from [`action-standard.md`](action-standard.md). |
| Toggles | Always a visible `label`. An unlabeled `ToggleControl` is a bug. |

---

## What core actually does

Four findings, because every rule below descends from one of them.

**1. Core's settings sections are `fieldset`s, not cards.** The Preferences
modal renders each group as a borderless `<fieldset>` with a `<legend>` holding
an `<h2>` title and an optional `<p>` description, separated by `2.5rem` of
margin (`packages/preferences/src/components/preferences-modal-section`). There
is no border, no shadow, no surface. Grouping is done by **space and a
heading** — the cheapest device that works — and containers are saved for when
containment means something.

**2. Every control carries its own `help`.** In
`packages/editor/src/components/preferences-modal/index.js`, all fifteen
`PreferenceToggleControl`s pass both `label` and `help`. The label names the
setting (`Always open List View`); the help states the *effect* (`Opens the List
View panel by default.`). The help never restates the label, and it is never a
sibling paragraph — it goes through the prop, which wires `aria-describedby`.
The classic Settings API does the same thing by hand (`<p class="description"
id="…">` + `aria-describedby` on the input, e.g. `options-general.php`).

**3. Section descriptions are for context the controls can't carry.** Only 6 of
the 11 preference sections have a `description`. `Interface`, `Publishing`, and
`Inserter` have none — their controls' `help` says everything. A description
appears when the *group* needs framing (`Select what settings are shown in the
document panel.`), never as decoration.

**4. Save is either one button or no button.** Preferences have **no save
control at all** — each toggle writes immediately. The site editor has exactly
one (`edit-site/src/components/save-hub`). Classic screens call
`submit_button()` once, at the bottom of one `<form>`. Core never puts a save
button inside a repeating unit.

Also worth stating, because our code does the opposite: in all of core's
settings surfaces, **the only badge is the DataForm card's `ValidationBadge`** —
which renders `Badge intent="high"` reading "*N* fields need attention", and
only when the card is collapsible, has been touched, and is invalid. That is
the bar for a badge in a settings header: an actionable error count.

---

## Page shell

Every settings screen is an `AdminPage` with `constrained`.

```jsx
<AdminPage
	breadcrumbs={ [
		{ label: __( 'Workflows', 'vip-workflow' ), href: 'admin.php?page=vip-workflow' },
		{ label: __( 'Tools', 'vip-workflow' ) },
	] }
	title={ __( 'Tools', 'vip-workflow' ) }
	subtitle={ __( 'Configure workflow tools available to your team.', 'vip-workflow' ) }
	actions={ <Button variant="secondary" onClick={ … }>{ __( 'Add custom tool', 'vip-workflow' ) }</Button> }
	constrained
>
```

- **The purpose is stated once**, in `subtitle`. A panel that opens with a
  paragraph re-explaining the page is deleted, not reworded.
- **Page-level actions go in the `actions` prop.** A "how to" or "add" button
  stranded in a bar at the bottom of the content is a header action in the wrong
  place. When a screen has no header action, the bottom belongs to Save; when it
  already has one, Save joins it in the header rather than opening a second
  place actions live (see [Saving](#saving)).
- `constrained` is not optional on settings screens. Long measure is what makes
  form copy unreadable; the wide mode exists for data screens.

---

## Tabs

Tabs divide a screen by **topic**. They are the top-level split and there is
exactly one strip per screen.

| Rule | |
|---|---|
| What a tab is | A topic a user would name when asked what they came to change: `General`, `Appearance`, `Prompts`. |
| What a tab is **not** | One instance of a repeating thing. Five Slack destinations are five cards in one tab, never five tabs. |
| Label | Sentence case, one word where possible. No `&` conjunctions — a tab needing "X & Y" is two tabs or a wrong split. |
| Count | 2–6. One tab is not a tab strip; past six, the split is wrong or the screen is two screens. |
| Nesting | Never. A tab panel containing another tab strip is a screen that should have been split. |
| Persistence | The active tab round-trips through the `tab` query param. |

```jsx
<Tabs.Root className="vip-workflow-tabs" value={ selected } onValueChange={ onChange }>
	<Tabs.List>
		{ tabs.map( ( tab ) => (
			<Tabs.Tab key={ tab.name } value={ tab.name }>{ tab.title }</Tabs.Tab>
		) ) }
	</Tabs.List>
	{ tabs.map( ( tab ) => (
		<Tabs.Panel key={ tab.name } value={ tab.name }>{ tab.content }</Tabs.Panel>
	) ) }
</Tabs.Root>
```

**A tab panel opens with its first section, not with a heading that repeats the
tab.** The tab strip already said the name; a card titled `General` inside the
`General` tab is the single most common redundancy in the current code.

### Tabs and cards

**The panel is an unstyled box, and the consumer owns its spacing.** WPDS styles
the tab strip and nothing else: `packages/ui/src/tabs/style.module.css` has
rules for `.tablist`, `.indicator`, `.tab`, `.tab-children` and `.tab-chevron`,
and **no `.panel` rule at all**. `Tabs.Panel` ships a focus ring plus one
`outline` reset — no padding, no background, no border. Core's consumers add
only what their layout needs (the tabbed sidebar adds a flex column and
`overflow-y`; the preferences panel adds padding to clear its vertical
tablist). Do the same: give a panel a `Stack` for rhythm, not a surface.

**A card sitting directly in a tab panel must be a list item, never a section
wrapper.** The panel is already a bounded, named region — the strip above it
draws the boundary and labels the contents. A bordered card inside redraws a
boundary that is already there, and in our code restates the name as well:
double chrome on top of double naming. Cards in a panel are fine when the panel
lists *N* entities (channels, tools, agents); they are never the container for
one screen's own settings.

Core is unambiguous here. Across the whole Gutenberg monorepo, exactly one file
pairs `Tabs` with `Card` — `preferences-modal-tabs/index.tsx` — and only in its
small-viewport branch, which swaps `Tabs` out for a `Navigator` drill-down. Even
there both Cards are `isBorderless`. The branch that actually renders `Tabs`
uses borderless `fieldset` sections and no Card.

**A tab may divide by category, not just by subject.** The ban is on tabs that
are *instances* — five Slack destinations are five cards, not five tabs. A fixed
set of kinds is a topic split like any other: Tools divides into `Checks`,
`Validators` and `Helpers`, three tabs that exist whether or not a site has any
of each. Show the empty ones with a line saying so; filtering them out makes the
strip vary per site and can collapse it to a single tab.

**Panels that hold editable state need `keepMounted`.** Base UI unmounts a hidden
panel by default (`keepMounted` defaults to `false`), so switching tabs discards
whatever the reader typed — silently, with no dirty warning — and takes any
plugin-supplied component's state with it, along with the save callback such a
component registered while it was mounted. A panel of read-only content can omit
it; a panel of controls cannot.

```jsx
<Tabs.Panel key={ tab.name } value={ tab.name } keepMounted>
```

This has one testing consequence worth knowing: `getByText` finds content inside
a hidden panel, `getByRole` does not. A test that waits on `getByText` and then
queries by role will look like the component is broken when it is the query that
is wrong.

**When a shell is genuinely needed for padding, it is borderless.**
`global-styles-ui/src/screen-root.tsx` is the pattern: an outer
`Card size="small" isBorderless isRounded={ false }` acting purely as a padding
provider, wrapping an inner `Card` that keeps its border because it is a real,
distinct object. Chrome does not nest — the outer container gives up its
border, or it does not exist.

---

## Sections — the default grouping device

A **section** is a titled group of related controls. It is the workhorse of
every settings screen, and it is **not a card**.

```jsx
<SettingsSection
	title={ __( 'Workflow behavior', 'vip-workflow' ) }
	description={ __( 'How posts enter and move through a workflow.', 'vip-workflow' ) }
>
	<ToggleControl … />
	<ToggleControl … />
</SettingsSection>
```

`SettingsSection` (`src/admin/components/SettingsSection.js`) renders core's
shape: a borderless `<fieldset>`, a `<legend>` carrying an `<h2>` title and the
optional description, and a `Stack` of controls. It owns the rhythm between its
controls and the space to the next section — **consumers never add margins.**

- **Title** is a sentence-case noun phrase: `Workflow behavior`, `Bypass
  permissions`, `Audit log access`.
- **Description is optional and earns its place.** Add it only when the group
  needs framing the controls can't give. If it paraphrases the title, delete it.
- **A section never shares its name with a control inside it.** `Audit log
  access` containing a checkbox group also called `Audit log access` is one of
  them named wrong.
- **No dividers.** An `<hr>` between fields inside a group is banned; the gap is
  the separator.

---

## Cards — what earns a container

A card is a **visually contained surface for one repeating, independently
addressable entity**. The test is a single question:

> Is this a thing the system has many of, that a user acts on individually?

**Yes → card.** A tool. An agent. A notification channel. A job.
**No → section.** "General settings". "Bypass permissions". "Prompts". Anything
that is a *part of this screen* rather than *an item the screen lists*.

Applying that test to the current code: `GeneralSettings`, `AiModelSettings`,
`ExperimentsSettings`, `PromptsSettings` and `SystemEventsCard` all wrap
screen-own settings in a `Card.Root` whose title repeats the tab. All five lose
the card. `ToolCard`, `AssistantCard` and `ChannelCard` keep theirs — they are
list items.

### Card anatomy

```jsx
<Card.Root>
	<Card.Header render={ <Stack justify="space-between" align="center" gap="md" /> }>
		<Card.Title render={ <h2 /> }>{ entity.name }</Card.Title>
		<ToggleControl
			__nextHasNoMarginBottom
			label={ __( 'Enabled', 'vip-workflow' ) }
			checked={ entity.enabled }
			onChange={ onToggle }
		/>
	</Card.Header>
	<Card.Content render={ <Stack direction="column" gap="lg" /> }>
		<Text variant="body-md" render={ <p /> }>{ entity.description }</Text>
		{ /* settings fields */ }
	</Card.Content>
</Card.Root>
```

| Slot | Rule |
|---|---|
| `Card.Title` | The **entity's own name**, `render={ <h2 /> }`. Never the section or page name. |
| Header right | At most **one** control — the enable toggle — plus at most **one** badge (see below). Nothing else. |
| Header toggle | Carries a visible `label`. An unlabeled toggle has no accessible name. |
| Description | First thing in `Card.Content`, `Text variant="body-md" render={ <p /> }`. One sentence. |
| Footer | **None.** Cards carry no save button — see [Saving](#saving). |
| Nesting | A card never contains another card. |

`Card.Content` is padding only; the flex column lives on `Card.Root`. Render it
as a `Stack` (`render={ <Stack direction="column" gap="lg" /> }`) so controls
that gave away their margin via `__nextHasNoMarginBottom` still get rhythm.

**Collapsed by default when the list is long.** A screen listing more than ~6
entities uses `CollapsibleCard` with `isOpened: false`, so the screen reads as a
list of names before it reads as a wall of forms.

---

## Fields and helper text

### Every control's helper text goes in `help`

```jsx
<ToggleControl
	__nextHasNoMarginBottom
	label={ __( 'Allow users to review their own posts', 'vip-workflow' ) }
	help={ __( 'Authors can see their own posts in the Review Queue.', 'vip-workflow' ) }
	checked={ … }
	onChange={ … }
/>
```

- **`help` states the effect, not the label again.** If the help text is the
  label as a sentence, delete it.
- **Never a sibling `<p>`.** The prop wires `aria-describedby`; a loose
  paragraph is invisible to assistive tech and drifts out of the control's
  spacing.
- **Never a legend or a key.** A "Soft = warning / Hard = blocks" legend beside
  a group is helper text for the control that offers soft/hard — put it there.
- **`help` is not an error channel.** Errors are Notices (see below).
- **A capability is help on the control it qualifies.** `Phase transition` /
  `Workflow transition` were badges describing what the "Can be used in
  transitions" toggle turns on; as that toggle's `help` they read as a sentence
  and get `aria-describedby` for free.

### Group-level context

Context that applies to several controls at once goes in the **section
description**, above them. Never below — a paragraph after a checkbox grid reads
as a footnote to the last checkbox.

### Every control gets the next-gen props

`__next40pxDefaultSize` and `__nextHasNoMarginBottom` on every
`@wordpress/components` control, without exception. Spacing is the parent
`Stack`'s job.

### Schema-driven fields

Fields generated from a PHP `settings_schema` render through `SchemaSettings`.
When a surface needs layout beyond a flat field list — grouping, side labels,
collapsible groups, validation — reach for **`DataForm`** from
`@wordpress/dataviews` (13.1.0 is installed and ships the `regular`, `panel`,
`card`, `row` and `details` layouts) rather than growing `SchemaSettings` a
second layout engine.

---

## Saving

**One save per screen.** By default it lives in a sticky `SettingsFooter`
pinned to the bottom of the constrained content column, holding exactly one
`primary` button.

```jsx
<SettingsFooter>
	<Button variant="primary" onClick={ onSave } isBusy={ saving } disabled={ saving || ! isDirty }>
		{ __( 'Save', 'vip-workflow' ) }
	</Button>
</SettingsFooter>
```

- **Never per-card.** A screen listing twelve tools has one Save, not twelve. A
  per-card save button turns a list into twelve forms and makes "did that
  save?" a question the user has to ask twelve times.
- **Never per-section.**
- **Never both**, which is what the Notifications screen does today (per-channel
  Save *and* a separate System Events Save in the same page).
- **Or none at all.** A screen whose every control applies immediately — the
  Experiments tab, the enable toggles — has no save button, and says so by
  having none. Do not mix: a screen is either staged-and-saved or
  immediate-apply, never half of each.

### Where Save goes

A screen has **one place actions live**, not two. So:

| The screen | Save goes |
|---|---|
| has no header action | in a sticky `SettingsFooter` at the bottom |
| already has a header action (`Add custom tools`, `Add channel`) | in `AdminPage actions`, last, after the secondary |

Tools is the second case: a footer there would have put a primary button at the
bottom while a secondary sat at the top, so a reader scanning for "what can I do
here" had to look in two places. Where the header already answers that question,
Save belongs in the answer.

The consequence is structural, and worth planning for rather than discovering:
`actions` is a prop of `AdminPage`, which the *page* renders, while the dirty
state lives in the *screen*. Lift that state into a hook the page calls and hand
it back down — `useToolsSettings()` in `ToolsSettings.js` is the reference — so
there is still exactly one copy of it.

### Saving many entities at once

A screen that lists N entities usually has one REST route per entity, not a
batch one. That is fine: the one Save walks the dirty ids and calls each entity's
own save, and the screen reports what happened.

```jsx
const failures = [];
for ( const id of dirtyIds ) {
	try {
		await saveHandlers.current[ id ]();
	} catch ( err ) {
		failures.push( `${ nameOf( id ) }: ${ err.message }` );
	}
}
```

- **A partial failure names the entities that failed**, in the one error Notice.
  "Some tools could not be saved: Readability: Network down" is actionable;
  a bare "Save failed" after five of six succeeded is not.
- **A card reports two things upward** — whether it is dirty, and how to save
  itself — and owns its own request. The screen owns the decision to make it.
- **Report dirtiness with a no-op guard.** A card's dirty-reporting effect runs
  on every keystroke; if the parent's setter returns new state each time, the
  screen re-renders in a loop. Return the previous state unchanged when nothing
  moved.

### Save feedback

| Signal | Mechanism |
|---|---|
| In flight | `isBusy` + `disabled` on the button. The **label does not change.** |
| Nothing to save | `disabled` |
| Success | One `createSuccessNotice( …, { type: 'snackbar' } )` |
| Failure | Inline `<Notice status="error">` at the top of the panel |

`getSaveButtonLabel()` and `<UnsavedChangesHint>`
(`src/admin/utils/save-button-label.js`) are **retired**. Between them they
produce a label that swaps to `Saving…`, then to a check icon plus `Saved!`,
beside a separate `Unsaved changes` string — three moving pieces saying what
`isBusy` and one snackbar already say, and a label-swap is the same defect
[`action-standard.md`](action-standard.md) bans as spinner-as-label. The
disabled state already communicates "nothing to save"; the button does not also
need to be narrated.

The same rule governs every other pending action: `Retry`/`Retrying…` and
`Send test`/`Sending…` become a static label plus `isBusy`.

---

## Status, errors, and empty states

| State | Pattern |
|---|---|
| Loading | `<SettingsLoading />` — one shared `Spinner` + `Text` row. Three hand-rolled variants exist today; they collapse into this. |
| Load failure | `<Notice status="error" isDismissible={ false }>` filling the panel |
| Action failure | `<Notice status="error" onRemove={ … }>` at the top of the panel |
| Empty | `<Text variant="body-md" render={ <p /> }>` stating what to do next. No wrapper `<div>`, no illustration. |
| Success | Snackbar only |

**`onRemove`, never `onDismiss`.** WPDS documents `onDismiss` as *"A deprecated
alternative to `onRemove`… should be avoided."* Twenty admin files pass
`onDismiss`, which the project's no-legacy rule forbids outright.

**A caught error is always shown.** `console.error( … )` as the only response to
a failed save — currently the behavior in `ToolsSettings` and `AssistantCard` —
leaves the user looking at a button that stopped spinning and changed nothing.

---

## Badges

A badge is for **runtime state the user must act on**. That is the whole
allowance.

| Allowed | Example |
|---|---|
| Actionable failure or gap | `Setup needed` on an agent missing credentials |
| Validation error count | DataForm's `N fields need attention` |

| Banned | Why |
|---|---|
| Category / type | `Check`, `Validator`, `Helper` — the section heading above the card already says it |
| Capability | `Research`, `Discovery`, `Available in AI stage` — that is a field with a label, or prose |
| Static fact | `Configured` — the absence of `Setup needed` says it |
| Anything duplicated by an adjacent Notice | A `Setup needed` badge above a warning Notice explaining the setup is one signal, shown twice — the Notice stays, because it names *which* requirement is unmet |

**One badge maximum per card header.** The Tools cards currently stack up to
three.

**`intent` is a severity/state scale, not a palette.** WPDS defines it as
`high | medium | low | stable | informational | draft | none`. Mapping a tool
*type* onto it — `check → informational`, `validator → medium`, `agent →
stable` — makes "validator" render as a medium-severity warning. Categorical
colour, where it is genuinely needed, follows the Badge-shell-plus-custom-colour
route already used by `StatusBadge`; it never borrows `intent`.

Sentence-case badge text, two words or fewer. `Setup needed — Wikipedia works`
is prose in a pill; the pill says `Setup needed` and the prose goes in the
body.

---

## Icons and emoji

- Icons come from `@wordpress/icons`, passed as `icon={ imported }`. No
  dashicon strings, no glyphs in translated strings.
- **No emoji. Anywhere.** Not in labels, not in `get_icon()`, not in the code
  samples the how-to modals hand to extension authors. Emoji render differently
  per platform, carry no semantic meaning to assistive tech, cannot be themed,
  and read as unserious in an editorial tool. The current
  `📧`/`💬`/`🔔`/`⚙️`/`📊` channel and job icons become `@wordpress/icons`
  imports, and `get_icon()`'s contract changes from *"Emoji or dashicon slug"*
  to an icon slug.
- **Most settings rows need no icon at all.** An icon beside every label is
  noise; icons earn their place on repeated actions and icon-only controls
  ([`action-standard.md`](action-standard.md)).

---

## Typography and headings

One variant per level. No exceptions, so a reader can tell depth from weight.

| Level | Element | `Text` variant | Used for |
|---|---|---|---|
| Page | `h1` | `heading-lg` | `AdminPage` title (owned by the component) |
| Section / card | `h2` | `heading-md` | `SettingsSection` title, `Card.Title` |
| Sub-group | `h3` | `heading-sm` | A named cluster inside a section or card |
| Body | `p` | `body-md` | Descriptions, prose |
| Helper | — | — | The control's `help` prop, styled by WPDS |

`Card.Title` is the one row the table describes rather than dictates: the
component ships its own type (`font-size-lg`, `line-height-sm`,
`font-weight-medium` — the same recipe as `heading-lg`) and styling it to
`heading-md` from CSS would be exactly the design-system override this standard
bans elsewhere. Pass `render={ <h2 /> }` for the semantics and leave the type to
the component.

Today `h3` is rendered as `heading-lg` (AssistantsTab how-to), `heading-md`
(GeneralSettings, ToolsSettings) **and** `heading-sm` (AssistantsTab sections) —
three type treatments for one structural level, two of them in the same file.
Heading levels also never skip: a page `h1` is followed by `h2`, not `h3`.

The `vip-workflow-eyebrow` class is not a heading style. Section headings use
the table above.

---

## Labels

Sentence case everywhere, and the vocabulary table in
[`action-standard.md`](action-standard.md) governs verbs.

| Retire | Use |
|---|---|
| `Workflow Behavior`, `Bypass Permissions`, `Audit Log Access` | `Workflow behavior`, `Bypass permissions`, `Audit log access` |
| `Check Tools`, `Validation Tools`, `Helper Tools` | `Checks`, `Validators`, `Helpers` |
| `Built-in Agents`, `Plugin Agents` | `Built-in`, `From plugins` |
| `System Events`, `Routing & Debug` | `System events`, `Routing` |
| `How to Add Custom Tools` / `How to Create Custom Agents` | `Add custom tools` / `Add custom agents` — one verb for one concept |
| `Creating Custom Tools` (modal title) | Match the trigger: `Add custom tools` |
| `Show in Command Palette (⌘K)` | `Show in command palette` — the shortcut is not part of the setting's name |
| `General AI Model` | `AI model` |
| `SLA Breached`, `SLA Warning`, `Goal At Risk` | `SLA breached`, `SLA warning`, `Goal at risk` — event labels reach the Routing matrix verbatim |

A section heading that ends in the type of thing it contains (`Check Tools`
under a page titled `Tools`) is saying "Tools" twice. Drop the noun the page
already owns.

---

## Accessibility floor

- Every control has a visible `label`, or `hideLabelFromVision` with the label
  still supplied. An unlabeled `ToggleControl` — currently the enable toggle on
  every tool and agent card — has no accessible name.
- Helper text goes through `help` so `aria-describedby` is wired.
- Grouped checkboxes/radios sit in a `<fieldset>` with a `<legend>`.
- Heading levels descend without skipping.
- Status text is never colour-only; it carries a word.
- A control disabled by a precondition explains why in `help`, not in a
  `title` tooltip.

---

## Shared components

Reach for these before hand-rolling. `SettingsFooter` and `SettingsLoading` were
created by the Tools migration and exist now; `SettingsSection` is created by the
first migration that has a group of bare controls to put in one.

| Component | Path | For |
|---|---|---|
| `AdminPage` | `src/admin/components/AdminPage.js` | every settings page shell |
| `SettingsSection` *(new)* | `src/admin/components/SettingsSection.js` | every titled group of controls |
| `SettingsFooter` | `src/admin/components/SettingsFooter.js` | the one save bar, on screens with no header action |
| `SettingsLoading` | `src/admin/components/SettingsLoading.js` | the one loading row |
| `SchemaSettings` | `src/admin/components/SchemaSettings.js` | fields generated from a PHP `settings_schema` |
| `DataForm` | `@wordpress/dataviews` | forms needing grouping, side labels, or validation |
| `ActionRow` | `src/common/ActionRow.js` | any other action group ([`action-standard.md`](action-standard.md)) |
| `HowToModal` | `src/admin/components/HowToModal.js` | "add custom X" documentation modals |

Retired by this standard: `getSaveButtonLabel`, `UnsavedChangesHint`
(`src/admin/utils/save-button-label.js`), and the per-card save handlers in
`ToolCard`, `AssistantCard`, and `ChannelCard`.

---

## Migration checklist (per screen)

- [ ] Page purpose stated once, in `AdminPage subtitle`; intro paragraph deleted.
- [ ] Page-level actions moved into `AdminPage actions`; no action bar at the bottom of the content.
- [ ] One tab strip, sentence case, topic-named, no nesting; `tab` param round-trips.
- [ ] No card whose title repeats its tab or page.
- [ ] Screen-own settings are `SettingsSection`s; only repeating entities are cards.
- [ ] Every card directly inside a tab panel is a list item; panels carry a `Stack` for rhythm, not a surface; any padding-only shell is `isBorderless`.
- [ ] One `Card.Title` per card, `render={ <h2 /> }`, naming the entity.
- [ ] Header carries at most one toggle (labeled) and one badge.
- [ ] Every badge is actionable runtime state; type/capability/`Configured` badges deleted; no `intent` used as a category palette.
- [ ] All helper text in `help`; sibling `<p>`s, legends and keys removed; group context in the section `description`, above the controls.
- [ ] Every control has `__next40pxDefaultSize` + `__nextHasNoMarginBottom`; no `<hr>` between fields.
- [ ] Exactly one Save — in `SettingsFooter`, or in `AdminPage actions` when the screen already has a header action — or none; per-card and per-section saves removed.
- [ ] A partial save failure names the entities that failed.
- [ ] Tab panels holding controls pass `keepMounted`.
- [ ] Save label static; `getSaveButtonLabel` / `UnsavedChangesHint` removed; success is a snackbar.
- [ ] Every caught error reaches a `Notice`; no `console.error`-only paths.
- [ ] `Notice` uses `onRemove`, not `onDismiss`.
- [ ] Loading via `SettingsLoading`; empty state is a `Text`, not a wrapper div.
- [ ] Headings follow the level/variant table; no skipped levels; `vip-workflow-eyebrow` not used as a heading.
- [ ] Labels sentence case, per the vocabulary table.
- [ ] Emoji removed from labels, `get_icon()`, and how-to code samples.

---

## Appendix A — audit findings (2026-08-17)

Measured across `vip-workflow/src/admin/` at
`43bf7250`. Ordered worst-first, which matches the migration order.

All four screens have since migrated; the findings are kept as the record of what
each one was, not as a queue. The cross-cutting table is a different matter — the
rows below it are closed only where a settings screen owned them. `Notice
onDismiss` and `console.error`-only failures still stand outside these four
screens, in Ideation and the list pages, and are not this standard's to close.

### Cross-cutting

| Finding | Extent |
|---|---|
| `h3` rendered as three different `Text` variants (`heading-lg`, `heading-md`, `heading-sm`) | 3 files, 2 of them in one component |
| Deprecated `Notice onDismiss` | 20 files |
| Per-card / per-section save buttons | 6 components |
| `getSaveButtonLabel` + `UnsavedChangesHint` (label swap + separate dirty string + snackbar) | 8 files |
| Distinct loading renders | 4 — `vip-workflow-loading`, `vip-workflow-assistants-loading`, `vip-workflow-integrations-loading`, and an inline-`style` variant in `PromptsSettings` |
| Cards wrapping screen-own settings | 5 components; in 3 of them (`GeneralSettings`, `ExperimentsSettings`, `SystemEventsCard`) the card title repeats its tab verbatim |
| Title Case section headings | throughout |
| Emoji as `get_icon()` return | 5 PHP classes + 3 how-to code samples |

### Tools (`ToolsSettings.js`, 580 lines) — **migrated**

All nine resolved. The type groups became the tab strip, which is what let the
cards sit directly under the page `h1` and take `h2` without colliding with a
section heading. Save moved to the header beside `Add custom tools`; the card
chrome went back to `Card.Root`, taking the stylesheet from 78 lines to 8.

1. **Three badges per card header.** `supports` badges (`Phase transition` /
   `Workflow transition`), a type badge (`Check` / `Validator` / `Helper`), and
   `Setup needed` — on cards already grouped under an `h3` reading `Check
   Tools` / `Validation Tools` / `Helper Tools`. The type badge restates the
   heading directly above it, once per card.
2. **`getToolTypeIntent()` maps a category onto the severity scale** —
   `validator → medium`, `check → informational`, `agent → stable`,
   default `draft`.
3. **`Setup needed` badge sits directly above a warning `Notice`** carrying the
   same requirements.
4. **Unlabeled enable toggle** in the card header.
5. **Per-card `size="small"` Save** with its own dirty hint and `Saved!` label —
   one per tool.
6. **Save failure goes to `console.error` only.**
7. **Soft/Hard legend** rendered as two inline `<span>`s with icons inside the
   settings group, instead of `help` on the control offering the choice.
8. **`How to Add Custom Tools` stranded** in a panel-surface bar at the bottom
   of the content.
9. `Show in Command Palette (⌘K)`; `Checks`/`Settings` label via
   `vip-workflow-eyebrow`; section `h3` under a page `h1`.

### Agents (`AssistantsTab.js` + `AssistantCard.js`, 927 lines) — **migrated**

All eight resolved. The two built-in/plugin groups became the tab strip, so the
agent cards sit under the page `h1` and take `h2`. Every badge went: the three
capability badges are `help` on the controls they describe, and the prose badge
became the sentence it always was. Save moved to the header beside `Add custom
agents`, which collapsed the three-status `ActionRow` to nothing — the dirty
hint, the `Save failed` `Text` and the `Saved!` label are one button plus a
snackbar plus a `Notice`.

1. **Purpose stated twice** — `AdminPage subtitle` ("Configure agents that
   assist with editorial work.") plus an intro paragraph ("Agents provide
   research, story discovery…").
2. **Capability badges as a row** — `Research`, `Discovery`, and `Available in
   AI stage`. The third is a sentence in a pill.
3. **Prose in a badge** — `Setup needed — Wikipedia, Hacker News works`.
4. **Three status affordances in one `ActionRow`** — `UnsavedChangesHint`, a
   `Save failed` `Text`, and the Save button's own `Saved!` state.
5. **Section headings are `heading-sm` `h3`** while the same file's how-to
   modal uses `heading-lg` `h3`.
6. **`Retry` → `Retrying…`** label swap alongside `isBusy`.
7. **Unlabeled enable toggle**; per-card Save; `console.error`-only failures;
   raw `<div>` empty state; `<span>` (not `Text`) loading label.
8. **`How to Create Custom Agents`** vs Tools' `How to Add Custom Tools` — two
   verbs, one concept; both modals titled with a gerund the button doesn't use.

### Notifications (`Notifications.js` + `NotificationChannelsTab.js`, 1,377 lines) — **migrated**

All eight resolved. The strip is two topic tabs — `Channels` and `Routing` — and
no longer grows with configuration. The two save models became one screen Save
in the header, which is also what retired the `title="Save changes first"`
tooltip: nothing is disabled on another control's state any more.

Routing turned out to be the substantive finding. Two matrices answered "does
this event reach this channel" — each channel's own `events` list and the global
routing option — and they were not equivalent. Routing is now the only authority,
seeded from the per-channel lists by a schema migration, and the dispatcher's
fallback to the per-channel list is gone. `SlackChannel` never persisted `events`
at all, so that matrix had been saving and silently losing the value on reload.

1. **Tabs are instances, not topics.** One tab per channel *group*, so a site
   with Slack, Email and ntfy gets a strip that grows with configuration —
   plus `System Events` and `Routing & Debug` appended. `Routing & Debug` is two
   topics in one tab.
2. **Two save models on one screen** — a Save per channel card, and a separate
   Save for the System Events matrix.
3. **`Configured` badge** — a static fact, redundant with the absence of a
   problem state.
4. **`Send test` → `Sending…`** label swap; test result rendered as `<span>`
   with an icon (`Sent` / `Failed`) inside the same `ActionRow` as the dirty
   hint and the Save state — up to four status elements in one row.
5. **`title="Save changes first"`** as the only explanation for a disabled
   button — a tooltip is not helper text.
6. **`SystemEventsCard` wraps screen-own settings in a card** whose title
   repeats its tab, and puts a second sentence in `<em>` inside the
   description paragraph.
7. **Add-channel action in a bottom bar** per tab, with its error `Notice`
   rendered inside that bar.
8. Group description, empty-state text and channel description all render as
   `vip-workflow-description` paragraphs at the same weight, so the tab has no
   visual hierarchy.

### Settings (`Settings.js` + the four tab components) — **migrated**

All seven resolved. The per-tab cards became `SettingsSection`s — a borderless
`fieldset` whose `legend` carries the `h2` and its description — so nothing on
this screen draws a surface any more; only repeating entities do, and this screen
has none. The three save models became one `SettingsFooter` for the page, which
Experiments joined: its toggles used to write on the spot and reload, so a
mis-click was already committed. It still reloads, but only after an explicit
Save.

1. **Every tab wraps itself in a card titled after the tab** — `General`,
   `Experiments`, and per-group cards in `Prompts`.
2. **Three save models across four tabs** — General and AI Services save inside
   their card; Prompts saves in a bar below all cards; Experiments has no save
   (writes immediately and reloads the page).
3. **`AiModelSettings` copy references a section that isn't there** — "the AI
   Agent has its own model setting below"; nothing renders below it.
4. **`RoleCheckboxGroup` puts its description below the checkbox grid**, where
   it reads as a note on the last checkbox.
5. **A section and a control inside it share the name `Audit Log Access`.**
6. **`PromptsSettings` separates fields with `<hr>`** and mixes an inline
   `style={ { padding: … } }` loading state with the shared class used
   elsewhere.
7. **Prompts signals success three ways** — snackbar, `Saved!` label, and the
   dirty hint clearing.
