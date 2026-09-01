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
This deletes the terminal→primary / bypass→tertiary precedence at
`WorkflowPanel.js:497-502`. (The shipped rail kept one exception, added
after this spec: when a stage offers exactly one transition and it is not
locked, that transition renders `primary` — see
`docs/guides/action-standard.md`.) Labels arrive already derived
(`StatusManager::transition_label()`, `class-status-manager.php:314-326`), so
the rail renders what it is given.

Clicking a transition calls the existing `handleTransitionClick`
(`WorkflowPanel.js:533-583`) — the warning, text-input, and assignment modals,
and the agent-interrupt confirm, all stay where they are. While one transition
is in flight (`transitioningTo`, `WorkflowPanel.js:133`) its button shows the
busy state and every other button is `aria-disabled`, so a second move cannot
queue behind the first.

### Blocked transitions

A locked transition (`_locked`, set by the assignment check at
`class-sequence.php:493-494` and passed through at
`class-status-manager.php:426-429`) renders as a disabled-styled button with
`_locked_reason` as **plain helper text directly below it** — no icon, no
tooltip, no colour. The reason is the actionable half of the state, so it is
always visible. This replaces the `🔒` span and `<Tooltip>` at
`WorkflowPanel.js:514-530`.

The button uses `accessibleWhenDisabled`, so it renders `aria-disabled` and
stays in the tab order beside its explanation, rather than the `disabled`
attribute that currently removes it (`WorkflowPanel.js:511`).

**A failing cached check does not disable a transition.** `transition()` runs
`run_transition_tools()` fresh on every attempt
(`class-status-manager.php:642`) — the cached result may predate the last
edit, and the server re-runs it regardless. A button that refuses a move the
server would allow is worse than one that fires and returns the block message.
The transition stays live; the failing check is visible directly beneath it;
and if the server does block, the `tool_check_failed` error already carries
`hard_failures` and `soft_warnings` (`class-status-manager.php:1924-1932`,
handled at `WorkflowPanel.js:402-408`) — the rail updates its check rows from
that payload, so the indicator and the refusal agree.

One asymmetry worth naming: a user who passes
`Settings::can_user_bypass_tool_checks()` never runs the tools at all
(`class-status-manager.php:641`). For them the check rows are pure disclosure
— accurate about the sequence, silent about their own next click. The rail
does not vary its rendering by bypass capability; the checks describe the
move, not the mover.

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
(`is_dead_end`, `class-sequence.php:718`) gets the same pill under a neutral
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
`array()` on purpose (`class-status-manager.php:387-389`), so the rail's
outcome rows come from the sequence: the current stage's own config in the
payload (`current`, the raw stage config from
`Sequence::get_status()`) carries `agent.routing`, the map from
`pass` / `fail` / `error` to destination stage keys
(`graph-model.js:156-159`) — matched against the stage's authored transitions
for their labels. The run plays in three beats:

1. **Running.** A spinner replaces the stage dot. Each routed outcome renders
   as a disabled button with its real transition label and the outcome's
   9–10px dot in its own tone — the one place a mark sits inside a button,
   because these are not controls; they are the routing table drawn in the
   rail's grammar. Never clickable.
2. **Resolve.** When polling (`WorkflowPanel.js:193-201`, on
   `workflow.agent_pending`) observes the run finish, the taken outcome's
   button flashes its **pressed state for ~700 ms**.
3. **Re-render.** The panel re-renders on the new stage, and a
   visually-hidden `role="status"` region announces the move — nobody
   clicked, so nothing else anchors the change.

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

Each transition's `required_tools` render as rows nested under its button —
**no edge, no arrowhead**. Each row is:

1. A **state indicator outside the control**: the sequence editor's 9–10px
   round dot. Hollow (`--hollow`-equivalent ring) when the check has not run;
   a spinner while running; `--wf-outcome-pass` / `-fail` / `-error` filled
   otherwise, with a check result's `output.status` of `warning` mapping to
   the error (amber) tone.
2. An ordinary `size="compact"` **secondary button** naming the tool, which
   runs it (`POST /abilities/{id}/run`, as `ToolsPanel.js:243-247` does now).
   A helper-type tool (`meta.type === 'helper'`) opens `HelperResultModal`
   exactly as today (`ToolsPanel.js:249-257`); a check-type result renders
   inline, with `CheckResultsModal` available from the details for the full
   report.
3. **Details underneath**: one severity roll-up line, then the issues, with
   the `VISIBLE_ISSUE_COUNT` disclosure (`ToolsPanel.js:44`) keeping a noisy
   tool from pushing everything else off the sidebar.

**Results are shared, per post + ability.** `vip_ability_results` is keyed
`ability_id` + `post_id` with no transition column
(`class-schema.php:983-997`). A check required by two exits has one result:
the rail lists it under both and running it anywhere updates every listing.
The corollary is a rule the component must hold: two transitions requiring
the same check are always both blocked or both fine.

**A disabled tool is omitted, not greyed.** `run_transition_tools()` skips a
tool whose `is_enabled()` is false and the transition proceeds as though the
check ran (`class-status-manager.php:1845-1847`). Greying it out would imply
a gate that isn't there. The abilities endpoint annotates `enabled`
(`class-abilities-controller.php:219`) without filtering on it; the rail
filters. The sidebar and the sequence will disagree about the count, and the
sidebar is the one telling the truth.

**Severity is per issue, and its site-wide half is only half.** `check_modes`
is a site option keyed ability → check key → `soft`|`hard`
(`class-ability-settings.php:86-89`): the sequence picks *which* checks gate
a move, Settings picks how hard each bites, everywhere at once. But a tool
can also declare an issue `error`/`hard` itself, and the server honours that
(`class-status-manager.php:1887-1890`) — so one run can return a mix. The
details render one roll-up line above the issues ("Blocks this move." /
"Warns before moving.") and mark individual lines only when they differ from
it. The roll-up is a statement about site configuration plus the tool's own
grading, never about this transition specifically.

### Check state, staleness included

The rail fetches the latest stored result per required ability
(`GET /posts/{id}/ability-results` — note `ToolsPanel.js:216-229` fetches
`limit=5` *total* and keeps first-per-ability, which under-fetches once a post
has more than five recent rows across its tools; the rail should request
per-ability or raise the limit to cover the required set).

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
(`class-abilities-controller.php:315-317`) — consistent with the rail, which
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
| Arrowhead | Open chevron `M -3.54,-3.54 L 0,0 L -3.54,3.54`, stroked at the line's own width, round cap and join. | `EdgeOverlay.js:76` |
| Standoff | `MARK_STANDOFF` (1.5) short of the button border — a gap, not an overlap. | `edge-constants.js:202` |
| Branch | An 8px fillet where each spur peels off the trunk. **The trunk ends at the last fillet** — the final spur's curve is the end of the trunk, so nothing overruns past the last button. | — |
| No socket | The trunk starts at the stage mark's centre and is painted over by it, so the line leaves the dot's edge. `EdgeOverlay` suppresses the socket on a node's own source handle for the same reason. | `EdgeOverlay.js:75`, rationale at `:27-52` |

Colours reference the CSS variables, never literal hex. That matters most for
the outcome tones: the comment above their declarations
(`SequenceGraphEditor.css:47-59`) explains they are deliberately *stroke*
tones rather than `fg-content-*` — the near-black content tints read as black
at 9px, not as green or red. `ToolsPanel.js:26-30`'s hardcoded
`STATUS_COLORS` become `--wf-outcome-*` as part of this work.

## The one server change

The flash in agent beat 2 needs the **resolved outcome**, and the payload
cannot currently supply it. `StageAgentRunner::finish()` clears the job
marker before transitioning (`class-stage-agent-runner.php:633`) and the
outcome survives only as an argument to the `vip_workflows_agent_completed`
action (`:659`); `get_agent_job_state()` returns only `status` and `error`,
filtered to the *current* stage (`class-workflow-controller.php:588-598`) —
after the route fires, the current stage is the destination and the state is
`null`.

Reverse-mapping the new stage through `agent.routing` is not a substitute:
two outcomes may legally route to the same stage, and the graph editor
already accounts for exactly that (`graph-model.js:372-377`).

Proposed shape, smallest that works: `finish()` writes a compact last-run
marker (`stage_key`, `outcome`, `to`, `finished_at`) to post meta before the
transition, and the status payload (`class-workflow-controller.php:488-515`)
gains an `agent_last_run` field carrying it. The client flashes only when it
observes the pending → not-pending edge and the marker's `stage_key` matches
the stage it was just watching. Everything else in this spec ships without
this field; only the flash degrades (straight to beat 3) when it is absent.

## Accessibility

- Blocked buttons use `accessibleWhenDisabled` (the stabilised name for
  `__experimentalIsFocusable`) so they carry `aria-disabled` and stay in the
  tab order, keeping the helper text that explains *why* within keyboard
  reach.
- A visually-hidden `role="status"` region announces every move, whether
  user-initiated or agent-routed. It matters most for the agent case: nobody
  clicked, so there is no expectation of change to anchor to.
- The clicked transition shows busy; every other transition is
  `aria-disabled` for the duration.
- The rail SVG is `aria-hidden="true" focusable="false"`.
- The buttons are grouped with `role="group"`, labelled by the current stage
  name — the prototype uses `aria-labelledby` against the stage label element.

## Implementation pointers

- **New** `src/editor/components/TransitionRail.js` + `.css` — the component,
  its geometry helper (a pure function from measured rows to path data, so it
  can be unit-tested against fixtures), and its styles.
- **Edit** `src/editor/components/WorkflowPanel.js` — remove
  `renderTransitionButton` and the transitions render block; mount the rail.
  `handleTransitionClick`, the warnings/input/assignment modals, the
  agent-interrupt confirm, and the polling stay put; the rail calls into
  them. `groupTransitions` moves with the rail.
- **Remove** `src/editor/components/ToolsPanel.js` — its job moves into the
  rail. **Keep** `ToolResultModals.js`: `CommandPalette.js` imports it
  (`CommandPalette.js:19`) and runs abilities through its own fetch
  (`:55`, `:141`), so it is unaffected by the panel's removal. Keep the
  `VISIBLE_ISSUE_COUNT` disclosure behaviour inside the rail's details area.
- **Edit** `src/editor/index.js` — drop the `<ToolsPanel>` mount at `:160`.
- **Edit** `src/editor/style.css` — the `vip-workflows-panel__progress-*`
  rules (`:112-190`) mostly survive; they belong to the progress list, which
  `non-linear-progress.md` owns, not to this component.
- **Shared tokens.** The rail needs `--wf-outcome-*` in the editor bundle;
  they are currently scoped to the graph editor's root
  (`SequenceGraphEditor.css:57-59`). Extract the three declarations (and
  their load-bearing comment) into a shared stylesheet under
  `src/common/` that both surfaces import, rather than redeclaring. The
  END pill's visual rules (`SequenceGraphEditor.css:406-425`) are worth the
  same treatment; `TerminalNode.js` itself is React-Flow-bound and stays
  where it is. Prefer relocation to `src/common/` over cross-importing
  from `src/admin/` throughout, per `non-linear-progress.md`'s bundle-boundary
  note.
- **Label derivation.** The agent outcome buttons need
  `transition_label()`'s derivation client-side; `graph-model.js:144-148`
  already mirrors it. Relocate the mirror to `src/common/` rather than
  writing a third copy.

## Tests

- **Geometry helper fixtures**: a single transition, several transitions,
  zero transitions, and a terminal stage.
- **The five degenerate states render distinctly**: terminal, dead end, agent
  running, all-locked, and blocked-by-check. They are not interchangeable,
  and a naive implementation collapses them into one blank box reading "dead
  end". Add the sixth: edges declared but role-filtered away.
- A check required by two transitions renders twice and both rows update when
  it runs once.
- A disabled tool is omitted rather than greyed.
- A stale pass renders as stale, not passed.
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
- **The results fetch shape.** Latest-per-ability is what the rail needs;
  whether that is N per-ability requests, a raised limit, or a small endpoint
  addition (`ability_id` already filters; a `latest_per_ability` flag would
  be honest) is an implementation call — but the `limit=5` under-fetch noted
  above should not be inherited.
- **Should running a check mark the post's other surfaces?** The Kanban board
  and Quick Edit reach `transition()` without this panel; a check run here
  updates a shared result they may also read. Nothing breaks — results were
  always shared — but the sync-across-buttons behaviour is the first UI that
  makes the sharing visible, and it may prompt "why did that change" reports
  worth a support note.
