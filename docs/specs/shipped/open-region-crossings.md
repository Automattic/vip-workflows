---
status: shipped
version: 1.0
last_updated: 2026-08-11
supersedes:
  - deprecated/boundary-checkpoints.md
related:
  - shipped/content-hierarchy.md
  - active/sequence-graph-editor.md
  - planned/workflow-side-effect-guard.md
  - planned/parallel-stages.md
---

# Open Region Crossings

> **Shipped 2026-08-11.** The removal plan below was followed in order. Two
> deviations, both recorded where they happened:
>
> - **`canEnter()` did not survive** (open question 1). With the region branch
>   gone, all four `graph-model.js` call sites were already covered by their own
>   existence checks, and both `SequenceGraphEditor.js` validators reduce to the
>   `isStageKey` helper they already had. `reconnectEdge` keeps an inline
>   both-endpoints-are-stages guard, which is the one thing the call actually did
>   there — refuse before the original edge is removed.
> - **`SequenceRegionRepairTest` was kept, not deleted.** Despite its name it
>   covers `get_stages_missing_region()` and `region_entry` presence detection —
>   the coverage step 6 says to keep — and holds no crossing cases at all.
>
> `reroute_illegal_crossings()` is now `collapse_duplicate_transitions()`, since
> the crossing half is what it lost and the duplicate-target collapse is all it
> ever does. Its report drops to `{config, dropped}` with `{from, to}` records —
> `rerouted`, `remapped`, and the `region`/`entry` fields were crossing artifacts
> — and the admin notice, the REST `repair` payload, and the editor's
> `describeRepair` follow it down.

## What Changes

A workflow transition may target **any** stage, in any status region. The rule
that a region-crossing edge must land on the target region's `region_entry`
checkpoint is removed from the write gate, the canvas, and the stored-row repair
path.

`region_entry` itself stays, with one job instead of two: it is where a post is
seated when something **outside the workflow** puts it in a region — a
core-driven status change (Publish button, Quick Edit, REST, WP-CLI, cron,
untrash) or a sequence assignment onto a post that already has a status. It
stops being "the only door" and becomes "the fallback landing spot".

Nothing about how a crossing *behaves* changes: a transition whose endpoints sit
in different regions still writes the target region's status through core, still
defers to `current_user_can_cross_region()`, and is still subject to the publish
veto. Only the constraint on **where such an edge may point** goes away.

## The two things called "checkpoint"

They are routinely discussed as one mechanism and are independent:

1. **`region_entry` as a landing target.** `StatusManager::resolve_reseat_stage()`
   needs exactly one stage per region to reseat at, and `assign_sequence()` uses
   the same marker to seat an incoming post at the region matching its current
   status. **Unaffected by this spec.**
2. **The crossing rule.** `Sequence::illegal_crossings()` and its canvas mirror
   `canEnter()` reject any transition that enters a region without landing on
   that region's `region_entry`. **This is what is removed.**

Every invariant that makes the matrix model work — every stage declares a
region, status is written only by region-crossing transitions, core-driven
changes reseat, overlays never reseat — belongs to (1) and survives intact.

## The finding that reframes the comparison

**The crossing rule is not enforced at runtime.** `StatusManager::transition()`
validates that the edge exists in the sequence, that its target resolves to a
defined stage, and that the caller may cross the regions involved. It never asks
whether the target is a checkpoint. The status write is keyed on
`$from_region !== $to_region`, not on the checkpoint.

The runtime therefore *already* executes arbitrary cross-region edges correctly.
The rule lives entirely in authoring and data layers:

| Layer | Where |
| --- | --- |
| Config write gate | `Sequence::prepare_config_for_write()` (`class-sequence.php:1110`) |
| Canvas gestures | `canEnter()` — 4 call sites in `graph-model.js`, 2 in `SequenceGraphEditor.js` |
| Stored-row repair | `reroute_illegal_crossings()`, `SequenceRepository::repair_stage_regions()`, the 2.19.0 replay (`class-schema.php:405`) |
| Assignment seat | `assign_sequence()` (`class-status-manager.php:1551`) |

That makes this a subtraction, not a rewrite: no new runtime behavior has to be
designed, written, or tested. It also means the rule constrains less than its
footprint in the code implies — it governs what can be *drawn* and *stored*, not
what can *happen*.

## What the rule buys

- **One funnel per region.** However a post got into `pending` — an edge or core
  — it arrives at the same stage and runs the same `vip_workflow_entered_{stage}`
  effects (agent dispatch, notifications, audit event). This is the justification
  stated in both `illegal_crossings()` and `canEnter()`.
- **A smaller state matrix.** Cross-region entry collapses from
  (source stage × target stage) to (source region × target region), which is
  fewer paths to reason about and to test.

What it does **not** buy, despite how the docblocks read: it does not protect the
publish boundary. A publish-region stage may legally carry an edge to `draft`'s
checkpoint — that is unpublishing, and the rule permits it; it only dictates
where the unpublish lands. The actual protection is
`StatusManager::current_user_can_cross_region()` and `PublishBoundaryGuard`, both
keyed on regions and untouched by this change. The symmetry argument that ended
the `ca346a9` experiment was about two authoring gates agreeing with each other,
not about closing a hole.

## What it costs

- **Ordinary editorial shapes are unauthorable.** "Send this back to the stage
  where work resumes" is the canonical case, and it already forced the shipped
  demo's `rights → desk` edge to be repointed at `brief`. The same applies to a
  region holding parallel lanes: if `pending` carries copy-edit, legal, and
  fact-check, nothing outside the region can address any of them directly.
- **The repair machinery exists only because of it.**
  `reroute_illegal_crossings()` is ~190 lines, and its crossing-specific parts —
  the per-stage `moves` map, the agent `routing` remap, the displaced-transition
  drop — exist solely to rewrite configs the rule invalidated. That repair
  **drops author transitions**, with their roles, required tools and
  notifications, whenever a reroute collides with an edge the stage already has.
  It is an author-hostile failure mode created entirely by the rule, and 2.19.0
  already ran it unattended across stored rows.
- **The funnel guarantee is self-protection, not enforcement.** The author who
  could draw a bypassing edge is the same author who owns the checkpoint. Unlike
  stage permissions or the publish veto, it defends nothing against anybody.

## The alternative, concretely

### Stays

- `region_entry`, still exactly one per used region.
- Both validation errors: a region with stages and no checkpoint, and a region
  with more than one.
- The border-slot rendering and the drag-a-stage-into-the-slot gesture. Its
  meaning sharpens: the slot is where core drops a post, which is a real and
  distinct concept rather than a restatement of the edge rule.
- `resolve_reseat_stage()`, `boundary_region()`, `status_to_region()`, overlay
  handling, `current_user_can_cross_region()`, `PublishBoundaryGuard`.
- The region-crossing status write in `transition()`.

### Goes

| Removal | Approx. size |
| --- | --- |
| `Sequence::illegal_crossings()` | ~76 lines |
| Crossing half of `Sequence::reroute_illegal_crossings()` (the duplicate-target collapse is a separate rule and stays) | ~2/3 of 190 lines |
| Crossing check in `prepare_config_for_write()` | small |
| Reroute branch in the 2.19.0 replay and in `repair_stage_regions()` | moderate |
| `assign_sequence()`'s `invalid_region_crossing_stage` refusal | ~30 lines |
| `canEnter()`'s cross-region branch + 6 call sites collapse to "target exists" | ~46 lines |
| `illegalCrossings()`, `rerouteIllegalCrossings()`, the crossing errors/warnings in `validateSequence()` | ~190 lines |
| "Reroute to checkpoint" repair action in `SequenceGraphEditor` | moderate |
| `SequenceRegionRepairTest` plus crossing cases across ~8 other test files | substantial |

Net: roughly 500–600 lines, overwhelmingly deletion.

### The one guarantee actually lost

"Region R's checkpoint effects run on every entry to R." Today that is how you
would express *"notify the desk whenever anything enters pending"*. With the rule
gone, an author would have to attach that to each entry stage, and nothing would
warn them when a new edge bypasses it.

Close it properly rather than by constraint: `dispatch_stage_change()` already
knows both the old and new stage and can resolve both regions, so a
**region-scoped entered event** is a small addition and is strictly better than
inferring region semantics from whichever stage happens to sit on the border. It
is a follow-up, not a blocker — no shipped sequence depends on the funnel today.

## Why this supersedes boundary checkpoints

The earlier boundary-checkpoint design bought back exactly what the crossing
rule forbids, at the price of:

- two stages per used adjacency (up to six region pairs, since `private` and
  `publish` are siblings rather than a line),
- a migration the spec itself describes as larger than the already-fragile
  2.17.0 replay, and
- three unresolved questions: what `region_entry` means once a region has two
  near halves, whether a near half must be effect-free to avoid firing two sets
  of entry effects on one crossing, and whether boundaries are derived or
  declared.

Removing the rule dissolves the problem that spec was solving. Its two open
design questions answer themselves: `region_entry` keeps one clear job, and
there is no near/far half to double-fire.

Its separable second payoff — *"the status change becomes one identifiable
object that can be guarded and audited"* — is already substantially served:
`StatusManager::commit_post_status()` is the single place a workflow writes
`post_status`, and `PublishBoundaryGuard` is the single place a core-driven one
is vetoed. That payoff never required the two-half model.

The `boundary-checkpoints` spec also anticipated this outcome. Its *Not In Scope*
section names "move entry effects from the checkpoint stage to the region, so
that where an edge lands stops being a correctness question" as the alternative
that "dissolves the rule rather than refining it", to be revisited if the costs
proved too high. They did.

## Removal plan

Ordered so the product is never in a state where the canvas and the server
disagree about what is legal.

1. **Server gate.** Drop the crossing check from `prepare_config_for_write()` and
   delete `illegal_crossings()`. Relaxing a gate is backward compatible: every
   stored config that passed the old gate passes the new one.
2. **Canvas.** Collapse `canEnter()` to a target-exists check (or delete it and
   inline that at its call sites), and remove `illegalCrossings()`,
   `rerouteIllegalCrossings()`, the crossing errors in `validateSequence()`, and
   the "Reroute to checkpoint" action. Keep the two `region_entry` validations.
3. **Repair and migration.** Reduce `reroute_illegal_crossings()` to the
   duplicate-target collapse it still needs to perform (normalize in repair mode
   + report what was collapsed); delete the `moves` map, the agent-`routing`
   remap, and the displaced-transition drop. `repair_stage_regions()` and the
   2.19.0 replay keep calling the reduced function.
4. **Assignment.** Delete the `invalid_region_crossing_stage` branch in
   `assign_sequence()`; the capability gate immediately below it stays and is
   the real check.
5. **Docs.** `AGENTS.md` and [content-hierarchy](../shipped/content-hierarchy.md)
   both state that a region's entry stage "is the only door into it, in either
   direction" and that a crossing transition must target the checkpoint. Both
   sentences must be rewritten to describe `region_entry` as the reseat/assignment
   landing spot. The sequence editor documentation must describe the same canvas
   rule and repair action.
6. **Tests.** Delete `SequenceRegionRepairTest` and the crossing cases in the
   PHPUnit and JS suites; keep and extend the `region_entry` presence/uniqueness
   coverage. Add a case asserting a mid-region cross-region transition writes the
   target region's status and seats the named stage — the behavior the runtime
   already has and nothing currently tests.

### Migration and data

No data migration is needed — the change only widens what is accepted, so every
stored row remains valid. Two notes:

- **2.19.0's rewrites are not undone.** Any install that has already upgraded had
  its crossing edges repointed at checkpoints, and any transition dropped in that
  process is gone. Authors can redraw them once the rule is lifted, but the
  original shape is not recoverable and the release notes should say so.
- **Demo and fixture sequences** (`docs/demos/multimedia-sequence.json`,
  `vip-workflow/tests/fixtures/ai-copy-desk-workflow.json`) were authored around
  the rule. `multimedia-sequence.json`'s `rights → desk` edge can be restored to
  its intended target.

## Risks and what would change the answer

- **If region-level entry effects become load-bearing** — an operator relying on
  "everything entering pending runs this agent" — the region-scoped entered event
  moves from follow-up to prerequisite.
- **If a future feature needs a guaranteed choke point per region** (an approval
  gate the workflow itself enforces, not the author), that is a gate on the
  *effect*, expressed in the same currency as stage permissions — not a
  constraint on where edges may point. Rebuilding the crossing rule would be the
  wrong shape for it.
- **Parallel stages** assume free targeting within a region; opening crossings
  is neutral-to-helpful there, since a parallel lane in another region becomes
  directly addressable.

## Open questions

1. **Does `canEnter()` survive as a function?** With the region branch gone it is
   a target-exists check that four of its six call sites already need for other
   reasons. Decide at implementation time whether keeping the name aids
   readability or just preserves a dead abstraction.
2. **Does the border slot keep its current visual weight?** The checkpoint is
   drawn docked on the region boundary because it was the door. As a
   "core lands here" marker it is still worth showing, but possibly quieter. A
   canvas call, not a model one.
3. **Region-scoped entered event: shape and naming.** `vip_workflow_entered_region_{region}`
   fired from `dispatch_stage_change()` when `from_region !== to_region`, with
   the same `$context` payload — or a single `vip_workflow_region_changed` with
   both regions as arguments. Settle when it is built, not here.

## Code entry points

- `vip-workflow/includes/sequences/class-sequence.php` — `illegal_crossings()`,
  `reroute_illegal_crossings()`, `prepare_config_for_write()`, `normalize_stages()`,
  `get_region_entry_stage()`
- `vip-workflow/includes/workflow/class-status-manager.php` — `transition()`
  (already unconstrained), `assign_sequence()`, `resolve_reseat_stage()`,
  `dispatch_stage_change()`, `current_user_can_cross_region()`
- `vip-workflow/includes/sequences/class-sequence-repository.php` —
  `repair_stage_regions()`
- `vip-workflow/includes/database/class-schema.php` — `replay_stored_stage_configs()`
- `vip-workflow/src/admin/components/graph/graph-model.js` — `canEnter()`,
  `illegalCrossings()`, `rerouteIllegalCrossings()`, `validateSequence()`,
  `regionEntryStage()`
- `vip-workflow/src/admin/components/graph/SequenceGraphEditor.js` — the repair
  action and the two connection validators
