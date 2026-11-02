# Data Flows

End-to-end sequence diagrams for the key runtime flows: status transitions with enforcement, sequence registration, tool execution, asset upload with AI analysis, notification dispatch, and the nightly cleanup routine.

Cross-references: see [architecture.md](architecture.md) for component context, [database-schema.md](database-schema.md) for the tables touched, and [code-patterns.md](code-patterns.md) for the API calls each flow exercises.

---

### Flow 1: Post Status Transition (with enforcement)

```
User clicks "Submit for Review" button in Editor Sidebar
    ↓
JavaScript: POST /vip-workflows/v1/workflow/post/{id}/transition
    ↓
WorkflowController::transition()
    ↓
StatusManager::transition($post_id, 'review', $options)
    ↓
1. Get sequence for post
2. Validate transition is allowed in sequence
3. Capability gates (core caps, in order):
    ↓
    Baseline: current_user_can('edit_post', $post_id) — every transition
    ↓
    If the edge crosses a status-region boundary, the core cap for the
    target region (via the post type's cap object):
      - into publish or private → publish_posts
      - out of publish (to a draft/pending-region stage) → edit_published_posts
      - draft ↔ pending → baseline only
    ↓
    If user lacks the cap → return WP_Error (403)
4. Check role-based permissions (allowed_roles)
    ↓
    If user lacks role → return WP_Error (403)
5. Run required tools (if not bypassed)
    ↓
    AbilityExecutor::execute('readability', ['post_id' => $post_id], 'transition')
        ↓
        Execute tool → get AbilityResult (issues live in $result->output['issues'])
        ↓
        Check each issue against AbilitySettings
        ↓
        If is_hard_check() and issue exists → add to hard_failures[]
        If is_soft_check() → add to soft_warnings[]
    ↓
    If hard_failures[] not empty → return WP_Error (422) with failure details
    If soft_warnings[] and not acknowledged → return array with warnings_pending
    ↓
    Log blocked transition to audit trail (if blocked)
6. If the edge crosses a status-region boundary:
    wp_update_post(['post_status' => <target region status>]) — written through
    core BEFORE the stage write; committed status read back and accepted
    (same-region moves never touch post_status; trashed posts are rejected up front)
7. Update meta: _vip_workflows_current_stage_key
8. Process transition input data (if provided)
9. Store transition data in _vip_workflows_transition_data
10. Log to wp_vip_workflows_events with notes
11. Fire action: do_action('vip_workflows_status_transition', ...)
12. Fire action: do_action('vip_workflows_entered_review', ...)
    ↓
EventBus stores the event (audit log, post history, recent activity)
    ↓
NotificationDispatcher delivers on the routed channels
    ↓
Return success to client
    ↓
Editor sidebar updates to show new status and history
```

### Flow 2: Sequence Registration

```
Plugin activation
    ↓
Seeder::seed()
    ↓
Create default sequences in wp_vip_sequences
    ↓
On next page load:
    ↓
init hook fires
    ↓
PostTypeManager::register_post_types() (priority 5)
    ↓
Get all active sequences
    ↓
Map each sequence's post_types to the sequence
    ↓
No custom post statuses are registered — stages live in post meta and
map onto core statuses via each stage's `status` region
```

### Flow 3: Tool Execution

```
User clicks "Run SEO Check" in Tools Panel
    ↓
JavaScript: POST /vip-workflows/v1/abilities/vip-workflows/seo-check/run
    ↓
AbilitiesController::run_ability()
    ↓
AbilityExecutor::execute('vip-workflows/seo-check', ['post_id' => $post_id, 'options' => $options])
    ↓
1. Validate ability exists
2. Get post content
3. Call execute_callback (from wp_register_ability)
    ↓
    seo_check_execute($input)
        ↓
        Analyze content:
        - Word count
        - Meta description
        - Title tags
        - Keyword density
        ↓
        Return result array (becomes AbilityResult::$output)
4. Create AbilityResult object — success/summary/error/duration_ms are its own
   properties; score/status/issues live in $result->output
5. Store in wp_vip_ability_results
6. Fire action: do_action('vip_workflows_ability_executed', ...)
    ↓
Return result to client
    ↓
Tools Panel displays results with pass/warning/fail status
```

### Flow 4: Ideation Document Upload with AI Analysis

There is no standalone asset library (`AssetsController`, `WorkflowNote`, `AIMediaAnalyzer`) — that subsystem was removed in schema `2.16.0`. Uploaded-file AI analysis today happens only inside a Story Ideation project, as one more `wp_vip_ideation_sources` row.

```
User uploads a file (document/image/audio/video) into an ideation project
    ↓
JavaScript: POST /vip-workflows/v1/ideation/{project_id}/sources (multipart/form-data)
    ↓
IdeationSourcesController::upload_source()
    ↓
1. Validate file type and size, upload to the WordPress media library (wp_handle_upload)
2. Insert a wp_vip_ideation_sources row: origin 'upload', attachment_id set,
   source_id a random id (uploads are the one source type not deduplicated by
   the content-derived source_id hash), processing_status 'pending'
3. as_enqueue_async_action('vip_workflows_process_source', [project_id, source_id])
    ↓
SourceProcessingJob::process() (hooked on vip_workflows_process_source)
    ↓
1. Mark the row 'processing'
2. new MediaProcessor(); $processor->process_file($file_path, $mime_type) —
   one entry point dispatching internally by mime type (image → Vision API,
   audio/video → Whisper + optional summary, PDF → PDF analysis)
    ↓
On success: mark 'complete'; write content/excerpt (Markdown::to_plain_text()
of the summary) and a JSON ai_analysis blob (type, processed_at, summary,
key_points) back onto the same wp_vip_ideation_sources row
On failure (exception or WP_Error): mark_error() — processing_status 'error'
with the message, not a silent retry
    ↓
Card re-renders on the mood board with the analyzed content once processing_status is 'complete'
```

### Flow 5: Notification Dispatch

There is no in-app notification inbox and no per-user "notification preferences" — `wp_vip_workflows_notifications` is created by the schema but nothing reads or writes it. Delivery is Email and Slack only, decided by one shared routing option (or a transition's own `notifications` list), not per-user targeting.

```
StatusManager commits a transition
    ↓
do_action('vip_workflows_status_transition', $post_id, $new, $old, $sequence, $context)
    ↓
NotificationDispatcher::handle_status_transition() (hooked at priority 10)
    ↓
1. Is this a go-live? (cause === 'workflow' AND committed_status === 'publish'
   AND previous_status !== 'publish') — a core-driven publish (cron, quick
   edit, REST, CLI) is instead caught by handle_go_live() on
   transition_post_status, suppressed while a workflow transition is mid-commit
   so go-live fires exactly once
    ↓
2. If go-live: dispatch('published', $data) — routed through the shared matrix
3. Always: look up $sequence->get_transition($old, $new)['notifications'] — a
   transition's own configured channel list, independent of the matrix
    ↓
NotificationDispatcher::dispatch($event_type, $data)
    ↓
For each registered, configured channel:
    ↓
    1. should_notify_channel(): debug/mirror-everything ON for this channel,
       OR the routing option lists this channel under $event_type
    2. is_rate_limited(): a transient keyed on channel+event+post_id — skip
       if still within the debounce window (default 60s, filterable via
       vip_workflows_notification_rate_limit_ttl)
    3. If Action Scheduler is available: as_enqueue_async_action('vip_workflows_send_notification', ...)
       Otherwise: send synchronously
        ↓
        build_notification() — fills in a templated title/message for known
        event types ('published', 'transition'), a generic one otherwise
        ↓
        EmailChannel::send($notification) → wp_mail()
        SlackChannel::send($notification) → POST to the channel's webhook URL
```

A transition's own `notifications` list is sent separately via `send_transition_notifications()`, using the Published template if the transition was a go-live (legacy parity) or a generic "stage changed" template otherwise — a channel already notified by the matrix dispatch above is deduplicated by the same rate limit, not sent twice.

### Flow 6: Nightly Cleanup

```
Cron triggers (nightly, 2am site time)
    ↓
ActionScheduler runs: vip_workflows_cleanup
    ↓
Cleanup::run()
    ↓
1. DELETE ability results older than 90 days
2. DELETE workflow events older than 1 year
    ↓
3. Write one maintenance.cleanup event to wp_vip_workflows_events
   (post_id NULL, actor_id 0, actor_type 'system'), carrying the row
   counts — or the database error, when a DELETE failed
    ↓
Admin sees the run in the Audit Log, filterable as "Cleanup Run"
```
