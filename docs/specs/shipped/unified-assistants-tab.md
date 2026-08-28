---
status: shipped
version: 1.1
last_updated: 2026-07-29
related:
  - shipped/story-discovery.md
  - shipped/extensible-research-agents.md
  - planned/qwoted.md
---

# Unified Assistants Tab

## Problem

The Integrations page has separate tabs for "Assistants" (research agents) and "Story Discovery" (discovery providers). A plugin like Qwoted provides both capabilities: it surfaces journalist requests as story prompts (discovery) and finds expert sources during research (assistant). With separate tabs, the editor sees the same service twice and configures credentials in two places.

## Solution

Merge the Assistants and Story Discovery tabs into a single **"Assistants"** tab. Each assistant plugin gets one card, regardless of how many capabilities it provides. The card description explains what the assistant does in plain language. The backend tracks capabilities for routing, and the UI exposes compact capability labels when they affect configuration decisions, such as whether an agent is available in AI stages.

The other Integrations tabs (Notification Channels, Tools, Jobs) are unaffected.

## Scope

**What changes:**

- Assistants tab and Story Discovery tab merge into one "Assistants" tab
- New `AssistantRegistry` groups research abilities, stage-eligible abilities, and discovery providers by plugin slug
- New `AssistantCard` component replaces both the assistant card and provider card
- New REST endpoints for the unified list and settings

**What does NOT change:**

- Tools tab, Notification Channels tab
- Discovery provider registration (`vip_workflows_register_discovery_providers`)
- Ability registration (`wp_abilities_api_init`)
- REST APIs for discovery recommend/search/select
- REST APIs for ability execution
- How the ideation landing page and mood board consume providers/assistants
- How `StageAgentRunner` executes stage-eligible abilities

The refactor is purely about the settings UI on the Integrations page.

## Backend: AssistantRegistry

### New file: `vip-workflows/includes/assistants/class-assistant-registry.php`

A singleton that combines research abilities, stage-eligible abilities, and discovery providers into a unified assistant list, grouped by plugin slug.

- Reads research abilities from `wp_get_abilities()` filtered by `get_category() === 'research'` and plugin-scoped stage-eligible abilities where `meta.supports` includes `stage` and `meta.stage_eligible` is true (merged with per-ability settings from `AbilitySettings`). Unmigrated core `vip-workflows/*` stage abilities stay internal until they are moved into agent plugins.
- Reads discovery providers from `DiscoveryProviderRegistry`
- Auto-generates an entry per unclaimed source: an ability `workflow-assistant-wikipedia/wikipedia` maps to slug `workflow-assistant-wikipedia-wikipedia`; a discovery provider `foresight-news` maps to slug `foresight-news`. **Amended:** the derived slug carries the whole ability id, not just its vendor prefix. Prefix-only derivation collapsed every ability a plugin registers onto one slug — both core research agents derived `vip-workflows` — and the entry slug is how a card addresses itself over REST. Grouping several abilities onto one card is what a manifest is for, and a manifest keeps its declared slug; this affects only entries generated because nothing claimed them. Nothing persists an entry slug (settings write through to ability ids and provider slugs), so widening it changed addressing only
- Plugins that span multiple capabilities (e.g., `workflow-qwoted` registers a discovery provider AND a research ability) declare a manifest via the `vip_workflows_register_assistant_meta` action with explicit `ability_ids`, `provider_slugs`, and optional `capabilities`; matched capabilities are merged into a single card

Unified assistant shape:

```php
array(
    'slug'            => 'workflow-qwoted',
    'label'           => 'Qwoted',
    'description'     => 'Expert sources and journalist requests.',
    'icon'            => 'microphone',
    'capabilities'    => array( 'discovery', 'research', 'stage' ),
    'available_in_ai_stage' => true,
    'available'       => true,
    'enabled'         => true,
    'settings_schema' => array( ... ),
)
```

The `capabilities` array determines where the assistant participates: landing page recommendations, project research, AI-owned workflow stages, or a combination. The Agents tab renders these as compact labels, including **Available in AI stage** for `stage`.

Plugins declare their unified metadata via a new action `vip_workflows_register_assistant_meta`. For simple plugins that only register one capability (like Wikipedia), the registry auto-generates metadata from the ability or provider registration. No changes needed in existing extension plugins.

### New REST endpoints

**`GET /vip-workflows/v1/assistants`** returns the unified assistant list with capabilities, availability, enabled status, merged options, and merged settings schema.

**`POST /vip-workflows/v1/assistants/{slug}/settings`** saves settings for a single assistant. Body: `{ enabled?: bool, options?: object }`. The registry writes through to the existing storage (`vip_workflows_ability_settings[id]` for each covered ability, `vip_discovery_provider_settings[slug].enabled` and `vip_discovery_provider_{slug}` config for each covered provider) so legacy consumers (ability executor, discovery controller) keep working unchanged.

The existing `GET /v1/discovery/providers` endpoint remains available for internal use. `GET/POST /v1/discovery/settings` was kept alongside it at ship time, but the Integrations page uses only the new unified endpoints, nothing else ever called it, and it has since been deleted as an orphaned surface. The old `GET/POST /v1/settings/abilities` endpoint was also retired in favor of the per-surface `GET /v1/tools` and `POST /v1/tools/{id}/settings` endpoints.

## Frontend

### New component: `AssistantCard.js`

Replaces both the assistant `Card` from `AssistantsTab.js` and `ProviderCard` from `DiscoveryProvidersTab.js`. Design:

- **Header:** icon, name, enabled toggle
- **Body:** description (plain language), capability labels, availability notice (if not configured), settings fields via `SchemaSettings` or the extension filter hook
- **Footer:** Save button (always visible, disabled when no changes), "Unsaved changes" hint

Capability labels stay compact and declarative. They do not create extra settings; stage availability is declared in the manifest and validated against ability metadata.

### Refactored: `AssistantsTab.js`

Fetches from `GET /v1/assistants` instead of the separate abilities and discovery endpoints. Renders `AssistantCard` for each entry. Includes the existing "How to create" help modal, updated to mention research, discovery, and AI-stage capabilities.

### Removed: `DiscoveryProvidersTab.js`

Absorbed into the unified `AssistantsTab`.

### Updated: `Integrations.js`

Remove the `discovery` tab entry. Update the header description. Four tabs remain: Channels, Tools, Assistants, Jobs.

### Extension hook migration

`AssistantCard` checks three JS filters in priority order:

1. **`vipWorkflows.assistantSettings`** (new unified hook) — receives the unified assistant entry (`slug`, `capabilities`, `ability_ids`, `provider_slugs`, `options`, …) plus a `{ disabled, onHasChangesChange, onSaveRef }` callbacks object.
2. **`vipWorkflows.assistantSettingsComponent`** (legacy assistants hook) — applied when the unified hook returns nothing AND the card covers at least one ability. Receives a shim with `id` set to the first covered ability id so existing filters keep working, plus the same callbacks object.
3. **`vip_workflows_discovery_provider_settings`** (legacy discovery hook) — applied when neither of the above return anything AND the card covers at least one provider. Receives the first covered provider slug, and returns a component *type* that the card renders with `providerSlug` and `disabled` props.

The card always supplies the callbacks object, on every path — a filter callback may destructure it without guarding, and the two `disabled` shapes above are the whole contract for that member.

`disabled` is `true` while the agent is switched off. A plugin-supplied settings component **must** honor it: pass it to every control it renders, and never report `true` through `onHasChangesChange` while it is set. The card can only disable the controls it renders itself, and a plugin component replaces those — so without this the card's own fix just moves the bug one layer out, and a switched-off agent stays configurable and savable.

Plugins using the old hooks continue to work. New plugins use `vipWorkflows.assistantSettings`.

## How Existing Plugins Map

- **Wikipedia** (`workflow-assistant-wikipedia`): registers one research ability. Auto-generates unified entry. No changes needed.
- **Hacker News** (`workflow-assistant-hackernews`): same as Wikipedia.
- **Poems** (`workflow-assistant-poems`): same as Wikipedia.
- **Reformat to Template** (`workflow-agent-reformat-to-template`): registers one mutating stage-eligible ability and a manifest with `capabilities: [ 'stage' ]`.
- **Copy Edit** (`workflow-agent-copy-edit`): registers one mutating stage-eligible ability and a manifest with `capabilities: [ 'stage' ]`.
- **Fact Check** (`workflow-agent-fact-check`): registers one stage-eligible ability and a manifest with `capabilities: [ 'stage' ]`. Shows as available in AI stages.
- **Tag Sanity Check** (`workflow-agent-tag-sanity-check`): registers one read-only stage-eligible ability and a manifest with `capabilities: [ 'stage' ]`.
- **Test Provider** (`workflow-discovery-test`): registers one discovery provider. Auto-generates unified entry. No changes needed.
- **Foresight** (future): registers a discovery provider AND a research ability under the same plugin slug. Gets one card with shared API key settings.
- **Qwoted** (future): same pattern as Foresight.

All existing plugins work without modification. The registry infers capabilities from what each plugin registers, and manifests can declare `stage` when the plugin has a matching stage-eligible ability.
