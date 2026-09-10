# Code Patterns

Copy-pasteable PHP and JavaScript snippets for the most common operations: reading sequences, transitioning statuses, executing tools, registering custom tools, sending notifications, and calling the REST API from the editor.

For subsystem context see [architecture.md](architecture.md); for extension-plugin patterns see [extension-points.md](extension-points.md).

---

### 1. Getting the Sequence for a Post

```php
use VIPWorkflows\Sequences\SequenceRepository;

$repository = new SequenceRepository();
$sequence_id = get_post_meta($post_id, '_vip_workflows_sequence_id', true);

if ($sequence_id) {
    $sequence = $repository->find((int) $sequence_id);
}
```

### 2. Transitioning Post Status

```php
use VIPWorkflows\Plugin;

$status_manager = Plugin::get_instance()->get_status_manager();

$result = $status_manager->transition($post_id, 'review', [
    'comment' => 'Ready for review',
    'notify' => true,
]);

if (is_wp_error($result)) {
    // Handle error (invalid transition, failed checks, etc.)
}
```

### 3. Executing a Tool

```php
use VIPWorkflows\Abilities\AbilityExecutor;

$executor = new AbilityExecutor();
$result = $executor->execute('vip-workflows/seo-check', [
    'post_id'   => $post_id,
    'min_words' => 300,
]);

// $result is an AbilityResult object. `success`, `summary`, `error`, and
// `duration_ms` are its own properties; the ability's actual payload lives in
// `output`, shaped per that ability's output_schema.
if ($result->success) {
    $score = $result->output['score'] ?? null;
    $issues = $result->output['issues'] ?? [];
}
```

### 4. Registering a Custom Tool

```php
// In your plugin's init hook
add_action('vip_workflows_register_abilities', function() {
    wp_register_ability('my-plugin/custom-check', [
        'label'       => __('Custom Check', 'my-plugin'),
        'description' => __('My custom content check', 'my-plugin'),
        'category'    => 'vip-workflows',
        'input_schema' => [
            'type' => 'object',
            'required' => ['post_id'],
            'properties' => [
                'post_id' => [
                    'type' => 'integer',
                ],
                'threshold' => [
                    'type' => 'number',
                    'default' => 80,
                ],
            ],
        ],
        'output_schema' => [
            'type' => 'object',
            'properties' => [
                'passed' => ['type' => 'boolean'],
                'score' => ['type' => 'number'],
                'issues' => ['type' => 'array'],
            ],
        ],
        'execute_callback' => 'my_custom_check_execute',
        // The permission_callback is a coarse gate only. `edit_posts` is correct
        // for post-agnostic abilities; for a *post-scoped* ability (one whose
        // input carries a post_id, like this one) it is NOT sufficient on its own
        // — a bare edit_posts check let any Contributor read/act on other authors'
        // posts. Enforce the per-object capability inside the
        // execute callback via require_post_edit_permission($post_id).
        'permission_callback' => function() {
            return current_user_can('edit_posts');
        },
    ]);
});

function my_custom_check_execute($input) {
    $post_id = (int) ($input['post_id'] ?? 0);

    // Per-object authorization: the caller must be able to edit *this* post.
    $permission_error = \VIPWorkflows\Abilities\Tools\require_post_edit_permission($post_id);
    if ($permission_error) {
        return $permission_error;
    }

    $threshold = $input['options']['threshold'] ?? 80;

    // Your check logic here

    return [
        'passed' => $score >= $threshold,
        'score' => $score,
        'issues' => $issues,
    ];
}
```

### 5. Listening for Workflow Events

```php
// Listen for any status transition
add_action('vip_workflows_status_transition', function($post_id, $new_status, $old_status, $sequence) {
    // Do something on any transition
}, 10, 4);

// Listen for specific status entry
add_action('vip_workflows_entered_review', function($post_id, $old_status, $sequence) {
    // Send notification to editors
}, 10, 3);

// Listen for tool execution
add_action('vip_workflows_ability_executed', function($ability_id, $post_id, $result) {
    // Log to analytics
}, 10, 3);
```

### 6. Creating a Sequence Programmatically

```php
use VIPWorkflows\Sequences\SequenceRepository;

$repository = new SequenceRepository();

$config = [
    'version' => '2.0',
    'post_types' => ['post'],
    'statuses' => [
        [
            'key' => 'draft',
            'label' => 'Draft',
            'color' => '#3498db',
            'status' => 'draft',
            'region_entry' => true,
            'transitions' => [
                [
                    'to' => 'review',
                    'label' => 'Submit',
                ],
            ],
        ],
        [
            'key' => 'review',
            'label' => 'Review',
            'color' => '#f39c12',
            'status' => 'draft',
            'transitions' => [
                ['to' => 'publish', 'label' => 'Publish'],
                ['to' => 'draft', 'label' => 'Back to Draft'],
            ],
        ],
        [
            'key' => 'publish',
            'label' => 'Published',
            'color' => '#27ae60',
            'status' => 'publish',
            'region_entry' => true,
            'transitions' => [],
        ],
    ],
];

// create() takes positional args, not an assoc array: name, slug,
// description, config, created_by, and an optional type (default 'workflow').
$sequence_id = $repository->create(
    'Custom Workflow',
    'custom-workflow',
    'Custom workflow for special content',
    $config,
    get_current_user_id()
);
```

### 7. REST API Usage (JavaScript)

```javascript
import apiFetch from '@wordpress/api-fetch';

// Transition post status
const result = await apiFetch({
    path: `/vip-workflows/v1/workflow/post/${postId}/transition`,
    method: 'POST',
    data: {
        to_status: 'review',
        comment: 'Ready for review',
    },
});

// Execute a tool (the route is /run, not /execute)
const toolResult = await apiFetch({
    path: `/vip-workflows/v1/abilities/vip-workflows/seo-check/run`,
    method: 'POST',
    data: {
        post_id: postId,
        options: {
            min_words: 300,
        },
    },
});

// List notification channels
const channels = await apiFetch({
    path: '/vip-workflows/v1/notifications/channels',
});

// Save a channel's settings (there is no in-app notification inbox — only
// the Email/Slack channels and the event-routing matrix)
await apiFetch({
    path: `/vip-workflows/v1/notifications/${channelId}/settings`,
    method: 'POST',
    data: channelSettings,
});

// Note: there is no `/vip-workflows/v1/assets/upload` route. The standalone
// asset library (AssetsController, the Workflow Notes CPT) was removed in
// schema 2.16.0 — see architecture.md § Ideation System. Ideation-project
// research sources go through `/vip-workflows/v1/ideation/{id}` and
// IdeationSourcesController instead.
```

### 8. Sending Notifications Programmatically

`NotificationDispatcher` has no `send_to_user()` / `send_to_role()` / `send_to_desk()` API and there is no `'in-app'` channel — routing is entirely event-driven, through the event-to-channel matrix (Workflows → Notifications → Routing) or a transition's own `notifications` config.

```php
use VIPWorkflows\Notifications\NotificationDispatcher;

$dispatcher = new NotificationDispatcher();

// Fires the same path a real workflow transition takes: checks the routing
// option (and debug mirror), then sends to every configured, matching
// channel. $event_type must be one registered via NotificationDispatcher::get_event_types()
// (filterable with `vip_workflows_notification_events`) or a transition's own
// notifications list — an unrecognized type reaches no one.
$dispatcher->dispatch('published', [
    'post_id'     => $post_id,
    'post_title'  => get_the_title($post_id),
    'author_name' => get_the_author_meta('display_name', get_post_field('post_author', $post_id)),
    'edit_url'    => get_edit_post_link($post_id, 'raw'),
    'view_url'    => get_permalink($post_id),
]);
```

For a per-transition notification (e.g. "notify Slack when this transition fires"), configure it on the transition's `notifications` array in the sequence — see [Working with Transition Inputs](#12-working-with-transition-inputs) and [architecture.md § Notifications System](architecture.md#6-notifications-system). There is no standalone job scheduler in this plugin — see [architecture.md §7](architecture.md#7-scheduled-cleanup); background work runs directly on Action Scheduler (`as_enqueue_async_action()`) or WP-Cron, as `NotificationDispatcher::dispatch()` and `Maintenance\Cleanup` do.

### 9. AI Asset Analysis

```php
use VIPWorkflows\Integrations\MediaProcessor;

$processor = new MediaProcessor();

// Check configuration before calling.
$config = $processor->check_configuration();
if ( is_wp_error( $config ) ) {
    // OpenAI not configured — handle gracefully.
    return;
}

// Analyze an image file.
$result = $processor->analyze_image( $file_path, $mime_type );
if ( ! is_wp_error( $result ) ) {
    $content = $result['content']; // Full analysis text.
}

// Transcribe audio or video.
$result = $processor->transcribe_audio_video( $file_path );
if ( ! is_wp_error( $result ) ) {
    $transcript = $result['content'];          // Raw transcript.
    $summary    = $result['summary'] ?? null;  // AI summary, or null if summarization failed.
}

// For an uploaded ideation source, MediaProcessor::process_file() is the
// entry point SourceProcessingJob::process() actually calls — it dispatches
// internally by mime type instead of the caller choosing analyze_image() vs.
// transcribe_audio_video(). The result is written onto the wp_vip_ideation_sources
// row (content/excerpt/ai_analysis columns), not to post meta — there is no
// AIMediaAnalyzer and no _vip_asset_analysis meta any more (removed with the
// standalone asset library in schema 2.16.0).
$result = $processor->process_file( $file_path, $mime_type );
```

### 10. Configuring Tool Check Modes

```php
use VIPWorkflows\Abilities\AbilitySettings;

$settings = AbilitySettings::get_instance();

// Get check mode for specific tool and check
$mode = $settings->get_check_mode('seo-check', 'min_words');
// Returns: 'soft' or 'hard'

// Check if a specific check is configured as hard
$is_hard = $settings->is_hard_check('seo-check', 'min_words');

// Update check mode
$settings->update_check_mode('seo-check', 'min_words', 'hard');

// Get all settings for a tool
$tool_settings = $settings->get_tool_settings('seo-check');

// Update multiple settings at once
$settings->update_tool_settings('seo-check', [
    'checks' => [
        'min_words' => ['mode' => 'hard', 'threshold' => 500],
        'meta_description' => ['mode' => 'soft'],
    ],
]);
```

### 11. Using Bypass Permissions

```php
use VIPWorkflows\Admin\Settings;

// Check if current user can bypass workflow rules (role restrictions, required fields)
if (Settings::can_user_bypass_workflow()) {
    // User can transition past the sequence's own rules
}

// Check if current user can bypass tool checks
if (Settings::can_user_bypass_tool_checks()) {
    // User can transition even with hard check failures
}

// These are configurable per-role in Settings → General
// Default: Administrators can bypass both
```

### 12. Working with Transition Inputs

A transition captures any number of inputs, in the order the author arranged
them, and the editor asks for them in that order before the post moves. At most
one of them may be an `assignment` — the one slot the editor collects an
assignee for — and `Sequence::prepare_config_for_write()` refuses a config
carrying two. The sequence editor mints an assignment's `meta_key` when the input
is added; authors never type it. A transition that captures nothing declares no
`inputs` key at all.

```php
// In sequence config:
$transition = [
    'to' => 'review',
    'label' => 'Submit for Review',
    'inputs' => [
        [
            'type' => 'textarea',  // or 'text', 'assignment'
            'note_id' => 'n123abc',
            'note_name' => 'Submission Notes',
            'meta_key' => 'wfp_n123abc_submission_notes',
            'required' => true,
        ],
        [
            'type' => 'assignment',
            'meta_key' => 'legal_reviewer',
            'assignee_type' => 'user',
        ],
    ],
];

// Every input writes under its own meta key, which is why two on one transition
// may never share one: the values arrive as a single flat map.

// When transition executes, input data stored in:
// 1. Post meta: _vip_workflows_transition_data (per-status history)
// 2. Workflow events table (audit log with notes array)

// Retrieve transition data:
$transition_data = get_post_meta($post_id, '_vip_workflows_transition_data', true);
$review_history = $transition_data['review'] ?? [];
// Each entry has: timestamp, user_id, user_name, notes[]
```
