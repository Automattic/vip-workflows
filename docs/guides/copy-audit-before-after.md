# UX copy audit — before / after

Every user-facing string that changed. Derived from the diff between the audit commit and HEAD rather than from an edit log, so a string renamed twice shows only its **net** result. **415 strings** across the plugin and its five extension plugins.

Rules and rationale: [`copy-standard.md`](copy-standard.md). Test-only changes are excluded.

| Group | Strings |
|---|---|
| [Capitalization](#capitalization) | 100 |
| [Terminology: sequence → workflow](#terminology-sequence-workflow) | 142 |
| [Capitalization + terminology](#capitalization-terminology) | 22 |
| [Ability labels](#ability-labels) | 8 |
| [New: reader-facing tool summaries](#new-reader-facing-tool-summaries) | 26 |
| [New: Quick Edit strings, now translatable](#new-quick-edit-strings-now-translatable) | 5 |
| [Helper text](#helper-text) | 13 |
| [Rewritten for clarity](#rewritten-for-clarity) | 16 |
| [Errors](#errors) | 23 |
| [Permission errors](#permission-errors) | 15 |
| [Empty states](#empty-states) | 5 |
| [Removed “Please”](#removed-please) | 8 |
| [Removed “successfully”](#removed-successfully) | 4 |
| [Typography](#typography) | 22 |
| [Terminal periods](#terminal-periods) | 6 |
| **Total** | **415** |

---

## Capitalization (100)

*82 distinct strings across 100 sites.*

| Before | After | Where |
|---|---|---|
| Add Item | Add item | `admin.js` |
| Add Source URL | Add source URL | `AddSourceModal.js` |
| Added by You | Added by you | `MoodBoard.js` |
| AI Analysis | AI analysis | `ImageCard.js` |
| AI Analyzed | AI analyzed | `DocumentCard.js` |
| AI Generated | AI generated | `MoodBoard.js` |
| AI Generated (OpenAI) | AI generated (OpenAI) | `class-ai-image-provider.php` |
| AI Summarized | AI summarized | `ArticleCard.js` |
| AI Summary | AI summary | `shared.js` |
| All Posts | All posts | `Calendar.js` |
| Archive Scout | Archive scout | `class-archive-scout.php` |
| Checklist Items | Checklist items | `admin.js` |
| Cleanup Run | Cleanup run | `class-status-manager.php` |
| Coming Soon | Coming soon | `AppShell.js` |
| Content Guidelines | Content guidelines | `class-ideation-orchestrator.php` |
| Copy Edit | Copy edit | `workflow-agent-copy-edit.php` |
| Edit Project | Edit project | `ProjectEditModal.js` |
| Editorial Guidance | Editorial guidance | `class-editorial-mentor.php` |
| Editorial Mentor | Editorial mentor | `AssistantPanel.js` |
| Follow-up Queries | Follow-up queries | `AssistantPanel.js` |
| Headline Suggestions | Headline suggestions | `class-headline-suggestions.php` |
| In Pipeline | In pipeline | `RecentProjects.js` |
| In Review | In review | `editorial-review-sequence.json` |
| Kanban Board | Kanban board | `KanbanBoard.js` |
| Key Event | Key event | `PromptPreviewModal.js` |
| Key Points | Key points | `IdeationSummary.js` |
| Keyword Check | Keyword check | `keyword-check.php` |
| Last Updated | Last updated | `MyWorkPage.js` |
| Media Scout | Media scout | `class-media-scout.php` |
| My Ability | My ability | `class-plugin.php` |
| My Content in Workflow | My content in workflow | `class-dashboard-widget.php` |
| My Ideation | My ideation | `MyDashboardPage.js` |
| My Queue | My queue | `MyDashboardPage.js` |
| My Work | My work | `MyDashboardPage.js` |
| News Angle | News angle | `class-seed-analyst.php` |
| No Workflow | No workflow | `KanbanBoard.js` |
| Parse.ly Trending | Parse.ly trending | `class-parsely-discovery-provider.php` |
| Past Performance | Past performance | `class-performance-signals.php` |
| Phase Sequences (%d) | Phase sequences (%d) | `SequencesList.js` |
| Post Claimed | Post claimed | `class-status-manager.php` |
| Post Released | Post released | `class-status-manager.php` |
| Pre-publish Checklist | Pre-publish checklist | `class-checklist-tool.php` |
| Project Name | Project name | `ProjectEditModal.js` |
| Project Summary | Project summary | `IdeationSummary.js` |
| Publish Now | Publish now | `editorial-review-sequence.json` |
| Published Only | Published only | `Calendar.js` |
| Readability Analysis | Readability analysis | `readability.php` |
| Ready to Publish | Ready to publish | `multimedia-sequence.json` |
| Remove From Workflow | Remove from workflow | `remove-from-workflow.php` |
| Request Changes | Request changes | `editorial-review-sequence.json` |
| Seed Analyst | Seed analyst | `class-seed-analyst.php` |
| Select a Workflow | Select a workflow | `WorkflowRequiredModal.js` |
| Send Back for Review | Send back for review | `editorial-review-sequence.json` |
| SEO Check | SEO check | `seo-check.php` |
| Slack (Default) | Slack (default) | `class-slack-channel.php` |
| Slack (New) | Slack (new) | `NotificationChannelsTab.js` |
| Smart Linking | Smart linking | `class-smart-linking.php` |
| Smart Linking Check | Smart linking check | `class-smart-linking-agent.php` |
| Source Detail | Source detail | `ArticleCard.js` |
| Stage Changed | Stage changed | `class-notification-dispatcher.php` |
| Submit for Review | Submit for review | `editorial-review-sequence.json` |
| Tag Sanity Check | Tag sanity check | `workflow-agent-tag-sanity-check.php` |
| Test Email | Test email | `class-email-channel.php` |
| Test Message | Test message | `class-slack-channel.php` |
| Tool Executed | Tool executed | `class-status-manager.php` |
| Tool Failed | Tool failed | `class-status-manager.php` |
| Tool Warnings | Tool warnings | `class-status-manager.php` |
| Top Story | Top story | `PromptPreviewModal.js` |
| Transition Blocked | Transition blocked | `class-status-manager.php` |
| Transition Notes | Transition notes | `EventNotes.js` |
| Update Post Fields | Update post fields | `update-post-fields.php` |
| Warnings Detected | Warnings detected | `WorkflowPanel.js` |
| Web Images (Tavily) | Web images (Tavily) | `class-tavily-image-provider.php` |
| Web Researcher | Web researcher | `class-web-researcher.php` |
| Web Videos (Tavily) | Web videos (Tavily) | `class-tavily-video-provider.php` |
| Workflow Assigned | Workflow assigned | `class-status-manager.php` |
| Workflow Completed | Workflow completed | `TransitionRail.js` |
| Workflow History | Workflow history | `WorkflowHistoryModal.js` |
| Workflow Removed | Workflow removed | `class-status-manager.php` |
| Workflow Summary | Workflow summary | `class-dashboard-widget.php` |
| Workflow: Pre-publish Checklist | Workflow: Pre-publish checklist | `editor.js` |
| YouTube Videos | YouTube videos | `class-you-tube-video-provider.php` |

## Terminology: sequence → workflow (142)

*112 distinct strings across 142 sites.*

| Before | After | Where |
|---|---|---|
| A sequence needs at least one stage. | A workflow needs at least one stage. | `StageInspector.js` |
| Activate Sequence | Activate workflow | `activate-sequence.php` |
| Are you sure you want to delete this sequence? This cannot be undone. | Are you sure you want to delete this workflow? This cannot be undone. | `SequenceGraphEditor.js` |
| Array of sequence objects with status details. | Array of workflow objects with status details. | `get-sequences.php` |
| Array of sequences with their status counts. | Array of workflows with their status counts. | `get-workflow-summary.php` |
| Array of status configurations defining the sequence stages. | Array of status configurations defining the workflow stages. | `create-sequence.php` |
| Delete sequence | Delete workflow | `SequenceGraphEditor.js` |
| Drop the sequence JSON file to import it | Drop the workflow JSON file to import it | `SequencesList.js` |
| Every stage in this sequence already has a status region. | Every stage in this workflow already has a status region. | `class-sequence-repository.php` |
| Failed to assign sequence. | Failed to assign workflow. | `class-workflow-controller.php` |
| Failed to change the sequence lifecycle state. | Failed to change the workflow lifecycle state. | `activate-sequence.php` |
| Failed to create sequence. | Failed to create workflow. | `class-sequences-controller.php` |
| Failed to delete sequence. | Failed to delete workflow. | `class-sequences-controller.php` |
| Failed to import sequence. | Failed to import workflow. | `class-sequences-controller.php` |
| Failed to update sequence. | Failed to update workflow. | `class-sequences-controller.php` |
| Import Sequence | Import workflow | `import-sequence.php` |
| Import sequence | Import workflow | `SequencesList.js` |
| Inactive sequences are saved as drafts and not applied to content. | Inactive workflows are saved as drafts and not applied to content. | `SequenceIdentityFields.js` |
| Initial lifecycle state of the sequence. Defaults to "active". | Initial lifecycle state of the workflow. Defaults to "active". | `create-sequence.php` |
| Loading sequences… | Loading workflows… | `SequencesList.js` |
| Loading sequence… | Loading workflow… | `SequenceGraphEditor.js` |
| New sequence | New workflow | `SequencesList.js` |
| No sequences match your search. | No workflows match your search. | `SequencesList.js` |
| Non-fatal advisories about the created sequence (e.g. no valid post types configured). | Non-fatal advisories about the created workflow (e.g. no valid post types configured). | `create-sequence.php` |
| Non-fatal advisories about the updated sequence (e.g. no valid post types configured). | Non-fatal advisories about the updated workflow (e.g. no valid post types configured). | `update-sequence.php` |
| Nothing ends this sequence: %s has no way out and is not marked as the end, so a post arriving there would be stuck. Drag from it to the End node to finish the flow there | Nothing ends this workflow: %s has no way out and is not marked as the end, so a post arriving there would be stuck. Drag from it to the End node to finish the flow there | `graph-model.js` |
| Nothing ends this sequence: %s have no way out and none is marked as the end, so a post arriving at one would be stuck. Drag from whichever should finish the flow to the  | Nothing ends this workflow: %s have no way out and none is marked as the end, so a post arriving at one would be stuck. Drag from whichever should finish the flow to the  | `graph-model.js` |
| Nothing ends this sequence: no stage is joined to the End node, so a post could travel it forever without finishing. Drag from the stage that should finish the flow to th | Nothing ends this workflow: no stage is joined to the End node, so a post could travel it forever without finishing. Drag from the stage that should finish the flow to th | `graph-model.js` |
| Number of sequences returned. | Number of workflows returned. | `get-sequences.php` |
| Number of statuses in the imported sequence. | Number of statuses in the imported workflow. | `import-sequence.php` |
| Number of statuses in the sequence. | Number of statuses in the workflow. | `create-sequence.php` |
| Number of statuses in the updated sequence. | Number of statuses in the updated workflow. | `update-sequence.php` |
| Optional name override for the imported sequence. Defaults to the name in the JSON. | Optional name override for the imported workflow. Defaults to the name in the JSON. | `import-sequence.php` |
| Optional sequence description. | Optional workflow description. | `create-sequence.php` |
| Optional sequence ID to filter by. Omit for all active sequences. | Optional workflow ID to filter by. Omit for all active workflows. | `get-workflow-summary.php` |
| Post types this sequence applies to (workflow only). Omitting this detaches the sequence from every post type. | Post types this workflow applies to (workflow only). Omitting this detaches the workflow from every post type. | `update-sequence.php` |
| Returns post counts grouped by workflow status for each active sequence. | Returns post counts grouped by workflow status for each active workflow. | `get-workflow-summary.php` |
| Search sequences | Search workflows | `SequencesList.js` |
| Sequence | Workflow | `Inspector.js` |
| Sequence Activated | Workflow activated | `class-status-manager.php` |
| Sequence activated | Workflow activated | `event-description.js` |
| Sequence config is required and must be an object. | Workflow config is required and must be an object. | `class-sequences-controller.php` |
| Sequence creation returned an unexpected response. | Workflow creation returned an unexpected response. | `create-sequence.php` |
| Sequence Deactivated | Workflow deactivated | `class-status-manager.php` |
| Sequence deactivated | Workflow deactivated | `event-description.js` |
| Sequence description. Omitting this clears it. | Workflow description. Omitting this clears it. | `update-sequence.php` |
| Sequence must have at least one stage. | Workflow must have at least one stage. | `class-sequences-controller.php` |
| Sequence Name | Workflow name | `SequencesList.js` |
| Sequence name is required. | Workflow name is required. | `class-sequences-controller.php` |
| Sequence not found. | Workflow not found. | `activate-sequence.php` |
| Sequence settings. | Workflow settings. | `create-sequence.php` |
| Sequence settings. Omitting this clears them. | Workflow settings. Omitting this clears them. | `update-sequence.php` |
| Sequence type the proposed config is for. Only meaningful with "config"; a stored sequence uses its own type. Defaults to "workflow". | Workflow type the proposed config is for. Only meaningful with "config"; a stored workflow uses its own type. Defaults to "workflow". | `validate-sequence.php` |
| Sequence update returned an unexpected response. | Workflow update returned an unexpected response. | `update-sequence.php` |
| Sequence Updated | Workflow updated | `class-status-manager.php` |
| Sequence updated, now %d stage | Workflow updated, now %d stage | `event-description.js` |
| Sequence was created but could not be retrieved. | Workflow was created but could not be retrieved. | `class-sequences-controller.php` |
| Sequence was created but the response is missing the "%s" field. | Workflow was created but the response is missing the "%s" field. | `create-sequence.php` |
| Sequence was imported but the response did not include the created sequence. | Workflow was imported but the response did not include the created workflow. | `import-sequence.php` |
| Sequence was updated but the response is missing the "%s" field. | Workflow was updated but the response is missing the "%s" field. | `update-sequence.php` |
| Sequences | Workflows | `class-admin.php` |
| The agent routed this post to "%s", a stage the sequence does not define a region for, so it stopped here. Fix the stage in the sequence editor, or move the post back. | The agent routed this post to "%s", a stage the workflow does not define a region for, so it stopped here. Fix the stage in the workflow editor, or move the post back. | `class-stage-agent-runner.php` |
| The complete array of status configurations defining the sequence stages. Replaces the existing stages entirely. | The complete array of status configurations defining the workflow stages. Replaces the existing stages entirely. | `update-sequence.php` |
| The created sequence ID. | The created workflow ID. | `create-sequence.php` |
| The exported sequence object (as produced by the export endpoint): must include type, name, and config.statuses. | The exported workflow object (as produced by the export endpoint): must include type, name, and config.statuses. | `import-sequence.php` |
| The generated sequence slug. | The generated workflow slug. | `create-sequence.php` |
| The ID of the sequence to update. | The ID of the workflow to update. | `update-sequence.php` |
| The ID of the sequence whose lifecycle state should change. | The ID of the workflow whose lifecycle state should change. | `activate-sequence.php` |
| The imported sequence ID. | The imported workflow ID. | `import-sequence.php` |
| The sequence could not be saved. | The workflow could not be saved. | `class-sequences-controller.php` |
| The sequence ID. | The workflow ID. | `activate-sequence.php` |
| The sequence lifecycle state (imported sequences are created as draft). | The workflow lifecycle state (imported workflows are created as draft). | `import-sequence.php` |
| The sequence lifecycle state, unchanged by this ability. | The workflow lifecycle state, unchanged by this ability. | `update-sequence.php` |
| The sequence lifecycle state. | The workflow lifecycle state. | `create-sequence.php` |
| The sequence name. | The workflow name. | `activate-sequence.php` |
| The sequence slug. | The workflow slug. | `update-sequence.php` |
| The sequence type the config was validated as. | The workflow type the config was validated as. | `validate-sequence.php` |
| The sequence type. | The workflow type. | `create-sequence.php` |
| The sequence UUID. | The workflow UUID. | `create-sequence.php` |
| The server did not say what this sequence can be built from. | The server did not say what this workflow can be built from. | `SequenceGraphEditor.js` |
| The updated sequence ID. | The updated workflow ID. | `update-sequence.php` |
| The validated sequence ID, or null when a proposed config was validated. | The validated workflow ID, or null when a proposed config was validated. | `validate-sequence.php` |
| The workflow the post was removed from. Empty when its sequence no longer exists. | The workflow the post was removed from. Empty when its workflow no longer exists. | `remove-from-workflow.php` |
| These sequences could not be upgraded and are not usable until someone fixes them in the Sequence editor. Their stages still have no status region, so any post that reach | These workflows could not be upgraded and are not usable until someone fixes them in the Workflow editor. Their stages still have no status region, so any post that reach | `class-admin.php` |
| This sequence cannot be activated because its stored configuration is invalid: %s | This workflow cannot be activated because its stored configuration is invalid: %s | `activate-sequence.php` |
| This sequence cannot be activated: these stages have no status region, and every read of them fails — %s. Repair the sequence first. | This workflow cannot be activated: these stages have no status region, and every read of them fails — %s. Repair the workflow first. | `activate-sequence.php` |
| This sequence cannot be activated: these status regions hold stages but designate no entry checkpoint, so any status change into them fails — %s. Repair the sequence firs | This workflow cannot be activated: these status regions hold stages but designate no entry checkpoint, so any status change into them fails — %s. Repair the workflow firs | `activate-sequence.php` |
| This sequence cannot be applied because its configuration is invalid: %s | This workflow cannot be applied because its configuration is invalid: %s | `class-workflow-controller.php` |
| This sequence cannot be saved yet — %d thing needs fixing: | This workflow cannot be saved yet — %d thing needs fixing: | `SequenceGraphEditor.js` |
| This sequence cannot be saved yet — %d things need fixing: | This workflow cannot be saved yet — %d things need fixing: | `SequenceGraphEditor.js` |
| This sequence has changes that have not been saved. Leaving now discards them. | This workflow has changes that have not been saved. Leaving now discards them. | `SequenceGraphEditor.js` |
| This sequence has no metadata fields. Add one to collect a value alongside every post that travels it. | This workflow has no metadata fields. Add one to collect a value alongside every post that travels it. | `MetadataFieldsEditor.js` |
| This sequence has no name. Click an empty part of the canvas and fill in Name in the Sequence panel. | This workflow has no name. Click an empty part of the canvas and fill in Name in the Workflow panel. | `graph-model.js` |
| This sequence has no stage in the Publish region, so it cannot publish posts until you set one. | This workflow has no stage in the Publish region, so it cannot publish posts until you set one. | `class-admin.php` |
| This sequence has no stages, so there is nothing for a post to be in. Right-click the canvas to add one. | This workflow has no stages, so there is nothing for a post to be in. Right-click the canvas to add one. | `graph-model.js` |
| This sequence is attached to no post type, so nothing would ever run through it. Click an empty part of the canvas and choose at least one under Post types. | This workflow is attached to no post type, so nothing would ever run through it. Click an empty part of the canvas and choose at least one under Post types. | `SequenceGraphEditor.js` |
| This sequence needs a change only you can make before it can be repaired: %s | This workflow needs a change only you can make before it can be repaired: %s | `class-sequence-repository.php` |
| This stage routes no destination for the "%s" outcome, so the post stopped here. Route it in the sequence editor, or move the post back. | This stage routes no destination for the "%s" outcome, so the post stopped here. Route it in the workflow editor, or move the post back. | `class-stage-agent-runner.php` |
| This transition asks for an assignee of type “%s”, which cannot be chosen here. Nothing has been assigned and the post has not moved — the sequence needs a user or role a | This transition asks for an assignee of type “%s”, which cannot be chosen here. Nothing has been assigned and the post has not moved — the workflow needs a user or role a | `TransitionInputPopover.js` |
| This workflow cannot be used until its stages have status regions: %s Open the sequence and assign the missing ones. | This workflow cannot be used until its stages have status regions: %s Open the workflow and assign the missing ones. | `class-status-manager.php` |
| Transitions removed, because the sequence was stored with a stage holding two to the same target. Their roles, required tools and notifications went with them: %s. | Transitions removed, because the workflow was stored with a stage holding two to the same target. Their roles, required tools and notifications went with them: %s. | `class-admin.php` |
| True to put the sequence live, false to return it to draft. Required: there is no default. | True to put the workflow live, false to return it to draft. Required: there is no default. | `activate-sequence.php` |
| Untitled sequence | Untitled workflow | `Inspector.js` |
| Update Sequence | Update workflow | `update-sequence.php` |
| Validate Sequence | Validate workflow | `validate-sequence.php` |
| Validate the stored configuration of this sequence. Mutually exclusive with "config". | Validate the stored configuration of this workflow. Mutually exclusive with "config". | `validate-sequence.php` |
| Warning: this sequence references post types that no longer exist: %s. Select valid post types and save. | Warning: this workflow references post types that no longer exist: %s. Select valid post types and save. | `SequenceGraphEditor.js` |
| Whether the call changed anything. False when the sequence was already in the requested state. | Whether the call changed anything. False when the workflow was already in the requested state. | `activate-sequence.php` |
| Whether the sequence was created. | Whether the workflow was created. | `create-sequence.php` |
| Whether the sequence was imported. | Whether the workflow was imported. | `import-sequence.php` |
| Whether the sequence was updated. | Whether the workflow was updated. | `update-sequence.php` |
| …or drop a sequence JSON file here. | …or drop a workflow JSON file here. | `SequencesList.js` |

## Capitalization + terminology (22)

*21 distinct strings across 22 sites.*

| Before | After | Where |
|---|---|---|
| Create Sequence | New workflow | `create-sequence.php` |
| Creates a new workflow sequence with its statuses, transitions, and metadata fields. | Creates a new workflow with its statuses, transitions, and metadata fields. | `create-sequence.php` |
| Editorial Sequences (%d) | Workflows (%d) | `SequencesList.js` |
| Failed to export sequence: | Could not export the workflow. Details: %s | `SequencesList.js` |
| Get Sequences | Workflows | `get-sequences.php` |
| Imports a workflow sequence from an exported JSON definition. The imported sequence is created as a draft. | Imports a workflow from an exported JSON definition. The imported workflow is created as a draft. | `import-sequence.php` |
| Lists active workflow sequences with their statuses and configuration. | Lists active workflows with their statuses and configuration. | `get-sequences.php` |
| New editorial sequence | New workflow | `SequencesList.js` |
| No editorial sequences yet. | No workflows yet. | `SequencesList.js` |
| No workflow sequence for this post. | No workflow for this post. | `class-status-manager.php` |
| Please enter a name for the sequence. | Enter a name for the workflow. | `SequencesList.js` |
| Please upload a sequence JSON file. | Upload a workflow JSON file. | `SequencesList.js` |
| Post types this sequence applies to (workflow only). A workflow sequence with no valid post types is not attached to any content and cannot be used — pass at least one re | Post types this workflow applies to (workflow only). A workflow with no valid post types is not attached to any content and cannot be used — pass at least one registered  | `create-sequence.php` |
| Puts a workflow sequence live, or takes it back to draft. This is the only ability that changes a sequence lifecycle state; Update Sequence cannot. Activation is refused  | Puts a workflow live, or takes it back to draft. This is the only ability that changes a workflow lifecycle state; Update Workflow cannot. Activation is refused when the  | `activate-sequence.php` |
| Replaces the configuration of an existing workflow sequence — its statuses, transitions, required tools, role permissions and metadata fields. This is a full replacement, | Replaces the configuration of an existing workflow — its statuses, transitions, required tools, role permissions and metadata fields. This is a full replacement, not a pa | `update-sequence.php` |
| Sequences define workflow stages and transitions for your content types. | A workflow is the set of stages a post moves through, and the routes between them. | `SequencesList.js` |
| The "%1$s" sequence has no stage with the %2$s status, so it cannot be started on this post. Change the post\'s status, or choose a sequence that covers it. | The "%1$s" workflow has no stage with the %2$s status, so it cannot be started on this post. Change the post’s status, or choose a workflow that covers it. | `class-status-manager.php` |
| This upgrade gave every workflow stage a status region, and made a stage hold at most one transition per target. These sequences had to be changed to fit. The changes are | This upgrade gave every workflow stage a status region, and made a stage hold at most one transition per target. These workflows had to be changed to fit. The changes are | `class-admin.php` |
| This workflow sequence has no valid post types configured, so it is not attached to any content type and cannot be used yet. Re-create it with a "post_types" array (e.g.  | This workflow has no valid post types configured, so it is not attached to any content type and cannot be used yet. Re-create it with a "post_types" array (e.g. ["post"]) | `create-sequence.php` |
| This workflow sequence now has no valid post types configured, so it is not attached to any content type and cannot be used. An update replaces the whole configuration —  | This workflow now has no valid post types configured, so it is not attached to any content type and cannot be used. An update replaces the whole configuration — pass "pos | `update-sequence.php` |
| Upload Sequence JSON: | Upload workflow JSON | `SequencesList.js` |

## Ability labels (8)

| Before | After | Where |
|---|---|---|
| Get Available Transitions | Available transitions | `get-available-transitions.php` |
| Get My Assignments | My assignments | `get-my-assignments.php` |
| Get Posts By Status | Posts by status | `get-posts-by-status.php` |
| Get Recent Activity | Recent activity | `get-recent-activity.php` |
| Get Stale Posts | Stale posts | `get-stale-posts.php` |
| Get Transition History | Transition history | `get-transition-history.php` |
| Get Workflow Summary | Workflow summary | `get-workflow-summary.php` |
| Transition Post | Move post | `transition-post.php` |

## New: reader-facing tool summaries (26)

Added as `meta.summary` — the sentence the tool card and the graph editor's tool picker now render in place of the model's `description`.

| String | Where |
|---|---|
| Changes a post’s title, excerpt, date or author. | `update-post-fields.php` |
| Checks a workflow configuration for problems without saving it. | `validate-sequence.php` |
| Checks the post against SEO basics: meta description, headings, keywords and images. | `seo-check.php` |
| Checks the post’s tags for typos, duplicates and off-topic terms. | `workflow-agent-tag-sanity-check.php` |
| Compares this post with how similar stories performed, using Parse.ly. | `class-performance-check.php` |
| Copy-edits the post for grammar, spelling and style, saving the result as a revision. | `workflow-agent-copy-edit.php` |
| Counts posts at each status, for every active workflow. | `get-workflow-summary.php` |
| Creates a draft workflow from an exported JSON definition. | `import-sequence.php` |
| Creates a workflow with its stages, transitions and metadata fields. | `create-sequence.php` |
| Flags banned words, competitor names and other terms you list. | `keyword-check.php` |
| Lists posts sitting at a given workflow status. | `get-posts-by-status.php` |
| Lists posts stuck at one status for longer than a set number of days. | `get-stale-posts.php` |
| Lists recent editorial activity across the site. | `get-recent-activity.php` |
| Lists the active workflows and their stages. | `get-sequences.php` |
| Lists the moves a given post and user can make right now. | `get-available-transitions.php` |
| Lists the posts assigned to you. | `get-my-assignments.php` |
| Moves a post to another status, respecting who is allowed to make the move. | `transition-post.php` |
| Puts a workflow live, or takes it back to draft. | `activate-sequence.php` |
| Replaces a workflow’s whole configuration. Anything you leave out is cleared. | `update-sequence.php` |
| Requires every item on your pre-publish checklist to be ticked. | `class-checklist-tool.php` |
| Scores how easy the post is to read, using Flesch-Kincaid. | `readability.php` |
| Shows a post’s trail through its workflow. | `get-transition-history.php` |
| Shows how comparable past coverage performed, and which angles did best. | `class-performance-signals.php` |
| Suggests alternative headlines, using Parse.ly. | `class-headline-suggestions.php` |
| Suggests internal links for the post, using Parse.ly. | `class-smart-linking.php` |
| Takes a post out of its workflow, leaving its published status alone. Cannot be undone. | `remove-from-workflow.php` |

## New: Quick Edit strings, now translatable (5)

These were hardcoded English inside an inline script and could not be translated at all.

| String | Where |
|---|---|
| Could not load the moves for this post. Reload the page to try again. | `class-posts-columns.php` |
| Could not move the post. | `class-posts-columns.php` |
| No moves available from this stage. | `class-posts-columns.php` |
| Placeholders: %s | `PromptsSettings.js` |
| Working… | `class-posts-columns.php` |

## Helper text (13)

| Before | After | Where |
|---|---|---|
| A friendly name to identify this Slack channel | *(removed)* | `NotificationChannelsTab.js` |
| An AI stage routes on what a language model returned, and that model reads the post’s own content, so publishing and going private both wait for a person. Off by default. | Lets an AI stage publish or go private without waiting for a person. It grants no rights the post’s author lacks. | `SequenceSettingsInspector.js` |
| Analyzes a fetched video transcript. Variables: {title}, {transcript}. | Analyzes a fetched video transcript. | `class-core-prompts.php` |
| Choosing an agent makes this an AI stage: it runs when a post enters, and routes the post onward by outcome. Drag from the stage’s pass, fail and error handles on the can | Makes this an AI stage: the agent runs when a post enters, and routes it onward by its outcome. | `StageInspector.js` |
| Evaluates ideation progress and suggests next steps. Variables: {seed}, {tags}, {news_angle}, {total_cards}, {pinned_count}, {pinned_breakdown}, {dismissed_count}, {pinne | Evaluates ideation progress and suggests next steps. | `class-core-prompts.php` |
| Extracts structured metadata (tags, entities, queries) from a story seed. Variables: {seed}, {brand_context}. | Extracts structured metadata (tags, entities, queries) from a story seed. | `class-core-prompts.php` |
| Ranks candidate archive articles by relevance to the seed. Variables: {limit}, {seed}, {candidate_text}. | Ranks candidate archive articles by relevance to the seed. | `class-core-prompts.php` |
| Summarizes a single research source. Variables: {max_length}, {title}, {content}. | Summarizes a single research source. | `class-core-prompts.php` |
| Summary prompt for transcripts and extracted text. {content_type} is the kind of content being summarized. | Summary prompt for transcripts and extracted text. | `class-core-prompts.php` |
| Synthesizes multiple research sources for a project. Variables: {source_count}, {max_length}, {context}. | Synthesizes multiple research sources for a project. | `class-core-prompts.php` |
| System instruction for editorial draft generation. Variables: {guideline_context}, {word_count}, {image_placement}. | System instruction for editorial draft generation. | `class-core-prompts.php` |
| User prompt for editorial draft generation. Variables: {project_name}, {research_context}, {image_instructions}. | User prompt for editorial draft generation. | `class-core-prompts.php` |
| Where a post lands when something outside the workflow sets this status — publishing from the editor, a scheduled post going live, a REST write — and where a sequence ass | Where a post lands when something outside the sequence gives it this status — an editor publishing, a scheduled post going live, a REST write. | `RegionInspector.js` |

## Rewritten for clarity (16)

| Before | After | Where |
|---|---|---|
| Ability meta, including supports, stage_eligible and transition_eligible. | Ability meta, including summary, supports, stage_eligible and transition_eligible. | `class-abilities-controller.php` |
| An error occurred while rendering this page. | This page could not be rendered. Reload to try again. | `ErrorBoundary.js` |
| Configure agents that assist with editorial work. | Agents run when a post enters a stage, and route it onward by what they find. | `Agents.js` |
| Configure workflow settings and preferences. | How workflows behave site-wide: enforcement, permissions, AI and integrations. | `Settings.js` |
| Configure workflow tools available to your team. | Tools check a post before it moves. A transition can require any of them. | `Tools.js` |
| Dry-runs a sequence configuration through the write gate without saving it. Reports whether it is valid, what normalization would change, and which stage/region invariant | Dry-runs a workflow configuration through the write gate without saving it. Reports whether it is valid, what normalization would change, and which stage/region invariant | `validate-sequence.php` |
| Enter a unique name for this sequence. | Must be unique. | `SequencesList.js` |
| Human-readable description of what the ability does. | Tool description written for a language model. Not for display — use label and meta.summary. | `class-abilities-controller.php` |
| Must match assignment key from another transition | Must match the key an earlier transition assigned. | `TransitionAssignmentConfig.js` |
| Restrict this transition to a previously assigned user or role | Only the user or role an earlier transition assigned can make this move. | `TransitionAssignmentConfig.js` |
| Sequence Type: | Type: | `SequencesList.js` |
| The "sequence_json" parameter is required and must be the exported sequence object. | The "sequence_json" parameter is required and must be the exported workflow object. | `import-sequence.php` |
| View all workflow activity and changes. | Every workflow event on this site — what happened, who did it, and when. | `AuditLog.js` |
| View Dashboard | Open dashboard | `class-dashboard-widget.php` |
| Your personal workspace for work and ideation. | The posts assigned to you, your review queue, and your ideation projects. | `MyDashboard.js` |
| ✓ All required items complete | All required items complete | `editor.js` |

## Errors (23)

*19 distinct strings across 23 sites.*

| Before | After | Where |
|---|---|---|
| Failed to add source. | Could not add the source. | `AddSourceModal.js` |
| Failed to apply. | Could not apply the result. | `CommandPalette.js` |
| Failed to assign workflow | Could not assign the workflow. | `WorkflowPanel.js` |
| Failed to create draft. | Could not create the draft. | `IdeationWorkspace.js` |
| Failed to create ideation project. | Could not create the ideation project. | `Ideation.js` |
| Failed to delete project. | Could not delete the project. | `IdeationWorkspace.js` |
| Failed to delete source. | Could not delete the source. | `IdeationWorkspace.js` |
| Failed to generate summary. | Could not generate the summary. | `IdeationWorkspace.js` |
| Failed to load AI settings: %s | Could not load AI settings. Reload the page to try again. Details: %s | `AiModelSettings.js` |
| Failed to load board | Could not load the board. Reload the page to try again. | `KanbanBoard.js` |
| Failed to load experiments: %s | Could not load experiments. Reload the page to try again. Details: %s | `ExperimentsSettings.js` |
| Failed to load project. | Could not load the project. Reload the page to try again. | `Ideation.js` |
| Failed to load prompts: %s | Could not load prompts. Reload the page to try again. Details: %s | `PromptsSettings.js` |
| Failed to load settings: %s | Could not load settings. Reload the page to try again. Details: %s | `GeneralSettings.js` |
| Failed to move card | Could not move the card. | `KanbanBoard.js` |
| Failed to remove this post from its workflow | Could not remove this post from its workflow. | `WorkflowSaveGuard.js` |
| Failed to remove workflow | Could not remove the workflow. | `WorkflowPanel.js` |
| Failed to reschedule post. | Could not reschedule the post. | `Calendar.js` |
| Failed to upload file. | Could not upload the file. | `AddSourceModal.js` |

## Permission errors (15)

*12 distinct strings across 15 sites.*

| Before | After | Where |
|---|---|---|
| You are not allowed to edit this post. | Sorry, you are not allowed to edit this post. | `class-status-manager.php` |
| You do not have permission for this transition. | Sorry, you are not allowed to make this transition. | `class-ideation-controller.php` |
| You do not have permission to access this endpoint. | Sorry, you are not allowed to access this endpoint. | `class-utility-controller.php` |
| You do not have permission to analyze this post. | Sorry, you are not allowed to analyze this post. | `class-abilities-controller.php` |
| You do not have permission to change the post author. | Sorry, you are not allowed to change the post author. | `update-post-fields.php` |
| You do not have permission to change this post to that status. | Sorry, you are not allowed to change this post to that status. | `class-status-manager.php` |
| You do not have permission to compare this post. | Sorry, you are not allowed to compare this post. | `class-performance-check.php` |
| You do not have permission to edit this post. | Sorry, you are not allowed to edit this post. | `helpers.php` |
| You do not have permission to execute this ability. | Sorry, you are not allowed to run this tool. | `keyword-check.php` |
| You do not have permission to perform this transition. | Sorry, you are not allowed to make this transition. | `class-assignment-manager.php` |
| You do not have permission to view results for this post. | Sorry, you are not allowed to view results for this post. | `class-abilities-controller.php` |
| You do not have permission to view the audit log. | Sorry, you are not allowed to view the audit log. | `class-admin.php` |

## Empty states (5)

| Before | After | Where |
|---|---|---|
| No agent plugins are installed. | No agent plugins installed. Agents arrive as separate plugins. | `AssistantsTab.js` |
| No check tools are registered. | No check tools yet. Add one with the Abilities API — see Add custom tools. | `ToolsSettings.js` |
| No configurable prompts are registered. | No configurable prompts on this site. A plugin registers them. | `PromptsSettings.js` |
| No experiments are available. | No experiments on this site. They arrive with plugin releases. | `ExperimentsSettings.js` |
| No helper tools are registered. | No helper tools yet. Add one with the Abilities API — see Add custom tools. | `ToolsSettings.js` |

## Removed “Please” (8)

| Before | After | Where |
|---|---|---|
| Could not save the post before starting the AI stage. Please try again. | Could not save the post before starting the AI stage. Try again. | `WorkflowPanel.js` |
| Could not save the post before the transition. Please try again. | Could not save the post before the transition. Try again. | `WorkflowPanel.js` |
| No checklist items have been configured. Please add items in the Integrations settings. | No checklist items yet. Add them in Integrations settings. | `class-checklist-tool.php` |
| Please confirm | Confirm | `use-confirm.js` |
| Please enter a valid URL. | Enter a valid URL. | `AddSourceModal.js` |
| Please wait, this may take a moment. | This may take a moment. | `CommandPalette.js` |
| The “%s” stage is set to run an AI agent but none is chosen. Please set one. | The “%s” stage is set to run an AI agent but none is chosen. Choose one. | `SequenceGraphEditor.js` |
| Your organization requires a workflow for new posts. Please select one to continue: | Your organization requires a workflow for new posts. Choose one to continue. | `WorkflowRequiredModal.js` |

## Removed “successfully” (4)

| Before | After | Where |
|---|---|---|
| Card moved successfully | Card moved. | `KanbanBoard.js` |
| Completed successfully. | Completed. | `class-ability.php` |
| Post claimed successfully. | Post claimed. | `class-workflow-controller.php` |
| Post released successfully. | Post released. | `class-workflow-controller.php` |

## Typography (22)

| Before | After | Where |
|---|---|---|
| %1$s of the %2$s selected posts are in workflows and can\'t be published directly: %3$s. Deselect them, or remove them from their workflows first. | %1$s of the %2$s selected posts are in workflows and can’t be published directly: %3$s. Deselect them, or remove them from their workflows first. | `class-posts-columns.php` |
| %1$s of the %2$s selected posts are in workflows: %3$s. Changing their status moves each one to its workflow\'s entry stage for the new status, or leaves it where it is i | %1$s of the %2$s selected posts are in workflows: %3$s. Changing their status moves each one to its workflow’s entry stage for the new status, or leaves it where it is if | `class-posts-columns.php` |
| %1$s of the %2$s selected posts are published and in workflows, so their published status can\'t be changed directly: %3$s. Deselect them, or remove them from their workf | %1$s of the %2$s selected posts are published and in workflows, so their published status can’t be changed directly: %3$s. Deselect them, or remove them from their workfl | `class-posts-columns.php` |
| %s is not connected. VIP Workflows does not manage this service\'s credentials, so the plugin that provides it must supply its own configuration. | %s is not connected. VIP Workflows does not manage this service’s credentials, so the plugin that provides it must supply its own configuration. | `class-requirement-factory.php` |
| Checking how similar stories performed... | Checking how similar stories performed… | `class-performance-signals.php` |
| Comparing with past performance... | Comparing with past performance… | `class-performance-check.php` |
| Duplicate assignment key: "%s". Two transitions assigning the same key overwrite each other\'s assignment. | Duplicate assignment key: "%s". Two transitions assigning the same key overwrite each other’s assignment. | `class-sequences-controller.php` |
| How this newsroom\'s comparable past coverage performed, and which angles did best. | How this newsroom’s comparable past coverage performed, and which angles did best. | `class-performance-signals.php` |
| Processing... | Processing… | `class-ability.php` |
| Searching for media... | Searching for media… | `class-media-scout.php` |
| Searching the web... | Searching the web… | `class-web-researcher.php` |
| Searching Wikipedia... | Searching Wikipedia… | `workflow-assistant-wikipedia.php` |
| Searching your archive... | Searching your archive… | `class-archive-scout.php` |
| Selected roles can see every user's activity in the audit log. | Selected roles can see every user’s activity in the audit log. | `GeneralSettings.js` |
| The %s provider is not registered with this site\'s WordPress AI Client, so text generation cannot run through it. | The %s provider is not registered with this site’s WordPress AI Client, so text generation cannot run through it. | `class-ai-availability.php` |
| The %s was stopped by the AI provider\'s content filter, so it returned nothing. Re-running it will not help until the wording that triggered the filter changes. | The %s was stopped by the AI provider’s content filter, so it returned nothing. Re-running it will not help until the wording that triggered the filter changes. | `class-llm-text-generator.php` |
| This post\'s author cannot edit posts, so the AI agent was not run. Reassign the post to a user who can edit it, or move it back to the previous stage. | This post’s author cannot edit posts, so the AI agent was not run. Reassign the post to a user who can edit it, or move it back to the previous stage. | `class-stage-agent-runner.php` |
| This post\'s workflow stage is misconfigured, so VIP Workflows cannot tell what a status change would do to it. The change was not applied — ask an administrator to fix t | This post’s workflow stage is misconfigured, so VIP Workflows cannot tell what a status change would do to it. The change was not applied — ask an administrator to fix th | `class-posts-columns.php` |
| Updates a post\'s title, excerpt, date, or author. Only include the fields you want to change. Requires confirmation before executing. | Updates a post’s title, excerpt, date, or author. Only include the fields you want to change. Requires confirmation before executing. | `update-post-fields.php` |
| What performing one of these transitions would set off. `current_region` is the editorial region (draft/pending/private/publish) of the post\'s stage, or null when it can | What performing one of these transitions would set off. `current_region` is the editorial region (draft/pending/private/publish) of the post’s stage, or null when it cann | `get-available-transitions.php` |
| What's the story? | What’s the story? | `SeedInput.js` |
| You haven't started any ideation projects yet. | You haven’t started any ideation projects yet. | `MyIdeationPage.js` |

## Terminal periods (6)

| Before | After | Where |
|---|---|---|
| A Slack emoji shortcode, or an https image URL | A Slack emoji shortcode, or an https image URL. | `NotificationChannelsTab.js` |
| Approved and awaiting publication | Approved and awaiting publication. | `editorial-review-sequence.json` |
| Author is writing the content | Author is writing the content. | `editorial-review-sequence.json` |
| Content is live | Content is live. | `editorial-review-sequence.json` |
| Editor is reviewing the content | Editor is reviewing the content. | `editorial-review-sequence.json` |
| Standard editorial workflow for blog posts and articles | Standard editorial workflow for blog posts and articles. | `editorial-review-sequence.json` |

