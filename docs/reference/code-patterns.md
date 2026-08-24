# Code Patterns

Copy-pasteable PHP and JavaScript snippets for the most common operations: reading sequences, transitioning statuses, executing tools, registering custom tools, sending notifications, scheduling jobs, and calling the REST API from the editor.

For subsystem context see [architecture.md](architecture.md); for extension-plugin patterns see [extension-points.md](extension-points.md).

---

### 1. Getting the Sequence for a Post

```php
use VIPWorkflow\Sequences\SequenceRepository;

$repository = new SequenceRepository();
$sequence_id = get_post_meta($post_id, '_vip_workflow_sequence_id', true);

if ($sequence_id) {
    $sequence = $repository->get($sequence_id);
}
```

### 2. Transitioning Post Status

```php
use VIPWorkflow\Plugin;

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
use VIPWorkflow\Abilities\AbilityExecutor;

$executor = new AbilityExecutor();
$result = $executor->execute('vip-workflow/seo-check', $post_id, [
    'min_words' => 300,
]);

// $result is AbilityResult object
if ($result->is_success()) {
    $score = $result->get_score();
    $issues = $result->get_data()['issues'] ?? [];
}
```

### 4. Registering a Custom Tool

```php
// In your plugin's init hook
add_action('vip_workflow_register_abilities', function() {
    wp_register_ability('my-plugin/custom-check', [
        'label'       => __('Custom Check', 'my-plugin'),
        'description' => __('My custom content check', 'my-plugin'),
        'category'    => 'vip-workflow',
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
    $permission_error = \VIPWorkflow\Abilities\Tools\require_post_edit_permission($post_id);
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
add_action('vip_workflow_status_transition', function($post_id, $new_status, $old_status, $sequence) {
    // Do something on any transition
}, 10, 4);

// Listen for specific status entry
add_action('vip_workflow_entered_review', function($post_id, $old_status, $sequence) {
    // Send notification to editors
}, 10, 3);

// Listen for tool execution
add_action('vip_workflow_ability_executed', function($ability_id, $post_id, $result) {
    // Log to analytics
}, 10, 3);
```

### 6. Creating a Sequence Programmatically

```php
use VIPWorkflow\Sequences\SequenceRepository;

$repository = new SequenceRepository();

$sequence_id = $repository->create([
    'name' => 'Custom Workflow',
    'slug' => 'custom-workflow',
    'description' => 'Custom workflow for special content',
    'status' => 'active',
    'config' => [
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
    ],
]);
```

### 7. REST API Usage (JavaScript)

```javascript
import apiFetch from '@wordpress/api-fetch';

// Transition post status
const result = await apiFetch({
    path: `/vip-workflow/v1/workflow/post/${postId}/transition`,
    method: 'POST',
    data: {
        to_status: 'review',
        comment: 'Ready for review',
    },
});

// Execute a tool
const toolResult = await apiFetch({
    path: `/vip-workflow/v1/abilities/vip-workflow/seo-check/execute`,
    method: 'POST',
    data: {
        post_id: postId,
        options: {
            min_words: 300,
        },
    },
});

// Get notifications
const notifications = await apiFetch({
    path: '/vip-workflow/v1/notifications',
});

// Mark notification as read
await apiFetch({
    path: `/vip-workflow/v1/notifications/${notificationId}/read`,
    method: 'POST',
});

// Upload asset
const formData = new FormData();
formData.append('file', file);

const asset = await apiFetch({
    path: '/vip-workflow/v1/assets/upload',
    method: 'POST',
    body: formData,
});
```

### 8. Sending Notifications Programmatically

```php
use VIPWorkflow\Notifications\NotificationDispatcher;
use VIPWorkflow\Notifications\Notification;

$dispatcher = new NotificationDispatcher();

$notification = new Notification([
    'type' => 'assignment',
    'title' => 'New Assignment',
    'message' => 'You have been assigned to: ' . get_the_title($post_id),
    'post_id' => $post_id,
    'action_url' => get_edit_post_link($post_id),
]);

// Send to specific user
$dispatcher->send_to_user($user_id, $notification, ['email', 'slack']);

// Send to role
$dispatcher->send_to_role('editor', $notification, ['in-app']);

// Send to desk
$dispatcher->send_to_desk($desk_id, $notification);
```

### 9. Scheduling Background Jobs

```php
use VIPWorkflow\Plugin;

$scheduler = Plugin::get_instance()->get_job_scheduler();

// Schedule one-time job
$scheduler->schedule_once('my-task', time() + 3600, [
    'param1' => 'value1',
]);

// Schedule recurring job
$scheduler->schedule_recurring('my-task', time(), 'daily', [
    'param1' => 'value1',
]);

// Cancel scheduled job
$scheduler->cancel('my-task');
```

### 10. AI Asset Analysis

```php
use VIPWorkflow\Integrations\MediaProcessor;

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

// For asset uploads, AIMediaAnalyzer runs automatically via
// vip_workflow_asset_file_uploaded and writes results to post meta.
$analysis = get_post_meta( $asset_id, '_vip_asset_analysis', true );
```

> **Note:** `AIMediaAnalyzer::analyze_image(int $asset_id, int $attachment_id)` /
> `transcribe_audio` / `transcribe_video` remain public but are thin wrappers
> that write directly to post meta. Prefer `MediaProcessor` for custom call
> sites that need the analysis value rather than the side-effect.

### 11. Configuring Tool Check Modes

```php
use VIPWorkflow\Abilities\AbilitySettings;

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

### 12. Using Bypass Permissions

```php
use VIPWorkflow\Admin\Settings;

// Check if current user can bypass workflow assignment checks
if (Settings::can_user_bypass_workflow()) {
    // User can transition without being assigned
}

// Check if current user can bypass tool checks
if (Settings::can_user_bypass_tool_checks()) {
    // User can transition even with hard check failures
}

// These are configurable per-role in Settings → General
// Default: Administrators can bypass both
```

### 13. Working with Transition Inputs

A transition captures any number of inputs, in the order the author arranged
them, and the editor asks for them in that order before the post moves. At most
one of them may be an `assignment` — it is the slot `requires_assignment` gates
on and the one `AssignmentManager` fills, so a second names nothing
distinguishable, and `Sequence::prepare_config_for_write()` refuses a config
carrying two. A transition that captures nothing declares no `inputs` key at all.

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
// 1. Post meta: _vip_workflow_transition_data (per-status history)
// 2. Workflow events table (audit log with notes array)

// Retrieve transition data:
$transition_data = get_post_meta($post_id, '_vip_workflow_transition_data', true);
$review_history = $transition_data['review'] ?? [];
// Each entry has: timestamp, user_id, user_name, notes[]
```
