# Authoring a Sequence Without the UI

This guide builds a simple **Draft -> Review -> Published** workflow and makes it live, entirely through the REST API (or WP-CLI) — no graph editor. For the field-by-field reference behind every value here, see [sequence-schema.md](../reference/sequence-schema.md); for an agent doing this over MCP, the [`create-vip-workflows-sequence`](../../vip-workflows/skills/create-sequence/SKILL.md) skill covers the same ground.

## Prerequisites

- A user with `manage_options` for the writes (create/import/activate). Reads — `export`, `options`, `stats` — need only `edit_posts`.
- A way to make authenticated REST calls: a logged-in cookie plus an `X-WP-Nonce`, or an application password, or `wp shell` / `wp eval-file`.

## 1. Write the JSON

Start from the canonical starter [`includes/sequences/templates/editorial-basic.json`](../../vip-workflows/includes/sequences/templates/editorial-basic.json) and adapt it. It is the **FLAT** shape (top-level `name` + `statuses`):

```json
{
	"name": "Editorial Basic",
	"post_types": ["post"],
	"statuses": [
		{ "key": "draft", "label": "Draft", "status": "draft", "region_entry": true,
		  "transitions": [ { "to": "review", "label": "Submit for review" } ] },
		{ "key": "review", "label": "In review", "status": "draft",
		  "transitions": [ { "to": "published", "label": "Approve", "allowed_roles": ["editor"] },
		                   { "to": "draft", "label": "Request changes" } ] },
		{ "key": "published", "label": "Published", "status": "publish", "region_entry": true, "is_terminal": true }
	]
}
```

Two things to get right (see the [region model](../reference/sequence-schema.md#the-status-region-model-the-part-that-trips-authors-up)): every stage declares a `status` region (`draft` / `pending` / `private` / `publish`), and each region you use has exactly one `region_entry` stage. Here `draft` (draft, review) enters at `draft`, and `publish` (published) enters at `published`.

## 2. See what it can attach to

```bash
curl -s -H "X-WP-Nonce: $NONCE" "$SITE/wp-json/vip-workflows/v1/sequences/options"
```

The `post_types` array lists the post types a sequence may target.

## 3. Dry-run it

Validate before you write. The `vip-workflows/validate-sequence` ability is a read-only dry run of the exact write gate:

```bash
curl -s -H "X-WP-Nonce: $NONCE" -H 'Content-Type: application/json' \
  -X POST "$SITE/wp-json/wp-abilities/v1/abilities/vip-workflows/validate-sequence/run" \
  -d '{"input":{"config":{"statuses":[ ... ]}}}'
```

Read `errors[]` (every category it breaks, in one pass) and `normalization[]` (defaulted regions, auto-assigned entry checkpoints). Fix everything and re-run until `valid` is true.

## 4. Create it

Two routes, depending on the shape you have.

**FLAT — create (defaults to active):**

```bash
curl -s -H "X-WP-Nonce: $NONCE" -H 'Content-Type: application/json' \
  -X POST "$SITE/wp-json/vip-workflows/v1/sequences" \
  --data @editorial-basic.json
```

Pass `"status": "draft"` in the body to stage it instead of going live immediately.

**WRAPPED — import (always creates a draft):**

```bash
curl -s -H "X-WP-Nonce: $NONCE" -H 'Content-Type: application/json' \
  -X POST "$SITE/wp-json/vip-workflows/v1/sequences/import" \
  -d '{"sequence_json": <the WRAPPED envelope> }'
```

**WP-CLI:** there is no dedicated `wp vip-workflows sequence` command; use `wp eval-file`. See [`vip-workflows/tests/fixtures/import-ai-copy-desk.php`](../../vip-workflows/tests/fixtures/import-ai-copy-desk.php) for a working recipe that imports a WRAPPED file and activates it.

## 5. Activate it (import path only)

Import lands as a **draft**. Make it live:

```bash
curl -s -H "X-WP-Nonce: $NONCE" -H 'Content-Type: application/json' \
  -X POST "$SITE/wp-json/wp-abilities/v1/abilities/vip-workflows/activate-sequence/run" \
  -d '{"input":{"sequence_id": 123, "active": true}}'
```

Activation is refused if the stored config is invalid.

## 6. Verify

- `GET /sequences/{id}` — confirm the stored config.
- Open a post of an attached post type — the Draft / Review / Published stages appear in the editor.
- `GET /sequences/{id}/stats` — per-stage counts.

## Next steps

The starter has no role gates, tools, assignments, or agents. Add them from the [schema reference](../reference/sequence-schema.md): `required_tools` and `allowed_roles` on transitions, an `inputs` assignment to route work to a reviewer, `metadata_fields` for editorial metadata, and an `agent` block for an AI-owned stage. A larger, valid example lives at [`docs/examples/editorial-review.flat.json`](../examples/editorial-review.flat.json).

> **Updating a sequence is a full replacement** (`PUT /sequences/{id}` / `update-sequence`): any field you omit is cleared. Read and validate the stored config first.
