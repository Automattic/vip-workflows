# Admin UI & React Components

Inventory of the React applications that ship with the plugin: the editor sidebar, the ideation admin, the notifications UI, the admin dashboard, the individual admin pages, and the settings/integrations pages with their API-key registry.

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
- One `Stack` (`.vip-workflow-sidebar`) holding `WorkflowPanel`. No card and no
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
- `TransitionRail.js` — the current stage, every way out of it, and the checks
  each way out depends on, drawn as one figure
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

### Ideation Admin UI (React)

**Location**: `src/ideation/`

**Main Components**:
- `AssetsPanel.js` - Asset upload and management
- `AssetUploader.js` - Drag-and-drop file upload

**Features**:
- Inline editing
- Quick filters (type, assignee)
- Asset preview with AI analysis results
- Claim board integration

### Notifications UI (React)

**Location**: `src/notifications/`

**Components**:
- `NotificationsList.js` - List of user notifications
- `NotificationItem.js` - Individual notification card
- `NotificationBell.js` - Admin bar bell icon with badge

**Features**:
- Real-time unread count
- Mark as read/unread
- Click to navigate to related post
- Infinite scroll pagination
- Filter by type
- Delete notifications

### Admin Dashboard (React)

**Location**: `src/admin/`

**Components**:
- `WorkflowDashboard.js` - Main dashboard overview
- `SequenceManager.js` - Sequence CRUD interface
- `StatusChart.js` - Visual status distribution
- `RecentActivity.js` - Recent workflow events
- `MyWorkItems.js` - Current user's assigned items

**Dashboard Widgets**:
- Posts by status (pie chart)
- SLA breaches (alert list)
- Recent transitions (timeline)
- My assignments (task list)
- Team activity (feed)

### Admin Pages

**Location**: `src/admin/pages/` (React) and `includes/admin/` (PHP)

> **Rendering model:** Following the app-shell removal, these screens render as standard wp-admin pages in the normal admin canvas — no fullscreen shell, no injected React sidebar, no `vipWorkflowAdmin.menuItems` global. Navigation is the native Workflows submenu (ordered Main → System → Integrations in `Admin::cleanup_menu()`). The System screens (Settings, Notifications, Agents, Tools, Jobs) use the shared `AdminPage` scaffold (`src/admin/components/AdminPage.js`), whose header + breadcrumbs match WordPress core's `@wordpress/admin-ui` `Page` pattern. Its stylesheet (`admin-page.css`) carries the **wp-admin typography reset** that stops wp-admin's unlayered `common.css` from overriding `@wordpress/ui` component styles — see [`docs/guides/wpds-usage-audit-patterns.md` → "wp-admin ↔ WPDS cascade-layer conflicts"](../guides/wpds-usage-audit-patterns.md#wp-admin--wpds-cascade-layer-conflicts-why-ds-styles-get-overridden); expect to reapply it on any new surface (modals/slideouts portal outside this canvas).
>
> The page inventory below is partially out of date — it predates the menu restructuring. Treat `includes/admin/class-admin.php` and [`vip-workflow/docs/PLUGIN-INTEGRATION.md`](../../vip-workflow/docs/PLUGIN-INTEGRATION.md) as the source of truth. The API-key section reflects the current connector-based credential flow.

**Main Pages**:
1. **Dashboard** - Workflow overview and stats
2. **My Dashboard** - Current user's assignments
3. **Kanban** - Visual board view of work items
4. **Sequences** - Create/edit workflow and phase sequences (two tabs: "Workflow Sequences", "Phase Sequences").
5. **Queue** - Items awaiting review
6. **Audit Log** - Search and filter workflow events

**Integrations Page** (tabbed):
- **Notification Channels** - Slack, Email, ntfy, etc.
- **Tools** - Configure per-tool settings, check modes (soft/hard), and two admin-controlled toggles:
  - **Show in Command Palette (⌘K)** — only shown for tools that declare `'show_in_commands' => true` in their ability `meta`. When enabled, the tool registers with `wp.commands` and appears in the editor ⌘K palette.
  - **Can be used in transitions** — only shown for tools that declare `'transition_eligible' => true` in their ability `meta`. When enabled, the tool is available to attach to workflow stage transitions.

  Both toggles persist via `AbilitySettings` → `wp_options` (`vip_workflow_ability_settings`).
- **Assistants** - Unified view of research abilities + discovery providers, one card per plugin (see [architecture.md § 5a](architecture.md#5a-unified-assistants-integrations-page)). An unavailable card names each unmet requirement from the ability's or provider's `availability_callback` and links to where it can be satisfied — for the built-in services that is core's Settings → Connectors, not this plugin
- **Jobs** - View and manage background jobs

**Settings Page** (tabbed):
- **General** - Workflow enforcement, bypass roles, audit log access
- **AI Services** - Selects the AI provider and model. This is a *preference* only; it holds no API keys.

**Settings Storage**:
- WordPress options table (`vip_workflow_settings`)
- Per-user meta for preferences
- Per-tool settings via AbilitySettings class

**API Keys — not an admin surface in this plugin**:

The plugin has no API-key entry UI. Keys for the built-in services (OpenAI, Anthropic, Google, Tavily, YouTube) are entered on WordPress core's **Settings → Connectors** screen (`options-connectors.php`). The plugin's former bespoke key stack — the `vip_workflow_api_key_fields` filter, the `ApiKeysController` class, its encrypted `vip_workflow_api_keys` option UI, and the `/vip-workflow/v1/settings/api-keys` routes — is no longer part of the plugin.

All credential reads go through the `VIPWorkflow\AI\Credentials` facade, which prefers a `VIP_WORKFLOW_*_KEY` constant and otherwise resolves through core connectors (or a legacy fallback store on installs without them). `Credentials::has_admin_credential_ui()` reports whether this install has a credential screen at all — code that points a user at one must check it rather than assuming Connectors exists.

See [`vip-workflow/docs/PLUGIN-INTEGRATION.md` § API Keys](../../vip-workflow/docs/PLUGIN-INTEGRATION.md#api-keys) for how a third-party plugin supplies its own key.
