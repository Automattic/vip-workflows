---
status: shipped
version: 1.0
last_updated: 2026-06-16
related:
  - shipped/module-registry.md
---

# Experiments — Toggleable Feature System

---

## 1. Overview

Experiments are in-development features that ship **disabled by default** and can be toggled on per-site. Each experiment declares the modules, admin modules, REST controllers, menus, and UI it owns; while disabled, none of those register. Toggling is surfaces-only — it never deletes data.

The system replaced the standalone "Content OS" admin page. The toggle UI now lives in **Settings → Experiments**.

Currently the only registered experiment is **Ideation** (`ideation`), which gates the research/discovery/source-processing subsystem.

---

## 2. Architecture

`includes/experiments/`:

| Class | File | Responsibility |
|-------|------|----------------|
| `Experiment` (abstract) | `class-experiment.php` | Declares an experiment: `get_id()`, `get_name()`, `get_description()`, `get_icon()`, `get_modules()`, `get_admin_modules()`, `is_available()`, `activate()`, `deactivate()`. |
| `ExperimentRegistry` | `class-experiment-registry.php` | Tracks experiments and resolves enabled state. `register()`, `is_enabled()`, `enable()`, `disable()`, `get_all()`, `get_enabled()`, `to_array()`, `register_modules( Plugin )`. |
| `IdeationExperiment` | `class-ideation-experiment.php` | The Ideation experiment. Registers `IdeationPostTypes`, `SourceProcessingJob`, `DiscoveryModule` (+ `IdeationAdmin` in admin); seeds the default phase sequence on activate and unschedules source-processing jobs on deactivate. |
| `ExperimentCLI` | `class-experiment-cli.php` | `wp vip-workflow experiment list|enable|disable`. |

### Storage & resolution

- **Option** `vip_workflow_experiments` — array of enabled experiment IDs (default empty → all disabled).
- **Filter** `vip_workflow_experiments` — code-level override; return the array of enabled IDs. Highest priority.
- Resolution order: **filter > option > default (disabled)**.

### Hooks

- `vip_workflow_register_experiments` (action, `$registry`) — register custom experiments from other plugins.
- `vip_workflow_experiment_enabled` / `vip_workflow_experiment_disabled` (action, `$experiment_id`) — fired after a toggle.

### Plugin wiring (`includes/class-plugin.php`)

The registry is built in `init_components()`, the `IdeationExperiment` is registered, the `vip_workflow_register_experiments` hook fires, then `register_modules( $this )` loads the modules of every enabled experiment. Accessors:

- `Plugin::get_experiment_registry(): ExperimentRegistry`
- `Plugin::experiment_enabled( string $id ): bool` — convenience wrapper used at gating call sites.

---

## 3. Surfaces

### Settings → Experiments tab

- React: `src/admin/components/ExperimentsSettings.js`, wired into `src/admin/pages/Settings.js` (`TabPanel`).
- REST: `GET /vip-workflow/v1/settings/experiments` returns `ExperimentRegistry::to_array()`; `POST` with `{ id, enabled }` enables/disables (`404 rest_experiment_not_found`, `400 rest_experiment_unavailable`). Controller: `includes/api/class-experiments-controller.php` (permission `manage_options`).
- Toggling reloads the page, because enabling/disabling changes server-registered menus and REST routes. The active tab is carried through the reload via a `tab=experiments` query param.

### CLI

```
wp vip-workflow experiment list
wp vip-workflow experiment enable ideation
wp vip-workflow experiment disable ideation
```

### Frontend gating

`get_experiment_flags()` in `class-admin.php` localizes enabled state as `window.vipWorkflowAdmin.experiments` (keyed by ID); React surfaces gate on e.g. `window.vipWorkflowAdmin?.experiments?.ideation`.

---

## 4. Adding an experiment

1. Subclass `Experiment` in `includes/experiments/`, implementing at least `get_id()`, `get_name()`, `get_description()`, `get_modules()`.
2. Register it — core experiments in `Plugin::init_components()`, external ones on the `vip_workflow_register_experiments` hook.
3. Gate any surface that should be hidden while off with `Plugin::experiment_enabled( '<id>' )` (module registration, REST controller list, admin menus, ability registration) and, in React, with `window.vipWorkflowAdmin.experiments.<id>`.
4. Use `activate()` / `deactivate()` for one-time setup/cleanup (seed data, flush rewrite rules, unschedule jobs). Never delete user data on `deactivate()`.

---

## 5. Data preservation

Disabling an experiment unregisters its modules/routes/menus/UI but leaves all data in place (CPT posts, meta, custom tables). Re-enabling restores the surfaces. This mirrors WordPress plugin deactivation semantics.
