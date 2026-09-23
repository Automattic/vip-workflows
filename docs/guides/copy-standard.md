# Copy Standard

The single, enforceable pattern for the **words** in the plugin: labels, helper
text, buttons, errors, empty states, notices and headings.

Fourth in the series after [`modal-standard.md`](modal-standard.md) (dialogs),
[`action-standard.md`](action-standard.md) (buttons) and
[`settings-standard.md`](settings-standard.md) (screen shape). Those three govern
*where a string goes and what component carries it*. This one governs *what the
string says*. Where they already legislate copy — the action vocabulary table,
"helper text goes in `help`", "sentence case" — this document is the expansion,
not a competing source. Verbs remain owned by
[`action-standard.md`](action-standard.md).

The reference throughout is **WordPress core**: the [Block Editor copy
guidelines](https://developer.wordpress.org/block-editor/contributors/documentation/copy-guide/),
the [capitalization
rules](https://make.wordpress.org/docs/style-guide/language-grammar/capitalization/),
and core's own REST controllers and post-type labels. Where our code and core
disagree, core wins.

The measured findings behind every rule are in [Appendix A](#appendix-a--audit-findings-2026-09-01).

## TL;DR

| Concern | Rule |
|---|---|
| Capitalization | **Sentence case** for everything the plugin writes: labels, headings, buttons, badges, column headers, event names, status names. Four carve-outs only — see [Capitalization](#capitalization). |
| One name per concept | A thing has **one** user-facing name across every surface. The editor and the admin never call the same object different things. |
| Labels | A noun phrase for a setting, a verb phrase for an action. No terminal period. Never a sentence. |
| Helper text | Only what a person would otherwise get wrong — a format, a constraint, a consequence. **About 50 characters**, one sentence, terminal period. Never documents the feature. |
| Help coverage | No quota. A control whose label is enough carries no `help`. |
| Errors | Full sentence, terminal period, says **what happened and what to do next**. Never bare `Failed to X`. |
| Permission errors | `Sorry, you are not allowed to …` — core's exact idiom, verbatim. |
| Empty states | Name what is absent, then give the way out. `No X yet.` alone is half a string. |
| Machine copy ≠ human copy | A string read by a language model and a string read by a person are **different strings**. Never let one field serve both. |
| Typography | `…` not `...`; `’` not `'`; `—` for parenthetical breaks. Same in PHP as in JS. |
| Banned | `Please`, `successfully`, `simply`/`just`/`easy`, emoji, `allows you to`, template-variable dumps, internal identifiers. |

---

## What core actually does

Five findings, because every rule below descends from one of them.

**1. Sentence case is the default, everywhere.** The WordPress style guide is
unambiguous: *"Use sentence-case capitalization in titles and headings.
Capitalize the first word in the title or heading, sub-heading, any proper nouns,
and official terms."* And: *"Lowercase all other words and terms. If in doubt,
don't capitalize the term."* Gutenberg ran two dedicated sweeps
([#18758](https://github.com/wordpress/gutenberg/pull/18758),
[#19377](https://github.com/wordpress/gutenberg/pull/19377)) to move its own
labels onto it.

**2. Core writes permission failures one way.** Every capability denial in
`WP_REST_Posts_Controller` reads `Sorry, you are not allowed to …` with a
terminal period — *"Sorry, you are not allowed to edit this post."*, *"Sorry, you
are not allowed to delete this post."* Seven of seven. It is an idiom, not a
suggestion, and screen-reader users hear it across every plugin they use.

**3. Core's help text states an effect in one sentence.** In the Gutenberg
Preferences modal, all fifteen `PreferenceToggleControl`s pass both `label` and
`help`. The label names the setting (`Always open List View`); the help states
what changes (`Opens the List View panel by default.`). One sentence, ends in a
period, never restates the label.

**4. Core's copy guide bans the hedge.** *"Scan for: 'can,' 'be,' 'might,'
'allows you to,' and 'helps'"* — these mark passive phrasing that needs
tightening. On "simple" and "easy": *"It is not for us to decide what is simple:
it's for the user to decide."* On voice: *"Any time text or instructions use 'we'
a lot, it means the focus of the text is on the people behind the software and
not the people using the software."* On errors: always offer a path forward.

**5. Core exempts its own chrome from sentence case, and nothing else.** Admin
menu items (`Available Tools`, `Site Health`), dashboard widget titles (`At a
Glance`, `Quick Draft`), post-type labels (`Edit Post`, `Search Posts`, `No
posts found` — note: no period) and post-status labels (`Pending Review`) are
Title Case by core convention. Everything a plugin writes in its own voice is
sentence case. These are the carve-outs below, and they are the whole list.

---

## Capitalization

**Sentence case for everything the plugin writes.** Capitalize the first word and
proper nouns. Nothing else.

| Retire | Use |
|---|---|
| `Sequence Name`, `Project Name` | `Sequence name`, `Project name` |
| `Stage Changed`, `Tool Failed`, `Workflow Assigned` | `Stage changed`, `Tool failed`, `Workflow assigned` |
| `Published Only`, `All Posts`, `In Pipeline` | `Published only`, `All posts`, `In pipeline` |
| `AI Summary`, `AI Analysis`, `Key Points` | `AI summary`, `AI analysis`, `Key points` |
| `Select a Workflow`, `Workflow History` | `Select a workflow`, `Workflow history` |
| `Transition Blocked`, `Warnings Detected` | `Transition blocked`, `Warnings detected` |
| `Test Email`, `Test Message` | `Test email`, `Test message` |
| `Last Updated`, `Source Detail`, `Top Story` | `Last updated`, `Source detail`, `Top story` |

### The four carve-outs

Title Case is correct **only** here. This list is exhaustive; anything not on it
is sentence case.

1. **Admin chrome that sits beside core's own** — menu and submenu items
   (`My Dashboard`, `Audit Log`) and dashboard widget titles (`My Workflow`).
   Core's menu is Title Case (`Available Tools`, `Site Health`) and so are its
   widget titles (`At a Glance`, `Quick Draft`); ours sit in the same chrome.
2. **Post-type and taxonomy labels** — core's defaults are Title Case
   (`Edit Post`, `Search Posts`) and `not_found` carries **no** terminal period
   (`No ideation projects found`). Match core's shape exactly; do not "fix" these
   to sentence case.
3. **Core's own post-status labels** — `Pending Review` beside `Draft`,
   `Scheduled`, `Private` and `Published`. Core writes that one in Title Case
   in wp-admin, and a status filter that half-matches core reads as a bug.
4. **Proper nouns and product names** — `VIP Workflows`, `Parse.ly`, `YouTube`,
   `Slack`, `Tavily`, `OpenAI`, `Wikipedia`. The vendor keeps its capitals; the
   words around it do not — `Web images (Tavily)`, `Parse.ly trending`.

Acronyms keep their casing inside a sentence-case string: `Add source URL`,
`Analyze with AI`, `Webhook URL`, `AI summary`.

**There is no carve-out for our own feature names.** An agent, tool or provider
is sentence case like everything else: `SEO check`, `Smart linking`, `Archive
scout`, `Web researcher`, `Pre-publish checklist`. A "is this a named thing?"
test sounds reasonable and is not: applied across 30 tools and agents it splits
almost at random, and the first sweep under it produced `Smart linking` beside
`SEO Check`. The style guide already answers it — *"If in doubt, don't
capitalize the term."*

### Ability labels are names, not function signatures

An ability's `label` is a **UI string** — it renders on the tool card and in the
command palette. Sixteen of them are the PHP function name with spaces inserted:
`Get Available Transitions`, `Get Posts By Status`, `Remove From Workflow`,
`Update Post Fields`. They capitalize prepositions (`By`, `From`), which is wrong
even under Title Case rules.

An ability label names **what the thing is**, from the reader's side:

| Retire | Use |
|---|---|
| `Get Available Transitions` | `Available transitions` |
| `Get Posts By Status` | `Posts by status` |
| `Get My Assignments` | `My assignments` |
| `Get Workflow Summary` | `Workflow summary` |
| `Remove From Workflow` | `Remove from workflow` |
| `Update Sequence`, `Create Sequence` | `Update sequence`, `New sequence` |

Read-only abilities take a noun phrase (they *are* a report). Abilities that
mutate take the verb from the [action vocabulary
table](action-standard.md#vocabulary).

---

## One name per concept

**The same object must not have two names.** This is the most damaging pattern in
the plugin's copy, and it is invisible to any per-file review.

The definition a post follows is a **sequence** in the admin and graph editor
(52 strings) and a **workflow** in the editor sidebar (24 strings, against 1 use
of "sequence"). A user configures a sequence under *Sequences*, opens a post,
and is asked to `Select a workflow`. Sixteen strings use both words in one
sentence, several as the compound `workflow sequence`.

**This finding is open.** A pass that renamed every reader-facing `sequence` to
`workflow` was reverted: the team is keeping **sequence** for now. Until that
decision is revisited, do not rename in either direction — write `sequence`
where the surrounding surface already does, and `workflow` in the editor
sidebar, where it already does.

| Concept | Name it | Never |
|---|---|---|
| The definition a post follows | **sequence** (undecided, see above) | `editorial sequence` |
| The product / the practice | **workflow** | — (uncountable: "a post in workflow", "VIP Workflows") |
| One step within a sequence | **stage** | `status`, `step` |
| The core publishing state a stage maps to | **status** | `state` |
| The AI actor | **agent** | `assistant`, `bot` (the code namespace says `assistant`; the UI must not) |
| A check that runs at a transition | **tool** | `ability` (an ability is the registration mechanism, not a user-facing noun) |

In the data model `sequence` is the supertype and `workflow` and `phase` are its
two types, listed as two tabs on one screen: *Workflow sequences* and *Phase
sequences*. Identifiers — post types, REST routes, table and meta keys, class and
file names — say `sequence` regardless; renaming those is a data migration, not a
copy change.

`phase` is a **real and distinct concept** (the Ideation → editorial hand-off),
not drift. Keep it, and keep it away from `stage`.

`ability` still reaches users in some strings. It is the Abilities API's word
for the registration, not the user's word for the thing — the settings screen
already calls them **Tools**.

---

## Labels

- **A setting takes a noun phrase.** `Minimum word count`, `Assignee type`,
  `Channel name`.
- **An action takes a verb phrase**, from the [action vocabulary
  table](action-standard.md#vocabulary). `Add source`, `Retry`, `Discard`.
- **No terminal period.** A label is not a sentence.
- **No colons.** The layout separates label from control.
- **No shortcut hints, badges or counts baked into the string.** A label is the
  setting's name, not a place to append a keyboard hint or a count — the
  settings migration already retired `Show in Command Palette (⌘K)` in favour of
  `Show in command palette` for exactly this reason.
- **Never let a description become a label.** `SchemaSettings` used to fall
  back to `field.description` when `field.label` was missing
  (`field.label || field.description || key`), rendering a full sentence where a
  noun phrase belongs and suppressing the help text on the next line. No
  first-party field relied on it, which is exactly what made it dangerous: the
  trap was armed and invisible. The fallback is now `field.label || key`, so a
  field with no label shows its key and reads as the bug it is. Every
  `settings_schema` field declares an explicit `label`.

---

## Helper text

**Helper text is for what a person would otherwise get wrong: a format, a
constraint, a consequence they would not guess. About 50 characters, one
sentence, ending in a period. Most controls need none.**

```jsx
<TextControl
	__next40pxDefaultSize
	__nextHasNoMarginBottom
	label={ __( 'Sequence name', 'vip-workflows' ) }
	help={ __( 'Must be unique.', 'vip-workflows' ) }
/>
```

- **Past ~50 characters, the help is doing another job.** It is documenting a
  feature in place, or the control needs so much explanation that the control is
  the problem. Explanation belongs in documentation, a tooltip, or another
  disclosure the reader opens on purpose. Helper text is read *while the user is
  deciding*; a paragraph under a select is not read at all, and it can take up
  more room than the control it describes.
- **Restating the label is not help.** `Prompt workflow selection for new posts`
  / *"A modal prompts users to select a workflow when they create a post."* says
  the label twice. Delete it.
- **Cut the lead-in.** A role group's help does not need *"Selected roles
  can…"*; the checkboxes are the roles. A state message does not need *"This
  channel is not set up, so…"* under the channel's own checkbox.
- **State messages under an input follow the same limit.** Say what is wrong
  and, if there is room, where to fix it: *"Not set up. See Workflows →
  Notifications."*
- **Not a place for developer reference.** A variable list for a prompt, or a
  description of what an internal field stores, is API documentation.

Where a concept genuinely needs more than a sentence to use correctly, that is a
design question to raise, not a longer `help` string.

---

## Errors

**An error says what happened, and what to do next.** Core's copy guide requires
the path forward; a bare failure statement is half a message.

```
Bad:   Failed to load settings: %s
Bad:   Failed to move card
Good:  Could not load settings. Reload the page to try again.
```

- **Full sentence, terminal period.** 236 of our error strings do this; 17 do
  not. `Failed to remove this post from its workflow` and `Failed to assign
  workflow` are the pattern to retire.
- **Retire the bare `Failed to …` opener** — 27 uses. It names the operation, not
  the consequence, and never carries a next step. Prefer `Could not …` plus a
  remedy, or state the outcome directly.
- **Never append a raw upstream error to a user sentence.** `Failed to load
  experiments: %s` splices machine text onto UI copy. Put the human sentence in
  the notice and the raw detail behind a disclosure or in the log.
- **Permission denials use core's idiom verbatim:** `Sorry, you are not allowed
  to …`. We currently write `You do not have permission to …` (12 uses) and, in
  one place, `You are not allowed to edit this post.` — a third phrasing. Core's
  wording is what assistive tech users hear from every other plugin.
- **No `Please`.** 11 uses. `Please try again` is `Try again`. `Please enter a
  valid URL.` is `Enter a valid URL.` Core does not beg.

### Machine-facing errors are exempt

Ability tools return errors to a **language model**, not a person:

```php
return new WP_Error( 'missing_param', __( 'The "post_id" parameter is required.', 'vip-workflows' ) );
```

Naming the parameter is exactly right there — the model needs the identifier to
correct its call. **Do not "fix" these into human copy.** The 30 strings that
name parameters, schemas and payloads inside `includes/abilities/` are correct as
written. The rule that matters is the next section: they must never *also* be
shown to a person.

---

## Machine copy and human copy are different strings

`ToolsSettings.js:280` renders `localAbility.description` — the ability's
top-level `description` — directly onto the tool card. That same field is the
tool description handed to the model.

One field, two irreconcilable audiences. The model wants precision and edge
cases; the reader wants to know what the tool does. The result is UI copy like:

> Replaces the configuration of an existing workflow sequence — its statuses,
> transitions, required tools, role permissions and metadata fields. This is a
> full replacement, not a patch… *(373 characters)*

and, on another card, prose containing `` `current_region` `` and
`` `null` `` in backticks — Markdown, rendered raw, in a settings screen.

**Rule: an ability declares both, or the card shows neither.**

- `description` — the model's. Long, precise, edge cases, identifiers. Unbounded.
  Never rendered.
- `meta.summary` — the reader's. One sentence, under ~120 characters, no
  identifiers, no Markdown. This is what the tool card and the graph editor's
  tool picker render.

There is **no fallback to `description`**. An ability that declares no summary
shows its label alone — per AGENTS.md, missing data is a data-integrity error,
not something to paper over, and a 373-character model prompt is not a card
description. Every first-party ability declares one.

The same split applies to `input_schema` / `output_schema` descriptions (250
strings): those are **model-only** and must never reach a rendered surface.

---

## Empty states

79 empty states, and the good ones already outnumber the bad. The pattern that
works — keep it:

```
No checklist items yet. Add one below.
```

Name what is absent, then the way out. What to retire:

- **Dead ends.** `No check tools are registered.` `No configurable prompts are
  registered.` `No experiments are available.` — true, and the reader is left
  holding it. Add the next step, or say plainly that nothing is expected here.
- **`Please` as the next step.** `No checklist items have been configured. Please
  add items in the Integrations settings.` → `No checklist items yet. Add them in
  Integrations settings.`
- **Title Case fragments.** `No Workflow` → `No workflow`.

Post-type `not_found` labels are the exception: match core's shape
(`No ideation projects found`, no period).

---

## Notices, progress and success

- **Success is a snackbar and says what happened**, not that it worked.
  `Card moved successfully` → `Card moved.` `Post claimed successfully.` →
  `Post claimed.` — 4 uses of `successfully`, which adds nothing a success
  snackbar has not already said.
- **Progress strings end in `…`** and name the work: `Loading sequences…`,
  `Running %s…`. `Loading…` unqualified is acceptable only where the surface
  already names what is loading.
- **One loading string per surface.** Not the concern of this document —
  [`settings-standard.md`](settings-standard.md) owns `SettingsLoading` — but the
  copy follows the component.

---

## Typography

Same rules in PHP and JS. The plugin currently splits by language, which is how
`Processing...` and `Processing…` both ship.

| Use | Not | Count today |
|---|---|---|
| `…` (ellipsis) | `...` (three periods) | 7 PHP strings use `...`; all 39 JS progress strings use `…` |
| `’` (right single quote) | `'` (straight apostrophe) | 17 strings, mostly PHP, several as `\'` |
| `“ ”` (curly quotes) | `" "` | mixed; the graph editor already uses `“ ”` |
| `—` (em dash, unspaced or spaced consistently) | `--` | consistent today — keep it |

**No emoji.** One survives (`✓ All required items complete`,
`workflow-tool-checklist/src/editor.js:206`); `settings-standard.md` already
bans them and the checkmark is doing an icon's job.

---

## Bundled content is product copy

`vip-workflows/includes/database/class-seeder.php` defines the default *Editorial Review* sequence —
the first workflow every new site sees, and the template most sites edit rather
than replace. Every label in it is Title Case:

| Retire | Use |
|---|---|
| `Submit for Review` | `Submit for review` |
| `Request Changes` | `Request changes` |
| `Ready to Publish` | `Ready to publish` |
| `Publish Now` | `Publish` |
| `Send Back for Review` | `Send back for review` |
| `In Review` | `In review` |

Stage descriptions there also carry no terminal period (`Author is writing the
content`) while the plugin's own help text does. Seeded copy is held to this
document exactly like code-resident copy.

Whether seeded labels should be translated is a separate, deliberate call: they
become editable rows the moment a site is set up, and core does translate its own
default content. Leaving them untranslated is defensible; leaving them Title Case
is not.

---

## Accessibility floor

- Helper text reaches the user through `help`, so `aria-describedby` is wired —
  never a sibling `<p>` ([`settings-standard.md`](settings-standard.md)).
- A control disabled by a precondition explains why in `help`, not in a `title`.
- Status is never colour-only; it carries a word.
- Icon-only actions carry `label` + `showTooltip`
  ([`action-standard.md`](action-standard.md)).
- Dynamic strings use `sprintf()` with a translator comment — never
  concatenation, which cannot be translated into languages that reorder.

---

## Migration checklist (per surface)

- [ ] Sentence case throughout; Title Case only under one of the four carve-outs.
- [ ] One name per concept; `sequence`/`workflow` not newly used interchangeably (the rename is open).
- [ ] `ability` does not reach the user; the word is `tool`.
- [ ] Labels are noun phrases (settings) or vocabulary-table verbs (actions); no terminal period, no colon, no shortcut hints.
- [ ] Every `settings_schema` field declares an explicit `label`.
- [ ] Helper text only where a person would otherwise get it wrong; about 50 characters, one sentence, terminal period.
- [ ] No help text that restates its label; no template-variable dumps.
- [ ] Errors are full sentences with a next step; no bare `Failed to …`; no raw `%s` upstream text spliced in.
- [ ] Permission errors read `Sorry, you are not allowed to …`.
- [ ] No `Please`, no `successfully`, no emoji.
- [ ] Empty states name what is absent **and** the way out.
- [ ] Model-facing strings (`input_schema`, `output_schema`, ability parameter errors) are never rendered to a person.
- [ ] Ability cards render `meta.summary`, not the model's `description`.
- [ ] `…` not `...`; `’` not `'` — in PHP as well as JS.

---

## Appendix A — audit findings (2026-09-01)

Measured across the whole monorepo: **2,190 translatable strings in 207 files**,
of which **1,940 are user-facing** (excluding 250 `input_schema` /
`output_schema` descriptions, which are model-only by design).

All of it is fixed except finding 2, which is deferred; the table is the record of what was found, not a queue. Every changed string is listed in [`copy-audit-before-after.md`](copy-audit-before-after.md).

| # | Finding | Extent |
|---|---|---|
| 1 | Title Case where sentence case is required | **94 strings**, plus the 16 ability labels below. The first count was 80: it spared 7 tool and agent names under a "named feature" exemption that did not survive contact with the code, and it missed the bundled workflow and its exported JSON, which are not translatable strings and so never entered the corpus. A further 41 Title Case strings are correct under the four carve-outs. |
| 2 | One concept, two names (`sequence` / `workflow`) | 128 vs 150 strings; editor sidebar 24:1 toward `workflow`, admin + graph 52:34 toward `sequence`; **16 strings use both**, several as `workflow sequence` |
| 3 | Model-facing `description` rendered as UI copy | 2 render sites (tool card, graph tool picker); worst offenders 373, 367, 268, 211 characters, some carrying backticked identifiers |
| 4 | Helper text absent | **40 `help` props across 93 controls** (43%); core's Preferences modal is 15/15 |
| 5 | Helper text far over length | 3 strings at 421, 266 and 206 characters, all in `src/admin/components/graph/` |
| 6 | Helper text restating its label | 6 of 15 literal `label`+`help` pairs |
| 7 | `SchemaSettings` rendered a `description` as a label when `label` was missing | 1 latent path; no first-party field relied on it, which is what made it dangerous |
| 8 | Bare `Failed to …` errors with no next step | 27 |
| 9 | `You do not have permission …` instead of core's `Sorry, you are not allowed to …` | 15 sites across 3 different phrasings |
| 10 | Error strings with no terminal period | 17 of 253 |
| 11 | `Please` | 11 |
| 12 | Straight apostrophe where `’` belongs | 16 |
| 13 | `...` instead of `…` | 7 (all PHP; JS was already consistent) |
| 14 | Template-variable dumps as helper text | 9 prompt descriptions, duplicating a `variables` array the registry already models and REST already returns |
| 15 | `successfully` in success messages | 4 |
| 16 | Bundled default sequence entirely Title Case | 6 labels in `class-seeder.php` |
| 17 | Emoji in a label | 1 |
| 18 | Action-vocabulary violations | **1** (`Start over` → `Discard`) |
| 19 | Vacuous page subtitles restating the page title | 5 |
| 20 | Empty states naming what is missing with no way out | 5 |

### Two bugs found while auditing

Neither is a copy defect; both were found by reading the strings.

- **`Auto Draft` was looked up in the wrong text domain.**
  `EditorIntegration` compared `__( 'Auto Draft', 'vip-workflows' )` against
  `$post->post_title`, but core sets that title with `__( 'Auto Draft' )` in the
  **default** domain. On any translated site the comparison never matched, so
  the workflow-required modal never appeared for new posts.
- **Four Quick Edit strings could not be translated.** `Working...`,
  `No transitions available`, `Error loading transitions` and
  `Transition failed` were hardcoded English inside the inline script, beside a
  localized `strings` object carrying everything else.

### What was already good

Worth recording, because the sweeps that produced it should not be undone:

- **The action vocabulary held.** One violation in 299 action labels. The
  [`action-standard.md`](action-standard.md) table is working.
- **Emoji were already gone.** One survivor across the whole monorepo.
- **No hedging.** Zero uses of `allows you to`, `can be used to`, `helps you`,
  `enables you to` — the exact constructions core's copy guide tells you to scan
  for. Zero marketing `simply` / `just` / `easy` (the two `easy` hits are Flesch
  reading-ease labels, which is the term of art).
- **Error prose is specific and consequence-first** where it was written
  deliberately: *"This post's author cannot edit posts, so the AI agent was not
  run. Reassign the post to a user who can edit it, or move it back to the
  previous stage."* That is the model for every error in this plugin — cause,
  effect, and two ways out.
- **Model-facing and human-facing strings were already separated** in
  `input_schema` / `output_schema`. Finding 3 was the one place the wall was
  missing, not a systemic failure.

The plugin's copy problem was **not** careless prose. It was three structural
gaps — capitalization drift the settings and action sweeps never covered, one
object with two names, and one field serving two audiences — plus helper text
that is scarce and, where present, occasionally enormous.

Finding 4 is withdrawn rather than closed. Missing help is not a defect when the
label is enough; the fix for helper text was to shorten it to about 50
characters and delete what documented features in place.
