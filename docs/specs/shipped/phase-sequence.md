---
status: shipped
version: 1.0
last_updated: 2026-04-22
related:
  - shipped/content-hierarchy.md
---

# Phase Sequence

Add a Phase Sequence type that defines transitions between content lifecycle phases (Ideation, Editorial), with configurable tools, roles, and notifications on each transition. Ships as a tab in the Sequences admin page.

> **Note:** This spec was written when the lifecycle included a Pitch phase. The Pitch subsystem has since been removed; the only phase transition today is Ideation → Editorial. References to a "Pitch" phase / "Create Pitch" transition below are historical.

## Motivation

Today the content lifecycle has three distinct phases (Ideation, Pitch, Editorial), each managed by its own system. But the transitions between phases have no configurable gates. Any user can move from Ideation to Pitch or create a draft with no tool checks, role restrictions, or notifications. The Phase Sequence fills this gap without duplicating internal phase logic.

## Data Model

New sequence `type: 'phase'` stored in the existing `wp_vip_sequences` table. Identical row structure to workflow/pitch sequences, just a different type. One Phase Sequence is seeded by default. The data model supports multiple for future extensibility, but the UI does not expose a "+ New" button.

**Config shape:**

```json
{
  "phases": [
    {
      "key": "ideation",
      "label": "Ideation",
      "transitions": [
        {
          "to": "pitch",
          "label": "Create Pitch",
          "required_tools": ["editorial-alignment"],
          "allowed_roles": ["editor", "author"],
          "notifications": ["ntfy-editorial"]
        },
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
      "key": "pitch",
      "label": "Pitch",
      "transitions": []
    },
    {
      "key": "editorial",
      "label": "Editorial",
      "transitions": []
    }
  ]
}
```

Phases are fixed (no add/remove). Only Ideation has meaningful transitions today. Pitch and Editorial appear as read-only phase cards noting that their internal workflows are managed by their respective sequences.

Transitions are add/remove, not toggle. The default seeded sequence ships with both Ideation transitions pre-added (Create Pitch, Create Draft) with empty tools/roles/notifications. An admin can remove either and re-add it later.

## Backend Changes

### Seeder (`class-seeder.php`)
Seed a default Phase Sequence (`type: 'phase'`) with all three phases and both Ideation transitions, no tools/roles/notifications configured.

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
- In `create_pitch()`: load active phase sequence, check role is allowed, then execute configured transition tools against the ideation project. On tool failure, return `tool_check_failed` error with `hard_failures` / `soft_warnings` (same error shape as editorial transitions in `StatusManager::run_transition_tools()`). On role failure or missing transition, return `403`.
- In `create_draft()`: same check for the `ideation` to `editorial` transition.
- Expose enabled transitions and button labels via the existing localized data (`vipWorkflowIdeation`) so the frontend knows which buttons to render without an extra API call.

## Frontend Changes

### Sequences List (`SequencesList.js`)
Add a third tab: "Phase Sequences". Phase tab shows the phase sequence card(s). No "+ New Phase Sequence" button.

### Phase Sequence Editor (new: `PhaseSequenceEditor.js`)
Renders three phase cards in a vertical layout (Ideation, Pitch, Editorial), visually connected to show the pipeline flow.

**Ideation card** is expandable and shows its transitions. Transitions can be removed and re-added:
- Each transition has: target phase (read-only label), button label (text input), required tools (checkboxes), allowed roles (checkboxes, empty = all), notifications (checkboxes).
- An "Add Transition" button appears when fewer than two transitions exist. Clicking shows a dropdown of available targets (Pitch, Editorial) minus any already present. When both are present, the button disappears.
- "Remove Transition" button on each transition (same pattern as workflow/pitch editors).

**Pitch card**: read-only, shows "Managed by Pitch Sequences" with a link to the Pitch Sequences tab.

**Editorial card**: read-only, shows "Managed by Editorial Sequences" with a link to the Editorial Sequences tab. (Note: editorial sequences use `type: 'workflow'` internally.)

Save button persists config via the existing sequence REST endpoint.

### Sequences Page Router (`Sequences.js`)
Add hash route `#/edit-phase/{id}` that renders `PhaseSequenceEditor`.

### Ideation Workspace (`IdeationWorkspace.js`)
Replaces the current hardcoded "Create Pitch" / "Create Draft" buttons with a data-driven approach:

- **Button rendering**: read phase transitions from localized data. Only render buttons for transitions that exist in the config. Button text comes from `transition.label`.
- **On click**: call `create-pitch` or `create-draft` as today. The server runs the configured transition tools fresh against the ideation project (same pattern as `StatusManager::run_transition_tools()`). If the server returns `tool_check_failed`, display a Tool Results Modal showing hard failures and soft warnings (same markup as `WorkflowStatusPanel.js`). Hard failures block; soft warnings allow the user to proceed after acknowledgement.
- **On success**: continue to pitch creation or draft creation as today (no change to the happy path).

## What This Does NOT Change

- Pitch and Editorial sequences remain unchanged. They manage their own internal status graphs.
- The Phase Sequence does not replace or duplicate any existing sequence logic.
- No new database tables. Uses the existing sequences table with `type = 'phase'`.

## Differences From Editorial/Pitch Sequence Editors

| Area | Editorial (`type: 'workflow'`) / Pitch | Phase |
|------|-----------------|-------|
| Statuses/phases | Add, remove, reorder | Fixed (Ideation, Pitch, Editorial) |
| Transition targets | Any status in the sequence | Fixed set: Pitch and Editorial |
| Transition fields | to, label, input, requires_assignment, required_tools, allowed_roles, show_in_queue, notifications | to, label, required_tools, allowed_roles, notifications |
| New sequence button | Yes, per tab | No (singleton for now) |
| Delete sequence | Danger Zone in editor | Danger Zone in editor |
