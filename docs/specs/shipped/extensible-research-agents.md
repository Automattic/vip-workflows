---
status: shipped
version: 0.3
last_updated: 2026-07-29
related:
  - shipped/interactive-ideation-assistants.md
  - active/ideation-system.md
  - shipped/story-discovery.md
  - shipped/unified-assistants-tab.md
---

# Extensible Research Agents via the Abilities API

> **Amendment:** `availability_callback` was widened from a bare
> bool to an *additive* structured return. Everything this spec says about the
> bool contract is still true — a callback returning `true`/`false` keeps working
> unchanged, with no diagnostic. What is new is that a callback may instead
> return a `VIPWorkflow\Abilities\Availability`, which names each unmet
> requirement and where to satisfy it. See
> [Availability Callback](#availability-callback) below; the sections on the
> `Ability` class, the agent card badge, and Resolved Decision 3 carry the same
> amendment.

---

## Problem

Ideation research agents (Web Researcher, Media Scout, Archive Scout) are hardcoded in `IdeationOrchestrator::get_assistants()`. A customer cannot add their own agent that searches AP Wire, Instagram, an internal CMS API, or any other source. Meanwhile, the Abilities API already provides a generic, extensible registration pattern (input schema, execute callback, output schema, permissions, settings). Research agents should be abilities, not a parallel system.

---

## Principles

1. **One registration API.** Research agents register via `wp_register_ability()` / `vip_workflow_register_ability()`, the same way editorial tools (SEO check, readability, keyword check) do today.
2. **The ability is the contract.** Input schema, execute callback, output schema. The Abilities API does not have opinions about what data an ability returns. An SEO check returns `{ score, issues, suggestions }`. A research agent returns `{ cards, summary }`. Both are just JSON matching their declared `output_schema`.
3. **`AbilityResult` carries raw output.** The result object stores the callback's return data in a generic `output` property. Consumers interpret it per the ability's schema. No typed fields like `score` or `issues` on the result class.
4. **Discovery via meta flags.** The `meta` key on ability registration already carries arbitrary metadata (`type`, `supports`, `annotations`). Research agents declare `'type' => 'research'` so consumers (the ideation orchestrator) can filter for them.
5. **Built-in agents ship as abilities.** Web Researcher, Media Scout, and Archive Scout become ability registrations. No separate `AssistantInterface` hierarchy.

---

## Part 1: Generalize `AbilityResult`

### Current Problem

`AbilityResult` has hardcoded public properties: `score`, `status`, `summary`, `analysis`, `issues`, `suggestions`. These assume every ability is an editorial check. A research agent returning cards has to shoehorn data into `analysis` or be wrapped in a parallel `AssistantResult` class (which is what happens today).

The DB table `wp_vip_ability_results` mirrors this: dedicated `score` and `status` columns, and a `result_data` JSON blob that packs `analysis`, `issues`, `suggestions`, `error`.

### Changes

**`AbilityResult` class** (`includes/abilities/class-ability-result.php`):

Remove `score`, `status`, `issues`, `suggestions`, `analysis` as direct properties. Replace with:

- `output` (`array`): The raw return value of the execute callback, whatever shape the ability's `output_schema` declares. An SEO check stores `{ score: 85, status: 'pass', issues: [...] }`. A research agent stores `{ card_count: 6, summary: '...' }` (see Part 3 for why cards are not stored here).
- Keep `success`, `error`, `duration_ms`, `summary`, `created_by`, `created_at` as first-class properties (execution metadata, not ability-specific output).

```php
class AbilityResult {
    public ?int $id = null;
    public string $ability_id;
    public ?int $post_id = null;
    public bool $success = true;
    public string $summary = '';
    public array $output = [];
    public ?string $error = null;
    public int $duration_ms = 0;
    public int $created_by = 0;
    public string $created_at = '';
}
```

All consumers that currently read `$result->score` or `$result->issues` change to `$result->output['score']` or `$result->output['issues']`.

**`AbilityResultRepository`** (`includes/abilities/class-ability-result-repository.php`):

- `save()`: writes `output` as `result_data` JSON. Writes `summary` to its dedicated column.
- `hydrate()`: reads `result_data` JSON into `output`.

**DB schema** (`includes/database/class-schema.php`):

- Make `post_id` nullable: `bigint(20) unsigned DEFAULT NULL`. Research projects are CPTs, so their post ID goes here. Editorial tools continue putting the article post ID here.
- Remove `score` and `status` columns. These are now in `result_data` JSON for abilities that produce them. Queries that filtered by score/status switch to JSON queries or application-level filtering.
- `result_data` stores the full `output` array.

**`Ability` class** (`includes/abilities/class-ability.php`):

- Add `availability_callback` property (callable, optional). Returns `bool` indicating whether the ability's runtime dependencies are satisfied (API keys, external services).
- Add `is_available(): bool` method that calls the callback (returns `true` if no callback set).
- Add `get_display_order(): int` convenience accessor reading from `meta['display_order']` with a default of 100.

**Amended:** `is_available(): bool` keeps its exact signature and behavior. A second accessor, `get_availability(): Availability`, was added alongside it and returns the structured result; `is_available()` is now a thin wrapper over `get_availability()->is_available()`. A callback that returns anything other than an `Availability` instance is coerced to bool exactly as before. Because the structured shape is a type rather than an array convention, a legacy callback returning an array cannot be mistaken for it — the array stays truthy-coerced.

This is a VIP Workflow extension to the Abilities API, not a Core WP concept. The `availability_callback` key passes through harmlessly when delegating to `wp_register_ability()` (Core ignores unknown keys). If Core adds something similar later, we migrate.

**`AbilityExecutor`** (`includes/abilities/class-ability-executor.php`):

- Before executing, check `$ability->is_available()`. If false, return a failure result with a clear message (not an exception, since this is an expected state).
- After executing, set `result->output` to the raw callback return (if it's an array).
- Set `post_id` from input when present:

```php
if ( isset( $input['project_id'] ) ) {
    $result->post_id = (int) $input['project_id'];
} elseif ( isset( $input['post_id'] ) ) {
    $result->post_id = (int) $input['post_id'];
}
```

---

## Part 2: Research Agent Registration Pattern

### Meta Convention

Research agents declare themselves via `meta.type` and control display ordering via `meta.display_order`:

```php
'meta' => array(
    'type'            => 'research',
    'display_order'   => 10,
    'show_in_rest'    => true,
    'show_in_commands' => false,
    'icon'            => 'search',
    'annotations'     => array(
        'readonly'    => true,
        'destructive' => false,
        'idempotent'  => true,
    ),
),
```

The `type` field is already used by existing abilities (SEO check uses `'type' => 'check'`). Research agents use `'type' => 'research'`.

**Display order:** Built-in agents ship with low values (Web Researcher: 10, Archive Scout: 20, Media Scout: 30). Third-party agents that omit `display_order` default to 100 and appear after built-ins. The frontend sorts by this value for badge ordering, card grouping, and the Research Agents settings tab.

### Availability Callback

Research agents register an `availability_callback` that returns `true` if the agent's runtime dependencies are satisfied (API keys configured, external service reachable, etc.):

```php
'availability_callback' => function(): bool {
    $provider = SearchProviderRegistry::get_instance()->get_selected();
    return $provider !== null && $provider->is_configured();
},
```

This is separate from `AbilitySettings::is_enabled()` (admin toggle). The distinction:

- **Enabled** = the admin has not disabled this agent. Controlled via the settings UI.
- **Available** = the agent's dependencies are configured and it can actually run.

The orchestrator checks both before execution. The settings UI shows availability status on each agent card ("Not configured" vs. ready). If `availability_callback` is not provided, the agent is assumed available when enabled.

`availability_callback` applies to all ability types, not just research. An editorial tool can use it too (e.g., "Yoast not installed" = SEO check unavailable).

#### Structured requirements

A bare bool says an agent cannot run but not why, so the card could only ever render one generic sentence. The contract was therefore widened **additively**. A callback may return either:

| Return value | Meaning | Behavior |
|---|---|---|
| `true` (or any truthy value) | Dependencies are met | Available. Unchanged. |
| `false` (or any falsy value) | Dependencies are not met, reason unknown | Unavailable, empty requirement set. Unchanged, and no diagnostic. |
| `VIPWorkflow\Abilities\Availability` | The structured shape | Unavailable, carrying the unmet requirements. |

**The callback owns satisfaction.** It is the only layer with credential access, so it evaluates its own dependencies and returns bare `true` when they are met — including when an `any` group has at least one satisfied member. An `Availability` therefore carries *only unmet* requirements: `Ability`, `DiscoveryProviderRegistry`, and `AssistantRegistry` aggregate what arrives and never re-derive satisfaction.

The value objects live in `includes/abilities/`:

- `Availability` — `::available()` / `::unmet( RequirementGroup ...$groups )`.
- `RequirementGroup` — `::all()` (every member needed) or `::any()` (one member is enough, so the card renders "configure at least one of" rather than N separate blockers).
- `Requirement` — a stable id for dedupe, a `kind` (`missing_credential` / `unsupported_environment` / `dependency`), two message registers, source attribution, and a tagged `Destination` (`admin_url` / `in_card` / `none`).
- `RequirementFactory` — **the intended authoring path.** It derives the id, kind, both registers, and the backend-resolved destination from a service slug, so the structured return is shorter than the bool it replaces.

```php
use VIPWorkflow\Abilities\Availability;
use VIPWorkflow\Abilities\RequirementFactory;
use VIPWorkflow\Abilities\RequirementGroup;

'availability_callback' => function(): bool|Availability {
    $provider = SearchProviderRegistry::get_instance()->get_selected();

    if ( null !== $provider && $provider->is_configured() ) {
        return true;
    }

    if ( null === $provider ) {
        return Availability::unmet(
            RequirementGroup::all(
                RequirementFactory::dependency(
                    'dependency:search-provider',
                    __( 'No web search provider is registered, so there is nothing to search with.', 'vip-workflow' ),
                    __( 'Web search is not available on this site.', 'vip-workflow' )
                )
            )
        );
    }

    // The provider names its own credential, so a replacement search provider
    // reports its own service rather than inheriting Tavily's.
    return Availability::unmet(
        RequirementGroup::all(
            RequirementFactory::missing_credential(
                $provider->get_id(),
                $provider->get_name(),
                array( __( 'Web Researcher', 'vip-workflow' ) )
            )
        )
    );
},
```

Two message registers exist because agent execution is gated on `edit_posts` while both the Agents screen and Settings → Connectors require `manage_options`. The admin register carries `reason` + `destination`; the user register carries `message` only, never a destination or any `/wp-admin/` URL. The register is chosen at the read boundary by `VIPWorkflow\API\AvailabilitySerializer` — one place in the plugin maps a capability to a register, so no controller can leak an admin URL to an editor.

Credentials for the built-in services (Tavily, YouTube) live on WordPress core's **Settings → Connectors** (`options-connectors.php`), not in this plugin. On an install without that screen there is no credential UI at all, so the requirement's destination resolves to `none` and names the `wp-config.php` constant instead of linking somewhere dead. A third-party agent whose key lives in its own card `settings_schema` should use `RequirementFactory::in_card()`.

### Input Schema Convention

All research agents share a common input shape. The Abilities API validates this via `input_schema`:

```php
'input_schema' => array(
    'type'       => 'object',
    'properties' => array(
        'seed' => array(
            'type'        => 'string',
            'description' => 'The ideation seed text.',
            'required'    => true,
        ),
        'query' => array(
            'type'        => 'string',
            'description' => 'Optional follow-up search query. If set, used instead of seed.',
        ),
        'seed_analysis' => array(
            'type'        => 'object',
            'description' => 'Structured output from Seed Analyst (tags, entities, search queries).',
        ),
        'project_id' => array(
            'type'        => 'integer',
            'description' => 'The ideation project post ID.',
        ),
        'brand_context' => array(
            'type'        => 'array',
            'description' => 'Brand knowledge entries relevant to this seed.',
        ),
    ),
),
```

### Output Schema Convention

Research agents return cards and a summary. Each card must include `source_type` and `origin` so the orchestrator can store them without hardcoded type mapping:

```php
'output_schema' => array(
    'type'       => 'object',
    'required'   => array( 'cards', 'summary' ),
    'properties' => array(
        'cards' => array(
            'type'        => 'array',
            'description' => 'Discovered source cards.',
            'items'       => array(
                'type'       => 'object',
                'required'   => array( 'type', 'source_type', 'origin' ),
                'properties' => array(
                    'type'        => array(
                        'type'        => 'string',
                        'description' => 'Card type identifier (e.g., web-article, ap-wire-article, image, video).',
                    ),
                    'source_type' => array(
                        'type'        => 'string',
                        'enum'        => array( 'article', 'image', 'video' ),
                        'description' => 'Source category for storage.',
                    ),
                    'origin'      => array(
                        'type'        => 'string',
                        'enum'        => array( 'search', 'archive', 'api', 'ai_generated' ),
                        'description' => 'How this source was discovered.',
                    ),
                    'title'       => array( 'type' => 'string' ),
                    'url'         => array( 'type' => 'string' ),
                    'excerpt'     => array( 'type' => 'string' ),
                    'image'       => array( 'type' => 'string' ),
                ),
            ),
        ),
        'summary' => array(
            'type'        => 'string',
            'description' => 'Human-readable summary of what was found.',
        ),
    ),
),
```

Card objects can carry additional properties beyond the base set (date, author, score, channel, duration, etc.). The orchestrator stores whatever the ability returns. The frontend renders based on `card.type` — note that only `document` routes to `DocumentCard`; everything else falls through to `ArticleCard`, so display changes usually belong in `cards/shared.js` rather than in one card.

The stored row's `source_id` is derived from the card — its `url`, or `title`
plus `content` when it has no URL — so a re-run lands on the row it created last
time instead of inserting a duplicate. An agent that returns unstable URLs, or
that omits `content` on generated cards, defeats that: the first forks a new
card per run, the second collapses genuinely different cards into one. See
`IdeationOrchestrator::card_identity()`.

### Built-in Agent Registration

**Web Researcher** (`includes/abilities/tools/web-researcher.php`):

```php
function register_web_researcher(): void {
    vip_workflow_register_ability(
        'vip-workflow/web-researcher',
        array(
            'label'               => __( 'Web Researcher', 'vip-workflow' ),
            'description'         => __( 'Searches the open web for articles, analysis, and background material.', 'vip-workflow' ),
            'category'            => 'vip-workflow',
            'input_schema'        => /* common research input schema */,
            'output_schema'       => /* common research output schema */,
            'execute_callback'    => __NAMESPACE__ . '\\execute_web_researcher',
            'permission_callback' => 'edit_posts',
            'availability_callback' => function(): bool {
                $provider = SearchProviderRegistry::get_instance()->get_selected();
                return $provider !== null && $provider->is_configured();
            },
            'meta'                => array(
                'type'             => 'research',
                'display_order'    => 10,
                'show_in_rest'     => true,
                'show_in_commands' => false,
                'icon'             => 'admin-site-alt3',
            ),
        )
    );
}
```

The `execute_web_researcher( $input )` function contains the same logic currently in `WebResearcher::run()`, returning `array( 'cards' => [...], 'summary' => '...' )`. Each card includes `source_type` and `origin`.

Same pattern for `vip-workflow/media-scout` (display_order: 30) and `vip-workflow/archive-scout` (display_order: 20).

### Extension Plugin Example

A customer builds `workflow-agent-ap-wire/`:

```php
add_action( 'vip_workflow_register_abilities', function() {
    vip_workflow_register_ability(
        'my-org/ap-wire-researcher',
        array(
            'label'            => 'AP Wire',
            'description'      => 'Searches the Associated Press wire for breaking news and background.',
            'category'         => 'my-org',
            'input_schema'     => array( /* same common research input schema */ ),
            'output_schema'    => array( /* same common research output schema */ ),
            'execute_callback' => function( array $input ) {
                $query   = $input['query'] ?? $input['seed'];
                $results = MyOrg\APWireClient::search( $query, 8 );
                $cards   = array_map( function( $item ) {
                    return array(
                        'type'        => 'ap-wire-article',
                        'source_type' => 'article',
                        'origin'      => 'api',
                        'title'       => $item->headline,
                        'url'         => $item->url,
                        'excerpt'     => $item->summary,
                        'date'        => $item->published,
                    );
                }, $results );
                return array(
                    'cards'   => $cards,
                    'summary' => sprintf( 'Found %d AP Wire stories.', count( $cards ) ),
                );
            },
            'permission_callback' => 'edit_posts',
            'availability_callback' => function(): bool {
                return defined( 'MY_ORG_AP_WIRE_KEY' ) && ! empty( MY_ORG_AP_WIRE_KEY );
            },
            'meta'                => array(
                'type'             => 'research',
                'display_order'    => 50,
                'show_in_rest'     => true,
                'show_in_commands' => false,
                'icon'             => 'rss',
            ),
        )
    );
});
```

No new API to learn. Same registration, same hooks, same settings panel.

---

## Part 3: Orchestrator Consumes Abilities

### `IdeationOrchestrator` Changes

**Remove** `get_assistants()` hardcoded array, `AssistantInterface` dependency, and `QUERYABLE_ASSISTANTS` constant.

**Replace** `resolve_assistant()` with ability lookup:

```php
private function get_research_abilities(): array {
    $registry = AbilityRegistry::get_instance();
    $abilities = array_filter(
        $registry->get_all(),
        fn( Ability $ability ) => ( $ability->get_meta()['type'] ?? '' ) === 'research'
    );
    usort( $abilities, fn( $a, $b ) => $a->get_display_order() <=> $b->get_display_order() );
    return $abilities;
}

private function resolve_research_ability( string $ability_id ): ?Ability {
    $registry = AbilityRegistry::get_instance();
    $ability  = $registry->get( $ability_id );
    if ( ! $ability || ( $ability->get_meta()['type'] ?? '' ) !== 'research' ) {
        return null;
    }
    return $ability;
}
```

**`create_from_seed()`**: After Seed Analyst runs, iterate `get_research_abilities()` to build the pending list dynamically. Only includes enabled and available agents.

### Execution and Storage (No Double Storage)

The orchestrator handles research ability execution directly rather than going through `AbilityExecutor::execute()` for result persistence. This avoids storing full card payloads in both `wp_vip_ability_results` and `wp_vip_ideation_sources`.

- `wp_vip_ability_results`: Execution log. Stores lightweight metadata per run: success, duration, summary, card count. No card payloads.
- `wp_vip_ideation_sources`: Card store. Individual rows per card with full content, pin/dismiss state, project association.

```php
private function run_single_assistant( int $project_id, string $ability_id, ?string $query = null ): AbilityResult {
    $ability = $this->resolve_research_ability( $ability_id );
    if ( ! $ability ) {
        return AbilityResult::failure( $ability_id, __( 'Unknown research agent.', 'vip-workflow' ) );
    }

    $settings = AbilitySettings::get_instance();
    if ( ! $settings->is_enabled( $ability_id ) ) {
        return AbilityResult::failure( $ability_id, __( 'Agent is disabled.', 'vip-workflow' ) );
    }

    if ( ! $ability->is_available() ) {
        return AbilityResult::failure( $ability_id, __( 'Agent is not configured.', 'vip-workflow' ) );
    }

    $seed          = get_post_meta( $project_id, '_vip_research_query', true );
    $seed_analysis = json_decode( get_post_meta( $project_id, self::META_SEED_ANALYSIS, true ) ?: '{}', true );

    $input = array(
        'project_id'    => $project_id,
        'seed'          => $seed,
        'seed_analysis' => $seed_analysis,
        'brand_context' => $this->get_brand_context( $seed ),
    );

    if ( $query !== null ) {
        $input['query'] = $query;
    }

    $start = microtime( true );

    try {
        $raw_output = $ability->execute( $input );
    } catch ( \Throwable $e ) {
        return AbilityResult::failure( $ability_id, $e->getMessage() );
    }

    $cards   = $raw_output['cards'] ?? array();
    $summary = $raw_output['summary'] ?? '';

    // Store cards in ideation_sources (the card store).
    $this->store_cards_as_sources( $project_id, $cards, get_current_user_id() );

    // Persist lightweight execution log to ability_results (no card payloads).
    $result              = AbilityResult::success( $ability_id, array(
        'card_count' => count( $cards ),
        'summary'    => $summary,
    ) );
    $result->summary     = $summary;
    $result->post_id     = $project_id;
    $result->duration_ms = (int) ( ( microtime( true ) - $start ) * 1000 );

    $repository = new AbilityResultRepository();
    $repository->save( $result );

    return $result;
}
```

Editorial tools (SEO check, readability) continue using `AbilityExecutor::execute()` which persists their full output to `ability_results`. Research agents bypass the executor's auto-persist and handle storage themselves.

### `store_cards_as_sources()` Reads Agent-Declared Fields

Remove the hardcoded card type mapping. Agents declare `source_type` and `origin` on each card:

```php
$source_type = $card['source_type'] ?? 'article';
$origin      = $card['origin'] ?? 'search';
```

### REST Controller Validation

The ideation controller (`class-ideation-controller.php`) removes validation against `QUERYABLE_ASSISTANTS`. Instead, it validates that the requested ability ID is a registered research ability:

```php
$ability = $orchestrator->resolve_research_ability( $assistant_id );
if ( ! $ability ) {
    return new WP_Error( 'invalid_agent', 'Unknown research agent.', array( 'status' => 400 ) );
}
```

Any registered ability with `meta.type === 'research'` is queryable. No hardcoded list anywhere.

### Editorial Mentor Dynamic Awareness

The Mentor's system prompt is built dynamically from the registry. Instead of hardcoding available assistants, it queries `get_research_abilities()` and lists them by label and ID. This means if a customer adds an AP Wire agent, the Mentor can suggest "Search AP Wire for commodity pricing data" without any code changes.

```php
$agents = $this->get_research_abilities();
$agent_list = array_map(
    fn( Ability $a ) => sprintf( '%s (id: %s)', $a->get_label(), $a->get_name() ),
    $agents
);
$prompt .= 'Available research agents: ' . implode( ', ', $agent_list );
```

### Seed Analyst Stays Internal

The Seed Analyst is not a research agent and not an ability. It runs synchronously during `create_from_seed()`, before any research abilities fire. It remains an internal orchestrator class. Customers have no reason to replace it, and exposing it as an extension point would add complexity without value.

### Frontend Impact

- `IdeationWorkspace.js` currently loops over pending assistant IDs from state. This continues to work: the state returns ability IDs (`vip-workflow/web-researcher`, `my-org/ap-wire-researcher`) instead of assistant IDs (`web-researcher`). The REST endpoint remains `POST /ideation/{id}/run-assistant`.
- The TopBar assistant badges render dynamically based on the research abilities present in the project state, sorted by `display_order`, rather than a hardcoded list.
- New card types from custom agents (`ap-wire-article`, `instagram-post`) render via a generic card component that reads `type`, `title`, `url`, `image`, `excerpt`. Custom card renderers can be registered via a JS filter (see Part 5).

---

## Part 4: Retire the Parallel System

### Remove

- `AssistantInterface` (`class-assistant-interface.php`)
- `AssistantResult` (`class-assistant-result.php`)
- `WebResearcher` class (`class-web-researcher.php`)
- `MediaScout` class (`class-media-scout.php`)
- `ArchiveScout` class (`class-archive-scout.php`)
- `QUERYABLE_ASSISTANTS` constant
- `resolve_assistant()` method
- Hardcoded card type mapping in `store_cards_as_sources()`

### Keep

- `SeedAnalyst` (internal orchestrator class, not extensible)
- `EditorialMentor` (internal orchestrator class, not extensible)
- `store_cards_as_sources()` (reads `source_type`/`origin` from cards, no mapping)
- `wp_vip_ideation_sources` table (card store, keyed by project)

---

## Part 5: Settings UI and Extension Pattern

### Standard Extension Pattern: `@wordpress/hooks` Filters

All extension plugins (research agents, notification channels, tools) use `@wordpress/hooks` JS filters to inject settings UI. This replaces the current ntfy pattern of independently mounting React into the DOM, which has timing and ordering issues.

**How it works:**

1. Core renders a tab (Research Agents, Notification Channels, etc.) with a card for each registered item.
2. For each card, core applies a JS filter to get an optional settings component:

```js
import { applyFilters } from '@wordpress/hooks';

const AgentSettings = applyFilters(
    'vip_workflow_research_agent_settings',
    null,
    ability.name
);

// In the card JSX:
{ AgentSettings && <AgentSettings abilityId={ ability.name } /> }
```

3. Extension plugins register a filter that returns their React component:

```js
import { addFilter } from '@wordpress/hooks';
import { APWireSettings } from './APWireSettings';

addFilter(
    'vip_workflow_research_agent_settings',
    'my-org/ap-wire',
    ( component, abilityName ) => {
        if ( abilityName === 'my-org/ap-wire-researcher' ) {
            return APWireSettings;
        }
        return component;
    }
);
```

No DOM timing issues, no mount point fragility, WordPress-idiomatic. The extension enqueues its JS with `vip-workflow-admin` as a dependency and the filter system handles the rest.

### Migrate Existing Extensions

The `workflow-channel-ntfy` plugin (and any future notification channel or tool extension) migrates to this pattern as part of this work. Core adds equivalent filter hooks for the Notification Channels and Tools tabs:

- `vip_workflow_notification_channel_settings` (for channel cards)
- `vip_workflow_tool_settings` (for tool cards)
- `vip_workflow_research_agent_settings` (new, for research agent cards)

This gives all extension types a consistent, reliable pattern.

### Integrations Page

The Integrations page (`Integrations.js`) adds a fourth tab: **Research Agents**.

```js
{
    name: 'research-agents',
    title: __( 'Research Agents', 'vip-workflow' ),
    className: 'vip-integrations-tab',
},
```

### Research Agents Tab Content

The core plugin renders a card for each registered ability where `meta.type === 'research'`. Each card shows:

- **Label, icon, description** from the ability registration
- **Enabled/disabled toggle** (writes to `AbilitySettings`)
- **Availability status** from `availability_callback`: green "Ready" badge or amber "Not configured" badge. **Amended:** where the callback returns structured requirements, the card additionally names each unmet requirement, lists which capabilities need it, and renders its destination per kind — a link for `admin_url`, a "complete the fields below" hint for `in_card`, plain text naming the constant for `none`. A bool `false` still renders the generic line. **Amended:** an `in_card` destination may additionally carry a `credentials_url` — where the user obtains the credential, as distinct from where they enter it — rendered as an external link beneath the hint. The field name is borrowed from core's connector API (`wp-includes/connectors.php`), which declares the same thing for `api_key` connectors, so the two converge if core grows an auth method beyond `api_key`/`none`. It rides inside the `destination` payload and is therefore admin-only, like every other destination: obtaining a credential means opening an account, and the card's settings fields are `manage_options`.
- **Extension settings component** via the `vip_workflow_research_agent_settings` filter

Cards are sorted by `meta.display_order`.

### Extension Settings UI (PHP side)

Extension plugins enqueue their JS on the Integrations page:

```php
add_action( 'admin_enqueue_scripts', function( $hook ) {
    if ( 'workflow_page_vip-workflow-integrations' !== $hook ) {
        return;
    }

    wp_enqueue_script(
        'workflow-agent-ap-wire-admin',
        WORKFLOW_AP_WIRE_URL . 'build/admin.js',
        array( 'vip-workflow-admin', 'wp-hooks' ),
        '1.0.0',
        true
    );
} );
```

The extension's JS registers its filter (as shown above) and owns its own REST endpoints for saving configuration (API keys, server URLs, etc.).

### Built-in Agent Settings

Built-in agents (Web Researcher, Media Scout, Archive Scout) use the same filter pattern but are registered by the core plugin's admin JS. Web Researcher shows the search provider configuration. Media Scout shows enabled providers. Archive Scout has no additional settings beyond enable/disable.

---

## What Shipped

- Generalized `AbilityResult` (typed fields replaced with generic `output`), `AbilityResultRepository`, and DB schema (`post_id` nullable, `score`/`status` columns removed).
- `availability_callback` on `Ability` class for all ability types. The contract was widened additively: the bool form is unchanged, and a callback may instead return an `Availability` carrying structured unmet requirements.
- Built-in research agents (`web-researcher.php`, `media-scout.php`, `archive-scout.php`) registered as abilities with `source_type`/`origin` on cards.
- `IdeationOrchestrator` switches to registry-based execution with lightweight result persistence.
- `@wordpress/hooks` filter pattern for Research Agents, Notification Channels, and Tools settings tabs.
- `workflow-channel-ntfy` migrated to filter pattern.
- Old parallel system removed (`AssistantInterface`, `AssistantResult`, old assistant classes, `QUERYABLE_ASSISTANTS`).
- Extension guide published (`skills/create-assistant/SKILL.md`), example plugins ship in repo (`workflow-assistant-poems/`, `workflow-assistant-hackernews/`, `workflow-assistant-wikipedia/`).

---

## Resolved Decisions

1. **Seed Analyst stays internal.** Not an ability. It runs synchronously before research agents and is not a customer extension point.

2. **Execution is parallel, display is ordered.** All research agents fire in parallel with no execution ordering. Display order in the UI is controlled by `meta.display_order` (integer). Built-ins ship with low values (10, 20, 30). Third-party agents default to 100 if unset.

3. **Formal `availability_callback`.** Added to the `Ability` class (all ability types, not just research). Returns `true`/`false` for runtime dependency checks. Separate from `AbilitySettings::is_enabled()` (admin toggle). This is a VIP Workflow extension, not a Core WP API concept.

   **Amended:** the callback may also return an `Availability` describing the unmet requirements. The bool return stays valid and silent; because the contract is ours rather than Core's, widening it was ours to do. The callback owns satisfaction and returns bare `true` when its dependencies are met, so requirement groups only ever contain unmet members. See [Availability Callback](#availability-callback).

4. **Media provider sub-extensibility coexists.** `MediaScout`'s `vip_workflow_media_providers` filter remains as an internal implementation detail of the Media Scout ability's execute callback. A customer adding a new image source to the existing Media Scout uses the filter. A customer adding a completely new agent registers a new ability. Both patterns coexist.

5. **No double storage.** Research agents persist lightweight execution metadata (card count, summary, duration) to `wp_vip_ability_results`. Full card data goes only to `wp_vip_ideation_sources`. The orchestrator handles this split.

6. **Agents declare `source_type` and `origin` on cards.** No hardcoded mapping in `store_cards_as_sources()`. The agent knows what it's returning. Defaults: `article` / `search`.

7. **No backward compatibility for existing projects.** Old assistant IDs in project meta are not migrated. Stale projects can be deleted.

8. **Clean break on `AbilityResult`.** Typed fields (`score`, `status`, `issues`, `suggestions`, `analysis`) are removed, not deprecated. `output` property holds all ability-specific data.

9. **`@wordpress/hooks` filters for extension settings UI.** All extension types (channels, tools, research agents) use the same pattern. `workflow-channel-ntfy` migrates as part of this work.

10. **No `post_id` column changes beyond nullable.** Research projects are CPTs. Their post ID goes in the existing `post_id` column. No `context_id`/`context_type` needed.
