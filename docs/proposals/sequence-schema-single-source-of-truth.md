---
status: proposed
version: 0.1
last_updated: 2026-09-23
related:
  - ../reference/architecture.md
---

# RFC: A single source of truth for the sequence schema

> **This is a draft for discussion, not an agreed plan.** It describes a problem,
> proposes a shared fix, and leaves one product decision open. Add review
> comments on the sections you have an opinion on, especially the open decision
> in [Section 5](#5-the-open-decision-flat-vs-wrapped). Nothing here is built
> yet. When the decision is settled, this document becomes the plan of record.

## 1. Summary

A sequence configuration (its stages, transitions, metadata fields, and
transition inputs) is described by a JSON Schema in several places at once. Each
copy is written and maintained by hand. They agree today by luck, not by
construction, and one has already drifted into describing nothing at all. None
of them mirrors the code that actually accepts or rejects a configuration, so a
schema can advertise a shape the write gate would reject, and reject a shape the
gate would accept.

This RFC proposes one builder, `SequenceSchema`, that every entry point calls,
plus a committed `sequence.schema.json` artifact and a test that fails when the
two drift apart. That part is mechanical and low risk.

It leaves one decision open: whether to also reconcile the two public request
shapes (FLAT and WRAPPED) into one, or keep them separate and share only their
common core.

## 2. The problem: the schema is defined many times by hand

The same stage schema is declared independently in four places.

| Where | Location | Shape it declares | Detail |
| --- | --- | --- | --- |
| `create-sequence` ability | `vip-workflows/includes/abilities/tools/create-sequence.php` (input_schema) | FLAT | Full stage schema, `additionalProperties: false`, requires `name` + `statuses`. |
| `update-sequence` ability | `vip-workflows/includes/abilities/tools/update-sequence.php` (input_schema) | FLAT | Full stage schema, near-identical to create. |
| `POST /sequences` REST args | `vip-workflows/includes/api/class-sequences-controller.php` (`get_create_args()`) | FLAT | Full stage schema again, hand-copied for the REST route. |
| `validate-sequence` ability | `vip-workflows/includes/abilities/tools/validate-sequence.php` (input_schema) | (opaque) | Takes `config` as a bare `type: object`. It describes no stage fields at all. |

A fifth surface, the WRAPPED import path in the controller, does not declare a
schema. It validates `name` and `config.statuses` with imperative checks
(`empty()` tests plus the agent and assignment validators).

Two facts make this fragile:

- **The three full copies agree today only because someone kept them in sync by
  hand.** Nothing enforces it. Add a stage field to one and the other two go
  stale silently. There is no test that compares them.
- **`validate-sequence` has already stopped describing the shape.** It accepts an
  opaque object and leans entirely on the write gate. That is a reasonable choice
  for a dry-run tool, but it means the one endpoint whose whole job is to explain
  what is valid tells a caller nothing up front.

### The schemas are not the real authority

The code that truly decides whether a configuration is accepted is the write
gate: `Sequence::prepare_config_for_write()` and the `normalize_stages()` it
calls (`vip-workflows/includes/sequences/class-sequence.php`). That method holds
around a dozen throw sites and the region-entry invariants (each used status
region needs exactly one `region_entry`). None of the four schemas expresses
those rules. So the declared schemas and the enforced rules can disagree in both
directions:

- A configuration can pass the JSON Schema and still be rejected by the gate (for
  example, two `region_entry` markers in one region).
- A configuration the gate would accept can be described as invalid by a stale
  schema copy.

## 3. Why it matters

The declared `input_schema` is the contract an agent or a human reads to author a
sequence without the UI. Recent work added a schema reference, an authoring
walkthrough, a starter template, and a create-sequence skill (see the sibling
docs under `docs/reference/` and `docs/guides/`, and the examples under
`docs/examples/`). All of that teaches people to trust the declared schema. If
the schema drifts, those guides teach a shape the code no longer accepts, and the
failure lands on the author as a confusing write-gate error.

The cost of drift is highest exactly where we are trying to make authoring
easier: for agents and for humans who never open the UI.

## 4. The proposed fix (common to every option)

Introduce one builder and one artifact, wire every surface to it, and guard it
with a test.

### 4.1 A `SequenceSchema` builder

Add `vip-workflows/includes/sequences/class-sequence-schema.php`. It owns the
shape and nothing else. Suggested surface:

- `stage_schema()` — one stage object (key, label, flags, `status`,
  `region_entry`, `transitions`, `metadata_fields`).
- `transition_schema()` — one transition (`to`, `label`, `required_tools`,
  `allowed_roles`, `notifications`, assignment input).
- `metadata_field_schema()` and `create_input_schema()` — the remaining nested
  shapes.
- `rest_create_args()` — the same shape adapted to the WordPress REST `args`
  format for `get_create_args()`.
- `to_json_schema()` — a plain JSON Schema document for export and tooling.

Enums come from the existing constants, not fresh literals:
`Sequence::EDITORIAL_STATUSES` for the status region, and
`Sequence::TYPE_WORKFLOW` / `Sequence::TYPE_PHASE` for the type. The builder
describes structure only. The write gate stays the single authority on the
cross-field rules (regions, reachability, terminal stages); the schema should not
try to duplicate those.

### 4.2 The four copies become one call

- `create-sequence` input_schema -> `SequenceSchema::create_input_schema()`.
- `update-sequence` input_schema -> the same core.
- `get_create_args()` -> `SequenceSchema::rest_create_args()`.
- `validate-sequence` -> can keep accepting an opaque `config`, but should
  reference the shared shape in its description so callers have one place to look.

### 4.3 A committed artifact and a drift guard

- Commit `vip-workflows/schemas/sequence.schema.json`, generated from
  `SequenceSchema::to_json_schema()`. It gives external tools and editors a real
  JSON Schema to validate against.
- Add a unit test that rebuilds the schema from the class and asserts it equals
  the committed file byte for byte. If someone edits the class and forgets to
  regenerate, the test fails and tells them how to refresh it. This is the
  mechanism that makes "single source of truth" true, rather than aspirational.

This whole section changes no public contract. It is a mechanical
consolidation and can ship on its own.

## 5. The open decision: FLAT vs WRAPPED

There are two public request shapes for a sequence, and this is the part that
needs a human call.

- **FLAT**: `{ name, statuses: [...], description?, type?, status? }`. Used by
  `POST /sequences`, `create-sequence`, and `update-sequence`.
- **WRAPPED**: `{ type, name, description, config: { statuses, ... } }`. Used by
  `POST /sequences/import`, and it is the shape `/export` emits.

So today an author who exports a sequence gets WRAPPED, but if they hand a config
to `create-sequence` they must send FLAT. The two shapes are close but not
interchangeable, which is its own small trap.

### Option A: keep both shapes, share only the core

`SequenceSchema` describes the shared config core (the `statuses` array and
friends). FLAT and WRAPPED each stay as thin wrappers that embed that core in
their own envelope. No endpoint changes what it accepts.

- **Pro:** smallest change, no deprecation, no migration. Fixes the drift that
  actually bites (the stage schema) without touching any caller.
- **Con:** the FLAT-vs-WRAPPED trap survives. Export still emits a shape that
  `create` will not read. Two envelopes remain to learn.

### Option B: reconcile the two shapes

Make one shape canonical and have every endpoint accept it. Two sub-variants:

- **B1 (widen, keep both):** teach `create` / `update` to also accept WRAPPED, so
  an exported config round-trips straight back into create. FLAT stays supported.
  Additive, low breakage, but now three of the four endpoints accept two shapes,
  which is more surface, not less.
- **B2 (converge, deprecate one):** pick one shape (WRAPPED reads as the more
  future-proof envelope, since it already carries `type` and `description`
  alongside `config`), accept it everywhere, and deprecate the other over a
  release or two.

- **Pro:** one shape to learn. Export round-trips into create. The docs get
  simpler.
- **Con:** changes the create contract. Needs a deprecation window, changelog
  care, and coordination with any existing callers. Bigger blast radius.

### Option C (recommended sequencing): ship Section 4 now, decide the shape after

Options A and B both need the `SequenceSchema` builder and the drift guard from
Section 4. None of that depends on the shape decision. So build Section 4 first,
independently, and let it land. Then take the FLAT-vs-WRAPPED decision as a
separate, smaller change on top, with the shared core already in place to make
either option cheap.

This is a sequencing recommendation, not a third destination. It just says: do
not block the mechanical win on the product debate.

## 6. Non-goals

- Moving the cross-field rules (regions, reachability, terminal detection) out of
  the write gate into the schema. The gate stays the authority; the schema
  describes structure.
- Changing what a valid sequence *is*. This is about where the shape is written
  down, not about the rules themselves.
- A public, versioned external schema contract. The committed
  `sequence.schema.json` is for internal drift-guarding and tooling first; making
  it a supported public artifact is a later question.

## 7. Questions for reviewers

1. **Option A, B1, or B2?** This is the main call. If B, which shape is canonical?
2. Should `validate-sequence` keep taking an opaque `config`, or describe the
   shared core so its `input_schema` teaches the shape too?
3. Is a committed `sequence.schema.json` worth maintaining, or is the PHP builder
   plus its test enough on its own?
4. If we converge shapes (B2), what deprecation window is acceptable, and who are
   the known callers of the shape we would retire?

## 8. Proposed next steps once this settles

1. Land `SequenceSchema` + the artifact + the drift-guard test (Section 4), no
   contract change.
2. Point the four copies at the builder.
3. Take the shape decision from Section 5 as a follow-up change.
