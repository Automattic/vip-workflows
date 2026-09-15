---
status: shipped
version: 1.1
last_updated: 2026-09-11
related:
  - shipped/content-hierarchy.md
  - shipped/experiments.md
---

# Phase Sequence

Add a Phase Sequence type that defines transitions between content lifecycle phases, with configurable tools, roles, and notifications on each transition. Ships as a tab in the Sequences admin page.

> **Updated 2026-09-11:** this spec originally described a three-phase lifecycle (Ideation, Pitch, Editorial). The Pitch phase and its sequence type were removed from the codebase — there is no `pitch` sequence type, no `create_pitch()` controller method, and no Pitch tab or card anywhere in `includes/` or `src/`. The lifecycle today is two phases: **Ideation → Editorial**. This version reflects the current implementation; the original motivation (configurable gates between phases) still holds.

## Motivation

The content lifecycle has two phases (Ideation, Editorial), each managed by its own system. But the transition between them had no configurable gate: any user could create a draft from an ideation project with no tool checks, role restrictions, or notifications. The Phase Sequence fills this gap without duplicating internal phase logic.

## Data Model

Sequence `type: 'phase'` stored in the existing `wp_vip_sequences` table. Identical row structure to workflow sequences, just a different type. One Phase Sequence is seeded — as `Content Lifecycle` / slug `content-lifecycle` — when the `ideation` experiment is activated (`IdeationExperiment::activate()` calls `Seeder::seed_phase_sequence()`; see [`shipped/experiments.md`](experiments.md)), not as part of the plugin's unconditional default seed. The data model supports multiple phase sequences for future extensibility, but the UI does not expose a "+ New" button.

**Config shape** (the actual default seed, from `class-seeder.php`):

```json
{
  "phases": [
    {
      "key": "ideation",
      "label": "Ideation",
      "transitions": [
        {
          "to": "editorial",
          "label": "Create Draft",
          "required_tools": [],
          "allowed_roles": [],
          "notifications": []
        }
      ]
    },
    {
      "key": "editorial",
      "label": "Editorial",
      "transitions": []
    }
  ]
}
```

Phases are fixed (no add/remove). Only Ideation has a meaningful transition today. Editorial appears as a read-only phase card noting that its internal workflow is managed by its own (`type: 'workflow'`) sequence.

Transitions are add/remove, not toggle. The default seeded sequence ships with the Ideation → Editorial transition pre-added, with empty tools/roles/notifications. An admin can remove it and re-add it later — with only one possible target (Editorial), there is nothing to choose between.

## Backend Changes

### Seeder (`class-seeder.php`)
`seed_phase_sequence()` seeds the default Phase Sequence (`type: 'phase'`) with both phases and the one Ideation → Editorial transition, no tools/roles/notifications configured. Called from `IdeationExperiment::activate()`, not from the plugin's general install/activation seed.

### Sequence Model (`class-sequence.php`)
- `get_phases()`: accessor for `config['phases']`.
- `get_phase_transition($from_phase, $to_phase)`: returns the transition config or null.
- `is_phase_transition_allowed($from_phase, $to_phase, $user_id)`: checks whether the transition exists and the user's role is allowed. Tool execution happens separately in the controller at transition time.

### Sequence Repository (`class-sequence-repository.php`)
- `get_phase_sequences()`: filters by `type = 'phase'`.
- `get_active_phase_sequence()`: returns first active phase sequence.

### Sequences REST Controller (`class-sequences-controller.php`)
Extend save/update sanitization for `type: 'phase'` configs. Sanitize `phases[].transitions[]` with the same pattern used for workflow transitions: `required_tools`, `allowed_roles`, `notifications`.

### Ideation Controller (`class-ideation-controller.php`)
- In `create_draft()`: load the active phase sequence, check the Ideation → Editorial transition's role is allowed, then execute its configured tools against the ideation project. On tool failure, return `tool_check_failed` error with `hard_failures` / `soft_warnings` (same error shape as editorial transitions in `StatusManager::run_transition_tools()`). On role failure or missing transition, return `403`.
- Expose the enabled transition and its button label via the existing localized data (`vipWorkflowsIdeation`) so the frontend knows whether to render the "Create Draft" button without an extra API call.

## Frontend Changes

### Sequences List (`SequencesList.js`)
A third tab: "Phase Sequences". The Phase tab shows the phase sequence card(s). No "+ New Phase Sequence" button.

### Phase Sequence Editor (`PhaseStageInspector.js`, part of `src/admin/components/graph/`)
Renders the two phase cards, visually connected to show the pipeline flow.

**Ideation card** is expandable and shows its one transition:
- Target phase (read-only label — the only possible target is Editorial), button label (text input), required tools (checkboxes), allowed roles (checkboxes, empty = all), notifications (checkboxes).
- An "Add Transition" button appears when the transition has been removed; clicking re-adds it targeting Editorial. It disappears once the transition exists, since there is no second target to offer.
- "Remove Transition" button (same pattern as workflow sequence editors).

**Editorial card**: read-only, shows "Managed by Editorial Sequences" with a link to the Editorial (Workflow) Sequences tab. (Editorial sequences use `type: 'workflow'` internally.)

Save button persists config via the existing sequence REST endpoint.

### Sequences Page Router
The graph editor's `mode` prop serves phase sequences the same canvas used for workflow sequences (see [quick-reference.md § Sequence (Sequence) Graph Editor](../../reference/quick-reference.md)).

### Ideation Workspace (`IdeationWorkspace.js`)
Data-driven "Create Draft" button:

- **Button rendering**: read the phase transition from localized data. Render the button only if the transition exists in the config. Button text comes from `transition.label`.
- **On click**: call `create-draft` as today. The server runs the configured transition tools fresh against the ideation project (same pattern as `StatusManager::run_transition_tools()`). If the server returns `tool_check_failed`, display a Tool Results Modal showing hard failures and soft warnings (same markup as `WorkflowStatusPanel.js`). Hard failures block; soft warnings allow the user to proceed after acknowledgement.
- **On success**: continue to draft creation as today (no change to the happy path).

## What This Does NOT Change

- Editorial sequences remain unchanged. They manage their own internal status graphs.
- The Phase Sequence does not replace or duplicate any existing sequence logic.
- No new database tables. Uses the existing sequences table with `type = 'phase'`.

## Differences From the Editorial (Workflow) Sequence Editor

| Area | Editorial (`type: 'workflow'`) | Phase |
|------|-----------------|-------|
| Statuses/phases | Add, remove, reorder | Fixed (Ideation, Editorial) |
| Transition targets | Any status in the sequence | Fixed: Editorial only |
| Transition fields | to, label, input, requires_assignment, required_tools, allowed_roles, show_in_queue, notifications | to, label, required_tools, allowed_roles, notifications |
| New sequence button | Yes, per tab | No (singleton for now) |
| Delete sequence | Danger Zone in editor | Danger Zone in editor |
| Seeded | On plugin install | On `ideation` experiment activation |
