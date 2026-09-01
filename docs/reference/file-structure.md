# File Structure Map

Generated from filesystem. Last updated: 2026-06-13.

Pair with [architecture.md](architecture.md) for the conceptual model and [code-patterns.md](code-patterns.md) for usage examples.

---

### Root Plugin Files

```
vip-workflows/
├── vip-workflows.php          # Plugin header, bootstrap, activation hooks
├── autoload-paths.php        # Autoloader path resolver (class_to_relative_path); required before includes/
├── uninstall.php             # Cleanup on uninstall
├── composer.json             # PHP dependencies (Abilities API, Action Scheduler, php-ai-client)
├── package.json              # JS dependencies (React, @wordpress packages)
├── webpack.config.js         # Build configuration (admin, editor)
└── skills/                   # AI agent skill files for extensibility
    ├── create-vip-workflows-assistant/SKILL.md
    ├── create-vip-workflows-tool/SKILL.md
    └── create-vip-workflows-notification-channel/SKILL.md
```

### PHP Code (`includes/`)

```
includes/
├── class-plugin.php                    # Main plugin class (singleton bootstrap)
├── class-module-interface.php          # ModuleInterface contract
│
├── abilities/
│   ├── functions.php                   # vip_workflows_register_ability() wrapper
│   ├── class-ability.php               # Extends WP_Ability with VIP metadata
│   ├── class-ability-registry.php      # Tool registration
│   ├── class-ability-executor.php      # Tool execution engine
│   ├── class-ability-result.php        # Result data object
│   ├── class-ability-result-repository.php  # Result storage
│   ├── class-ability-settings.php      # Per-tool settings (soft/hard, enabled/disabled)
│   └── tools/
│       ├── helpers.php                 # Shared tool helpers
│       ├── seo-check.php              # SEO analysis
│       ├── readability.php            # Readability scoring
│       ├── keyword-check.php          # Keyword analysis
│       ├── transition-post.php        # Transition post status from agent
│       ├── update-post-fields.php     # Update post fields from agent
│       ├── get-available-transitions.php  # Query available transitions
│       ├── get-sequences.php         # Query sequences
│       ├── get-my-assignments.php     # Query user's assignments
│       ├── get-posts-by-status.php    # Query posts by workflow status
│       ├── get-recent-activity.php    # Query recent events
│       ├── get-stale-posts.php        # Posts unmodified for N days
│       ├── get-transition-history.php # Query transition history
│       └── get-workflow-summary.php   # Dashboard summary data
│
├── ai/
│   └── class-event-dispatcher.php     # PSR-14 for AI request logging
│
├── assistants/
│   └── class-assistant-registry.php   # Unified assistant registry (research + discovery)
│
├── automation/
│   ├── class-event-bus.php            # Records every event the plugin emits
│   └── class-event-registry.php       # Event type definitions
│
├── sequences/
│   ├── class-sequence.php            # Sequence data object
│   └── class-sequence-repository.php # Sequence CRUD
│
├── database/
│   ├── class-schema.php               # Table creation/updates (v2.14.0)
│   └── class-seeder.php              # Default data seeding
│
├── discovery/
│   ├── class-discovery-module.php     # Story Discovery module (ModuleInterface)
│   └── class-discovery-provider-registry.php  # Provider registry singleton
│
├── editor/
│   └── class-editor-integration.php   # Enqueues sidebar scripts
│
├── experiments/
│   ├── class-experiment.php              # Abstract base for toggleable experiments
│   ├── class-experiment-registry.php     # Tracks experiments, resolves enabled state
│   ├── class-experiment-cli.php          # WP-CLI: wp vip-workflows experiment
│   └── class-ideation-experiment.php     # Ideation experiment declaration
│
├── ideation/
│   ├── class-ideation-post-types.php  # Registers the Workflow Note CPT
│   ├── class-workflow-note.php        # Asset model
│   ├── assistants/
│   │   ├── class-ideation-orchestrator.php    # Coordinates all assistants
│   │   ├── class-seed-analyst.php             # Tag/entity extraction via LLM
│   │   ├── class-archive-scout.php            # Internal archive search
│   │   ├── class-web-researcher.php           # Tavily web search
│   │   ├── class-editorial-mentor.php         # Continuous guidance
│   │   ├── class-media-scout.php              # Orchestrates media providers
│   │   ├── class-archive-search-interface.php # Swappable search contract
│   │   ├── class-llm-assisted-wp-search.php   # Phase 1 archive search
│   │   ├── class-media-provider-interface.php # Pluggable media provider contract
│   │   ├── class-tavily-image-provider.php    # Web image search via Tavily
│   │   ├── class-tavily-video-provider.php    # Web video search via Tavily
│   │   ├── class-you-tube-video-provider.php  # YouTube Data API v3 search
│   │   └── class-ai-image-provider.php        # AI image generation (DALL-E)
│   └── research/
│       ├── class-ideation-analyzer.php        # AI analysis tools (summarize, compare)
│       ├── class-ideation-post-types.php      # Research project CPT
│       ├── class-source-processing-job.php    # Background source processing
│       └── search-providers/
│           ├── class-search-provider-interface.php
│           ├── class-search-provider-registry.php
│           └── class-tavily-provider.php
│
├── integrations/
│   ├── class-ai-media-analyzer.php   # Event adapter; delegates AI processing to MediaProcessor
│   ├── class-media-processor.php      # Generic AI processing (images, audio, video, PDF)
│   ├── class-url-meta-extractor.php   # Fetch Open Graph/meta tags from URLs
│   ├── class-content-extractor.php    # Extract text content from URLs/HTML
│   ├── class-draft-builder.php        # Build post drafts from ideation data
│   ├── class-llm-json-parser.php      # Parse LLM responses as JSON
│   ├── class-you-tube-transcript.php  # YouTube transcript extraction
│   └── class-guideline-context-provider.php  # Read guideline context from Gutenberg/Core for AI
│
├── maintenance/
│   └── class-cleanup.php              # Nightly prune, reported to the audit log
│
├── notifications/
│   ├── class-notification-dispatcher.php  # Central notification dispatcher
│   ├── class-notification.php             # Notification data object
│   ├── class-notification-channel.php     # Channel interface
│   └── channels/
│       ├── class-email-channel.php        # Email notifications
│       └── class-slack-channel.php        # Slack notifications
│
├── story/
│   └── class-story.php               # Story entity model
│
├── workflow/
│   ├── class-post-type-manager.php    # Maps post types to sequences
│   ├── class-status-manager.php       # Handles transitions with validation
│   ├── class-workflow-events.php      # Emits workflow events
│   ├── class-agent-runner.php         # Async agent task execution
│   └── class-assignment-manager.php   # User assignment logic
│
└── api/
    ├── class-rest-controller.php          # Base REST controller
    ├── class-sequences-controller.php    # Sequence CRUD
    ├── class-workflow-controller.php      # Transition endpoints
    ├── class-abilities-controller.php     # Tool execution
    ├── class-ability-settings-controller.php  # Tool settings
    ├── class-availability-serializer.php  # Capability-aware availability serialization
    ├── class-assets-controller.php        # Asset CRUD + upload
    ├── class-assistants-controller.php    # Unified assistants
    ├── class-audit-log-controller.php     # Event log
    ├── class-discovery-controller.php     # Story discovery
    ├── class-general-settings-controller.php  # General settings
    ├── class-ideation-controller.php      # Story ideation
    ├── class-ideation-sources-controller.php  # Research sources CRUD
    ├── class-notifications-controller.php # Notification channels
    └── class-utility-controller.php       # Shared utility endpoints
```

### JavaScript Code (`src/`)

```
src/
├── admin/
│   ├── index.js                              # Admin app entry point
│   ├── components/
│   │   ├── index.js                          # Component exports
│   │   ├── AppShell.js                       # Page dispatcher (reads ?page=, mounts the screen)
│   │   ├── AdminPage.js                      # Admin page scaffold (header + breadcrumbs; core admin-ui Page pattern)
│   │   ├── admin-page.css                    # AdminPage styles
│   │   ├── ErrorBoundary.js                  # React error boundary
│   │   ├── SummaryCard.js                    # Shared list card (title, badges, description, meta, actions)
│   │   ├── CardGridView.js                   # Shared DataViews free-composition panel: search + filters + card grid + pagination
│   │   ├── SequencesList.js                 # Sequence list
│   │   ├── graph/                            # Sequence graph editor (both sequence types)
│   │   │   ├── SequenceGraphEditor.js        # Editor core: state, load/save, canvas + inspector
│   │   │   ├── graph-model.js                # Pure model: projection, mutations, validateSequence()
│   │   │   ├── GraphCanvas.js                # @xyflow/react canvas wrapper
│   │   │   ├── StageInspector.js             # Stage (node) options
│   │   │   ├── TransitionInspector.js        # Transition (edge) options
│   │   │   ├── SequenceSettingsInspector.js  # Sequence-level settings
│   │   │   └── PhaseStageInspector.js        # Fixed-phase stage inspector
│   │   ├── TransitionAssignmentConfig.js     # Assignment config in sequences
│   │   ├── AssetManager.js                   # Asset upload/management
│   │   ├── KanbanBoard.js                    # Kanban board
│   │   ├── KanbanColumn.js                   # Kanban column
│   │   ├── KanbanCard.js                     # Kanban card
│   │   ├── GeneralSettings.js                # General settings form
│   │   ├── ApiKeysSettings.js                # API keys settings
│   │   ├── AssistantsTab.js                  # Integrations > Assistants
│   │   ├── AssistantCard.js                  # Unified assistant card
│   │   ├── ToolsSettings.js                  # Integrations > Tools
│   │   ├── NotificationChannelsTab.js        # Integrations > Channels
│   │   ├── JobsTab.js                        # Integrations > Jobs
│   │   ├── SchemaSettings.js                 # Auto-render settings from JSON schema
│   │   ├── InstallSkillButton.js             # Download skill zip for AI agents
│   │   ├── SearchResultsModal.js             # Generic search results modal
│   │   ├── AddSourceModal.js                 # Add research source manually
│   │   ├── ProjectEditModal.js               # Edit ideation project
│   │   └── ideation/
│   │       ├── SeedInput.js                  # Freeform seed textarea
│   │       ├── IdeationWorkspace.js          # Main workspace layout
│   │       ├── TopBar.js                     # Seed, tags, active assistants
│   │       ├── MoodBoard.js                  # Masonry research card board
│   │       ├── IdeationCard.js               # Card type router
│   │       ├── IdeationSummary.js            # Project summary view
│   │       ├── RecentProjects.js             # Recent projects list
│   │       ├── DiscoverySearchModal.js        # Discovery provider search
│   │       ├── use-card-actions.js           # Pin/dismiss/similar hooks
│   │       ├── use-mentor.js                 # Editorial mentor hook
│   │       ├── use-drop-zone.js              # Drag-and-drop hook
│   │       └── cards/
│   │           ├── shared.js                 # Shared card helpers
│   │           ├── ArticleCard.js            # Article card with summarize
│   │           ├── DocumentCard.js           # Document/PDF card
│   │           ├── ImageCard.js              # Image card
│   │           ├── TagCloudCard.js           # Tag cloud visualization
│   │           ├── EntityCard.js             # Entity card
│   │           └── NewsAngleCard.js          # News angle card
│   └── pages/
│       ├── Dashboard.js                      # Workflow overview
│       ├── MyDashboard.js                    # Personal dashboard
│       ├── MyDashboardPage.js                # Personal dashboard page wrapper
│       ├── MyWorkPage.js                     # My work items
│       ├── MyQueuePage.js                    # My review queue
│       ├── Kanban.js                         # Kanban board page
│       ├── Sequences.js                     # Sequence management
│       ├── Queue.js                          # Review queue
│       ├── AuditLog.js                       # Audit log viewer
│       ├── Calendar.js                       # Calendar view
│       ├── Ideation.js                       # Story ideation
│       ├── Contributors.js                   # Contributor management
│       ├── Notifications.js                  # Notifications page
│       ├── Settings.js                       # Settings page
│       └── Integrations.js                   # Integrations page
│
├── editor/
│   ├── index.js                              # Editor sidebar entry point
│   ├── store.js                              # WordPress data store
│   └── components/
│       ├── index.js                          # Component exports
│       ├── WorkflowPanel.js                  # Stage, progress, transitions, actions
│       ├── WorkflowHistoryModal.js           # Transition trail (DataViews, code-split)
│       ├── WorkflowSaveGuard.js              # editor.preSavePost guard — no chrome
│       ├── MetadataPanel.js                  # Editorial metadata fields
│       ├── ToolsPanel.js                     # Tools + results
│       ├── WorkflowRequiredModal.js          # Required workflow prompt
│       ├── TransitionInputPopover.js         # Transition input (note, or assignee + notes)
│       ├── ToolResultModals.js               # Tool result display modals
│       ├── CommandPalette.js                 # Command palette (Cmd+K)
│       ├── BylineSelector.js                 # Byline selection
│       └── BylineList.js                     # Byline display
│
├── common/                                   # JS shared across entries
│   ├── event-description.js                  # One sentence per workflow event
│   ├── ToolFailuresModal.js                  # Hard failures and soft warnings
│   └── use-confirm.js                        # Confirm / acknowledge dialogs
│
├── entries/                                  # Build entries with no page tree of their own
│   ├── confirm-workflow-side-effect.js       # Status-change decision table + copy
│   └── classic-admin.css                     # Styles for the classic wp-admin screens
│
├── styles/                                   # CSS shared across entries
│
└── notifications/
    └── components/
        └── NotificationsApp.js               # Notifications UI
```

### Build Output (`build/`)

Generated by webpack. Do not edit directly. Entry points: admin, editor.

> The AI Agent (chat) surfaces — the `ai-agent.php` ability, `class-ai-agent-service.php`,
> `class-ai-agent-controller.php`, `AiAgentSettings.js`, the `ai-agent/` chat components,
> and the `slideout/` entry — were extracted to the standalone `vip-ai-agent` plugin
> (2026-07-09) and no longer live in core.

### Extension Plugins

```
workflow-assistant-wikipedia/          # Research assistant: Wikipedia search
workflow-tool-checklist/               # Check tool: configurable checklist
workflow-agent-copy-edit/              # Stage agent: copy editing
workflow-agent-tag-sanity-check/       # Stage agent: tag validation
workflow-parsely/                      # Parse.ly abilities, agents, and discovery
```

Additional integrations can be built as standalone plugins using the same extension points.
