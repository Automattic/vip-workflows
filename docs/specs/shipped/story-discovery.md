---
status: shipped
version: 0.3
last_updated: 2026-07-29
related:
  - active/ideation-system.md
  - shipped/extensible-research-agents.md
  - shipped/unified-assistants-tab.md
  - planned/qwoted.md
---

# Story Discovery Framework

> **Amendment:** a provider's `availability_callback` may now
> return structured unmet requirements instead of a bare bool. The bool contract
> is unchanged and still valid. See [Availability](#availability).

---

## Problem

The ideation landing page assumes editors already have a story idea. They type a seed, research assistants develop it. But many editors don't start with an idea; they start with a question: "What should we be writing about?"

Right now, nothing in the system helps answer that. Editors rely on external tools, editorial meetings, and instinct to decide what to cover. The ideation page is a blank text box waiting for inspiration that comes from somewhere else.

Story Discovery fills the gap before the seed. It surfaces story prompts from external intelligence sources (upcoming events, trending topics, content gaps, competitor coverage) and lets editors browse, search, and select prompts that become seeds, feeding directly into the existing ideation flow.

---

## Concepts

**Discovery Provider**: A registered source of story prompts. Each provider connects to an external service or data source and returns prompts in a common format. Foresight News is the first provider. Future providers could include Parse.ly (trending content, audience data), competitor monitoring, internal content gap analysis, wire services, or social listening tools.

**Story Prompt**: A normalized object that any provider returns. Contains enough information to (a) display a meaningful card on the landing page and (b) generate a rich seed when selected. Prompts are not stored persistently; they're fetched on demand and cached transiently.

**Seed Generation**: When an editor selects a prompt, the system composes a seed string from the prompt's data (headline, context, dates, source-specific metadata) and submits it through the existing `POST /vip-workflow/v1/ideation/seed` flow. The prompt's structured metadata can optionally be passed as supplementary context alongside the seed text.

---

## Story Prompt Shape

All providers return prompts conforming to this common structure. Providers may include additional properties in `meta` for their own UI or seed generation needs.

```php
array(
    'id'          => 'foresight-703721',         // Provider-namespaced unique ID
    'provider'    => 'foresight-news',           // Provider slug
    'title'       => 'White House announcement on US Space Command relocation',
    'description' => 'US President Donald Trump makes announcement...',
    'url'         => 'https://...',              // Optional external link
    'date'        => '2025-09-02T18:00:00+00:00', // Primary date (event date, publish date, etc.)
    'date_end'    => null,                       // Optional end date for multi-day items
    'tags'        => array( 'Politics', 'Defence & Security' ),
    'importance'  => 'top_story',                // Provider-defined: 'key_event', 'top_story', 'normal'
    'meta'        => array(                      // Provider-specific structured data
        'event_type'     => 'Media Opportunities',
        'region'         => 'United States',
        'address'        => 'Oval Office, The White House...',
        'is_embargoed'   => false,
        'embargo_date'   => null,
        'is_operational' => false,
        'date_confirmed' => true,
        'links'          => array(),
        'contacts'       => array(),
    ),
);
```

**Required fields:** `id`, `provider`, `title`. Everything else is optional but recommended.

The `importance` field is provider-defined. The UI can use it for visual treatment (badges, sort order) but does not enforce a universal scale.

---

## Discovery Provider Interface

### PHP Registration

Providers register via a WordPress action, similar to how notification channels and research agents register. Core provides the hook; extension plugins implement providers.

```php
add_action( 'vip_workflow_register_discovery_providers', function( $registry ) {
    $registry->register( 'foresight-news', array(
        'label'       => __( 'Foresight News', 'workflow-discovery-foresight' ),
        'description' => __( 'Upcoming events, diary dates, and scheduled announcements.', 'workflow-discovery-foresight' ),
        'icon'        => 'calendar-alt',
        'features'    => array( 'recommend', 'search' ),
        'callbacks'   => array(
            'recommend' => __NAMESPACE__ . '\get_recommendations',
            'search'    => __NAMESPACE__ . '\search_events',
            'filters'   => __NAMESPACE__ . '\get_search_filters',
            'seed'      => __NAMESPACE__ . '\generate_seed',
        ),
        'availability_callback' => __NAMESPACE__ . '\check_availability',
    ) );
} );
```

### Capabilities

Providers declare which features they support via the `features` array:

- **`recommend`**: Can return a curated list of prompts without user input. Used for the landing page section. Called with site-level configuration (preferred categories, region, time horizon) but no user query.
- **`search`**: Can accept user queries and filters. Used for the modal search. Called with user-provided text and filter selections.

A provider may support one or both. A Parse.ly provider might only support `recommend` (trending content, no search). A wire service might only support `search`. Foresight supports both.

### Callbacks

**`recommend( array $config ): array`**
Returns an array of story prompts based on site-level configuration. Called on landing page load. Should be fast (cached results preferred). `$config` contains the provider's saved settings (categories, regions, time horizon, etc.).

**`search( array $params ): array`**
Returns story prompts matching user criteria. `$params` includes `text` (freetext query) and `filters` (structured filter selections from the provider's filter definition).

**`filters(): array`**
Returns the available search filters for the modal UI. Each filter has a type, label, and options. This allows the modal to render provider-specific filter controls dynamically.

```php
function get_search_filters(): array {
    return array(
        array(
            'key'     => 'date_range',
            'label'   => __( 'Date range', 'workflow-discovery-foresight' ),
            'type'    => 'date_range',
            'default' => array( 'from' => 'today', 'to' => '+90 days' ),
        ),
        array(
            'key'     => 'categories',
            'label'   => __( 'Topics', 'workflow-discovery-foresight' ),
            'type'    => 'multi_select',
            'options' => 'dynamic',  // Fetched via REST, not hardcoded
        ),
        array(
            'key'     => 'regions',
            'label'   => __( 'Regions', 'workflow-discovery-foresight' ),
            'type'    => 'multi_select',
            'options' => 'dynamic',
        ),
        array(
            'key'     => 'event_types',
            'label'   => __( 'Event type', 'workflow-discovery-foresight' ),
            'type'    => 'multi_select',
            'options' => 'dynamic',
        ),
        array(
            'key'     => 'importance',
            'label'   => __( 'Importance', 'workflow-discovery-foresight' ),
            'type'    => 'select',
            'options' => array(
                array( 'value' => 'all', 'label' => 'All events' ),
                array( 'value' => 'top_story', 'label' => 'Top stories only' ),
                array( 'value' => 'key_event', 'label' => 'Key events only' ),
            ),
        ),
    );
}
```

**`seed( array $prompt ): string`**
Composes a seed string from a selected story prompt. Providers control how their data becomes a seed because they know what context matters. For Foresight, this would weave together the headline, event content, dates, and relevant context into a natural-language seed paragraph.

### Availability

**`availability_callback(): bool|Availability`**
Returns whether the provider is configured and operational (API key set, service reachable). Mirrors the pattern from research agents. If a provider is unavailable, its section is hidden from the landing page and its option is grayed out in the modal.

**Amended:** the bool return is unchanged and still valid — a callback returning `true`/`false` keeps working with no diagnostic. Additionally, a callback may return a `VIPWorkflow\Abilities\Availability` naming the unmet requirements, so the Agents card can say *what* is missing instead of only *that* something is. `DiscoveryProviderRegistry` mirrors `Ability` exactly: `is_available( string $slug ): bool` keeps its signature and its permissive default, and `get_availability( string $slug ): Availability` returns the structured result. Aggregation on the Agents card can therefore fold a provider and an ability uniformly, deduplicating a requirement that arrives from both.

**The callback owns satisfaction.** It returns bare `true` when its dependencies are met — including when an `any` group has one satisfied member — so a requirement group only ever contains unmet members and no consumer re-derives availability.

Build requirements with `VIPWorkflow\Abilities\RequirementFactory` rather than by hand: it derives the id, kind, both message registers, and the destination from a service slug. A provider whose credentials are entered in its own card fields uses `RequirementFactory::in_card()`, optionally passing a `credentials_url` so the card can also link to where those credentials are obtained; one backed by a credential the plugin reads through `VIPWorkflow\AI\Credentials` uses `missing_credential()`, whose destination resolves against the active credential backend so it never renders a link to a screen this install does not have.

```php
use VIPWorkflow\Abilities\Availability;
use VIPWorkflow\Abilities\RequirementFactory;
use VIPWorkflow\Abilities\RequirementGroup;

function check_availability(): bool|Availability {
    if ( is_configured() ) {
        return true;
    }

    return Availability::unmet(
        RequirementGroup::all(
            RequirementFactory::in_card(
                'settings:foresight-news',
                __( 'Foresight News sign-in details are missing. Add the email and password below.', 'workflow-discovery-foresight' ),
                __( 'Foresight News is not connected. Ask an administrator to add its sign-in details.', 'workflow-discovery-foresight' ),
                __( 'Complete the email and password fields below.', 'workflow-discovery-foresight' ),
                array( __( 'Foresight News', 'workflow-discovery-foresight' ) )
            )
        )
    );
}
```

Registering the same callback on both the provider and the plugin's research ability is intentional — the shared requirement id means the card renders one row listing both capabilities.

---

## REST API

Core exposes REST endpoints that proxy to registered providers. The frontend never calls external APIs directly.

**`GET /vip-workflow/v1/discovery/providers`**
Lists registered providers with their label, icon, features, and availability status.

**`GET /vip-workflow/v1/discovery/recommend`**
Returns recommended prompts. Optional `provider` param to request from a specific provider. If no provider specified, returns results from all available providers that support `recommend`, grouped by provider and capped at 6 per provider. The landing page renders each provider as its own section (e.g., "From Foresight News", "Trending on Parse.ly"), each with up to 6 cards. Results are cached server-side (transient, 15-30 min TTL).

**`GET /vip-workflow/v1/discovery/search?provider={slug}&text={query}&filters={json}`**
Searches a specific provider. Returns prompts matching the query and filters. The `filters` param is a JSON object whose keys match the provider's filter definitions.

**`GET /vip-workflow/v1/discovery/filters?provider={slug}`**
Returns the search filter definitions for a provider. For providers with `dynamic` options (like Foresight's categories), this endpoint fetches from the external API and caches the results.

**`POST /vip-workflow/v1/discovery/select`**
Called when an editor selects a prompt. Body: `{ provider, prompt_id, prompt_data }`. Calls the provider's `seed` callback to generate a seed string, then delegates to the existing ideation seed flow (`IdeationOrchestrator::create_from_seed()`). Returns the new project state, same as `POST /vip-workflow/v1/ideation/seed`. Additionally stores the full prompt data as project meta (`_vip_discovery_prompt`) before delegating, so the structured context is available to research assistants and the mentor downstream. This storage happens in the select handler, not in `create_from_seed()`, keeping the core seed flow unaware of discovery.

---

## Landing Page UI

### Layout

The discovery section sits between `SeedInput` and `RecentProjects` in the `.ideation-landing` div:

```
+--------------------------------------------------+
|           What's the story?                      |
|   [ seed text area                          ]    |
|                          [-> Start ideation]     |
+--------------------------------------------------+
|                                                  |
|   FROM FORESIGHT NEWS        [Browse more...]    |
|                                                  |
|   +------------+  +------------+  +------------+ |
|   | Headline   |  | Headline   |  | Headline   | |
|   | May 3      |  | May 8-10   |  | Jun 1      | |
|   | Politics   |  | Economy    |  | Technology | |
|   | * Top Story|  |            |  | * Key Event| |
|   +------------+  +------------+  +------------+ |
|                                                  |
+--------------------------------------------------+
|                                                  |
|   RECENT IDEAS                                   |
|   ... existing project cards ...                 |
+--------------------------------------------------+
```

### Behavior

- On mount, fetches `GET /vip-workflow/v1/discovery/recommend`.
- Renders up to 6 prompt cards in a grid matching the `RecentProjects` visual style.
- Each card shows: title, primary date (formatted with time awareness from `startDateHasTime`), tags (from categories/topics), importance badge if applicable.
- Clicking a card calls `POST /vip-workflow/v1/discovery/select` with the prompt data, then navigates to the workspace exactly like a manual seed submission.
- "Browse more..." button opens the search modal.
- If no providers are available or configured, the section is hidden entirely (same pattern as `RecentProjects` when empty).
- Loading and error states are independent of the rest of the page. `SeedInput` and `RecentProjects` render immediately; the discovery section shows a subtle loading skeleton while fetching and silently hides if the fetch fails. Never blocks the page.
- Provider attribution shown subtly on each card (e.g., "via Foresight News") since multiple providers will eventually contribute prompts.

### Search Modal

Opened via "Browse more..." or a dedicated button. Contains:

- Provider selector (tabs or dropdown) if multiple search-capable providers exist. Single provider = no selector.
- Freetext search input.
- Dynamic filter controls rendered from the provider's `filters()` definition.
- Results grid below, same card format as the landing section.
- Clicking a result card selects it and triggers the same seed generation flow.

The modal uses the provider's filter definitions to render controls, so each provider gets a search UI tailored to its capabilities without core knowing anything about Foresight categories or Parse.ly metrics.

---

## Foresight News Provider (Extension Plugin)

### Plugin Structure

```
workflow-discovery-foresight/
  workflow-discovery-foresight.php    # Bootstrap, register provider
  includes/
    class-foresight-client.php        # HTTP client (auth, endpoints, caching)
    class-foresight-auth.php          # JWT token management (obtain, cache, refresh)
    class-prompt-formatter.php        # Foresight Event -> Story Prompt mapping
    class-seed-composer.php           # Story Prompt -> seed text composition
  src/
    admin.js                          # Settings UI via JS filter
  build/
```

### Authentication

Foresight uses email/password to obtain a JWT token valid for 24 hours, with a refresh endpoint.

- Credentials stored as encrypted WordPress options.
- `ForesightAuth` handles token lifecycle: authenticate on first use, cache token in a transient (23h TTL for safety margin), refresh before expiry.
- All API calls go through `ForesightClient` which injects the Bearer token and handles 401 (re-authenticate) and 429 (rate limit backoff).

### Recommend Callback

For the landing page feed:

1. Build query from site configuration: configured category IDs, region, date range (today + configured time horizon).
2. Call `/events/filter/v1` with `DateFrom`, `DateTo`, `CategoryIds`, `RegionIds`, and optionally `IsTopStoryUK=true` or `IsTopStoryUSA=true` depending on configured region.
3. Take first 6-12 results (sorted by StartDate from the API).
4. Map each `Event` to a story prompt via `PromptFormatter`.
5. Cache results in a transient (30 min TTL).

### Search Callback

For the modal:

1. If `text` is provided and no structured filters, use `/events/freetext/v1?Text={text}` (sorted by relevancy). Rate limit: 2 requests per 5 seconds, so debounce in the frontend.
2. If structured filters are provided (with or without text), use `/events/filter/v1` with the appropriate params: `DateFrom`, `DateTo`, `CategoryIds`, `RegionIds`, `EventTypeIds`, `Text`, `IsTopStoryUK`/`IsTopStoryUSA`.
3. Map results via `PromptFormatter`.

### Filter Callback

Fetches from Foresight's own filter endpoints, cached:

- `/filters/categories` -> Topics multi-select (parent/child hierarchy)
- `/filters/regions` (with `/filters/countries` for grouping) -> Regions multi-select
- `/filters/eventTypes` -> Event type multi-select
- `/filters/contentLists` -> Content lists (could expose as a filter or as preset feeds)

Cache these aggressively (24h transient). They change infrequently.

### Seed Composition

When an editor selects a Foresight event, `SeedComposer` builds a rich seed string:

```
"Labour Party Autumn Conference runs September 28 to October 1, 2025 at ACC
Liverpool. Key party figures speak at major annual event. This is a Top Story
(UK). Topics: UK Politics, Political Parties. Event type: Conferences."
```

The goal is a natural-language paragraph dense enough for Seed Analyst to extract entities, topics, and search queries from. It includes:

- Headline
- Date range (formatted naturally, with time if `startDateHasTime` is true, "date TBC" if `monthTbc` or `yearTbc`)
- Venue/address if present
- Content (the editorial prose, truncated if very long)
- Importance flags (Key Event, Top Story)
- Category names and event type names (resolved from IDs via the cached filter lookups)
- Links (first 2-3, if present)

The prompt's full structured data is also stored as project meta (`_vip_discovery_prompt`) so it's available to research assistants or the mentor later if useful.

### Settings

Providers appear on the unified Integrations → Assistants tab as individual cards (or grouped with a research ability when a plugin registers both, via `vip_workflow_register_assistant_meta`). Settings fields are either auto-rendered from the provider's `settings_schema` or injected by the plugin via the `vipWorkflow.assistantSettings` JS filter (with legacy `vip_workflow_discovery_provider_settings` still supported for backward compatibility). See `docs/specs/unified-assistants-tab.md` for the unified tab architecture.

For the Foresight News provider specifically:

- **Email / Password** for API authentication (stored encrypted)
- **Default Region**: UK / US / Global
- **Default Time Horizon**: 30 / 60 / 90 / 180 days
- **Preferred Categories**: multi-select from Foresight taxonomy (fetched from `/filters/categories`)
- **Default Importance Filter**: All / Top Stories / Key Events
- **Content Lists**: optional, select specific Foresight content lists to include in recommendations

---

## Caching Strategy

External API calls are cached server-side to avoid rate limits and keep the landing page fast:

| Data | TTL | Key |
|------|-----|-----|
| Recommendations (landing page) | 30 min | `vip_discovery_recommend_{provider}_{config_hash}` |
| Search results | 10 min | `vip_discovery_search_{provider}_{params_hash}` |
| Filter options (categories, regions, etc.) | 24 hours | `vip_discovery_filters_{provider}_{filter_key}` |
| Auth token | 23 hours | `vip_foresight_auth_token` |

Transients for all of these. No custom tables needed for the discovery system.

---

## Foresight as a Research Assistant (Inside Projects)

The discovery framework covers the pre-seed use cases (recommendations and search on the landing page). But Foresight is also valuable after a project exists: an editor working on a UK monetary policy story wants to know what upcoming Bank of England events, parliamentary hearings, or reports are scheduled.

This is a standard research assistant, not a discovery provider. The Foresight extension plugin registers both:

```php
// Discovery provider (landing page)
add_action( 'vip_workflow_register_discovery_providers', function( $registry ) {
    $registry->register( 'foresight-news', array( /* ... */ ) );
} );

// Research assistant (inside projects)
add_action( 'wp_abilities_api_init', function() {
    vip_workflow_register_ability( 'workflow-discovery-foresight/research', array(
        'label'            => __( 'Foresight News', 'workflow-discovery-foresight' ),
        'description'      => __( 'Finds upcoming events relevant to this story.', 'workflow-discovery-foresight' ),
        'category'         => 'research',
        'input_schema'     => /* standard research input (seed, query, seed_analysis, etc.) */,
        'output_schema'    => /* standard research output (cards, summary) */,
        'execute_callback' => __NAMESPACE__ . '\research_execute',
        'permission_callback' => fn() => current_user_can( 'edit_posts' ),
        'meta'             => array(
            'type'             => 'research',
            'display_order'    => 15,
            'show_in_rest'     => true,
            'icon'             => 'calendar-alt',
            'thinking_message' => __( 'Checking upcoming events...', 'workflow-discovery-foresight' ),
            'success_message'  => __( 'Found upcoming events.', 'workflow-discovery-foresight' ),
            // Abilities carry the callback in `meta`; discovery providers carry it
            // as a top-level key. Registering the same function on both is what
            // makes the Agents card fold them into one requirement row.
            'availability_callback' => __NAMESPACE__ . '\check_availability',
        ),
    ) );
} );
```

### Shared Code

Both registrations use the same `ForesightClient` for API calls, the same auth management, and similar query-building logic. The difference is input and output:

| | Discovery (landing page) | Research (inside project) |
|---|---|---|
| **Input** | Site config (categories, region) or user search (text, filters) | Seed text, seed analysis, optional follow-up query |
| **Query strategy** | Direct: use configured filters or user-provided filters | Derived: extract topics/entities from seed analysis, map to Foresight categories, add date range |
| **Output** | Story prompts (displayed as cards, selected to create a seed) | Research cards (stored in `vip_ideation_sources`, displayed on the mood board) |
| **User intent** | "What should I write about?" | "What's coming up that's relevant to this story?" |

### Research Execute Callback

The research assistant's execute callback:

1. Extracts keywords and topics from `seed_analysis` (entities, topics, suggested queries).
2. Optionally maps topics to Foresight category IDs using a keyword-to-category lookup (deterministic first, with room for LLM-assisted mapping later).
3. Uses `query` (if provided as a follow-up) or falls back to freetext from the seed.
4. Calls `/events/filter/v1` with derived categories + date range (today + configured horizon), or `/events/freetext/v1` if no categories matched.
5. Maps results to standard research cards (with `source_type => 'article'`, `origin => 'api'`, and Foresight-specific metadata).
6. Returns `{ cards, summary }` per the research agent contract.

The cards land in `vip_ideation_sources` alongside results from Web Researcher, Archive Scout, and Media Scout. The editor sees upcoming events on the mood board next to published articles and media.

---

## Future Providers (Not In Scope)

These are not planned for this work, but the framework should accommodate them without changes:

- **Parse.ly**: Trending content on the site, audience engagement data, content gap analysis. Likely `recommend` only (no search).
- **Competitor monitoring**: Surface stories competitors are covering that we aren't. Likely both `recommend` and `search`.
- **Wire services** (AP, Reuters): Breaking and upcoming wire content. Likely `search` primarily.
- **Social listening**: Trending topics from social platforms. Likely `recommend` only.
- **Internal analytics**: Stories that performed well and deserve follow-ups. Likely `recommend` only.

---

## What Shipped

- Discovery provider registry and registration hook
- Story prompt data shape
- REST endpoints (providers, recommend, search, filters, select)
- Landing page section component (`StoryDiscovery`)
- Search modal component with dynamic filter rendering
- Seed generation flow (prompt -> seed -> existing ideation flow)
- Settings hook for provider configuration UI
- Extension plugin (`workflow-discovery-foresight/`)
- Foresight API client with JWT auth and token management
- Discovery provider registration: recommend, search, filters, seed callbacks
- Research ability registration: execute callback with seed-to-query mapping
- Shared query builder and prompt/card formatters
- Settings UI (credentials, region, categories, time horizon)
