# Extension Points Reference

How external plugins extend VIP Workflow: media providers, notification channels, background jobs, custom tools, event listeners, and REST API routes. Includes working examples from this repository.

For deeper PHP examples see [code-patterns.md](code-patterns.md); for the underlying subsystems see [architecture.md](architecture.md).

---

### Extension Plugin Examples

The following plugins in this repository demonstrate extensibility:

**1. workflow-tool-checklist/** - Check tool with editor UI
- Configurable checklist items per sequence
- Per-item hard/soft enforcement
- Custom editor panel showing checklist
- Demonstrates editor integration

**2. workflow-assistant-wikipedia/** - Research assistant
- Fetches Wikipedia summaries and references
- Demonstrates a research ability and assistant manifest

**3. workflow-agent-copy-edit/** - Mutating stage agent
- Copy-edits post content and stores attributed revisions
- Demonstrates a stage-eligible ability with write annotations

**4. workflow-agent-tag-sanity-check/** - Read-only stage agent
- Flags questionable post tags without modifying the post
- Demonstrates a stage-eligible ability with read-only annotations

**5. workflow-parsely/** - Product integration
- Adds Parse.ly abilities, agents, and discovery
- Demonstrates several extension points in one plugin

### 1. Custom Media Providers

```php
// workflow-provider-unsplash/workflow-provider-unsplash.php
use VIPWorkflow\Abilities\Destination;
use VIPWorkflow\Abilities\Requirement;
use VIPWorkflow\Ideation\Assistants\MediaProviderInterface;
use VIPWorkflow\Ideation\Assistants\MediaProviderRequirements;

// MediaProviderRequirements is optional: implementing it lets Media Scout say
// *why* this provider is unconfigured instead of only that it is. Callers probe
// for it with instanceof, so a provider implementing only MediaProviderInterface
// keeps working.
class UnsplashMediaProvider implements MediaProviderInterface, MediaProviderRequirements {
    private const KEY_CONSTANT = 'MY_PLUGIN_UNSPLASH_KEY';

    public function get_id(): string {
        return 'unsplash';
    }

    public function get_name(): string {
        return __( 'Unsplash Photos', 'my-plugin' );
    }

    public function is_configured(): bool {
        return defined( self::KEY_CONSTANT ) && '' !== constant( self::KEY_CONSTANT );
    }

    // Only called when is_configured() returns false.
    //
    // RequirementFactory::missing_credential() is the shorter path, but it only
    // covers services the plugin knows about through VIPWorkflow\AI\Credentials.
    // A third-party key read from a constant has no entry there, so construct the
    // requirement directly with a `none` destination that names the constant —
    // never an admin URL, since no screen writes this key.
    public function get_unmet_requirement(): Requirement {
        return new Requirement(
            'credential:unsplash',
            Requirement::KIND_MISSING_CREDENTIAL,
            sprintf(
                /* translators: %s: PHP constant name. */
                __( 'Unsplash is not connected. Define the %s constant in wp-config.php.', 'my-plugin' ),
                self::KEY_CONSTANT
            ),
            __( 'Unsplash is not connected. Ask an administrator to connect it.', 'my-plugin' ),
            Destination::none(
                sprintf(
                    /* translators: %s: PHP constant name. */
                    __( 'Define the %s constant in wp-config.php.', 'my-plugin' ),
                    self::KEY_CONSTANT
                )
            ),
            array( $this->get_name() )
        );
    }

    public function is_generative(): bool {
        return false;
    }

    public function search_media( string $query, int $max_results = 8, array $context = array() ) {
        $api_key = constant( self::KEY_CONSTANT );
        // ... Unsplash API call ...
        return array(
            array(
                'url'        => 'https://images.unsplash.com/...',
                'title'      => 'Photo description',
                'source_url' => 'https://unsplash.com/photos/...',
                'domain'     => 'unsplash.com',
                'thumbnail'  => null,
                'media_type' => 'image',
                'duration'   => null,
                'provider'   => $this->get_id(),
                'is_generated' => false,
            ),
        );
    }
}

// Register the provider.
add_filter( 'vip_workflow_media_providers', function( $providers ) {
    $providers[] = new UnsplashMediaProvider();
    return $providers;
} );

// Provide the API key via a wp-config.php constant:
// define( 'MY_PLUGIN_UNSPLASH_KEY', 'your-unsplash-access-key' );
```

> The plugin has no API-key entry UI. Keys for the built-in services live on
> WordPress core's **Settings → Connectors** screen and are read through
> `VIPWorkflow\AI\Credentials`; the old `vip_workflow_api_key_fields` filter and
> `ApiKeysController` were removed. A third-party provider either
> reads its key from a `wp-config.php` constant (as above) or registers its own
> core connector. See
> [`vip-workflow/docs/PLUGIN-INTEGRATION.md` § API Keys](../../vip-workflow/docs/PLUGIN-INTEGRATION.md#api-keys).

### 2. Custom Notification Channels

```php
// workflow-channel-my-service/workflow-channel-my-service.php
use VIPWorkflow\Notifications\NotificationChannel;

class MyServiceChannel extends NotificationChannel {
    public function get_id(): string {
        return 'my-service';
    }

    public function get_name(): string {
        return __('My Service', 'my-plugin');
    }

    public function send(Notification $notification): bool {
        // Send notification via your service API
        $api_key = get_option('my_service_api_key');
        // ... send logic ...
        return true;
    }
}

add_filter('vip_workflow_notification_channels', function($channels) {
    $channels[] = new MyServiceChannel();
    return $channels;
});
```

### 3. Custom Background Jobs

```php
// workflow-job-my-task/includes/class-my-task-job.php
use VIPWorkflow\Jobs\Job;

class MyTaskJob extends Job {
    public function get_id(): string {
        return 'my-task';
    }

    public function get_name(): string {
        return __('My Task', 'my-plugin');
    }

    public function get_schedule(): string {
        return 'daily'; // or cron expression
    }

    public function execute(array $args = []): void {
        // Your task logic
    }
}

add_action('vip_workflow_jobs_init', function($scheduler) {
    $scheduler->register_job(new MyTaskJob());
});
```

### 4. Custom Research Agents

Research agents run during story ideation and produce cards for the mood board.

```php
// workflow-agent-my-source/workflow-agent-my-source.php
add_action( 'wp_abilities_api_init', function() {
    if ( ! function_exists( 'vip_workflow_register_ability' ) ) {
        return;
    }

    vip_workflow_register_ability(
        'workflow-agent-my-source/my-source',
        array(
            'label'               => __( 'My Source', 'my-plugin' ),
            'description'         => __( 'Searches My Source for relevant content.', 'my-plugin' ),
            'category'            => 'research',
            'input_schema'        => array(
                'type'       => 'object',
                'properties' => array(
                    'seed'          => array( 'type' => 'string' ),
                    'seed_analysis' => array( 'type' => 'object' ),
                    'project_id'    => array( 'type' => 'integer' ),
                    'query'         => array( 'type' => 'string' ),
                ),
                'required'   => array( 'seed' ),
            ),
            'output_schema'       => array(
                'type'       => 'object',
                'properties' => array(
                    'cards'   => array( 'type' => 'array' ),
                    'summary' => array( 'type' => 'string' ),
                ),
            ),
            'execute_callback'    => 'my_source_execute',
            'permission_callback' => fn() => current_user_can( 'edit_posts' ),
            'meta'                => array(
                'type'             => 'research',
                'display_order'    => 50,
                'show_in_rest'     => true,
                'icon'             => '🔍',
                'thinking_message' => __( 'Searching My Source...', 'my-plugin' ),
                'success_message'  => __( 'My Source search complete.', 'my-plugin' ),
            ),
        )
    );
} );

function my_source_execute( array $input ): array {
    $query = $input['query'] ?? $input['seed'] ?? '';

    // Your search logic here. Return cards array.
    return array(
        'cards'   => array(
            array(
                'title'       => 'Result Title',
                'url'         => 'https://example.com/article',
                'excerpt'     => 'Brief description of the result.',
                'source_type' => 'article',  // article, document, discussion, video, image
                'domain'      => 'example.com',
                'image'       => null,
                'published_at' => '2026-01-15',
                'author'      => 'Author Name',
            ),
        ),
        'summary' => 'Found 1 relevant result from My Source.',
    );
}
```

Key points:
- Register via `vip_workflow_register_ability` (not `wp_register_ability`) to get VIP Workflow metadata
- `category` must be `'research'` and `meta.type` must be `'research'` for the orchestrator to discover it
- `meta.display_order` controls position in the agent panel (lower = earlier)
- Cards are stored in `wp_vip_ideation_sources` with `ability_id` linking back to the agent
- Use `group_id` on cards to visually group related items on the mood board
- Settings UI is auto-generated from `meta.settings_schema` (JSON Schema)

Working example: `workflow-assistant-wikipedia/`

### 5. Stage-Capable Agents

Stage-capable agents run when a post enters an AI-owned workflow stage. Register a stage-eligible Ability for execution and an agent manifest so the Agents tab can mark it as available in AI stages.

```php
add_action( 'vip_workflow_register_abilities', function() {
    vip_workflow_register_ability(
        'my-plugin/fact-check',
        array(
            'label'               => __( 'Fact Check', 'my-plugin' ),
            'category'            => 'vip-workflow',
            'input_schema'        => array(
                'type'                 => 'object',
                'additionalProperties' => false,
                'properties'           => array(
                    'post_id' => array( 'type' => 'integer' ),
                ),
                'required'             => array( 'post_id' ),
            ),
            'execute_callback'    => 'my_fact_check_execute',
            'permission_callback' => fn() => current_user_can( 'edit_posts' ),
            'meta'                => array(
                'type'           => 'agent',
                'supports'       => array( 'workflow', 'stage' ),
                'stage_eligible' => true,
                'annotations'    => array(
                    'readonly'    => true,
                    'destructive' => false,
                    'idempotent'  => true,
                ),
            ),
        )
    );
} );

add_action( 'vip_workflow_register_assistant_meta', function( $registry ) {
    $registry->register(
        'my-plugin',
        array(
            'label'        => __( 'Fact Check', 'my-plugin' ),
            'ability_ids'  => array( 'my-plugin/fact-check' ),
            'capabilities' => array( 'stage' ),
        )
    );
} );
```

Key points:
- `meta.supports` must include `stage` and `meta.stage_eligible` must be true for `/vip-workflow/v1/abilities?context=stage`
- The stage agent returns `{ status, summary }` with `status` set to `pass` or `fail` (a binary editorial judgment); `WP_Error` or an invalid contract result is an execution error — it follows the stage's `error` route when the sequence configures one (the error path is opt-in), and otherwise fails in place with a "go back to the previous stage" action in the editor
- The stage owns routing; the agent owns only the outcome
- The manifest `capabilities` value drives the Agents card's "Available in AI stage" indicator only when backed by a registered stage-eligible ability

### 6. Custom Tools (Abilities)

See [Registering a Custom Tool in code-patterns.md](code-patterns.md#4-registering-a-custom-tool).

### 7. Event Listeners

```php
// Listen for workflow events. The 5th arg is $context =
// ['cause' => 'workflow'|'core', 'committed_status' => ...];
// four-argument listeners keep working (the extra arg is additive).
add_action('vip_workflow_status_transition', 'my_transition_handler', 10, 5);
add_action('vip_workflow_entered_{stage}', 'my_stage_handler', 10, 4);
add_action('vip_workflow_ability_executed', 'my_tool_handler', 10, 3);
```

### 8. REST API Extensions

```php
add_action('rest_api_init', function() {
    register_rest_route('my-plugin/v1', '/custom-endpoint', [
        'methods' => 'POST',
        'callback' => 'my_custom_endpoint',
        'permission_callback' => function() {
            return current_user_can('edit_posts');
        },
    ]);
});
```

### 9. AI Prompt Filters

These filters customize the prompts sent to the Vision and Whisper APIs. All
three fire inside `MediaProcessor`, so they apply to every call site (asset
uploads via `AIMediaAnalyzer`, research image sources, and ideation image
sources).

| Filter | Signature | Notes |
|--------|-----------|-------|
| `vip_workflow_ai_image_prompt` | `(string $prompt)` | Image/vision analysis. Renamed from `vip_workflow_media_image_prompt` on the MediaProcessor path. ⚠️ Also dropped the `$attachment_id` second arg that existed on the asset-upload path pre-merge. |
| `vip_workflow_ai_summary_prompt` | `(string $prompt, string $content_type)` | Transcript/text summarization. `$content_type` is additive and backward-compatible. |
| `vip_workflow_media_pdf_prompt` | `(string $prompt)` | PDF analysis. New filter; no legacy name. |

**Migrating `vip_workflow_media_image_prompt` callbacks:** rename to
`vip_workflow_ai_image_prompt`. Default prompt is unchanged; only the filter
name moved.

**Migrating `vip_workflow_ai_image_prompt` callbacks that read `$attachment_id`:**
the second argument is no longer passed. If you need attachment context, hook
`vip_workflow_asset_file_uploaded` separately to capture the attachment id.

```php
add_filter( 'vip_workflow_ai_image_prompt', function( string $prompt ): string {
    return $prompt . "\n\nAlways respond in Spanish.";
} );

add_filter( 'vip_workflow_ai_summary_prompt', function( string $prompt, string $content_type ): string {
    if ( 'transcript' === $content_type ) {
        return $prompt . "\n\nHighlight any speaker attributions.";
    }
    return $prompt;
}, 10, 2 );
```

### 10. Editorial Guideline Filters

Guidelines come from the Gutenberg/Core Knowledge storage (`wp_knowledge`
guideline rows), read through `GuidelineContextProvider` — see
[guidelines.md](guidelines.md). These filters let extensions alter the guideline
content as it reaches each AI consumer. All default to returning their input
unchanged.

| Filter | Signature | Fires in / affects |
|--------|-----------|--------------------|
| `vip_workflow_guideline_context` | `(string $context, int $category_id)` | `GuidelineContextProvider::gather_context()` — the canonical guideline text. Applies to ideation draft generation (`DraftBuilder`) **and** the ideation brand context (`IdeationOrchestrator`). The empty state is the literal string `No guideline context available.`. |
| `vip_workflow_editorial_alignment_rules` | `(array $rules, int $post_id)` | `GuidelineContextProvider::get_editorial_alignment_rules()` — the `{ name, rule }` list the Editorial Alignment Checker validates against. |

The discovery scouts (`archive-scout`, `web-researcher`, `media-scout`) intentionally have no guideline hook: they are retrieval tools driven by the search queries the Seed Analyst produces, so guidelines already shape discovery upstream via `vip_workflow_guideline_context`.

```php
// Append a house rule to every guideline-aware AI prompt.
add_filter( 'vip_workflow_guideline_context', function ( string $context ): string {
    if ( 'No guideline context available.' === $context ) {
        return $context;
    }
    return $context . "\n## House Rule\nAlways spell out acronyms on first use.";
} );

// Add a bespoke rule to the Editorial Alignment Checker.
add_filter( 'vip_workflow_editorial_alignment_rules', function ( array $rules ): array {
    $rules[] = array( 'name' => 'Locale', 'rule' => 'Use UK English spelling.' );
    return $rules;
} );
```

---

### 11. Discovery Prompt Enrichment

`vip_workflow_discovery_prompts` runs over the grouped story prompts on their way out
of `GET /vip-workflow/v1/discovery/recommend`, immediately before the response.

It exists because a discovery provider only ever sees its own results, and the plugin
holding an extra signal is usually not the plugin that fetched the prompt. Attaching
performance history to a wire item, or a legal flag to a diary date, has no other seam.

```php
add_filter( 'vip_workflow_discovery_prompts', function ( array $grouped ): array {
    foreach ( $grouped as $group_index => $group ) {
        foreach ( $group['prompts'] as $prompt_index => $prompt ) {
            // Cached read only — see the note on cost below.
            $extra = get_transient( 'my_signal_' . md5( $prompt['title'] ) );

            $grouped[ $group_index ]['prompts'][ $prompt_index ]['my_signal'] =
                is_array( $extra ) ? $extra : null;
        }
    }

    return $grouped;
} );
```

**Each group is `{ provider: array, prompts: array }`.** Return the same shape; a
listener that reshapes it reaches the ideation screen unvalidated.

**Listeners must be cache-only.** This runs inside a REST request the ideation landing
page waits on, and a provider feed can carry forty prompts. Anything that fetches per
prompt makes the screen wait on it. The established pattern is to read a cache, return
immediately on a miss, and warm the miss on a scheduled event —
`workflow-parsely/includes/discovery/class-prompt-scorer.php` is the working example.

**Priority is part of the contract when listeners depend on each other.** A listener
that *reads* what another attached must run later — `workflow-parsely` attaches its
scores at the default priority 10, so a listener that ranks on them registers at 20.
Nothing enforces this, and a listener registered in between that reorders prompts will
silently defeat the one that follows.

**It fires on `recommend` only, not on `search`.** Prompts returned by the search modal
do not carry anything a listener adds here.
