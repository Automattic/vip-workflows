# Admin UI & React Components

Inventory of the React applications that ship with the plugin: the editor sidebar, the story ideation UI, the notifications UI, the dashboard, the individual admin pages, and the settings pages, including the API-key story.

For corresponding REST endpoints see [quick-reference.md](quick-reference.md); for common React gotchas see the "React/JavaScript Patterns" section of that same file.

---

### Editor Sidebar (React)

**Location**: `src/editor/`

Everything the plugin adds to the block editor lives in one `PluginSidebar`
named "Workflow" — the plugin used to also mount two
`PluginDocumentSettingPanel`s in the document settings sidebar, which duplicated
the sidebar's own readouts and split one feature across two places.

**Structure** (`index.js`):
- `WorkflowSaveGuard` — mounted unconditionally, **outside the sidebar**, and
  renders no chrome. Its `editor.preSavePost` filter has to survive the sidebar
  being closed, which is why it is not inside it.
- One `Stack` (`.vip-workflows-sidebar`) holding `WorkflowPanel`. No card and no
  heading of its own: `PluginSidebar` already names the sidebar "Workflow", and
  the panel opens with the document-sidebar row that names the sequence. The
  runs within the panel rule themselves apart.
- `MetadataPanel` is a **child of** `WorkflowPanel`, not a sibling section. The
  panel's foot — Show history, and the way out of the workflow — lives inside
  the panel and acts on the workflow itself, so it has to come after the fields
  the writer fills in; lifting the foot out instead would mean lifting the
  panel's `transitioning`/`historyOpen` state and its lazily-loaded history
  dialog with it, purely for a reorder. So the panel reads: sequence row →
  assignment and claim → transition rail → metadata → foot. Every one of the
  panel's returns renders the metadata slot, including the ones that draw no
  workflow at all — nesting made the panel the only thing deciding whether the
  section reaches the screen.
- `CommandPalette` and `WorkflowRequiredModal` — no chrome of their own.

**Main Components**:
- `WorkflowPanel.js` — the whole of a post's workflow state: the sequence the
  post belongs to, assignment and claim, stage-agent states, the transition
  rail, the metadata slot, and the footer actions (Show history, Remove from
  workflow)
- `TransitionRail.js` — the current stage and every way out of it, drawn as
  one figure. A transition's required tools are not listed: they run when it
  fires, and a refusal opens `ToolFailuresModal`
- `WorkflowHistoryModal.js` — the transition trail, as a DataViews activity
  stream in a dialog. Code-split: DataViews is bundled rather than externalized,
  so it loads on first open
- `MetadataPanel.js` — sequence-declared editorial metadata fields, written
  through `useEntityProp` so they take part in collaborative editing. Renders
  nothing at all when the active sequence declares no fields
- `SidebarRow.js` — core's document-sidebar row (a label beside a value-shaped
  trigger whose popover holds the control), rebuilt once because neither
  `PostPanelRow` nor `InspectorPopoverHeader` is exported. `WorkflowRow.js` and
  `MetadataRow.js` are its two users
- `TransitionInputPopover.js` — the text and assignment inputs a transition can
  require, asked for at the button that needs them
- `ToolResultModals.js` — tool result display modals
- `CommandPalette.js` — command palette (Cmd+K)
- `WorkflowRequiredModal.js` — the "pick a workflow" prompt for a new post
- Shared from `src/common/`: `ToolFailuresModal` (hard failures and
  warnings), `useConfirm`

**Data Flow**:
1. `EditorIntegration.php` enqueues scripts and localizes data
2. React components mount in the editor sidebar slot
3. Components use `@wordpress/api-fetch` for REST API calls
4. State managed with React hooks (useState, useEffect)
5. One `GET /workflow/post/{id}/status` request feeds the whole panel; it polls
   only while a stage agent is running

**Key Features**:
- Color-coded stages, with the rail drawing the current one and the routes out
- Required-check state shown against each transition before it is pressed
- Assignment autocomplete with user search

### Story Ideation UI (React)

**Location**: `src/admin/components/ideation/` (mounted from `src/admin/pages/Ideation.js`, gated on the `ideation` experiment — see [architecture.md § Ideation System](architecture.md#4-ideation-system) and [§ Story Ideation](architecture.md#4b-story-ideation))

**Main Components**:
- `SeedInput.js` - the freeform seed textarea that starts a project
- `IdeationWorkspace.js` - workspace layout: top bar, masonry board, assistant panel
- `TopBar.js` - seed, tags, active assistants
- `MoodBoard.js` - CSS-columns masonry board of research cards, with type-specific card components under `cards/`
- `StoryDiscovery.js` - provider-driven discovery sections on the landing page, before a seed exists
- `AssistantPanel.js` - collapsible panel with mentor guidance and per-assistant results
- `DiscoverySearchModal.js` / `AddSourceModal.js` / `PromptPreviewModal.js` - search, manual add, and prompt-preview modals

There is no separate asset-upload panel in this UI — assets attach to ideation projects through the source/card flow above, not a dedicated `AssetsPanel.js`/`AssetUploader.js` (those do not exist in the current tree).

### Notifications UI (React)

**Location**: `src/admin/components/NotificationChannelsTab.js` (page: `src/admin/pages/Notifications.js`) and `src/admin/components/notifications/NotificationsApp.js`

There is no in-app notification bell or inbox — no admin-bar icon, no unread dropdown, no mark-as-read. The `wp_vip_workflows_notifications` table is still created by the schema but nothing reads or writes it. What exists is configuration for the two real delivery channels:

**Components**:
- `NotificationChannelsTab.js` - the whole Notifications screen: a `Channels` tab (one card per registered channel — Slack supports multiple webhook destinations, each its own card) and a `Routing` tab
- `notifications/NotificationsApp.js` - despite the name, this is the `Routing` tab's content: the event-to-channel matrix and the debug/mirror-everything toggle

**Features**:
- Per-channel settings (webhook URL, etc.), each with its own REST route and its own "Send test" action
- One event-to-channel routing matrix shared by all channels
- Debug mode to mirror every event to selected channels for testing

### Admin Dashboard (React)

**Location**: `src/admin/pages/MyDashboard.js` / `MyDashboardPage.js`

There is no separate site-wide "Dashboard" page or `WorkflowDashboard.js`/`SequenceManager.js`/`StatusChart.js`/`RecentActivity.js`/`MyWorkItems.js` — none of those components exist. "My Dashboard" (personal, landing page for both editors and authors) is the only dashboard; team-wide views live on the dedicated Kanban, Calendar, and Audit Log pages instead of a shared dashboard widget set.

### Admin Pages

**Location**: `src/admin/pages/` (React) and `includes/admin/` (PHP)

> **Rendering model:** Following the app-shell removal, these screens render as standard wp-admin pages in the normal admin canvas — no fullscreen shell, no injected React sidebar, no `vipWorkflowsAdmin.menuItems` global. Navigation is the native Workflows submenu, ordered by `Admin::cleanup_menu()` into a "Main" group (My Dashboard, Kanban, Calendar, Ideation) and a "System" group (Sequences, Notifications, Agents, Tools, Audit Log, Settings); any third-party page falls after both, unordered. The System screens use the shared `AdminPage` scaffold (`src/admin/components/AdminPage.js`), whose header + breadcrumbs match WordPress core's `@wordpress/admin-ui` `Page` pattern. Its stylesheet (`admin-page.css`) carries the **wp-admin typography reset** that stops wp-admin's unlayered `common.css` from overriding `@wordpress/ui` component styles — see [`docs/guides/wpds-usage-audit-patterns.md` → "wp-admin ↔ WPDS cascade-layer conflicts"](../guides/wpds-usage-audit-patterns.md#wp-admin--wpds-cascade-layer-conflicts-why-ds-styles-get-overridden); expect to reapply it on any new surface (modals/slideouts portal outside this canvas).
>
> There is no tabbed "Integrations" page any more. The menu restructuring split it into separate top-level submenu items — **Notifications**, **Agents**, and **Tools** — each its own `AdminPage`. Treat `includes/admin/class-admin.php` (`register_menu()`) as the source of truth for the current menu. The API-key section below reflects the current connector-based credential flow.

**Main Pages** (display order set by `Admin::cleanup_menu()`, not registration order; **My Dashboard/Kanban/Calendar/Ideation** are the "Main" group, **Sequences/Notifications/Agents/Tools/Audit Log/Settings** are "System" — Kanban/Calendar/Sequences/Notifications/Agents/Tools/Audit Log are editor+ only, gated on `edit_others_posts`):
1. **My Dashboard** - landing page for every role; current user's assignments (also the top-level "Workflows" menu item itself)
2. **Kanban** - visual board view of work items, shown while the `kanban` experiment is enabled
3. **Calendar** - calendar view of scheduled/dated work, shown while the `calendar` experiment is enabled
4. **Ideation** - the story-ideation workspace, shown only while the `ideation` experiment is enabled (see [architecture.md § Experiments](architecture.md) and [`docs/specs/shipped/experiments.md`](../specs/shipped/experiments.md))
5. **Sequences** - Create/edit workflow and phase sequences (two tabs: "Workflow sequences", "Phase sequences")
6. **Notifications** - Channels + Routing (see Notifications UI above)
7. **Agents** - Unified view of research abilities + discovery providers, one card per plugin (see [architecture.md § 5a](architecture.md#5a-unified-assistants-agents-page)). An unavailable card names each unmet requirement from the ability's or provider's `availability_callback` and links to where it can be satisfied — for the built-in services that is core's Settings → Connectors, not this plugin
8. **Tools** - Configure per-tool settings, check modes (soft/hard), and two admin-controlled toggles:
   - **Show in Command Palette (⌘K)** — only shown for tools that declare `'show_in_commands' => true` in their ability `meta`. When enabled, the tool registers with `wp.commands` and appears in the editor ⌘K palette.
   - **Can be used in transitions** — only shown for tools that declare `'transition_eligible' => true` in their ability `meta`. When enabled, the tool is available to attach to workflow stage transitions.

   Both toggles persist via `AbilitySettings` → `wp_options` (`vip_workflows_ability_settings`).
9. **Audit Log** - Search and filter workflow events, role-gated by `Settings::can_user_view_audit_log()`

There is no "Queue" page and no generic "Dashboard" separate from "My Dashboard" — neither exists in the current menu. A third-party plugin's own admin page falls after all of the above, in the trailing (unnamed) group `cleanup_menu()` gives every unlisted slug.

**Settings Page** (tabbed, one Save for the whole screen — see [`docs/guides/settings-standard.md`](../guides/settings-standard.md)):
- **General** - Workflow enforcement, bypass roles, audit log access
- **AI services** - Selects the AI provider and model. This is a *preference* only; it holds no API keys.
- **Prompts** - `PromptsSettings.js`; editable prompt text for AI-driven features
- **Experiments** - `ExperimentsSettings.js`; toggles registered experiments (`ideation`, `kanban`, `calendar`, and `my_queue`). Enabling/disabling reloads the page, since it changes server-registered menus, REST routes, and dashboard tabs — see [`docs/specs/shipped/experiments.md`](../specs/shipped/experiments.md)

**Settings Storage**:
- WordPress options table (`vip_workflows_settings`)
- Per-user meta for preferences
- Per-tool settings via AbilitySettings class

**API Keys — not an admin surface in this plugin**:

The plugin has no API-key entry UI. Keys for the built-in services (OpenAI, Anthropic, Google, Tavily, YouTube) are entered on WordPress core's **Settings → Connectors** screen (`options-connectors.php`). The plugin's former bespoke key stack — the `vip_workflows_api_key_fields` filter, the `ApiKeysController` class, its encrypted `vip_workflows_api_keys` option UI, and the `/vip-workflows/v1/settings/api-keys` routes — is no longer part of the plugin.

All credential reads go through the `VIPWorkflows\AI\Credentials` facade, which prefers a `VIP_WORKFLOWS_*_KEY` constant and otherwise resolves through core connectors (or a legacy fallback store on installs without them). `Credentials::has_admin_credential_ui()` reports whether this install has a credential screen at all — code that points a user at one must check it rather than assuming Connectors exists.

See [`vip-workflows/docs/PLUGIN-INTEGRATION.md` § API Keys](../../vip-workflows/docs/PLUGIN-INTEGRATION.md#api-keys) for how a third-party plugin supplies its own key.
