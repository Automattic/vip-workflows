---
status: shipped
version: 1.1
last_updated: 2026-08-21
related:
  - planned/non-linear-progress.md
  - active/sequence-graph-editor.md
  - planned/helper-tools-transition-modal.md
  - shipped/ai-agent.md
---

# Transition Rail

> **Shipped 2026-08-14** on `block-editor-workflow-sidebar-cleanup`. Four
> deviations, each recorded where it happened:
>
> - **The measure loop is bounded, not free-running.** The rail's layout
>   effect re-measures when the rendered shape changes, with a ResizeObserver
>   covering fonts and sidebar resizes — not after every render. A
>   re-measure-after-own-set loop is one unstable measurement away from
>   React's nested-update limit taking the whole editor down, which is
>   exactly what happened when the rail first rendered unstyled (below).
> - **`build/editor.css` was never enqueued.** wp-scripts routes only files
>   literally named `style.css` into `style-editor.css`; every component-level
>   CSS import lands in `editor.css`, which `class-editor-integration.php`
>   did not enqueue (pre-existing — the modal styles were already silently
>   missing). Both stylesheets are now enqueued, mirroring `class-admin.php`.
> - **No Playwright coverage for the success-path flash.** The tests env
>   blocks provider egress, so an e2e agent run always fails in place and no
>   resolved outcome ever exists to flash. The three-beat sequence is
>   unit-tested (`transition-rail-flash.test.js`) including the degraded
>   no-`agent_last_run` path and the stale-record guard.
> - **"View full result" renders only when a result has issues.** A passing
>   check's row stays one line; its full report is reachable by re-running.
>   The helper-tool modal-on-run flow is unchanged.
>
> The panel's "Workflow complete" success Notice and the "An AI agent is
> working…" spinner row were removed with the sections they annotated — the
> END pill + green check and the rail's mark spinner + routed outcomes are
> those states now.
>
> **Scope addition (2026-08-14):** the whole-workflow Progress list was
> removed as well — the rail replaces it, not just the actions column. The
> two things only the list carried moved into the rail's header: the
> Live/Scheduled visibility badge and the current stage's description. The
> whole-graph reading the list gestured at (inaccurately, on any branching
> sequence) is `planned/non-linear-progress.md`'s job.

> **On the citations below (2026-09-14 line-citation pass).** `ToolsPanel.js`
> and `WorkflowPanel.js`'s `renderTransitionButton`/`groupTransitions` — the
> code this spec replaces — no longer exist; that logic now lives in
> `TransitionRail.js`. The **What Changes** and **Why** sections cite that
> pre-shipped code as historical rationale for the change and are left as
> written. From **The Model** onward, citations have been corrected to point
> at current `main` — where the described behavior actually lives today —
> with a few spots flagged where the shipped behavior itself diverged from
> what this spec proposed.

> **Second evolution (2026-09-15, `#22`, "Simplify the transition rail and
> align AI publishing routes").** The per-tool-row design this spec proposed,
> and which the 2026-09-14 pass above confirmed had shipped, was itself
> removed one day later. `TransitionRail.js` dropped from 1263 to 606 lines:
> every required tool's status dot, ad-hoc run button, and issue list is gone
> from the rail, along with the per-post abilities/ability-results fetches,
> the run handler, both result modals' wiring inside the rail, the stale-check
> comparison, and the results-refetch counter. The rail now renders moves
> only — a transition button, and, when locked, its `_locked_reason` as plain
> text underneath. Running a tool ad hoc still works, from the command
> palette, which keeps its own copy of both result modals
> (`CommandPalette.js`, unaffected by this change). **The "Checks are
> dependencies, not nodes" and "Check state, staleness included" sections
> below describe design proposed here and confirmed shipped on 2026-09-14 —
> read them as an accurate record of that intermediate state, not of
> `TransitionRail.js` today.** The same commit also changed what happens when
> an agent's route would publish without permission — see the note under
> **Agent stages** below.

## What Changes

The block editor sidebar currently answers "how do I move this post" in two
places that do not know about each other:

- The **actions section** of `WorkflowPanel`
  (`src/editor/components/WorkflowPanel.js:1107-1133`, buttons built by
  `renderTransitionButton` at `:494-531`, grouped by `groupTransitions` at
  `:91-101`) renders the available transitions as a stack of buttons.
- The separate **Tools panel** (`src/editor/components/ToolsPanel.js`, 547
  lines, mounted independently at `src/editor/index.js:160`) renders the checks
  those transitions require, grouped under "→ Destination" headings
  (`groupByTransition`, `ToolsPanel.js:149-166`) — restating in prose the
  relationship the buttons above already own.

Replace both with one component, the **Transition Rail**: the current stage as
a mark, each available transition as a spur off a drawn trunk, and each
transition's required checks nested directly beneath the button they gate. The
rail uses the sequence editor's own visual vocabulary — its line weight, its
arrowhead, its outcome tones, its END pill — so the sidebar and the canvas
describe the same graph in the same hand.

This component takes over what `planned/non-linear-progress.md` layer 2 calls
"fan-out". Layers 0, 1, and 3 there are unaffected.

## Why

Five defects, each in the current code:

**The split renders one relationship twice, out of sync.** A transition's
required tools are an attribute of the transition
(`required_tools`, served per transition at `class-status-manager.php:417`),
but the sidebar shows the transition in one card and its requirements in
another, each with its own fetch (`WorkflowPanel.js:174`, `ToolsPanel.js:197`
and `:216`) and its own refresh cycle. Nothing keeps them coherent.

**The buttons assert a preference the data doesn't declare.** Variant
precedence at `WorkflowPanel.js:497-502` promotes a terminal transition to
`primary` and demotes a bypass to `tertiary`. Nothing in the sequence marks a
preferred exit — a terminal edge is just an edge whose target has
`is_terminal` — so the promotion is an editorial claim the panel invented.

**The locked reason hides in a tooltip.** `_locked_reason` is the only thing
telling the user who to go ask, and it renders as a `<Tooltip>`
(`WorkflowPanel.js:522-530`) on a button that is truly `disabled` (`:511`) —
out of the tab order, so keyboard users can neither reach the button nor
summon the reason. A `🔒` glyph (`:514-517`) stands in for the explanation.

**The tools panel hardcodes the outcome colours.** `STATUS_COLORS` at
`ToolsPanel.js:26-30` is literal hex (`#00a32a` / `#dba617` / `#d63638`),
while the sequence editor reads the same three meanings from
`--wf-outcome-pass` / `-fail` / `-error`
(`SequenceGraphEditor.css:57-59`). Two palettes for one vocabulary.

**A cached green dot is presented as a promise.** The tools panel shows the
last stored result with no reference to when it ran. The result row carries
`created_at` (`class-ability-result.php:167`) and the post carries
`post_modified`; a pass recorded before the last edit is stale, and the panel
cannot currently say so.

## Principles

**Available, not advisable.** The panel states what the sequence permits from
here. Nothing in the data ranks the exits, so nothing in the UI may — one
button style for every transition, and the reader chooses.

**An edge means the post travels along it.** The rail's arrowheads point only
at things the post can become. A check is a precondition *on* an edge, not a
place the post goes, so it gets no edge and no arrowhead — it hangs under the
transition it gates, as an attribute.

**State lives outside the control.** A check's result belongs to a row in
`vip_ability_results`, shared and timestamped; the button acts on the tool.
Two objects with two lifetimes get two elements: an indicator beside the
button, never a tint inside it.

**Never promise what the server doesn't.** The server re-runs every required
check at transition time regardless of the cache, silently skips disabled
tools, and grades severity site-wide. The rail must not gate harder than the
server does, imply gates the server won't enforce, or present a stale pass as
a current one.

## The Model

### Structure

```
● Offer                      current stage — 15px dot, or spinner, or green check
│  you are here
├──▶ [ Hire ]                transition, ordinary secondary button
│      ○  [ SEO check ]      dependency: indicator OUTSIDE the button
│         Blocks this move.
│         · Meta description is missing.
│      ●  [ Readability ]
├──▶ [ Renegotiate ]
├──▶ [ Reject ]
└──▶ [ Fast-track ]
```

A working prototype of every state (normal, hard fail, soft fail, shared
check, all locked, agent, terminal) exists as a single HTML file; it is the
reference for layout, geometry, and the interaction beats below.

### Transitions

Every transition renders as `variant="secondary"`, and **nothing sits inside
the button but its `label`** — no lock glyph, no terminal marker, no badge.
This deletes the terminal→primary / bypass→tertiary precedence that used to
live in `WorkflowPanel.js`'s `renderTransitionButton` (removed; see the note
above). (The shipped rail kept one exception, added after this spec: when a
stage offers exactly one transition and it is not locked, that transition
renders `primary` — `TransitionRail.js:1056-1074`; see
`docs/guides/action-standard.md`.) Labels arrive already derived
(`StatusManager::transition_label()`, `class-status-manager.php:438-450`), so
the rail renders what it is given.

Clicking a transition calls `onTransition`, wired to `WorkflowPanel`'s
`handleTransitionClick` (`WorkflowPanel.js:684`, now considerably longer than
the ~50 lines this spec sized it at) — the warning, text-input, and
assignment modals, and the agent-interrupt confirm, all stay where they are.
While one transition is in flight (`transitioningTo`, passed down from
`WorkflowPanel.js:184` and compared per-button at `TransitionRail.js:1066`,
disabling the rest at `:1082`) its button shows the busy state and every
other button is `aria-disabled`, so a second move cannot queue behind the
first.

### Blocked transitions

A locked transition (`_locked`, set by the assignment check at
`class-sequence.php:508-509` and passed through at
`class-status-manager.php:531-535`) renders as a disabled-styled button
(`TransitionRail.js:1065-1085`) with `_locked_reason` as **plain helper text
directly below it** (`TransitionRail.js:1089-1096`) — no icon, no tooltip, no
colour. The reason is the actionable half of the state, so it is always
visible. This replaces the old `🔒` span and `<Tooltip>` that used to live in
`WorkflowPanel.js`'s removed `renderTransitionButton`.

The button uses `accessibleWhenDisabled` (`TransitionRail.js:1085`), so it
renders `aria-disabled` and stays in the tab order beside its explanation,
rather than the `disabled` attribute the old, removed button used.

**A failing check does not disable a transition.** `transition()` runs
`run_transition_tools()` fresh on every attempt
(`class-status-manager.php:916`) — the rail carries no cached opinion about a
transition's tools at all now (see the removal notes above), so a button is
either live or `_locked`, never "probably going to fail." A refusal comes
back as the `tool_check_failed` error, carrying `hard_failures` and
`soft_warnings` (`class-status-manager.php:2307-2308`), which the panel
above the rail renders as the blocked-transition dialog — the mechanism this
spec's **Why** section originally argued should replace two out-of-sync
displays with one; it now does so by removing the second display entirely
rather than keeping it in sync.

One asymmetry worth naming: a user who passes
`Settings::can_user_bypass_tool_checks()` never runs the tools at all
(`class-status-manager.php:915`). Since the rail shows nothing about tools
either way now, this has no separate visible consequence in the sidebar —
worth noting only because it's still true of the server, and the "Included
tools" audit-log record still reflects it.

### Order, and the retired bypass group

Transitions render in the order the payload delivers them, which is the order
of the stored `transitions` array. That array is the only ranking a sequence
carries, and the stage inspector is where an author arranges it; a sort in the
rail would silently override the one control whose effect the author can see.

**Retired in 1.1.** The rail originally sorted transitions declaring
`kind: 'bypass'` into a group of their own below the rest, separated by two
wavy breaks in the trunk (the drafting convention for an elided length) and
annotated *"Skips N stages"*. The parameter behind it was deleted whole: it
never reached storage through the sequence editor — `SequencesController`'s
write allowlist did not name `kind`, so an authored bypass was dropped on save
— and in review the inspector control it needed could not explain its own
meaning to the author facing it. Ordering by hand covers what the grouping
was reaching for, and does it under a control an author can watch work.

### Terminal stages and dead ends

A stage with `is_terminal` ends the rail with the sequence editor's **END
pill** (`TerminalNode.js`, styled at `SequenceGraphEditor.css:406-425`): the
trunk runs from the stage mark to a single spur whose arrowhead meets the
pill. The stage mark becomes a green check. A dead end
(`is_dead_end`, `class-sequence.php:902-904`) gets the same pill under a neutral
dot — stopped is not done, and the mark is the difference.

A stage that is neither flagged but offers the user no transitions is a third
state, not a blank: when the stage's raw config
(`all_statuses`) declares edges the permitted list omits — role filtering
removes them entirely, where a rule that merely holds an edge (assignment,
required metadata) leaves it in the list as a `_locked` row — the
rail says so in helper text ("Moves from this stage belong to other roles")
rather than impersonating a dead end.

### Agent stages

While an agent owns the stage, `get_available_transitions()` returns
`array()` on purpose (`class-status-manager.php:480-481`), so the rail's
outcome rows come from the sequence: the current stage's own config in the
payload (`current`, the raw stage config from
`Sequence::get_status()`) carries `agent.routing`, the map from
`pass` / `fail` / `error` to destination stage keys
(`AGENT_OUTCOMES`, `graph-model.js:119-126`; read into the rail's own
`agentOutcomes()`, `TransitionRail.js:199-218`) — matched against the stage's
authored transitions for their labels. The run plays in three beats:

1. **Running.** A spinner replaces the stage dot. Each routed outcome renders
   as a disabled button with its real transition label and the outcome's
   9–10px dot in its own tone — the one place a mark sits inside a button,
   because these are not controls; they are the routing table drawn in the
   rail's grammar. Never clickable.
2. **Resolve.** When polling (`WorkflowPanel.js`'s `agentIsPending` check at
   `:246`, on `workflow.agent_pending`) observes the run finish, the taken outcome's
   button flashes its **pressed state for ~700 ms**.
3. **Re-render.** The panel re-renders on the new stage, and a
   visually-hidden `role="status"` region announces the move — nobody
   clicked, so nothing else anchors the change.

> **Held publish routes (2026-09-15, `#22`).** An outcome that would cross
> into the `publish` or `private` region without the sequence's
> `allow_agent_publish` setting is a held route
> (`StageAgentRunner::holds_publication()`,
> `class-stage-agent-runner.php:714-731`) — mirrored on the canvas by
> `heldPublishOutcomes()` (`graph-model.js:1129`). While the agent owns the
> stage, `StatusManager::agent_routed_targets()`
> (`class-status-manager.php:421-455`) leaves a held target out of the
> routing this section describes, so the rail never renders it as a routed
> outcome at all — not "disabled", simply absent, same as any other unrouted
> transition. Once the stage is released (run finished, failed with no
> resolvable origin, or a warnings-pending move), the same method reads the
> post ID and lets the held target back in, so a post whose only routes
> publish is never stranded. The sequence editor treats the held route as an
> unrouted leftover the rest of the time it's held: a greyed dotted edge,
> disabled in both inspectors (`StageInspector.js:553-556` renders
> `"%s (disabled)"`; `TransitionInspector.js:369-381` carries the explanatory
> copy naming the setting), out of the transition count, with a non-blocking
> stage warning. "Let AI stages publish" is suggested only when a pass alone
> would take the held route; a fail/error route the UI instead suggests
> rerouting, since the setting would let a failed or errored run publish too.

Beat 2 needs data the payload does not carry — see **The one server change**.
A run that fails in place keeps the failed treatment in the panel above the
rail, but the exits do NOT return *(revised after shipping — the original
design released them beside a Re-run affordance)*: `agent_owns_stage_exits`
keeps withholding while the failed job records a resolvable origin stage, the
panel's one action is "Go back to <origin>" (the `agent-revert` endpoint), and
the rail keeps drawing the routed outcomes disabled. Only a failure with no
resolvable origin (a marker predating `from_stage`, or an origin the sequence
no longer defines) releases the stage's transitions — and then only the ones
`agent.routing` names; unrouted transitions are never offered in any state.

### Checks are dependencies, not nodes

> **Removed 2026-09-15 (`#22`).** Everything in this subsection describes the
> per-tool rows this spec proposed and which shipped — they no longer render.
> A required tool disabled site-wide still reaches the rail as a `_locked`
> transition carrying its reason (`Sequence::lock_disabled_required_tools`),
> and renders exactly like any other locked transition (see **Blocked
> transitions** above); nothing else about a tool's status shows in the rail.
> The reasoning below (results are shared per post+ability, severity is per
> issue) is still true of the underlying data — it's just no longer
> surfaced here.

Each transition's `required_tools` render as rows nested under its button —
**no edge, no arrowhead**. Each row is:

1. A **state indicator outside the control**: the sequence editor's 9–10px
   round dot. Hollow (`--hollow`-equivalent ring) when the check has not run;
   a spinner while running; `--wf-outcome-pass` / `-fail` / `-error` filled
   otherwise, with a check result's `output.status` of `warning` mapping to
   the error (amber) tone.
2. An ordinary `size="compact"` **secondary button** naming the tool, which
   runs it (`POST /abilities/{id}/run`, `TransitionRail.js:677-680`, in the
   `runCheck` helper that replaced `ToolsPanel.js`'s equivalent).
   A helper-type tool (`meta.type === 'helper'`) opens `HelperResultModal`
   (`TransitionRail.js:683-684`, rendered at `:1228-1246`); a check-type
   result renders inline, with `CheckResultsModal` available from the
   details for the full report (`TransitionRail.js:1250-1260`).
3. **Details underneath**: one severity roll-up line, then the issues, with
   the `VISIBLE_ISSUE_COUNT` disclosure (`TransitionRail.js:78`) keeping a
   noisy tool from pushing everything else off the sidebar.

**Results are shared, per post + ability.** `vip_ability_results` is keyed
`ability_id` + `post_id` with no transition column
(`class-schema.php:1485-1497`). A check required by two exits has one result:
the rail lists it under both and running it anywhere updates every listing.
The corollary is a rule the component must hold: two transitions requiring
the same check are always both blocked or both fine.

> **Shipped behavior diverged here, then the frontend half of it was removed
> anyway.** This spec's "omitted, not greyed" principle did not ship as
> written. `run_transition_tools()` never silently skipped a disabled
> required tool — it adds a `tool_disabled` **hard failure** that blocks the
> transition (`class-status-manager.php:2219-2226`), the opposite of "the
> transition proceeds as though the check ran." That server-side rule is
> still current. What's no longer true is the frontend half this note
> originally described: `TransitionRail.js` no longer renders per-tool rows
> at all (2026-09-15, `#22` — see the section note above), so a disabled
> required tool doesn't render as a blocking row, either — it's simply a
> `_locked` transition like any other. The underlying question this note
> raised (blocking vs. informational for a site-wide-disabled tool) is
> answered the same way either UI shows it: a disabled required tool blocks
> the move.

**Severity is per issue, and its site-wide half is only half.** `check_modes`
is a site option keyed ability → check key → `soft`|`hard`
(`class-ability-settings.php:86-89`): the sequence picks *which* checks gate
a move, Settings picks how hard each bites, everywhere at once. But a tool
can also declare an issue `error`/`hard` itself, and the server honours that
(`class-status-manager.php:2265-2268`) — so one run can return a mix. The
details render one roll-up line above the issues ("Blocks this move." /
"Warns before moving.") and mark individual lines only when they differ from
it. The roll-up is a statement about site configuration plus the tool's own
grading, never about this transition specifically.

### Check state, staleness included

> **Removed 2026-09-15 (`#22`), along with the rest of "Checks are
> dependencies, not nodes" above.** The per-ability fetch, the staleness
> comparison, and the ring/fill/hollow marks described below no longer exist
> in `TransitionRail.js`. A stale-or-fresh distinction has no home in the
> rail today; the server still re-runs every check at transition time
> regardless, so a stale pass was never load-bearing, only informational.

> **Shipped, and the under-fetch it warns about is resolved.** `TransitionRail.js`
> issues one `GET /posts/{id}/ability-results?ability_id=...&limit=1` request
> per required ability (`TransitionRail.js:522-525`) — the "N per-ability
> requests" option this doc's own Open Questions section below left
> undecided. `ToolsPanel.js`'s single `limit=5`-total fetch no longer exists.

The rail fetches the latest stored result per required ability
(`GET /posts/{id}/ability-results`, one request per ability as above).

When the post has been edited since the check ran — the result's `created_at`
(`class-ability-result.php:167`) is older than the post's `post_modified`,
both site-local wall-clock — the indicator renders **stale**: the outcome's
tone as a ring rather than a fill, with the detail line naming when it ran. A
filled dot means "true of this content"; a ring means "true of an earlier
version"; hollow means "never asked". The server re-runs everything at
transition time anyway, which is exactly why a stale pass must not wear the
same mark as a current one.

During an agent run the abilities endpoint returns an empty list — its
transitions filter reads `get_available_transitions()`, which is withholding
(`class-abilities-controller.php:279-284`) — consistent with the rail, which
draws no check rows under the outcome buttons.

### The rail drawing

One decorative SVG behind the buttons: `aria-hidden="true"
focusable="false"`, no pointer events, no focus stops — every semantic lives
in the buttons. **Geometry is measured from the laid-out buttons**
(`getBoundingClientRect` against the rail container), never assumed from row
heights, so the drawing cannot drift from the things it annotates.

The marks are the sequence editor's, exactly:

| Mark | Rule | Source |
| --- | --- | --- |
| Line | 1px, `--wpds-color-stroke-surface-neutral-strong`. 2px and the brand tone are the editor's hover / selection / `is-outbound` states (`SequenceGraphEditor.css:828-849`), which this surface doesn't have. | `SequenceGraphEditor.css:821-826` |
| Arrowhead | Open chevron `M -3.54,-3.54 L 0,0 L -3.54,3.54`, stroked at the line's own width, round cap and join. | `EdgeOverlay.js:115` |
| Standoff | `MARK_STANDOFF` (1.5) short of the button border — a gap, not an overlap. | `edge-constants.js:202` |
| Branch | An 8px fillet where each spur peels off the trunk. **The trunk ends at the last fillet** — the final spur's curve is the end of the trunk, so nothing overruns past the last button. | — |
| No socket | The trunk starts at the stage mark's centre and is painted over by it, so the line leaves the dot's edge. `EdgeOverlay` suppresses the socket on a node's own source handle for the same reason. | Rationale at `EdgeOverlay.js:60-90` (grown considerably from this spec's estimate as more edge cases were documented in place) |

Colours reference the CSS variables, never literal hex. That matters most for
the outcome tones: the comment above their declarations, now in the shared
stylesheet this spec's Implementation pointers proposed
(`src/common/outcome-tones.css`), explains they are deliberately *stroke*
tones rather than `fg-content-*` — the near-black content tints read as black
at 9px, not as green or red. `ToolsPanel.js`'s hardcoded `STATUS_COLORS`
constant is gone along with the file; `TransitionRail.js`'s `OutcomeMark`
component (`:248-264`) reads `--wf-outcome-*` directly (via the
`vip-workflows-rail__outcome--*` classes it assigns), with no hardcoded hex
left anywhere in the rail.

## The one server change

> **Shipped, essentially as proposed below.** `StageAgentRunner::LAST_RUN_META`
> (`class-stage-agent-runner.php:99`, `_vip_workflows_agent_last_run`) is
> exactly the compact last-run marker this section proposed, written by
> `finish()` (`class-stage-agent-runner.php:809-906`, the meta write itself
> at `:894-903`; the job marker is cleared via the separate
> `clear_job_for_stage()` compare-and-delete helper at `:1023-1038`) and
> surfaced by `WorkflowController::get_agent_last_run()`
> (`class-workflow-controller.php:725-737`), added to the status payload
> alongside `agent_job` (`class-workflow-controller.php:536-537`). One
> deliberate refinement over the plan: the record is **not** filtered to the
> current stage the way `get_agent_job_state()` is — the doc comment at
> `class-workflow-controller.php:716-720` explains why: by the time the
> client checks it, the post has already left the stage the run belonged to,
> so filtering it out would defeat the point.

The flash in agent beat 2 needed the **resolved outcome**, and the payload
could not previously supply it. `StageAgentRunner::finish()` cleared the job
marker before transitioning and the outcome survived only as an argument to
the `vip_workflows_agent_completed` action
(`class-stage-agent-runner.php:905`); `get_agent_job_state()` returned only
`status` and `error`, filtered to the *current* stage
(`class-workflow-controller.php:672-676`) — after the route fired, the
current stage was the destination and the state was `null`.

Reverse-mapping the new stage through `agent.routing` was not a substitute:
two outcomes may legally route to the same stage, and the graph editor
already accounted for exactly that (`graph-model.js:347-357`).

Shipped shape, matching the smallest-that-works proposal: `finish()` writes
the last-run marker (`stage_key`, `outcome`, `to`, plus a timestamp) to post
meta before the transition, and the status payload gains the `agent_last_run`
field carrying it. The client flashes when it observes the pending →
not-pending edge and the marker's `stage_key` matches the stage it was just
watching; the flash degrades gracefully (straight to beat 3) when the field
is absent.

## Accessibility

- Blocked buttons use `accessibleWhenDisabled` (the stabilised name for
  `__experimentalIsFocusable`) so they carry `aria-disabled` and stay in the
  tab order, keeping the helper text that explains *why* within keyboard
  reach.
- Every move is announced via `@wordpress/a11y`'s `speak()` (a polite live
  region core manages, not a `role="status"` element this component owns —
  changed since this spec was written), whether user-initiated or
  agent-routed. It matters most for the agent case: nobody clicked, so there
  is no expectation of change to anchor to.
- The clicked transition shows busy; every other transition is
  `aria-disabled` for the duration.
- The rail SVG is `aria-hidden="true" focusable="false"`.
- The buttons are grouped with `role="group"`, labelled by the current stage
  name — the prototype uses `aria-labelledby` against the stage label element.

## Implementation pointers

All of the following shipped; each bullet is left as the plan, with a note
where the shipped result is verified.

- **New** `src/editor/components/TransitionRail.js` + `.css` — the component,
  its geometry helper (a pure function from measured rows to path data, so it
  can be unit-tested against fixtures), and its styles. Shipped at 1263 and
  365 lines respectively; **as of 2026-09-15 (`#22`), down to 606 and 159**
  after the per-tool-row removal.
- **Edit** `src/editor/components/WorkflowPanel.js` — remove
  `renderTransitionButton` and the transitions render block; mount the rail.
  `handleTransitionClick`, the warnings/input/assignment modals, the
  agent-interrupt confirm, and the polling stay put; the rail calls into
  them. `groupTransitions` moves with the rail. Confirmed: both functions are
  gone from `WorkflowPanel.js`; `<TransitionRail` now mounts at `:1080` (the
  file itself has grown to 1246 lines from unrelated work since).
- **Remove** `src/editor/components/ToolsPanel.js` — its job moves into the
  rail. Confirmed removed. **Keep** `ToolResultModals.js`: `CommandPalette.js`
  imports it (`CommandPalette.js:19`, unchanged) and runs abilities through
  its own fetch, so it is unaffected by the panel's removal. **The
  `VISIBLE_ISSUE_COUNT` disclosure this bullet promised to keep did not
  survive either** — it shipped inside the rail's per-tool details area, and
  that whole area was removed on 2026-09-15 (`#22`) along with it; no
  `VISIBLE_ISSUE_COUNT` constant exists anywhere in the codebase today. A
  long issue list is once again whatever `ToolResultModals.js` renders
  in full, same as before this spec.
- **Edit** `src/editor/index.js` — drop the `<ToolsPanel>` mount at `:160`.
  Confirmed: no `ToolsPanel` reference remains in `index.js`.
- **Edit** `src/editor/style.css` — the `vip-workflows-panel__progress-*`
  rules mostly survive; they belong to the progress list, which
  `non-linear-progress.md` owns, not to this component.
- **Shared tokens.** The rail needs `--wf-outcome-*` in the editor bundle;
  they were scoped to the graph editor's root. Extract the three
  declarations (and their load-bearing comment) into a shared stylesheet
  under `src/common/` that both surfaces import, rather than redeclaring.
  Shipped as `src/common/outcome-tones.css`, imported by both
  `TransitionRail.css` and the graph editor's stylesheets. The END pill's
  visual rules (`SequenceGraphEditor.css:406-425`) were not given the same
  treatment — `TerminalNode.js` and its styling stay in `src/admin/`, cited
  directly rather than relocated; that's a smaller gap against the plan than
  it looks, since the rail only reuses the pill's rendered output via
  `TerminalNode.js`, not its CSS.
- **Label derivation.** The agent outcome buttons need
  `transition_label()`'s derivation client-side. Shipped exactly as
  proposed, and further than `graph-model.js:144-148` (the mirror this spec
  pointed at) suggested: the derivation now lives in
  `src/common/transition-label.js:52` (`transitionLabel()`), and
  `graph-model.js:108-116` re-exports it rather than keeping its own copy —
  no third copy was written.

## Tests

- **Geometry helper fixtures**: a single transition, several transitions,
  zero transitions, and a terminal stage.
- **The five degenerate states render distinctly**: terminal, dead end, agent
  running, all-locked, and blocked-by-check. They are not interchangeable,
  and a naive implementation collapses them into one blank box reading "dead
  end". Add the sixth: edges declared but role-filtered away. **"Blocked-by-
  check" has no meaning to test for any more** (2026-09-15, `#22`) — with no
  per-tool rows, a transition is either offered or `_locked`; there is no
  third, check-failing-but-not-locked visual state left to distinguish.
- A check required by two transitions renders twice and both rows update when
  it runs once. **Gone with the per-tool rows** (2026-09-15, `#22`) —
  `transition-rail-checks.test.js` shrank from 376 lines to a fraction of
  that in the same commit, and this scenario no longer has UI to assert
  against.
- A disabled tool is omitted rather than greyed. **Did not ship this way, and
  is now moot besides** — see the shipped-behavior note under "Checks are
  dependencies, not nodes" above: it first shipped as a blocking row, then
  the row itself was removed on 2026-09-15 (`#22`); a disabled required tool
  is simply a `_locked` transition now, same as any other lock.
- A stale pass renders as stale, not passed. **Gone with the staleness
  comparison** (2026-09-15, `#22`) — `isBefore()`, the helper this rested on,
  was deleted from `src/common/datetime.js` along with its dedicated test
  coverage (`datetime.test.js` lost 50 lines in the same commit); there is
  no stale/fresh distinction left in the rail to test. `transition-rail-
  flash.test.js` was also removed in the same commit, but that covered the
  agent three-beat flash (see **The one server change**), a separate
  concern this doc's own banner already distinguishes.
- Existing suites per `docs/TESTING.md` (PHPCS, PHPUnit, and Jest on GitHub
  Actions). Playwright coverage for the agent three-beat sequence
  if the e2e suite has a reasonable home for it — the agent-stage e2e spec is
  the candidate.
- Every WPDS lint exception carries its inline `wpds-allow` justification,
  as the existing files do.

## Explicitly out of scope

- The whole-graph shape map and other non-linear progress visualizations.
- Any sequence schema change. `required_tools`, `kind`, `status_info`,
  `_locked`, `_locked_reason`, and `agent.routing` all already ship.
- Per-transition check severity. That would need `check_modes` to move out of
  site settings; until it does, the nesting must not be read as
  per-transition grading, and the roll-up line is worded accordingly.
- Making the rail interactive beyond the buttons. The SVG stays a drawing.

## Open questions

- **Height.** Three transitions with two checks each measures ~260px — past
  the sidebar's fold. Scrolling is acceptable here in a way it wasn't for the
  shape map, but if trimming is wanted, the candidate is collapsing the nest
  behind a count on transitions whose checks all pass ("2 checks ✓") and
  expanding only rows with something to say. Failures are why the component
  exists; passes can be one line. Deferred until the full-height version is
  seen on real sequences.
- **The results fetch shape.** *Resolved.* Shipped as N per-ability requests
  (`TransitionRail.js:522-525`, `limit=1` per ability) — see the shipped-note
  under "Check state, staleness included" above.
- **Should running a check mark the post's other surfaces?** The Kanban board
  and Quick Edit reach `transition()` without this panel; a check run here
  updates a shared result they may also read. Nothing breaks — results were
  always shared — but the sync-across-buttons behaviour is the first UI that
  makes the sharing visible, and it may prompt "why did that change" reports
  worth a support note.
