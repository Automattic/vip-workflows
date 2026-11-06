---
status: proposed
version: 0.1
last_updated: 2026-11-04
related:
  - ../../guides/copy-standard.md
  - ../../guides/modal-standard.md
  - ../../guides/wpds-usage-audit-patterns.md
---

# Error-state pattern

> **Design spec for review. No code changes accompany it.** It defines what a
> failure looks like and which level it belongs to. A planned shell-owned
> notice region makes the *placement* decision once and owns where page-level
> messages render. This spec owns the *shape* of a message and decides which
> failures go to that region.

## Problem

Each per-item failure was fixed with its own treatment. Each fix is good on its
own terms, but no two look or behave alike. As a result, a reader cannot learn
what "this failed" looks like, and the next failure has no pattern to follow.
The opposite failure also exists. A document card that failed to process shows
only a 16px caution icon with a `title` tooltip on its face, which is too
subtle for a reader to notice.

## Inventory of current error surfaces

Line numbers are against `main` at the time of writing. Paths are relative to
`vip-workflows/`.

| # | Surface | Where | How it looks today |
|---|---|---|---|
| 1 | Card image fails to load | `src/admin/components/ideation/cards/shared.js:334` (`CardThumb`); `ImageCard.js:80-100, 182, 224` (grid thumb); `ImageCard.js:110-121, 138, 147` (modal) | `CardThumb`: neutral tile, `role="img"`, label "Image unavailable". Image card grid thumb: the card's own no-image placeholder, not `CardThumb`. Modal: centred `Text` "Preview unavailable." No retry, no reason. Deliberately quiet. |
| 2 | Research agent could not run | `src/admin/components/ideation/AssistantPanel.js:144-209` (`UnavailableRetry`); `AssistantPanel.css:161` | Secondary "Retry" button. On failure, a bare `Text` styled with `--wpds-color-foreground-content-error-weak`: "The agent could not run. Nothing changed." Not a `Notice`, not announced. |
| 3 | Agent dependencies unmet | `src/common/AgentRequirements.js:39` (`CredentialsLink`); `src/admin/components/AssistantCard.js:346-390, 468-484`; `ideation/TopBar.js:189-230`; `src/editor/components/ToolResultModals.js:42-61` | Structured rows: what is missing, who needs it, where to fix it, and an external "Where to get these credentials" link. Wrapped in a `warning` `Notice` on an enabled agent card, a plain hint when the agent is off, and an `error` `Notice` in tool results. The same content uses three containers. |
| 4 | AI response truncated vs unparseable | `includes/integrations/class-llm-json-generator.php:64-70`; `includes/api/class-ideation-controller.php:939-990` | Server keeps `truncated_response`, `incomplete_response`, `parse_error`, `no_candidates` distinct, prefixed `ai_` on REST. The client ignores the code. Create draft shows `err.message` in a snackbar (`ideation/IdeationWorkspace.js:596-603`), which times out on a message that asks for an administrator. |
| 5 | Cutoff at the token ceiling | `includes/integrations/class-llm-text-generator.php:263-293` (`truncated_response`), `:201` (clamp report); `includes/abilities/agents/class-stage-agent.php:117-135` | Good copy: names the step, the ceiling, and who can raise it. But `class-stage-agent.php:134-135` passes a raw `Throwable` message through as `ai_error`, which the copy standard forbids. |
| 6 | Document card processing failed | `ideation/cards/DocumentCard.js:170-175, 182-187, 260-263` | Modal: `error` `Notice` with `ai.error` or "Processing failed.". Card face: caution icon and tooltip only. Tooltips are not exposed to assistive tech and do not exist on touch devices. |
| 7 | Sequence editor Save refused | `src/admin/components/graph/SequenceGraphEditor.js:877-919` (`saveBlockers`), `:1810-1875` | Dismissible `error` `Notice` floated over the canvas. Lists every blocker, and each row has "Show stage/transition". Strongest example in the app. Sits off-screen on tall canvases, which the notice region fixes. |
| 8 | Sequence editor warnings and read failure | `SequenceGraphEditor.js:1879-1900` (repair, missing regions); `:1739` (read failed) | `warning` `Notice`s stacked in the same floating slot. A read failure replaces the page with a bare `error` `Notice` that has no next step. |
| 9 | Editor transition blocked | `src/editor/components/WorkflowPanel.js:508-527, 1168-1186` (`ToolFailuresModal`) | Modal "Transition blocked" with hard failures and soft warnings. Correct level: the author must act before continuing. |
| 10 | Editor transition, claim or release failed | `WorkflowPanel.js:704-708` (move back), `:724-727` (claim), `:743-747` (release), `:882-890` (notice) | Dismissible `Notice` in the panel. The fallback copy "Failed to move the post back", "Failed to claim post" and "Failed to release post" breaks the copy standard. |
| 11 | Misconfigured transition | `src/editor/components/TransitionInputPopover.js:395-405` | `error` `Notice` inside the popover. Says what happened, why, and what the sequence needs. Good copy, inline, correct. |
| 12 | List and page loads | `src/admin/components/AssistantsTab.js:458-466`; `admin/pages/MyWorkPage.js:429`; `admin/pages/MyQueuePage.js:329`; `KanbanBoard.js:498` | Dismissible `error` `Notice` above the list, or a page replaced by a non-dismissible `Notice`. Usually shows the raw `err.message`. |
| 13 | Action failures in lists | `KanbanBoard.js:281, 295, 391`; `SequencesList.js:132`; `IdeationWorkspace.js` (6 call sites besides create draft); `admin/pages/Calendar.js:821`; `src/editor/components/CommandPalette.js:47, 102` | `createErrorNotice( …, { type: 'snackbar' } )` into `SnackbarList` at `AppShell.js:206-242`. These disappear by themselves, even when the message asks for a decision. |
| 14 | wp-admin notices (PHP) | `includes/admin/class-admin.php:543-555` (build required), `:606-628` (region review); `includes/workflow/class-publish-boundary-guard.php:84, 214` | Core `notice notice-error` markup. Correct for PHP-rendered screens. Out of scope except for copy. |
| 15 | Render crash | `src/admin/components/ErrorBoundary.js:33-50` (wraps every screen in `AppShell.js`) | The page is replaced by the title "Something went wrong" and a "Reload page" button. The title names nothing, which the anatomy below forbids. |
| 16 | Settings loads and modal forms | `src/admin/components/GeneralSettings.js:176`; `admin/pages/Settings.js:184`; `src/admin/components/AddSourceModal.js:167`; `src/admin/components/ProjectEditModal.js:59`; `ideation/cards/ArticleCard.js:269` | `error` `Notice` at the top of the settings screen or inside the modal body. Some append the raw message after "Details: %s". |

## Taxonomy

Every failure belongs to exactly one level. Choose the level by **what the
failure stops**, not by which component noticed it. This follows the WPDS
*Error Messages* pattern ("Displaying error messages") and makes it specific to
this app.

| Level | Use when | Container | Persistence |
|---|---|---|---|
| **Item** | One card, row, field, source or agent failed, and its siblings still work. | Inside the item: an error line (or compact `Notice`) in the item body, *plus* a visible state on the item's face (badge or tile) when the item has a collapsed face, such as a card. | Until resolved, retried or dismissed. Never auto-dismiss. |
| **Collection** | A list, board, grid or panel could not load or refresh as a whole, or one action failed in a way that affects the whole set. | `Notice` at the top of that collection, inside its container, above its items. | Until resolved, retried or dismissed. |
| **Page / global** | The whole screen is unusable or a save was refused: read failed, Save blocked, render crashed. (Background failures outside any visible item are an open question.) | The shell's notice region. Components report; the region places. | Until resolved or dismissed. |
| **Blocking** | The user cannot continue until they decide something. | `Modal` (existing `ToolFailuresModal`; see the [modal standard](../../guides/modal-standard.md)). | Until closed. |
| **Transient confirmation** | Something finished, or failed, and asks for no decision. | Snackbar through the notice region. | Auto-dismiss. **Never** for a message that asks for an action, a retry or another person. |

**Choosing rules.**

1. **Show the failure where it happened.** Use the narrowest level that still
   contains the cause. Whether a failure escalates when its item is not on
   screen, for example after a background run, is open (see Open questions).
2. **Siblings that work stay usable.** An item error never blocks its list. A
   collection error never replaces the page while cached items are still
   useful.
3. **One failure, one message.** Do not repeat it at two levels. The exception
   is a page-level *summary* that links to the items, as Save blockers do with
   "Show transition".
4. **If it needs a decision, it does not time out.** Any message with a retry,
   a link, or "ask an administrator" is persistent.
5. **Configuration gaps are warnings, not errors.** Unmet requirements on an
   enabled agent card are `warning`: nothing failed yet. The same gap
   becomes `error` when a run actually fails because of it.

## Anatomy: what every error contains

Use the WPDS order. It matches the [copy standard](../../guides/copy-standard.md#errors).

1. **What failed.** Name the specific thing ("The research agent", "This
   image", "Save"), never "Something".
2. **Why, if known.** Use the cause the server reported: truncation, cutoff,
   missing credential, permission. If the cause is unknown, say so. Do not
   guess.
3. **What the user can do.** One next step. If the reader cannot fix it, name
   who can ("ask an administrator to raise it for this step").
4. **An affordance when one exists.** "Retry" (secondary button) for
   transient or provider failures. A `Link` to the settings page or the
   external credential source. "Show …" to jump to the cause. One primary
   affordance at most.
5. **Preserved state.** Say so when nothing changed ("Nothing changed."). A
   failed retry keeps the prior content on screen.
6. **Raw detail stays out of the sentence.** Upstream or provider text goes
   behind a disclosure (WPDS "Notice with disclosed details") or into the log.
   It never gets appended to the human sentence.

**Copy rules.** The copy standard applies unchanged. Write a full sentence
with a terminal period. Use `Could not …` plus a remedy, never a bare
`Failed to …`. Use `Sorry, you are not allowed to …` for capability denials.
No `Please`. Do not blame the reader. Machine-facing ability errors stay
machine copy and are never shown to a person as-is.

**Error codes drive presentation.** The client should branch on the REST
`code`, not parse the message. The same model failure reaches the client in
two forms: the ideation controller prefixes it with `ai_`
(`ai_truncated_response`), and the stage agent returns it unprefixed
(`truncated_response`). The table lists codes without that prefix, and the
client matches either form. `ai_error` and `ai_unavailable` exist only with
the prefix. Proposed client-side classes:

| Class | Example codes | Default affordance |
|---|---|---|
| `retryable` | `no_candidates`, `no_text_content`, `parse_error`, network | Retry |
| `limit` | `truncated_response`, `incomplete_response` | None for editors. Settings link for admins. |
| `throttled` | `vip_workflows_ai_rate_limited` (429) | None. Say when the reader can try again. |
| `refused` | `content_filtered` | None. Retry does not help until the input changes. |
| `config` | unmet `availability` groups, `ai_unavailable` | Settings or credential link |
| `permission` | `rest_forbidden` | None |
| `invalid` | `tool_check_failed`, required metadata, save blockers | Show the cause |
| `unknown` | `ai_error` (any provider exception, including credential failures) | Retry. Say the cause is not known, and put the provider text behind the disclosure. |

## Shared components

Prefer WPDS over custom components. Add no new visual vocabulary.

- **`Notice` from `@wordpress/ui`** (`Notice.Root` with `intent="error" |
  "warning"`, `Notice.Title`, `Notice.Description`, `Notice.Actions`,
  `Notice.ActionButton`, `Notice.CloseIconButton`). Use it for item,
  collection and page messages. Render page-level ones inside `Notice.List`
  so they are announced. That list belongs to the notice region.
  `@wordpress/components` `Notice` remains the fallback until the pinned
  `@wordpress/ui` version (currently `^0.9.0`) is confirmed to export it.
- **`Badge` from `@wordpress/ui`** with `intent="high"`, for the *item-face*
  state on cards and rows. `Badge` has no `error` intent; `high` is what the
  app already uses for failed states (`ideation/TopBar.js` `statusIntent`). This replaces the icon-plus-tooltip on document
  cards. `Tooltip` is never the only carrier of an error.
- **`Snackbar` and `SnackbarList`**, through the notice region, for transient
  confirmations only.
- **`Modal` / `ToolFailuresModal`** for blocking decisions. No change.
- **`AgentRequirements`** stays the one renderer for unmet requirements. Only
  its container is decided by this spec.
- **One thin wrapper, `ErrorState`** (in `src/common/`). It takes `{ level,
  title, cause, action, details }` and renders the WPDS pieces above in the
  anatomy order. It holds no styling of its own. It exists so that retry, link
  and disclosure behave the same everywhere. `UnavailableRetry`'s generation
  guard moves into it.
- **Neutral media fallback.** `CardThumb`'s tile stays as it is. A missing
  hotlinked image is *degraded content*, not an error: no error colour and no
  message (see Open questions).

**Tokens.** Use component intents first. Where custom CSS is unavoidable, use
only the semantic tokens already in use:
`--wpds-color-background-surface-error-weak` (fill),
`--wpds-color-stroke-surface-error` / `-error-strong` (border and outcome marks),
`--wpds-color-foreground-content-error` / `-error-weak` (text),
`--wpds-color-background-surface-warning-weak` (warning fill),
`--wpds-color-stroke-surface-warning` / `-warning-strong` (warning border),
`--wpds-color-foreground-content-warning` / `-warning-weak` (warning text), and
`--wpds-color-background-surface-neutral-weak` (degraded media tile). No raw
hex. No new `z-index`: stacking belongs to the notice region.

## Retrofit plan

| # | Current case | Target |
|---|---|---|
| 1 | Card image fallback | Keep as degraded content. The modal "Preview unavailable." gains a link to open the source. |
| 2 | Agent retry | Item-level `ErrorState` (`retryable`): error `Notice` inside the agent row, with Retry as its action and the server's reason. |
| 3 | Unmet requirements | Item-level `warning` on the card and in the ideation top bar. Item-level `error` only in tool results, where a run failed. One container component for all three. |
| 4 | Truncated vs parse error | Client maps `ai_*` codes to classes. Create draft moves from snackbar to a persistent page-level `Notice` (`limit` or `retryable`). |
| 5 | Cutoffs | Copy stays. The stage agent's `ai_error` stays machine copy, because the ability also answers a model. The client renders it as class `unknown`: its own human sentence, with the provider text in details. |
| 6 | Document processing failed | Error `Badge` plus a one-line reason on the card face. Modal `Notice` gets Retry. |
| 7–8 | Save blockers, editor warnings, read failure | Unchanged shape. They move into the notice region. Read failure gains a reload action. |
| 9, 11 | Transition blocked modal, misconfigured popover | Already conform. No change. |
| 10 | Transition, claim or release failed | Copy fix for all three fallbacks (`Could not move the post back. …`, `Could not claim the post. …`, `Could not release the post. …`). Stays item-level in the panel, dismissible. |
| 12 | List loads | Collection-level `ErrorState` with Retry. Raw `err.message` moves to details. |
| 13 | Action snackbars | Audit each one. Keep the snackbar only when no decision is needed. Otherwise use item-level on the affected card. |
| 14 | wp-admin notices | Copy review only. |
| 15 | Render crash | Page level. The title names what failed (`Could not show this screen.`). The reload action stays. |
| 16 | Settings loads and modal forms | Settings loads are collection-level `ErrorState` with Retry. In a modal, the modal body is the collection: the `Notice` sits above the form. Raw `Details: %s` text moves to details. |

## Open questions

1. **Is `@wordpress/ui` `Notice` ready?** Should we adopt it now, at
   `^0.9.0`, or keep `@wordpress/components` `Notice` until it stabilises?
   This decides whether `ErrorState` wraps one or the other.
2. **Is degraded media an error?** Should a hotlinked image that will not load
   stay a silent neutral tile, or carry a quiet "Image unavailable" caption?
3. **Agent requirements: warning or error?** Is "enabled but unconfigured" a
   `warning` (proposed) or an `error`? It is the most frequent state on a
   fresh install.
4. **Where do background failures go?** An agent run that fails while its
   card is scrolled away, or on another tab: does it escalate to the page
   region, or wait silently on the item?
5. **What do editors see for `limit`?** Editors cannot change token ceilings.
   Is "ask an administrator" enough, or should the message link to a request
   flow?
6. **Should errors offer copy-to-clipboard?** Should page-level errors offer
   it, as the WPDS pattern suggests, for support hand-off?
7. **Should `ErrorState` exist at all?** Is the thin wrapper worth it, or
   should the rules be enforced by lint and review over raw WPDS components?
