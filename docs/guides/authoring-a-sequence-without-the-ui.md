# Authoring a Sequence Without the UI

This guide builds a simple **Draft -> Review -> Published** workflow and makes it live, entirely through the REST API (or `wp eval-file`) — no graph editor. For the field-by-field reference behind every value here, see [sequence-schema.md](../reference/sequence-schema.md); for an agent doing this over MCP, the [`create-vip-workflows-sequence`](../../vip-workflows/skills/create-sequence/SKILL.md) skill covers the same ground.

## Prerequisites

- A user with `manage_options`. Create, import, activate, and the validate dry run all require it. Only the reads — `export`, `options`, `stats` — need just `edit_posts`.
- A way to make authenticated REST calls. The examples use an [application password](https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/) with HTTP Basic auth (`-u "$USER:$APP_PASSWORD"`), which works from any shell. A logged-in cookie plus an `X-WP-Nonce` header works too, but only with the cookie sent alongside it.

```bash
SITE=https://example.test
USER=admin
APP_PASSWORD='xxxx xxxx xxxx xxxx xxxx xxxx'
```

## 1. Write the JSON

Start from the canonical starter [`includes/sequences/templates/editorial-basic.json`](../../vip-workflows/includes/sequences/templates/editorial-basic.json) and adapt it. It is the **FLAT** shape (top-level `name` + `statuses`), and this is the file exactly:

```json
{
	"name": "Editorial Basic",
	"type": "workflow",
	"post_types": [ "post" ],
	"settings": {
		"allow_skip": false
	},
	"statuses": [
		{
			"key": "draft",
			"label": "Draft",
			"status": "draft",
			"region_entry": true,
			"transitions": [
				{ "to": "review", "label": "Submit for review" }
			]
		},
		{
			"key": "review",
			"label": "In review",
			"status": "draft",
			"transitions": [
				{ "to": "published", "label": "Approve" },
				{ "to": "draft", "label": "Request changes" }
			]
		},
		{
			"key": "published",
			"label": "Published",
			"status": "publish",
			"region_entry": true,
			"is_terminal": true,
			"transitions": []
		}
	],
	"metadata_fields": [
		{
			"key": "seo_focus_keyword",
			"label": "SEO focus keyword",
			"type": "text",
			"required": false,
			"searchable": true
		}
	]
}
```

Two things to get right (see the [region model](../reference/sequence-schema.md#the-status-region-model-the-part-that-trips-authors-up)): every stage declares a `status` region (`draft` / `pending` / `private` / `publish`), and each region you use has exactly one `region_entry` stage. Here the `draft` region (draft, review) enters at `draft`, and the `publish` region (published) enters at `published`.

## 2. See what it can attach to

```bash
curl -s -u "$USER:$APP_PASSWORD" "$SITE/wp-json/vip-workflows/v1/sequences/options"
```

The `post_types` array lists the post types a sequence may target.

## 3. Dry-run it

Validate before you write. The `vip-workflows/validate-sequence` ability is a read-only dry run of the exact write gate. Run it through the plugin's ability route, passing the ability's input under `options`:

```bash
curl -s -u "$USER:$APP_PASSWORD" -H 'Content-Type: application/json' \
  -X POST "$SITE/wp-json/vip-workflows/v1/abilities/vip-workflows/validate-sequence/run" \
  -d '{"options":{"config":{"statuses":[ ... ]}}}'
```

The response wraps the ability's result: read `output.valid`, `output.errors[]` (fix everything it lists), and `output.normalization[]` (defaulted regions, auto-assigned entry checkpoints, normalized keys). Re-run until `output.valid` is true. If the run itself was refused — a malformed request rather than a bad config — the response carries `success: false` and an `error` message instead, with no `output`.

> The core `wp-abilities/v1` run route does not expose these abilities (they are not registered with `show_in_rest`), so use the plugin route above, MCP, or `wp eval-file`.

## 4. Create it

Two routes, depending on the shape you have.

**FLAT — create (defaults to active):**

```bash
curl -s -u "$USER:$APP_PASSWORD" -H 'Content-Type: application/json' \
  -X POST "$SITE/wp-json/vip-workflows/v1/sequences" \
  --data @editorial-basic.json
```

Add `"status": "draft"` to the body to stage it instead of going live immediately.

**WRAPPED — import (always creates a draft):**

The import route takes the WRAPPED envelope (`{type, name, description, config}` — the document `GET /sequences/{id}/export` emits) as the value of a `sequence_json` parameter, not as the body itself:

```bash
curl -s -u "$USER:$APP_PASSWORD" -H 'Content-Type: application/json' \
  -X POST "$SITE/wp-json/vip-workflows/v1/sequences/import" \
  -d '{"sequence_json": <the WRAPPED envelope> }'
```

**WP-CLI:** there is no dedicated `wp vip-workflows sequence` command; use `wp eval-file`. See [`vip-workflows/tests/fixtures/import-ai-copy-desk.php`](../../vip-workflows/tests/fixtures/import-ai-copy-desk.php) for a working recipe that imports a WRAPPED file and activates it.

## 5. Activate it (import path only)

Import lands as a **draft**. Make it live with the `vip-workflows/activate-sequence` ability, through the same plugin route:

```bash
curl -s -u "$USER:$APP_PASSWORD" -H 'Content-Type: application/json' \
  -X POST "$SITE/wp-json/vip-workflows/v1/abilities/vip-workflows/activate-sequence/run" \
  -d '{"options":{"sequence_id": 123, "active": true}}'
```

Activation is refused if the stored config is invalid.

## 6. Verify

- `GET /sequences/{id}` — confirm the stored config.
- Open a post of an attached post type — the Draft / Review / Published stages appear in the editor.
- `GET /sequences/{id}/stats` — per-stage counts.

## Next steps

The starter has no role gates, tools, assignments, or agents, and a single metadata field. Add more from the [schema reference](../reference/sequence-schema.md): `required_tools` and `allowed_roles` on transitions, an `inputs` assignment to route work to a reviewer, further `metadata_fields`, and an `agent` block for an AI-owned stage. A larger, valid example lives at [`docs/examples/editorial-review.flat.json`](../examples/editorial-review.flat.json).

> **Updating a sequence is a full replacement** (`PUT /sequences/{id}` / `update-sequence`): any field you omit is cleared. Read and validate the stored config first.
