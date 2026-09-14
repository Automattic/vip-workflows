# UX copy audit — before / after

Every user-facing string that changed. Derived from the diff between the audit commit and HEAD rather than from an edit log, so a string renamed twice shows only its **net** result. **243 distinct strings** across the plugin and its five extension plugins.

Rules and rationale: [`copy-standard.md`](copy-standard.md). Test-only changes are excluded.

| Group | Strings |
|---|---|
| [Capitalization](#capitalization) | 92 |
| [Capitalization + wording](#capitalization--wording) | 3 |
| [Ability labels](#ability-labels) | 10 |
| [New: reader-facing tool summaries](#new-reader-facing-tool-summaries) | 26 |
| [New: Quick Edit strings, now translatable](#new-quick-edit-strings-now-translatable) | 5 |
| [Helper text](#helper-text) | 13 |
| [Rewritten for clarity](#rewritten-for-clarity) | 14 |
| [Errors](#errors) | 20 |
| [Permission errors](#permission-errors) | 12 |
| [Empty states](#empty-states) | 5 |
| [Removed “Please”](#removed-please) | 10 |
| [Removed “successfully”](#removed-successfully) | 4 |
| [Typography](#typography) | 23 |
| [Terminal periods](#terminal-periods) | 6 |
| **Total** | **243** |

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
| Requires every item on your pre-publish checklist to be ticked. | `class-checklist-tool.php` |
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

## Rewritten for clarity (14)

| Before | After | Where |
|---|---|---|
| Ability meta, including supports, stage_eligible and transition_eligible. | Ability meta, including summary, supports, stage_eligible and transition_eligible. | `class-abilities-controller.php` |
| An error occurred while rendering this page. | This page could not be rendered. Reload to try again. | `ErrorBoundary.js` |
| Configure agents that assist with editorial work. | Agents run when a post enters a stage, and route it onward by what they find. | `Agents.js` |
| Configure workflow settings and preferences. | How workflows behave site-wide: enforcement, permissions, AI and integrations. | `Settings.js` |
| Configure workflow tools available to your team. | Tools check a post before it moves. A transition can require any of them. | `Tools.js` |
| Enter a unique name for this sequence. | Must be unique. | `SequencesList.js` |
| Human-readable description of what the ability does. | Tool description written for a language model. Not for display — use label and meta.summary. | `class-abilities-controller.php` |
| Must match assignment key from another transition | Must match the key an earlier transition assigned. | `TransitionAssignmentConfig.js` |
| Restrict this transition to a previously assigned user or role | Only the user or role an earlier transition assigned can make this move. | `TransitionAssignmentConfig.js` |
| Sequences define workflow stages and transitions for your content types. | A sequence is the set of stages a post moves through, and the routes between them. | `SequencesList.js` |
| View all workflow activity and changes. | Every workflow event on this site — what happened, who did it, and when. | `AuditLog.js` |
| View Dashboard | Open dashboard | `class-dashboard-widget.php` |
| Your personal workspace for work and ideation. | The posts assigned to you, your review queue, and your ideation projects. | `MyDashboard.js` |
| ✓ All required items complete | All required items complete | `editor.js` |

## Errors (20)

| Before | After | Where |
|---|---|---|
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

## Empty states (5)

| Before | After | Where |
|---|---|---|
| No agent plugins are installed. | No agent plugins installed. Agents arrive as separate plugins. | `AssistantsTab.js` |
| No check tools are registered. | No check tools yet. Add one with the Abilities API — see Add custom tools. | `ToolsSettings.js` |
| No configurable prompts are registered. | No configurable prompts on this site. A plugin registers them. | `PromptsSettings.js` |
| No experiments are available. | No experiments on this site. They arrive with plugin releases. | `ExperimentsSettings.js` |
| No helper tools are registered. | No helper tools yet. Add one with the Abilities API — see Add custom tools. | `ToolsSettings.js` |

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

## Typography (23)

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
| The "%1$s" sequence has no stage with the %2$s status, so it cannot be started on this post. Change the post\'s status, or choose a sequence that covers it. | The "%1$s" sequence has no stage with the %2$s status, so it cannot be started on this post. Change the post’s status, or choose a sequence that covers it. | `class-status-manager.php` |
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

