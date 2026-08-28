# Data Flows

End-to-end sequence diagrams for the key runtime flows: status transitions with enforcement, sequence registration, tool execution, asset upload with AI analysis, notification dispatch, and background job runs.

Cross-references: see [architecture.md](architecture.md) for component context, [database-schema.md](database-schema.md) for the tables touched, and [code-patterns.md](code-patterns.md) for the API calls each flow exercises.

---

### Flow 1: Post Status Transition (with enforcement)

```
User clicks "Submit for Review" button in Editor Sidebar
    ↓
JavaScript: POST /vip-workflow/v1/workflow/post/{id}/transition
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
5. Check assignment requirements (requires_assignment)
    ↓
    If required and user doesn't match → return WP_Error (403)
    (unless Settings::can_user_bypass_workflow())
6. Run required tools (if not bypassed)
    ↓
    AbilityExecutor::execute('readability', $post_id)
        ↓
        Execute tool → get AbilityResult
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
7. If the edge crosses a status-region boundary:
    wp_update_post(['post_status' => <target region status>]) — written through
    core BEFORE the stage write; committed status read back and accepted
    (same-region moves never touch post_status; trashed posts are rejected up front)
8. Update meta: _vip_workflow_current_stage_key
9. Mark assignment requirement completed (if applicable)
10. Process transition input data (if provided)
11. Store transition data in _vip_workflow_transition_data
12. Log to wp_vip_workflow_events with notes
13. Fire action: do_action('vip_workflow_status_transition', ...)
14. Fire action: do_action('vip_workflow_entered_review', ...)
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
JavaScript: POST /vip-workflow/v1/abilities/vip-workflow/seo-check/execute
    ↓
AbilitiesController::execute_ability()
    ↓
AbilityExecutor::execute('vip-workflow/seo-check', $post_id, $options)
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
        Return result array
4. Create AbilityResult object
5. Store in wp_vip_ability_results
6. Fire action: do_action('vip_workflow_ability_executed', ...)
    ↓
Return result to client
    ↓
Tools Panel displays results with pass/warning/fail status
```

### Flow 4: Asset Upload with AI Analysis

```
User uploads image to a story
    ↓
JavaScript: POST /vip-workflow/v1/assets/upload (multipart/form-data)
    ↓
AssetsController::upload()
    ↓
1. Validate file type and size
2. Upload to WordPress media library (wp_handle_upload)
3. Create WorkflowNote CPT with attachment ID
4. Fire action: do_action('vip_workflow_asset_uploaded', $asset_id, $attachment_id)
    ↓
AIMediaAnalyzer listening on hook (thin adapter)
    ↓
Checks settings (auto_process, enable_image_analysis, etc.)
    ↓
Delegates to MediaProcessor (core AI logic, shared with research/ideation paths)
    ↓
If image:
    MediaProcessor::analyze_image() → Vision API
        → Returns ['content' => '...'] or WP_Error
        → AIMediaAnalyzer writes result to post meta: _vip_asset_analysis
If audio/video:
    Check file size ≤ 25 MB (AIMediaAnalyzer writes the UI-string error if oversized)
    MediaProcessor::transcribe_audio_video() → Whisper API → optional GPT summary
        → Returns ['content' => transcript, 'summary' => '...'] or WP_Error
        → AIMediaAnalyzer writes formatted result to post meta: _vip_asset_analysis
    ↓
Return asset with analysis to client
    ↓
Asset displayed with AI-generated metadata
```

### Flow 5: Notification Dispatch

```
Status transition occurs (e.g., post enters "review")
    ↓
StatusManager fires: do_action('vip_workflow_entered_review', $post_id, ...)
    ↓
NotificationDispatcher listening on hook
    ↓
1. Check the routing option for channels subscribed to this event
2. If any are, create the Notification object
    ↓
NotificationDispatcher::dispatch($notification)
    ↓
1. Determine target users (role:editor, user:123, desk:5)
2. For each user:
    ↓
    3. Store in wp_vip_workflow_notifications (in-app)
    4. Get user's notification preferences
    5. For each enabled channel:
        ↓
        EmailChannel::send($notification)
            ↓
            wp_mail($to, $subject, $message)
        ↓
        SlackChannel::send($notification)
            ↓
            POST to Slack webhook URL
        ↓
        CustomChannel::send($notification)
            ↓
            Plugin-specific delivery
    ↓
6. Log delivery status
7. Fire action: do_action('vip_workflow_notification_sent', ...)
    ↓
User sees:
- Bell icon in admin bar updates (unread count++)
- Email in inbox
- Slack message in channel
```

### Flow 6: Nightly Cleanup

```
Cron triggers (nightly, 2am site time)
    ↓
ActionScheduler runs: vip_workflow_cleanup
    ↓
Cleanup::run()
    ↓
1. DELETE ability results older than 90 days
2. DELETE workflow events older than 1 year
    ↓
3. Write one maintenance.cleanup event to wp_vip_workflow_events
   (post_id NULL, actor_id 0, actor_type 'system'), carrying the row
   counts — or the database error, when a DELETE failed
    ↓
Admin sees the run in the Audit Log, filterable as "Cleanup Run"
```
