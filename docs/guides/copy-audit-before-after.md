# UX copy audit — before / after

Every user-facing string that changed. Derived from the diff between the audit commit and HEAD rather than from an edit log, so a string renamed twice shows only its **net** result. **416 distinct strings** across the plugin and its five extension plugins.

Rules and rationale: [`copy-standard.md`](copy-standard.md). Test-only changes are excluded.

| Group | Strings |
|---|---|
| [Capitalization](#capitalization) | 92 |
| [Capitalization + wording](#capitalization--wording) | 3 |
| [Ability labels](#ability-labels) | 10 |
| [New: reader-facing tool summaries](#new-reader-facing-tool-summaries) | 26 |
| [New: Quick Edit strings, now translatable](#new-quick-edit-strings-now-translatable) | 5 |
| [Helper text](#helper-text) | 59 |
| [Rewritten for clarity](#rewritten-for-clarity) | 13 |
| [Errors](#errors) | 56 |
| [Validation and confirmations](#validation-and-confirmations) | 34 |
| [Permission errors](#permission-errors) | 12 |
| [Empty states](#empty-states) | 14 |
| [Notices and descriptions](#notices-and-descriptions) | 60 |
| [Removed “Please”](#removed-please) | 10 |
| [Removed “successfully”](#removed-successfully) | 4 |
| [Typography](#typography) | 12 |
| [Terminal periods](#terminal-periods) | 6 |
| **Total** | **416** |

---

## Capitalization (92)

| Before | After | Where |
|---|---|---|
| Activate Sequence | Activate sequence | `activate-sequence.php` |
| Add Item | Add item | `admin.js` |
| Add Source URL | Add source URL | `AddSourceModal.js` |
| Added by You | Added by you | `MoodBoard.js` |
| AI Analysis | AI analysis | `ImageCard.js` |
| AI Analyzed | AI analyzed | `DocumentCard.js` |
| AI Generated (OpenAI) | AI generated (OpenAI) | `class-ai-image-provider.php` |
| AI Generated | AI generated | `MoodBoard.js` |
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
| Import Sequence | Import sequence | `import-sequence.php` |
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
| No Workflow | No sequence | `KanbanBoard.js` |
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
| Sequence Activated | Sequence activated | `class-status-manager.php` |
| Sequence Deactivated | Sequence deactivated | `class-status-manager.php` |
| Sequence Name | Sequence name | `SequencesList.js` |
| Sequence Type: | Sequence type: | `SequencesList.js` |
| Sequence Updated | Sequence updated | `class-status-manager.php` |
| Slack (Default) | Slack (default) | `class-slack-channel.php` |
| Slack (New) | Slack (new) | `NotificationChannelsTab.js` |
| Smart Linking Check | Smart linking check | `class-smart-linking-agent.php` |
| Smart Linking | Smart linking | `class-smart-linking.php` |
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
| Update Sequence | Update sequence | `update-sequence.php` |
| Upload Sequence JSON: | Upload sequence JSON | `SequencesList.js` |
| Validate Sequence | Validate sequence | `validate-sequence.php` |
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

## Capitalization + wording (3)

| Before | After | Where |
|---|---|---|
| Editorial Sequences (%d) | Workflow sequences (%d) | `SequencesList.js` |
| New editorial sequence | New sequence | `SequencesList.js` |
| No editorial sequences yet. | No workflow sequences yet. | `SequencesList.js` |

## Ability labels (10)

| Before | After | Where |
|---|---|---|
| Create Sequence | New sequence | `create-sequence.php` |
| Get Available Transitions | Available transitions | `get-available-transitions.php` |
| Get My Assignments | My assignments | `get-my-assignments.php` |
| Get Posts By Status | Posts by status | `get-posts-by-status.php` |
| Get Recent Activity | Recent activity | `get-recent-activity.php` |
| Get Sequences | Sequences | `get-sequences.php` |
| Get Stale Posts | Stale posts | `get-stale-posts.php` |
| Get Transition History | Transition history | `get-transition-history.php` |
| Get Workflow Summary | Workflow summary | `get-workflow-summary.php` |
| Transition Post | Move post | `transition-post.php` |

## New: reader-facing tool summaries (26)

Added as `meta.summary` — the sentence the tool card and the graph editor's tool picker now render in place of the model's `description`.

| String | Where |
|---|---|
| Changes a post’s title, excerpt, date or author. | `update-post-fields.php` |
| Checks a sequence configuration for problems without saving it. | `validate-sequence.php` |
| Checks the post against SEO basics: meta description, headings, keywords and images. | `seo-check.php` |
| Checks the post’s tags for typos, duplicates and off-topic terms. | `workflow-agent-tag-sanity-check.php` |
| Compares this post with how similar stories performed, using Parse.ly. | `class-performance-check.php` |
| Copy-edits the post for grammar, spelling and style, saving the result as a revision. | `workflow-agent-copy-edit.php` |
| Counts posts at each status, for every active sequence. | `get-workflow-summary.php` |
| Creates a draft sequence from an exported JSON definition. | `import-sequence.php` |
| Creates a sequence with its stages, transitions and metadata fields. | `create-sequence.php` |
| Flags banned words, competitor names and other terms you list. | `keyword-check.php` |
| Lists posts sitting at a given workflow status. | `get-posts-by-status.php` |
| Lists posts stuck at one status for longer than a set number of days. | `get-stale-posts.php` |
| Lists recent editorial activity across the site. | `get-recent-activity.php` |
| Lists the active sequences and their stages. | `get-sequences.php` |
| Lists the moves a given post and user can make right now. | `get-available-transitions.php` |
| Lists the posts assigned to you. | `get-my-assignments.php` |
| Moves a post to another status, respecting who is allowed to make the move. | `transition-post.php` |
| Puts a sequence live, or takes it back to draft. | `activate-sequence.php` |
| Replaces a sequence’s whole configuration. Anything you leave out is cleared. | `update-sequence.php` |
| Requires every checklist item to be ticked. | `class-checklist-tool.php` |
| Scores how easy the post is to read, using Flesch-Kincaid. | `readability.php` |
| Shows a post’s trail through its sequence. | `get-transition-history.php` |
| Shows how comparable past coverage performed, and which angles did best. | `class-performance-signals.php` |
| Suggests alternative headlines, using Parse.ly. | `class-headline-suggestions.php` |
| Suggests internal links for the post, using Parse.ly. | `class-smart-linking.php` |
| Takes a post out of its sequence, leaving its published status alone. Cannot be undone. | `remove-from-workflow.php` |

## New: Quick Edit strings, now translatable (5)

These were hardcoded English inside an inline script and could not be translated at all.

| String | Where |
|---|---|
| Could not load the moves for this post. Reload the page to try again. | `class-posts-columns.php` |
| Could not move the post. | `class-posts-columns.php` |
| No moves available from this stage. | `class-posts-columns.php` |
| Placeholders: %s | `PromptsSettings.js` |
| Working… | `class-posts-columns.php` |

## Helper text (59)

| Before | After | Where |
|---|---|---|
| %s has no model chosen. Ask an administrator to finish setting it up. | %s has no model. Ask an administrator to choose one. | `class-ai-availability.php` |
| %s is not connected. VIP Workflows does not manage this service\'s credentials, so the plugin that provides it must supply its own configuration. | %s is not connected. Set it up in its own plugin. | `class-requirement-factory.php` |
| A friendly name to identify this Slack channel | *(removed)* | `NotificationChannelsTab.js` |
| A modal prompts users to select a workflow when they create a post. | *(removed)* | `GeneralSettings.js` |
| AI text generation has no provider selected. Ask an administrator to finish setting it up. | No AI provider selected. Ask an administrator to choose one. | `class-ai-availability.php` |
| An AI stage routes on what a language model returned, and that model reads the post’s own content, so publishing and going private both wait for a person. Off by default. | Never exceeds the post author’s permissions. | `SequenceSettingsInspector.js` |
| Analyzes a fetched video transcript. Variables: {title}, {transcript}. | Analyzes a fetched video transcript. | `class-core-prompts.php` |
| Another field already uses this key. Saving is refused until it is unique. | Another field already uses this key. | `InspectorFieldList.js` |
| Authors can see their own posts in the Review Queue. | *(removed)* | `GeneralSettings.js` |
| Choosing an agent makes this an AI stage: it runs when a post enters, and routes the post onward by outcome. Drag from the stage’s pass, fail and error handles on the can | Runs when a post enters this stage. | `StageInspector.js` |
| Comparable coverage at or above this multiple of a typical story counts as Tier 1. | A multiple of a typical story. | `class-performance-check.php` |
| Comparable coverage at or below this multiple counts as Tier 3. Everything between the two is Tier 2. | A multiple of a typical story. | `class-performance-check.php` |
| Content enters the flow at this stage. Drag the Start connection to another stage to change the entry point. | Drag the Start connection to another stage to change it. | `Inspector.js` |
| Describe the image you want to generate. Be specific about style, subject, and composition. | Be specific about style, subject, and composition. | `MoodBoard.js` |
| Evaluates ideation progress and suggests next steps. Variables: {seed}, {tags}, {news_angle}, {total_cards}, {pinned_count}, {pinned_breakdown}, {dismissed_count}, {pinne | Suggests next steps for an ideation project. | `class-core-prompts.php` |
| Extracts structured metadata (tags, entities, queries) from a story seed. Variables: {seed}, {brand_context}. | Extracts tags, entities and queries from a seed. | `class-core-prompts.php` |
| Inactive sequences are saved as drafts and not applied to content. | Inactive sequences don’t apply to posts. | `SequenceIdentityFields.js` |
| Manage API keys in Settings → Connectors | Add providers in Settings → Connectors | `AiModelSettings.js` |
| No channel with this id is registered on this site — its plugin may be inactive. It stays stored, and notifies again if the channel comes back. | Channel not found, so nothing is sent. | `TransitionInspector.js` |
| No models could be discovered for this provider, so AI features cannot generate through it. Check its connection in Settings → Connectors, or choose a provider whose mode | No models found. Check Settings → Connectors. | `AiModelSettings.js` |
| No models were discovered for this provider; the default will be used. | No models found. The default model will be used. | `AiModelSettings.js` |
| No role with this slug exists on this site — its plugin may be inactive. Nobody matches it, so it allows nobody while it keeps the restriction on. | Role not found, so it matches no one. | `TransitionInspector.js` |
| No tool with this id is registered on this site — its plugin may be inactive. Saving this sequence drops it from the transition. | Tool not found. Saving removes it. | `TransitionInspector.js` |
| Only a status with no stages can be removed, and Draft always stays — it’s where new content is created. | Draft can’t be removed. | `RegionInspector.js` |
| Only a status with no stages can be removed, and Draft always stays — it’s where new content is created. | Move or delete its stages first. | `RegionInspector.js` |
| Only providers with a configured API key appear here. | *(removed)* | `AiModelSettings.js` |
| Only these roles can use this transition. With none checked, everyone can. | Leave all unchecked to allow everyone. | `TransitionInspector.js` |
| Phases are fixed. Select the connection between phases to configure how content moves from Ideation into the editorial workflow. | Phases are fixed. Configure the connection between them. | `PhaseStageInspector.js` |
| Posts hold the “%s” status while they sit in any stage in this section of the canvas. Moving between stages inside it leaves the status alone; a transition that crosses i | Posts made private elsewhere start at the entry checkpoint. | `regions.js` |
| Posts hold the “%s” status while they sit in any stage in this section of the canvas. Moving between stages inside it leaves the status alone; a transition that crosses i | Posts published elsewhere start at the entry checkpoint. | `regions.js` |
| Posts hold the “%s” status while they sit in any stage in this section of the canvas. Moving between stages inside it leaves the status alone; a transition that crosses i | Posts sent for review elsewhere start at the entry checkpoint. | `regions.js` |
| Posts hold the “%s” status while they sit in any stage in this section of the canvas. Moving between stages inside it leaves the status alone; a transition that crosses i | Posts set to draft elsewhere start at the entry checkpoint. | `regions.js` |
| Prompt for summarizing and extracting text from uploaded PDFs. | Summarizes and extracts text from uploaded PDFs. | `class-core-prompts.php` |
| Ranks candidate archive articles by relevance to the seed. Variables: {limit}, {seed}, {candidate_text}. | Ranks archive results by relevance to the seed. | `class-core-prompts.php` |
| Recommend — users can skip and continue without a workflow | Recommend — users can skip selecting a workflow | `GeneralSettings.js` |
| Research, discovery, and source management for ideation projects. | Research and source tools for ideation. | `class-ideation-experiment.php` |
| Restrict this transition to a previously assigned user or role | Only the earlier assignee can make this move. | `TransitionAssignmentConfig.js` |
| Selected roles can change post status directly, bypassing workflow restrictions. | Change post status outside the workflow. | `GeneralSettings.js` |
| Selected roles can open the audit log and see their own activity in it. | Their own events only. | `GeneralSettings.js` |
| Selected roles can proceed with transitions even when required tool checks fail. | Move posts even when required checks fail. | `GeneralSettings.js` |
| Selected roles can see every user's activity in the audit log. | Events from every user. | `GeneralSettings.js` |
| Shorter image analysis prompt used when analyzing a pinned ideation source image. | Analyzes images pinned as ideation sources. | `class-core-prompts.php` |
| Summarizes a single research source. Variables: {max_length}, {title}, {content}. | Summarizes a single research source. | `class-core-prompts.php` |
| Summary prompt for transcripts and extracted text. {content_type} is the kind of content being summarized. | Summary prompt for transcripts and extracted text. | `class-core-prompts.php` |
| Synthesizes multiple research sources for a project. Variables: {source_count}, {max_length}, {context}. | Combines a project’s research sources. | `class-core-prompts.php` |
| System instruction for editorial draft generation. Variables: {guideline_context}, {word_count}, {image_placement}. | System instruction for editorial draft generation. | `class-core-prompts.php` |
| The %s provider is not registered with this site\'s WordPress AI Client, so text generation cannot run through it. | %s is not registered with the WordPress AI Client. | `class-ai-availability.php` |
| This channel is not set up, so nothing is sent on it. Finish it under Workflows → Notifications, or untick it here. | Not set up. See Workflows → Notifications. | `TransitionInspector.js` |
| This field needs a key. Saving is refused until it has one. | A key is required. | `InspectorFieldList.js` |
| This is a final stage — content exits the flow here. Delete this connection to make the stage non-final. | Delete this connection to make the stage non-final. | `Inspector.js` |
| This site has no credential screen, so set the %s constant in wp-config.php. | Set the %s constant in wp-config.php. | `class-requirement-factory.php` |
| This stage is where “%s” seats a post that arrives from outside the workflow. Moving it to another status leaves that one with no entry checkpoint, and Save is blocked un | Changing this leaves “%s” with no entry checkpoint. | `StageInspector.js` |
| This status has no stages yet. Drag a stage into its section of the canvas, or drop a new connection there. | No stages yet. Drag one into this section. | `RegionInspector.js` |
| This tool is turned off for the whole site under Workflows → Tools, so this transition skips it and the check never runs. | Turned off site-wide, so this check is skipped. | `TransitionInspector.js` |
| User prompt for editorial draft generation. Variables: {project_name}, {research_context}, {image_instructions}. | User prompt for editorial draft generation. | `class-core-prompts.php` |
| Visible only to logged-in users who can read private posts. | Only users with access can see it. | `regions.js` |
| Vision prompt for analyzing uploaded images during research. | Analyzes images uploaded during research. | `class-core-prompts.php` |
| Where a post lands when something outside the workflow sets this status — publishing from the editor, a scheduled post going live, a REST write — and where a sequence ass | *(removed)* | `RegionInspector.js` |
| Where content goes when this transition is used. “End of workflow” makes the stage it leaves a final one and drops this transition, settings and all — a final stage exits | “End of workflow” removes this transition and its settings. | `TransitionInspector.js` |

## Rewritten for clarity (13)

| Before | After | Where |
|---|---|---|
| Ability meta, including supports, stage_eligible and transition_eligible. | Ability meta, including summary, supports, stage_eligible and transition_eligible. | `class-abilities-controller.php` |
| An error occurred while rendering this page. | This page could not be rendered. Reload to try again. | `ErrorBoundary.js` |
| Configure agents that assist with editorial work. | Agents run when a post enters a stage. | `Agents.js` |
| Configure workflow settings and preferences. | How workflows behave site-wide. | `Settings.js` |
| Configure workflow tools available to your team. | Tools check a post before it moves. | `Tools.js` |
| Enter a unique name for this sequence. | Must be unique. | `SequencesList.js` |
| Human-readable description of what the ability does. | Tool description written for a language model. Not for display — use label and meta.summary. | `class-abilities-controller.php` |
| Must match assignment key from another transition | Must match the key an earlier transition assigned. | `TransitionAssignmentConfig.js` |
| Sequences define workflow stages and transitions for your content types. | Each sequence is the stages a post moves through. | `SequencesList.js` |
| View all workflow activity and changes. | Every workflow event, who did it, and when. | `AuditLog.js` |
| View Dashboard | Open dashboard | `class-dashboard-widget.php` |
| Your personal workspace for work and ideation. | Find work and see what needs your attention. | `MyDashboard.js` |
| ✓ All required items complete | All required items complete | `editor.js` |

## Errors (56)

| Before | After | Where |
|---|---|---|
| %1$s of the %2$s selected posts are in workflows and can\'t be published directly: %3$s. Deselect them, or remove them from their workflows first. | %1$s of %2$s selected posts can’t be published while in workflows: %3$s. Deselect them to continue. | `class-posts-columns.php` |
| %1$s of the %2$s selected posts are published and in workflows, so their published status can\'t be changed directly: %3$s. Deselect them, or remove them from their workf | %1$s of %2$s selected posts can’t be unpublished while in workflows: %3$s. Deselect them to continue. | `class-posts-columns.php` |
| '%1$s' is in the '%2$s' workflow. To publish it directly, remove it from the workflow (this is logged), or move it through the workflow to a published stage. | “%1$s” is in the “%2$s” workflow. Move it to a published stage, or remove it from the workflow. | `class-publish-boundary-guard.php` |
| '%s' is in a workflow. To publish it directly, remove it from the workflow (this is logged), or move it through the workflow to a published stage. | “%s” is in a workflow. Move it to a published stage, or remove it from the workflow. | `class-publish-boundary-guard.php` |
| Duplicate assignment key: "%s". Two transitions assigning the same key overwrite each other\'s assignment. | Two transitions share the assignment key “%s”. Give one of them a key of its own. | `class-sequences-controller.php` |
| Failed to add source. | Could not add the source. | `AddSourceModal.js` |
| Failed to apply. | Could not apply the result. | `CommandPalette.js` |
| Failed to assign workflow | Could not assign the workflow. | `WorkflowPanel.js` |
| Failed to create draft. | Could not create the draft. | `IdeationWorkspace.js` |
| Failed to create ideation project. | Could not create the ideation project. | `Ideation.js` |
| Failed to delete project. | Could not delete the project. | `IdeationWorkspace.js` |
| Failed to delete source. | Could not delete the source. | `IdeationWorkspace.js` |
| Failed to export sequence: | Could not export the sequence. Details: %s | `SequencesList.js` |
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
| Incomplete %1$s: the response opens a JSON structure but never closes it, ending after %2$d characters (%3$s). | Incomplete %1$s: the response was cut off after %2$d characters (%3$s). | `class-llm-json-parser.php` |
| Parse.ly has no related content for this topic yet, so there is nothing to link to. If every post reports this, check the Site ID and API Secret under Settings → Parse.ly | Parse.ly has no related content yet. If every post says this, check the Site ID in Settings → Parse.ly. | `class-smart-linking.php` |
| Stage "%1$s" has a transition restricted to assignment key "%2$s", which no transition assigns, so the gate cannot be re-pointed at the imported slot. | Stage “%1$s” has a transition restricted to “%2$s”, a key no transition assigns. | `class-sequences-controller.php` |
| Stage "%1$s" has a transition restricted to assignment key "%2$s", which no transition assigns. Nobody could take that transition. | Stage “%1$s” has a transition restricted to “%2$s”, a key no transition assigns. | `class-sequences-controller.php` |
| Stage "%1$s" routes the agent outcome "%2$s" to "%3$s", which is not a configured transition of that stage. | Stage “%1$s” routes agent outcome “%2$s” to “%3$s” with no transition to travel on. | `class-sequences-controller.php` |
| Stage "%s" has a transition restricted to an assignee but names no assignment key, so nobody can take it. | Stage “%s” has a transition restricted to an assignee but no assignment key. Add one. | `class-sequences-controller.php` |
| Stage "%s" has a transition that assigns work without an assignment key. Every assignment slot needs one. | Stage “%s” has a transition that assigns work but no assignment key. Add one. | `class-sequences-controller.php` |
| The "%1$s" sequence has no stage with the %2$s status, so it cannot be started on this post. Change the post\'s status, or choose a sequence that covers it. | The “%1$s” sequence has no %2$s stage. Change the post’s status, or choose another sequence. | `class-status-manager.php` |
| The %1$s used its entire %2$d-token limit before it finished, so it produced nothing usable. That ceiling is a setting, not a problem with your content — ask an administr | The %1$s hit its %2$d-token limit. Ask an administrator to raise it for this step. | `class-llm-text-generator.php` |
| The %s returned no response at all. Re-running it may succeed; if it keeps happening, the AI provider is not answering. | The %s got no response from the AI provider. Try again. | `class-llm-text-generator.php` |
| The %s stopped at its token limit before it finished. That ceiling is a setting, not a problem with your content — ask an administrator to raise it for this step. | The %s hit its token limit. Ask an administrator to raise it for this step. | `class-llm-text-generator.php` |
| The %s was stopped by the AI provider\'s content filter, so it returned nothing. Re-running it will not help until the wording that triggered the filter changes. | The AI provider’s content filter blocked the %s. Change the wording before retrying. | `class-llm-text-generator.php` |
| The agent routed this post to "%s", a stage the sequence does not define a region for, so it stopped here. Fix the stage in the sequence editor, or move the post back. | Stage “%s” has no status. Fix it in the sequence editor, or move the post back. | `class-stage-agent-runner.php` |
| The agent run failed, and this stage routes errors to "%1$s", which publishes. This sequence doesn’t allow AI stages to publish, so the post stopped here. Edit the sequen | The error route publishes, which AI stages can’t do. Reroute it. Error: %s | `class-stage-agent-runner.php` |
| The AI agent returned "%1$s", which routes to "%2$s" — a stage that publishes. This sequence doesn’t allow AI stages to publish, so the post stopped here. Edit the sequen | “%s” route publishes, which AI stages can’t do. Allow it in sequence settings or reroute. | `class-stage-agent-runner.php` |
| The AI agent returned "%1$s", which routes to "%2$s" — a stage that publishes. This sequence doesn’t allow AI stages to publish, so the post stopped here. Edit the sequen | “%s” route publishes, which AI stages can’t do. Route it to a stage before publishing. | `class-stage-agent-runner.php` |
| These sequences could not be upgraded and are not usable until someone fixes them in the Sequence editor. Their stages still have no status region, so any post that reach | These sequences could not be upgraded and are unusable. Fix them in the Sequence editor. | `class-admin.php` |
| These stages have no status region and cannot be used until one is set: %s. Assigning the default puts them in Draft; drag any of them into another status’s section of th | These stages have no status and can’t be used: %s. Assigning the default puts them in Draft. | `SequenceGraphEditor.js` |
| This post moved to another stage while your change was being applied: it started at "%1$s" and is now at "%2$s". Reload and try again. | This post moved from “%1$s” to “%2$s” in the meantime. Reload and try again. | `class-status-manager.php` |
| This post\'s author cannot edit posts, so the AI agent was not run. Reassign the post to a user who can edit it, or move it back to the previous stage. | The author cannot edit posts, so the agent didn’t run. Reassign the post or move it back. | `class-stage-agent-runner.php` |
| This post\'s workflow stage is misconfigured, so VIP Workflows cannot tell what a status change would do to it. The change was not applied — ask an administrator to fix t | This post’s workflow stage is misconfigured, so nothing changed. Ask an administrator to fix it. | `class-posts-columns.php` |
| This stage belongs to an AI agent, and its route to this destination publishes. This sequence doesn’t allow AI stages to publish, so the route stays closed while the agen | This route publishes, which AI stages can’t do. Allow it in sequence settings or reroute. | `class-status-manager.php` |
| This stage belongs to an AI agent, and its route to this destination publishes. This sequence doesn’t allow AI stages to publish, so the route stays closed while the agen | This route publishes, which AI stages can’t do. Route it to a stage before publishing. | `class-status-manager.php` |
| This stage routes no destination for the "%s" outcome, so the post stopped here. Route it in the sequence editor, or move the post back. | No route for the “%s” outcome. Add one in the sequence editor, or move the post back. | `class-stage-agent-runner.php` |
| This transition asks for an assignee of type “%s”, which cannot be chosen here. Nothing has been assigned and the post has not moved — the sequence needs a user or role a | “%s” assignees can’t be chosen here. The sequence needs a user or role assignment. | `TransitionInputPopover.js` |
| This workflow cannot be used until its stages have status regions: %s Open the sequence and assign the missing ones. | Some stages have no status: %s Assign them in the sequence editor. | `class-status-manager.php` |
| VIP Workflows could not check what this status change would do to the workflow, so the change was not applied. Reload the page and try again. | Could not check the workflow, so nothing changed. Reload the page and try again. | `class-posts-columns.php` |
| Warning: this sequence references post types that no longer exist: %s. Select valid post types and save. | These post types no longer exist: %s. Select valid ones and save. | `SequenceGraphEditor.js` |
| “%1$s” is in the “%2$s” workflow. To publish it directly, remove it from the workflow (this is logged), or move it through the workflow to a published stage. | “%1$s” is in the “%2$s” workflow. Move it to a published stage, or remove it from the workflow. | `confirm-workflow-side-effect.js` |
| “%s” belongs to a workflow that no longer exists, so its status cannot be changed. Remove it from the workflow (this is logged) to edit it as an ordinary post. | “%s” is in a deleted workflow. Remove it from the workflow to change its status. | `confirm-workflow-side-effect.js` |
| “%s” is not in this group’s destinations, so there was nothing to delete. Reload the page to see the current channels. | “%s” was not found, so nothing was deleted. Reload the page to see current channels. | `NotificationChannelsTab.js` |

## Validation and confirmations (34)

Errors, validation messages and confirmation dialogs cut to about 100 characters, at most two sentences: what is wrong and the way out. Confirmations keep their consequence. See [Length](copy-standard.md#length).

| Before | After | Where |
|---|---|---|
| %1$s of the %2$s selected posts are in workflows: %3$s. Changing their status moves each one to its workflow\'s entry stage for the new status, or leaves it where it is i | Changing the status may move %1$s of %2$s selected posts to new stages and stop their agents: %3$s. Continue? | `class-posts-columns.php` |
| A stage on the canvas has neither a name nor a key. Open it and fill in both — the name is what writers see, the key is what the stage is stored under. | A stage has no name or key. Open it and fill in both. | `graph-model.js` |
| Adding a channel reloads this page, which discards the unsaved changes on it. Add the channel anyway? | Adding a channel reloads the page and discards unsaved changes. | `NotificationChannelsTab.js` |
| Agent “%s” is not available on this site; posts entering this stage will error — following the on-error route if one is set, stopping here otherwise. | Agent “%s” is not available on this site. Posts here will error. | `graph-model.js` |
| Agent “%s” needs setup; until it is configured, posts entering this stage will error — following the on-error route if one is set, stopping here otherwise. | Agent “%s” needs setup. Until then, posts here will error. | `graph-model.js` |
| Changing the status from %1$s to %2$s leaves this post at its current workflow stage, which is already a %2$s stage. | Changing the status from %1$s to %2$s keeps this post at its current %2$s stage. | `confirm-workflow-side-effect.js` |
| Changing the status from %1$s to %2$s leaves this post at its current workflow stage: its workflow has no %2$s stage to move it to. | Changing the status from %1$s to %2$s keeps this post at its stage. Its workflow has no %2$s stage. | `confirm-workflow-side-effect.js` |
| Changing the status from %1$s to %2$s moves this post out of its current workflow stage and re-seats it at “%3$s”. | Changing the status from %1$s to %2$s moves this post to “%3$s”. | `confirm-workflow-side-effect.js` |
| Move this post from the “%1$s” workflow to “%2$s”? It gives up its place in “%1$s”: the change is recorded in the workflow log, and the post starts at the “%2$s” entry st | Move this post from “%1$s” to “%2$s”? It loses its place in “%1$s”. | `confirm-workflow-side-effect.js` |
| No transition leads here and this is not its status group’s entry checkpoint, so no post can ever reach this stage. | No transition leads here, so no post can ever reach this stage. Draw one into it. | `graph-model.js` |
| Nothing ends this sequence: %s has no way out and is not marked as the end, so a post arriving there would be stuck. Drag from it to the End node to finish the flow there | Nothing ends this sequence: %s has no way out. Drag from it to the End node. | `graph-model.js` |
| Nothing ends this sequence: %s have no way out and none is marked as the end, so a post arriving at one would be stuck. Drag from whichever should finish the flow to the  | Nothing ends this sequence: %s have no way out. Drag from one to the End node. | `graph-model.js` |
| Nothing ends this sequence: no stage is joined to the End node, so a post could travel it forever without finishing. Drag from the stage that should finish the flow to th | Nothing ends this sequence. Drag from the stage that should finish it to the End node. | `graph-model.js` |
| Re-running replaces the seed analysis and every board card, and re-runs every research agent. Pinned board cards will be lost. Sources stay on the board, and anything an  | Replaces the seed analysis and every board card, including pinned ones. Sources stay. | `AssistantPanel.js` |
| Remove this post from its deleted workflow? The removal is recorded in the workflow log, with the stage it was removed from. It cannot be undone. | Remove this post from its deleted workflow? This can’t be undone. | `confirm-workflow-side-effect.js` |
| Remove this post from the “%s” workflow? The removal is recorded in the workflow log, with the stage it was removed from. It cannot be undone: re-assigning the workflow l | Remove this post from the “%s” workflow? It loses its place, and this can’t be undone. | `confirm-workflow-side-effect.js` |
| Scheduling this post leaves it at its current workflow stage. When it goes live, the workflow re-seats it at “%s”. | Scheduling this post leaves it at its current workflow stage. It moves to “%s” when it goes live. | `confirm-workflow-side-effect.js` |
| Stage “%s” has no key, so there is nothing to store it under. Open it and fill in Key. | Stage “%s” has no key. Open it and fill in Key. | `graph-model.js` |
| The agent has no outcome routed anywhere and the stage is not marked final — content cannot leave it. Drag from the stage’s outcome handles to route it. | The agent has no outcome routed anywhere. Drag from an outcome handle to route one. | `graph-model.js` |
| The agent’s “%1$s” route has no transition to travel on (%2$s). Re-drag the handle onto that stage. | “%1$s” route has no transition to travel on (%2$s). Re-drag its handle. | `graph-model.js` |
| The agent’s “%1$s” route leads to a stage that publishes (%2$s), but this sequence doesn’t allow AI stages to publish, so the route is disabled and posts will stop here i | “%s” route publishes, which AI stages can’t do. Allow it in sequence settings or reroute. | `graph-model.js` |
| The agent’s “%1$s” route leads to a stage that publishes (%2$s), but this sequence doesn’t allow AI stages to publish, so the route is disabled and posts will stop here i | “%s” route publishes, which AI stages can’t do. Route it to a stage before publishing. | `graph-model.js` |
| The flow entry is outside the “draft” status region — new content starts as a draft and will land at the draft region’s entry stage instead. | New posts start as drafts, so they skip this stage. Move it into the “Draft” status group. | `graph-model.js` |
| The stage keyed “%s” has no name. Open it and fill in Name — it is what writers see on the board and on the buttons that move a post. | The stage keyed “%s” has no name. Open it and fill in Name. | `graph-model.js` |
| The “%1$s” transition assigns to “%2$s”, a key another transition already assigns — the second assignment would overwrite the first. Give this one a key of its own. | The “%1$s” transition reuses the assignment key “%2$s”. Give it a key of its own. | `graph-model.js` |
| The “%1$s” transition is restricted to assignment key “%2$s”, which no transition assigns — nobody could take it. Point it at a key another transition assigns. | The “%1$s” transition is restricted to “%2$s”, a key no transition assigns. Pick another. | `graph-model.js` |
| The “%s” status group has no entry checkpoint. Drag one of its stages onto the group’s top edge to set where posts entering that status land. | The “%s” status group has no entry checkpoint. Drag one of its stages onto the group’s top edge. | `graph-model.js` |
| The “%s” transition assigns work but names no assignment key, so there is nowhere to record the assignment. Fill in its Assignment key. | The “%s” transition assigns work but has no assignment key. Fill one in. | `graph-model.js` |
| The “%s” transition is restricted to an assignee but names no assignment key, so nobody could take it. Name the slot it should read, or turn the restriction off. | The “%s” transition is restricted to an assignee but has no assignment key. Pick one. | `graph-model.js` |
| This sequence has no stages, so there is nothing for a post to be in. Right-click the canvas to add one. | This sequence has no stages. Right-click the canvas to add one. | `graph-model.js` |
| This sequence is attached to no post type, so nothing would ever run through it. Click an empty part of the canvas and choose at least one under Post types. | No post type selected. Click an empty part of the canvas and choose one under Post types. | `SequenceGraphEditor.js` |
| Two stages share the key “%s”, so saving would collapse them into one and drop the second stage’s transitions. Open one of them and give it a key of its own. | Two stages share the key “%s”. Give one of them a key of its own. | `graph-model.js` |
| VIP Workflows cannot resolve this post’s workflow stage, so changing its status leaves the post where it is in the workflow. | This post’s workflow stage can’t be resolved, so the post won’t move. | `confirm-workflow-side-effect.js` |
| Your organization recommends using a workflow for new posts. Select one below or skip to continue without a workflow: | Your organization recommends a workflow for new posts. Choose one or skip. | `WorkflowRequiredModal.js` |

## Permission errors (12)

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

## Empty states (14)

| Before | After | Where |
|---|---|---|
| Check back later or visit the full Queue page for team-wide items. | See the Queue page for team-wide posts. | `MyQueuePage.js` |
| No agent plugins are installed. | No agent plugins installed. Agents ship as plugins. | `AssistantsTab.js` |
| No check tools are registered. | No check tools yet. See Add custom tools. | `ToolsSettings.js` |
| No configurable prompts are registered. | No configurable prompts. Plugins register them. | `PromptsSettings.js` |
| No experiments are available. | No experiments yet. They ship with plugin releases. | `ExperimentsSettings.js` |
| No helper tools are registered. | No helper tools yet. See Add custom tools. | `ToolsSettings.js` |
| No results found. Try different search terms or filters. | No results. Try different terms or filters. | `DiscoverySearchModal.js` |
| No summary yet. Click "Generate summary" to create one from your pinned sources. | No summary yet. Generate one from pinned sources. | `IdeationSummary.js` |
| Nothing leaves this stage yet. Add an exit above, or drag from one of the stage’s handles on the canvas. | No exits yet. Add one or drag from a handle. | `StageInspector.js` |
| This post belongs to a workflow that no longer exists, so its status cannot be changed. | This post’s workflow was deleted, so its status is locked. | `WorkflowPanel.js` |
| This sequence has no metadata fields. Add one to collect a value alongside every post that travels it. | No fields yet. Add one to collect a value per post. | `MetadataFieldsEditor.js` |
| This sequence has no stages. Add one to create the first step content moves through. | No stages yet. Add one to start. | `SequenceSettingsInspector.js` |
| This transition captures nothing. Add an input to ask for a note or an assignment before the post moves on. | No inputs yet. Add one to ask for a note or assignee. | `TransitionInspector.js` |
| This transition runs no tools. Add one to check the post before it moves on. | No tools yet. Add one to check the post first. | `TransitionInspector.js` |

## Notices and descriptions (60)

Inline notices, state messages, tool findings, page subtitles and section descriptions cut to about 50 characters. See [Length](copy-standard.md#length).

| Before | After | Where |
|---|---|---|
| %1$d transition was removed because the stage already had one to the same place, and its label, roles, required tools and notifications went with it: %2$s. | Removed %1$d duplicate transition and its settings: %2$s. | `SequenceGraphEditor.js` |
| %1$d transitions were removed because the stage already had ones to the same places, and their labels, roles, required tools and notifications went with them: %2$s. | Removed %1$d duplicate transitions and their settings: %2$s. | `SequenceGraphEditor.js` |
| %1$s all lead to %2$s along this one transition, so everything below applies to all of them. Giving an outcome its own roles, tools, notifications or assignment means rou | %1$s all lead to %2$s, so settings below apply to all of them. | `TransitionInspector.js` |
| %d image(s) missing alt text. Alt text improves accessibility and SEO. | %d image(s) missing alt text. | `seo-check.php` |
| %s is selected but no longer connected, so AI features cannot generate. Choose one of the connected providers. | %s is no longer connected. Choose a connected provider. | `AiModelSettings.js` |
| %s%% of words are complex (3+ syllables). Consider simpler alternatives. | %s%% of words have 3+ syllables. | `readability.php` |
| Adds an empty group for this status. Move stages into it using their Post status control or by dragging. Transitions between groups change a post’s status. | Adds an empty group to move stages into. | `AddPostStatusModal.js` |
| Auto-refresh is paused. Click "Refresh guidance" to run manually. | Auto-refresh is paused. Click “Refresh guidance”. | `AssistantPanel.js` |
| Average sentence length is %s words. Aim for 15-20 words. | Average sentence length is %s words. Aim for 15-20. | `readability.php` |
| Based on %1$d comparable article, %2$s %3$s in its first %4$d days. | %1$d comparable article, %2$s %3$s in its first %4$d days. | `class-performance-check.php` |
| Based on %1$d comparable articles, typically %2$s %3$s in their first %4$d days. | %1$d comparable articles, typically %2$s %3$s in their first %4$d days. | `class-performance-check.php` |
| Break long sentences into shorter ones. Use periods more often. | Break long sentences into shorter ones. | `readability.php` |
| Calendar view of scheduled and published workflow posts. | Scheduled and published posts by date. | `class-calendar-experiment.php` |
| Checks that a post's tags make sense for its content. Does not modify tags. | Checks that tags fit the post, without changing them. | `workflow-agent-tag-sanity-check.php` |
| Choose which channels receive each event. Only a configured channel can be selected — set one up on the Channels tab first. | Only channels configured on the Channels tab appear. | `NotificationsApp.js` |
| Configure notification channels and event-to-channel routing. | Channels and the events routed to them. | `Notifications.js` |
| Content is short (%1$d words). Aim for at least %2$d words for better SEO. | Content is %1$d words. Aim for at least %2$d. | `seo-check.php` |
| Copy-edits a post body for grammar, spelling, and style, saving changes as a revision. | Copy-edits the post, saving changes as a revision. | `workflow-agent-copy-edit.php` |
| Describe your idea in a sentence or two. Our agents will find related articles, external sources, and context to help you develop it. | Describe your idea in a sentence or two. | `SeedInput.js` |
| Drag-and-drop Kanban board view of workflow posts by stage. | Drag posts between stages on a board. | `class-kanban-experiment.php` |
| Entry checkpoint: %1$s. Open the “%2$s” post status options, where it is set | Entry checkpoint: %1$s. Open the “%2$s” post status options | `StageInspector.js` |
| Expand the content with more details, examples, or related information. | Add detail, examples, or related information. | `seo-check.php` |
| Keyword density is low. Consider using the keyword more naturally. | Keyword density is low. Use the keyword more often. | `seo-check.php` |
| Mirror every event to the channels selected here, whatever the routing above says. Useful while testing a new channel. | Sends every event to these channels, ignoring routing. | `NotificationsApp.js` |
| More than one provider is connected and none is chosen. Choose the one AI features should generate through. | No provider chosen. Choose one below. | `AiModelSettings.js` |
| No AI provider is connected. Add an API key in Settings → Connectors to enable AI features. | No AI provider connected. See Settings → Connectors. | `AiModelSettings.js` |
| No comparable coverage in the archive, so there is no performance history to compare against. This may be new ground. | No comparable coverage in the archive. This may be new ground. | `class-performance-check.php` |
| No headings found. Use H2-H4 tags to structure content. | No headings found. Use H2-H4 to structure content. | `seo-check.php` |
| No images found. Adding relevant images can improve engagement. | No images found. Add relevant images. | `seo-check.php` |
| No meta description set. This appears in search results. | No meta description set. Add one for search results. | `seo-check.php` |
| No notification channel is configured yet, so no event can be routed anywhere. | No configured channels. Set one up on the Channels tab. | `NotificationsApp.js` |
| No provider has been chosen, so the only connected one is being used. Save to make that explicit — otherwise connecting a second provider will leave this site with no sel | Using the only connected provider. Save to keep it. | `AiModelSettings.js` |
| No web search provider is registered, so there is nothing to search with. | No web search provider is registered. | `class-web-researcher.php` |
| Parse.ly is missing its Site ID or API Secret. Add both under Settings → Parse.ly. | Add the Site ID and API Secret in Settings → Parse.ly. | `workflow-parsely.php` |
| Parse.ly is not connected. Ask an administrator to finish setting it up. | Parse.ly is not connected. Ask an administrator. | `workflow-parsely.php` |
| Parse.ly is not set up. Ask an administrator to activate the Parse.ly plugin. | Parse.ly is not set up. Ask an administrator. | `workflow-parsely.php` |
| Parse.ly smart linking and headline suggestions are not enabled for this site. Ask an administrator to have the feature turned on. | Parse.ly suggestions are off. Ask an administrator. | `workflow-parsely.php` |
| Reading level (grade %1$s) is above target (grade %2$d). Content may be too complex. | Reading level is grade %1$s, above target grade %2$d. | `readability.php` |
| Review and remove or replace the flagged words before publishing. | Replace or remove the flagged words. | `keyword-check.php` |
| Smart linking, headline suggestions, trending topics and audience performance data from Parse.ly. | Smart linking, headlines, trends and audience data. | `workflow-parsely.php` |
| Still processing — this is taking longer than expected. | Processing is taking longer than expected. | `DocumentCard.js` |
| The AI agent updated this post. Reload to see its changes — this discards your unsaved edits. | The agent updated this post. Reloading discards unsaved edits. | `WorkflowPanel.js` |
| The comparison with past performance is still being gathered and will be ready shortly. | Still gathering past performance. Check back shortly. | `class-performance-check.php` |
| The My Dashboard tab listing posts a reviewer can act on next. | Adds a My Dashboard tab of posts you can act on. | `class-my-queue-experiment.php` |
| The Parse.ly plugin (wp-parsely) is not active. Parse.ly capabilities cannot run without it. | The Parse.ly plugin is not active. See Plugins. | `workflow-parsely.php` |
| The provider and model the plugin uses for AI features such as media analysis, ideation and research. | *(removed)* | `AiModelSettings.js` |
| The WordPress AI client is not available on this site, so images cannot be generated. | The WordPress AI client is not available. | `class-ai-image-provider.php` |
| This agent has required settings that are not yet configured. | Some required settings are not configured. | `AssistantCard.js` |
| This document is being analyzed by AI. Check back shortly. | Analyzing this document. Check back shortly. | `DocumentCard.js` |
| This Parse.ly Site ID does not include Suggestions API access, so Smart Linking and headline suggestions cannot run. The Site ID and secret are correct; the feature is no | Site ID is correct, but Content Helper is off. Ask Parse.ly. | `workflow-parsely.php` |
| This tool has required settings that are not yet configured. | Some required settings are not configured. | `ToolsSettings.js`, `TransitionInspector.js` |
| This transition is disabled. %s publishes, and this sequence doesn’t allow AI stages to publish, so the agent stops instead of taking it. It keeps its settings — route fa | %s publishes, which AI stages can’t do. Reroute it; allowing it would publish failed runs too. | `TransitionInspector.js` |
| This transition is disabled. %s publishes, and this sequence doesn’t allow AI stages to publish, so the agent stops instead of taking it. It keeps its settings — turning  | %s publishes, which AI stages can’t do. Allow it in sequence settings or reroute. | `TransitionInspector.js` |
| This transition is disabled. An agent runs this stage and routes content onward by outcome, so nobody can use this. It keeps its settings — routing an outcome along it, o | The stage’s agent routes by outcome. Route an outcome here or remove the agent. | `TransitionInspector.js` |
| This upgrade gave every workflow stage a status region, and made a stage hold at most one transition per target. These sequences had to be changed to fit. The changes are | This upgrade changed how these sequences behave. Confirm them in the Sequence editor. | `class-admin.php` |
| Title may be truncated in search results (over 60 characters). | Title may be truncated (over 60 characters). | `seo-check.php` |
| Transitions removed, because the sequence was stored with a stage holding two to the same target. Their roles, required tools and notifications went with them: %s. | Duplicate transitions removed, with their roles, required tools and notifications: %s. | `class-admin.php` |
| Until this is set up, a post entering this stage errors — following the on-error route if one is set, stopping here otherwise. | Until this is set up, posts here will error. | `StageInspector.js` |
| Upload images, PDFs, or documents to add to your workspace. | Upload images, PDFs, or documents. | `AddSourceModal.js` |
| “%s” is no longer available on this site, so posts entering this stage will error — following the on-error route if one is set, stopping here otherwise. | “%s” is unavailable, so posts here will error. | `StageInspector.js` |

## Removed “Please” (10)

| Before | After | Where |
|---|---|---|
| Could not save the post before starting the AI stage. Please try again. | Could not save the post before starting the AI stage. Try again. | `WorkflowPanel.js` |
| Could not save the post before the transition. Please try again. | Could not save the post before the transition. Try again. | `WorkflowPanel.js` |
| No checklist items have been configured. Please add items in the Integrations settings. | No checklist items yet. Add them in Integrations settings. | `class-checklist-tool.php` |
| Please confirm | Confirm | `use-confirm.js` |
| Please enter a name for the sequence. | Enter a name for the sequence. | `SequencesList.js` |
| Please enter a valid URL. | Enter a valid URL. | `AddSourceModal.js` |
| Please upload a sequence JSON file. | Upload a sequence JSON file. | `SequencesList.js` |
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

## Typography (12)

| Before | After | Where |
|---|---|---|
| Checking how similar stories performed... | Checking how similar stories performed… | `class-performance-signals.php` |
| Comparing with past performance... | Comparing with past performance… | `class-performance-check.php` |
| How this newsroom\'s comparable past coverage performed, and which angles did best. | How this newsroom’s comparable past coverage performed, and which angles did best. | `class-performance-signals.php` |
| Processing... | Processing… | `class-ability.php` |
| Searching for media... | Searching for media… | `class-media-scout.php` |
| Searching the web... | Searching the web… | `class-web-researcher.php` |
| Searching Wikipedia... | Searching Wikipedia… | `workflow-assistant-wikipedia.php` |
| Searching your archive... | Searching your archive… | `class-archive-scout.php` |
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
