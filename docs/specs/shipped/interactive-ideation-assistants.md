---
status: shipped
version: 0.1
last_updated: 2026-03-20
related:
  - active/story-ideation.md
  - active/ideation-system.md
  - shipped/extensible-research-agents.md
---

# Interactive Ideation Assistants

---

## Problem

The current workspace runs all assistants once on seed submission, dumps cards on a flat page, and stops. There is no ongoing interaction, no way to direct assistants, and no sense of a team working for you. The spec envisions "a team of assistants pinning related material around the journalist's idea" with continuous dialogue.

---

## Architecture: One System, Three Entry Points

All four priorities funnel through a single new capability: **follow-up queries**. A follow-up query runs a single assistant with a custom search term and appends results to the workspace.

Three entry points trigger the same flow:

1. **Panel text input** - journalist types "find more on the EU angle"
2. **"Find similar" on cards** - auto-generates a query from the card's context
3. **Mentor suggestion click** - pre-built query from the mentor's structured output

```
Panel input / Card action / Mentor suggestion
            |
    POST /ideation/{id}/query { query, assistant }
            |
    Orchestrator.run_query()
            |
    Single assistant runs with custom query
            |
    New cards stored + query logged
            |
    Frontend: cards animate in, panel updates, mentor re-evaluates
```

---

## Piece 1: Follow-up Query Backend

**Files:** `class-ideation-orchestrator.php`, `class-ideation-controller.php`

- New `run_query(int $project_id, string $assistant_id, string $query): AssistantResult` on `IdeationOrchestrator`
  - Loads seed + seed_analysis from meta
  - Builds context with `query` key set to the custom search term
  - Instantiates and runs the single specified assistant
  - Stores resulting cards via existing `store_cards_as_sources()`
  - Logs the query to `_vip_ideation_query_log` post meta

- New post meta `_vip_ideation_query_log`: JSON array of entries:
  ```php
  [ 'id' => wp_generate_password(8), 'query' => '...', 'assistant' => 'web-researcher', 'card_count' => 4, 'timestamp' => '2026-03-19 14:30:00' ]
  ```

- New REST route: `POST /ideation/{id}/query` accepting `{ query: string, assistant: string }`
  - Validates assistant ID against known assistants
  - Returns the updated state (so frontend gets new cards immediately)

- Update `get_state()` to include `query_log` in the response

**Assistant changes** (minimal, no interface change needed):

- `WebResearcher`: if `$context['query']` is set, use it as the sole search query instead of `$seed_analysis['search_queries']`
- `MediaScout`: if `$context['query']` is set, use it as the search term for image/video providers
- `ArchiveScout`: if `$context['query']` is set, use it as the search term

---

## Piece 2: Proactive Mentor with Suggestions

**Files:** `class-editorial-mentor.php`, `AssistantPanel.js`, `use-mentor.js`

- Update the mentor prompt to return structured `suggestions`:
  ```json
  {
    "guidance": "Strong angle on coffee prices...",
    "readiness": "developing",
    "suggestions": [
      { "label": "Search for commodity analyst opinions", "assistant": "web-researcher", "query": "coffee commodity analyst forecast" },
      { "label": "Find photos of frost damage", "assistant": "media-scout", "query": "Brazil coffee frost damage" }
    ]
  }
  ```

- Prompt instructions: generate 1-3 suggestions based on what's missing. Each suggestion names a specific assistant and provides a ready-to-execute query.
- `use-mentor.js`: parse and expose `suggestions` from the result object.
- `AssistantPanel.js`: render suggestions as styled clickable buttons below the guidance text. Clicking one calls `onRunQuery(assistant, query)`.

---

## Piece 3: "Find Similar" on Cards

**Files:** `shared.js`, `ArticleCard.js`, `ImageCard.js`

- Add a "Find similar" action to `CardActions` (available when `onFindSimilar` prop is provided)
- When clicked, auto-generate a query from the card's context:
  - For articles: title + domain keywords
  - For images: title/description + "similar images"
  - For videos: title + channel context
- Auto-select the best assistant: `web-researcher` for articles, `media-scout` for images/videos
- Call `onFindSimilar(assistantId, generatedQuery)` which flows through `IdeationWorkspace` to the same query endpoint

---

## Piece 4: Live Activity Feel

**Files:** `AssistantPanel.js`, `IdeationWorkspace.js`, `TopBar.js`, `style.css`

- **Query thread in panel**: Below the mentor section, show the chronological thread of follow-up queries and their outcomes:
  ```
  You: "EU climate angle"
  -> Web Researcher found 4 articles

  You: "Find similar to 'Coffee prices hit 5-year high'"
  -> Web Researcher found 3 articles
  ```

- **Running state**: When a follow-up query is in-flight, show the query text with an animated spinner in the thread. The relevant assistant badge in the TopBar pulses.
- **Card entrance animation**: CSS `@keyframes` for new cards fading/sliding in. Cards from follow-up queries get a brief highlight.
- **Panel text input**: A text input at the bottom of the AssistantPanel with a submit button. Optional assistant selector dropdown (defaults to "Auto"). Keyboard shortcut: Enter to submit.
- **TopBar assistant badges**: Pulse animation when that assistant is running a follow-up query.

---

## Wiring in IdeationWorkspace

`IdeationWorkspace.js` is the central coordinator:

- New `handleQuery(assistantId, query)` callback that:
  1. Sets `runningQuery` state (assistant ID + query text, for UI indicators)
  2. POSTs to `/ideation/{id}/query`
  3. On response, updates state (new cards arrive), clears running state
  4. Triggers mentor re-evaluation if auto-refresh is on
- Pass `onRunQuery` down to `AssistantPanel` (for panel input + mentor suggestions) and through `MoodBoard` -> `IdeationCard` -> card components (for "Find similar")

---

## Follow-on: Collaboration (Next Phase)

Not in this build. Noted for next phase:

- Presence awareness (who's online, heartbeat via transients)
- Attribution (who pinned, who queried)
- Activity thread (shared, not just "You")
- Polling-based state sync (3-5s interval)
- **Transport strategy**: Design the data model and events as a clean abstraction. Implement transport as REST polling initially. WordPress 7 is shipping real-time collaboration with WebSocket infrastructure. If/when available on VIP, swap the transport layer without touching the data model or UI.
