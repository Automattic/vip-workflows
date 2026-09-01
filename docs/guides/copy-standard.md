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
| Helper text | States the **effect**, not the label again. One sentence, terminal period, **under ~120 characters**. If it needs two sentences, the design is unclear, not the copy. |
| Help coverage | Every control that isn't self-evident carries `help`. Core's Preferences modal is 15/15; we are 40/93. |
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

**5. Core exempts two things from sentence case, and only two.** Admin menu
items (`Available Tools`, `Site Health`, `Export Personal Data`) and post-type
labels (`Edit Post`, `Search Posts`, `No posts found` — note: no period) are
Title Case by core convention. Everything else core writes is sentence case.
These are the carve-outs below, and they are the whole list.

---

## Capitalization

**Sentence case for everything the plugin writes.** Capitalize the first word and
proper nouns. Nothing else.

| Retire | Use |
|---|---|
| `Sequence Name`, `Project Name` | `Sequence name`, `Project name` |
| `Stage Changed`, `Tool Failed`, `Workflow Assigned` | `Stage changed`, `Tool failed`, `Workflow assigned` |
| `Pending Review`, `Published Only`, `All Posts` | `Pending review`, `Published only`, `All posts` |
| `AI Summary`, `AI Analysis`, `Key Points` | `AI summary`, `AI analysis`, `Key points` |
| `Select a Workflow`, `Workflow History` | `Select a workflow`, `Workflow history` |
| `Transition Blocked`, `Warnings Detected` | `Transition blocked`, `Warnings detected` |
| `Test Email`, `Test Message` | `Test email`, `Test message` |
| `Last Updated`, `Source Detail`, `Top Story` | `Last updated`, `Source detail`, `Top story` |

### The four carve-outs

Title Case is correct **only** here. This list is exhaustive; anything not on it
is sentence case.

1. **Admin menu and submenu items** — `My Dashboard`, `Audit Log`. Core's own
   menu is Title Case (`Available Tools`, `Site Health`) and ours sits in the
   same sidebar.
2. **Post-type and taxonomy labels** — core's defaults are Title Case
   (`Edit Post`, `Search Posts`) and `not_found` carries **no** terminal period
   (`No ideation projects found`). Match core's shape exactly; do not "fix" these
   to sentence case.
3. **Proper nouns and product names** — `VIP Workflows`, `Parse.ly`, `YouTube`,
   `Slack`, `Tavily`, `OpenAI`, `Wikipedia`.
4. **Named features** — an agent, tool or provider that is *a thing with a name*,
   the way a core block is: `Archive Scout`, `Web Researcher`, `SEO Check`,
   `Smart Linking`, `Pre-publish Checklist`. The test is whether it names an
   entity a user could point at, not whether it is important.

Acronyms keep their casing inside a sentence-case string: `Add source URL`,
`Analyze with AI`, `Webhook URL`, `AI summary`.

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

A workflow definition is called a **sequence** in the admin and the graph editor
(52 strings) and a **workflow** in the editor sidebar (24 strings, against 1 use
of "sequence"). A user who configures a sequence under *Sequences*, then opens a
post, is asked to `Select a Workflow`. Sixteen strings use both words in one
sentence, several as the compound `workflow sequence` — which is neither name and
teaches the reader that they are two things.

**Rule: pick the name the user meets first, and use it everywhere.**

| Concept | Name it | Never |
|---|---|---|
| The configured definition a post follows | **sequence** | `workflow` as a countable noun, `workflow sequence`, `editorial sequence` |
| The product / the practice | **workflow** | — (uncountable: "a post in workflow", "VIP Workflows") |
| One step within a sequence | **stage** | `status`, `step` |
| The core publishing state a stage maps to | **status** | `state` |
| The AI actor | **agent** | `assistant`, `bot` (the code namespace says `assistant`; the UI must not) |
| A check that runs at a transition | **tool** | `ability` (an ability is the registration mechanism, not a user-facing noun) |

`phase` is a **real and distinct concept** (the Ideation → editorial hand-off),
not drift. Keep it, and keep it away from `stage`.

`ability` currently reaches users in 35 strings. It is the Abilities API's word
for the registration, not the user's word for the thing — the settings screen
already calls them **Tools**.

---

## Labels

- **A setting takes a noun phrase.** `Minimum word count`, `Assignment key`,
  `Channel name`.
- **An action takes a verb phrase**, from the [action vocabulary
  table](action-standard.md#vocabulary). `Add source`, `Retry`, `Discard`.
- **No terminal period.** A label is not a sentence.
- **No colons.** The layout separates label from control.
- **No shortcut hints, badges or counts baked into the string.** A label is the
  setting's name, not a place to append a keyboard hint or a count — the
  settings migration already retired `Show in Command Palette (⌘K)` in favour of
  `Show in command palette` for exactly this reason.
- **Never let a description become a label.** `SchemaSettings.js:102` falls back
  to `field.description` when `field.label` is missing
  (`const label = field.label || field.description || key`), which renders a
  full sentence where a noun phrase belongs — and then suppresses the help text
  entirely on the next line. Every `settings_schema` field declares an explicit
  `label`. Only 8 of them do today.

---

## Helper text

**Helper text states the effect of the control, in one sentence, under ~120
characters, ending in a period.**

```jsx
<ToggleControl
	__nextHasNoMarginBottom
	label={ __( 'Allow users to review their own posts', 'vip-workflows' ) }
	help={ __( 'Authors can see their own posts in the Review Queue.', 'vip-workflows' ) }
/>
```

Three failures, in the order they matter:

**1. Too long.** Three `help` strings run 206–421 characters, all in the graph
inspectors. The 421-character one hangs under a control labelled `Stage` and
explains region entry, editor publishes, scheduled posts, REST writes and
sequence re-assignment in a single breath. Helper text is read *while the user is
deciding*; at that length nobody does. Long explanation is a documentation link
or a `HowToModal`, not a `help` prop.

**2. Restating the label.** Six of the fifteen literal `label`+`help` pairs
repeat the label as a sentence — `Channel name` / *"A friendly name to identify
this Slack channel"*, `Sequence Name` / *"Enter a unique name for this
sequence."* Per [`settings-standard.md`](settings-standard.md#fields-and-helper-text):
if the help text is the label as a sentence, **delete it**.

**3. Missing entirely.** 40 `help` props across 93 controls. Core's Preferences
modal is 15/15. A control whose effect is not obvious from its label needs help;
most of ours have neither.

Helper text is also **not** a place for developer reference. The Prompts screen
renders `Variables: {seed}, {tags}, {news_angle}, {total_cards}, {pinned_count},
{pinned_breakdown}, {dismissed_count}, {pinned_details}, {assistant_list}.` as
help under a prompt field. That is API documentation in a settings screen. The
variable list belongs in the editor UI for the prompt itself, or in a
disclosure — not in `help`.

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
- `meta.summary` — the reader's. One sentence, under ~120 characters, no
  identifiers, no Markdown. This is what the tool card renders.

Until `meta.summary` exists, the tool card shows the label alone. A 373-character
model prompt is not a card description.

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

`vip-workflows/includes/database/class-seeder.php` and
`editorial-review-sequence.json` define the default *Editorial Review* sequence —
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
- [ ] One name per concept; `sequence`/`workflow` not used interchangeably; no `workflow sequence`.
- [ ] `ability` does not reach the user; the word is `tool`.
- [ ] Labels are noun phrases (settings) or vocabulary-table verbs (actions); no terminal period, no colon, no shortcut hints.
- [ ] Every `settings_schema` field declares an explicit `label`.
- [ ] Helper text states the effect, one sentence, under ~120 characters, terminal period.
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
of which **1,940 are user-facing** (excluding 250 `input_schema` / `output_schema`
descriptions, which are model-only by design).

Ordered by reach, which matches the migration order.

| # | Finding | Extent |
|---|---|---|
| 1 | Title Case where sentence case is required | **80 strings** (64 labels/headings/event names + 16 ability labels). A further 55 Title Case strings are correct under the four carve-outs. |
| 2 | One concept, two names (`sequence` / `workflow`) | 128 vs 150 strings; editor sidebar 24:1 toward `workflow`, admin + graph 52:34 toward `sequence`; **16 strings use both**, several as `workflow sequence` |
| 3 | Model-facing `description` rendered as UI card copy | `ToolsSettings.js:280`; worst offenders 373, 367, 268, 211 characters, some containing backticked identifiers |
| 4 | Helper text absent | **40 `help` props across 93 controls** (43%); core's Preferences modal is 15/15 |
| 5 | Helper text far over length | 3 strings at 421, 266 and 206 characters, all in `src/admin/components/graph/` |
| 6 | Helper text restates its label | 6 of 15 literal `label`+`help` pairs |
| 7 | `settings_schema` fields with no `label` | 4 of 8 fields fall through to `SchemaSettings.js:102`, which renders the *description* as the label and drops the help |
| 8 | Bare `Failed to …` errors with no next step | 27 |
| 9 | `You do not have permission …` instead of core's `Sorry, you are not allowed to …` | 12, plus 1 third variant (`You are not allowed to edit this post.`) |
| 10 | Error strings with no terminal period | 17 of 253 |
| 11 | `Please` | 11 |
| 12 | Straight apostrophe where `’` belongs | 17 |
| 13 | `...` instead of `…` | 7 (all PHP; JS is consistently `…`) |
| 14 | Template-variable dumps as helper text | 12 prompt descriptions in `class-core-prompts.php` |
| 15 | `successfully` in success messages | 4 |
| 16 | Bundled default sequence entirely Title Case | 6 transition/stage labels in `class-seeder.php` + `editorial-review-sequence.json` |
| 17 | Emoji in a label | 1 (`workflow-tool-checklist/src/editor.js:206`) |
| 18 | Action-vocabulary violations | **1** (`Start over` → `Discard`, `AssistantPanel.js:261`) |

### What is already good

Worth recording, because the sweeps that produced it should not be undone:

- **The action vocabulary held.** One violation in 299 action labels. The
  [`action-standard.md`](action-standard.md) table is working.
- **Emoji are gone.** One survivor across the whole monorepo.
- **No hedging.** Zero uses of `allows you to`, `can be used to`, `helps you`,
  `enables you to` — the exact constructions core's copy guide tells you to scan
  for. Zero marketing `simply` / `just` / `easy` (the two `easy` hits are Flesch
  reading-ease labels, which is the term of art).
- **Error prose is specific and consequence-first** where it has been written
  deliberately: *"This post's author cannot edit posts, so the AI agent was not
  run. Reassign the post to a user who can edit it, or move it back to the
  previous stage."* That is the model for every error in this plugin — cause,
  effect, and two ways out.
- **Empty states mostly follow `No X yet.` + a way forward**, and the JS
  progress strings are uniformly `…`-terminated.
- **Model-facing and human-facing strings are already separated** in
  `input_schema` / `output_schema`. Finding 3 is the one place the wall is
  missing, not a systemic failure.

The plugin's copy problem is **not** careless prose. It is three structural
gaps — capitalization drift that the settings and action sweeps never covered,
one object with two names, and one field serving two audiences — plus helper
text that is scarce and, where present, occasionally enormous.
