# Sequence Schema Reference

Derived from `vip-workflows/includes/sequences/class-sequence.php` (the write gate), `vip-workflows/includes/api/class-sequences-controller.php`, and `vip-workflows/includes/abilities/tools/create-sequence.php` (v0.0.4). Keep in sync when those change.

A **sequence** is the JSON definition of a workflow: its stages, the transitions between them, the tools and roles each transition requires, the inputs a transition captures, and the metadata fields the workflow adds to a post. This page is the field-by-field reference for authoring one by hand — for the end-to-end task, follow [Authoring a sequence without the UI](../guides/authoring-a-sequence-without-the-ui.md); for endpoints and permissions see [quick-reference.md](quick-reference.md#key-rest-endpoints).

## The two shapes

The same config travels in two envelopes. Use the one the channel expects.

| Shape | Envelope | Used by | Example |
| --- | --- | --- | --- |
| **FLAT** | `name` and `statuses` at the top level (plus `post_types`, `settings`, `metadata_fields`) | `POST /sequences`, the `vip-workflows/create-sequence` ability | [`editorial-review.flat.json`](../examples/editorial-review.flat.json) |
| **WRAPPED** | `{ "type", "name", "description", "config": { "statuses", ... } }` | `POST /sequences/import`, the `vip-workflows/import-sequence` ability; the shape `GET /sequences/{id}/export` emits | [`editorial-review.wrapped.json`](../examples/editorial-review.wrapped.json) |

The `statuses` / `post_types` / `settings` / `metadata_fields` payload is **identical** in both; only the envelope differs. Feeding a WRAPPED body to create, or a FLAT body to import, fails. A minimal, valid FLAT starter lives at [`includes/sequences/templates/editorial-basic.json`](../../vip-workflows/includes/sequences/templates/editorial-basic.json).

## Top-level fields (FLAT) / envelope fields (WRAPPED)

| Field | Required | Notes |
| --- | --- | --- |
| `name` | yes | The sequence name. |
| `type` | — | `"workflow"` (default) or `"phase"`. Phase sequences carry a `phases` graph, not `statuses`, and are exempt from the stage rules below. |
| `description` | — | Free text. |
| `status` | — (FLAT create only) | Lifecycle: `"active"` (default) or `"draft"`. Import always creates a draft regardless. |
| `post_types` | — | Array of post-type slugs the sequence attaches to, e.g. `["post"]`. Discover eligible types with `GET /sequences/options`. |
| `settings` | — | Object, e.g. `{ "allow_skip": false }`. |
| `statuses` | yes | The stages, in order. See below. |
| `metadata_fields` | — | Workflow metadata fields. See below. |
| `version` | — | Config version string (`"2.0"`); WRAPPED files carry it under `config`. |

## Stage object (`statuses[]`)

| Field | Required | Notes |
| --- | --- | --- |
| `key` | yes | Machine key, `sanitize_key`'d, non-empty, unique across the sequence. |
| `label` | yes | Human-readable stage name. |
| `status` | — | The core **status region** this stage lives in (see below). Defaults to `draft`; a value outside the four regions is rejected. |
| `region_entry` | — | Boolean; marks this stage as its region's entry checkpoint (see below). |
| `color` | — | Hex color for the stage. |
| `is_terminal` / `is_initial` / `is_dead_end` / `is_in_progress` | — | Booleans that flag the stage for the UI and queries. |
| `transitions` | — | The moves out of this stage. See below. |

### The status-region model (the part that trips authors up)

The workflow **stage** is stored in post meta and is decoupled from WordPress's `post_status`. Each stage declares which core status **region** it belongs to in its `status` field — one of:

- `draft`, `pending`, `private`, `publish`

This is where WordPress keeps the post's publish status while it sits at that stage. An absent `status` defaults to `draft`; a value outside the four is **rejected** by the write gate (it is not silently coerced).

Every **region you use** needs exactly **one** stage with `region_entry: true` — the checkpoint where a change that comes from *outside* the workflow (the core Publish button, a scheduled publish, an assignment that names no stage) re-seats the post. Rules the gate enforces:

- **At most one** `region_entry` per region — declaring two in the same region is rejected.
- If a region names **none**, the first stage in that region (config order) is auto-marked as the entry.
- `region_entry` does **not** constrain transition targets — any transition may point at any defined stage.

In the canonical example the `draft` region's entry is the `draft` stage and the `publish` region's entry is the `publish` stage.

## Transitions (`transitions[]`)

| Field | Required | Notes |
| --- | --- | --- |
| `to` | yes | The target stage `key`. Must be a **defined** stage — a dangling target is rejected. At most one transition per target (a duplicate is rejected on write). |
| `label` | — | The button/label for the move. |
| `required_tools` | — | Array of ability IDs (e.g. `["vip-workflows/readability"]`) that must pass before the move is allowed. Not validated against registered abilities at write time — an unregistered id simply makes the transition un-passable. |
| `allowed_roles` | — | Array of role slugs permitted to make this move. Omit to allow anyone who can edit the post. |
| `inputs` | — | Values the transition captures. See below. |

### Transition inputs and assignments (`inputs[]`)

A transition may capture inputs; at most **one** may be an assignment:

```json
{ "type": "assignment", "meta_key": "reviewer", "assignee_type": "user", "label": "Assign a reviewer" }
```

- `meta_key` must be **unique across the whole sequence**. Import regenerates these keys, so a hand-authored `meta_key` survives create but is replaced on import.
- `assignee_type` is `user`, `role`, or an extension-registered type.
- The legacy singular `input` key is refused alongside `inputs`; use `inputs` (plural).

## Metadata fields (`metadata_fields[]`)

| Field | Required | Notes |
| --- | --- | --- |
| `key` | yes | Matches `^[a-z0-9_]+$` (camelCase or hyphens are rejected). Stored as `wf_meta_{sequence_id}_{key}`. |
| `label` | yes | Field label. |
| `type` | yes | One of `text`, `textarea`, `select`, `date`, `user`. Any other value is rejected. |
| `options` | for `select` | A `select` field needs a non-empty `options[]`. |
| `required` | — | A required field is enforced **only** on transitions that cross *into* the `publish` region. |
| `searchable` | — | Whether the field is searchable in the queue. |

## Agent stage (`agent`)

An AI-owned stage carries an `agent` block:

```json
"agent": { "ability_id": "workflow-agent-copy-edit/copy-edit", "settings": {}, "routing": { "pass": "ready", "fail": "review", "error": "review" } }
```

- `ability_id` must be a registered, stage-eligible ability.
- Every `routing` target (`pass` / `fail` / `error`) must be a `to` of that stage's own transitions.

Agent stages are validated by the REST/ability path, not by the bare write gate, so validate an agent sequence with `vip-workflows/validate-sequence` before creating it. See [`create-agent`](../../vip-workflows/skills/create-agent/SKILL.md) and the [`ai-copy-desk-workflow.json`](../../vip-workflows/tests/fixtures/ai-copy-desk-workflow.json) fixture.

## Lifecycle

- **Create** (`POST /sequences`, `create-sequence`) defaults the sequence to **active**. Pass `status: "draft"` to stage it.
- **Import** (`POST /sequences/import`, `import-sequence`) always creates a **draft** — call `vip-workflows/activate-sequence` (`active: true`) to make it live. Activation is refused if the stored config is invalid.
- **Update** (`PUT /sequences/{id}`, `update-sequence`) is a **full replacement** — any field you omit is cleared. Read/validate the stored config first.
- **Validate** (`vip-workflows/validate-sequence`) is a read-only dry run of the exact write gate; it reports what is wrong plus the normalized result. Fix everything it lists and re-run until valid.

Writes (create/update/import/activate) require `manage_options`; `export`, `options`, and `stats` require only `edit_posts`.
