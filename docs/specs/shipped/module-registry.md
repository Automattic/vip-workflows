---
status: shipped
version: 1.0
last_updated: 2026-02-24
related: []
---

# Module Registry — Subsystem Registration Pattern

---

## 1. Problem

`Plugin::init_components()` is a ~90-line method that manually instantiates ~20 subsystems. `RestController::register_routes()` manually instantiates ~16 controllers. Every new feature requires editing both files to wire itself in. As the plugin grows, this creates:

- A merge-conflict magnet in two central files
- Hidden dependency ordering (subsystems must be instantiated in a specific sequence)
- No way to inspect what's registered at runtime
- No consistent contract — some subsystems have `init()`, some don't

## 2. Solution

A lightweight `ModuleInterface` and a registration loop. Not a framework. Not a DI container. Just an interface and an array.

## 3. Design

### ModuleInterface

```php
namespace VIPWorkflow;

interface ModuleInterface {
    public function get_id(): string;
    public function init(): void;
}
```

That's it. Two methods. `get_id()` returns a unique string identifier. `init()` sets up hooks, registers CPTs, etc. — exactly what every subsystem already does.

### RestModuleInterface

For subsystems that register REST endpoints:

```php
namespace VIPWorkflow\API;

interface RestModuleInterface {
    public function register_routes(): void;
}
```

A module can implement both interfaces if it has REST routes.

### Registration in Plugin

```php
private function init_components(): void {
    // Core services (order matters, these are dependencies).
    $this->event_bus = new EventBus( new EventRegistry() );

    $this->post_type_manager = new PostTypeManager();
    $this->post_type_manager->init();

    $this->status_manager = new StatusManager( null, $this->post_type_manager );
    $this->status_manager->init();

    // Modules (order does NOT matter — each is self-contained).
    $this->modules = array();

    $this->register_module( new EditorIntegration() );
    $this->register_module( new Cleanup() );
    $this->register_module( new IdeationPostTypes() );
    $this->register_module( new ResearchPostTypes() );
    $this->register_module( new SourceProcessingJob() );
    $this->register_module( new ResearchSourceAnalyzer() );
    $this->register_module( new IdeationEvents() );
    $this->register_module( new WorkflowEvents() );
    $this->register_module( new AgentRunner() );
    $this->register_module( new NotificationDispatcher() );
    $this->register_module( new AIMediaAnalyzer() );
    // ... future modules

    // Allow external plugins to register modules.
    do_action( 'vip_workflow_register_modules', $this );

    // Initialize all modules.
    foreach ( $this->modules as $module ) {
        $module->init();
    }
}

public function register_module( ModuleInterface $module ): void {
    $this->modules[ $module->get_id() ] = $module;
}

public function get_module( string $id ): ?ModuleInterface {
    return $this->modules[ $id ] ?? null;
}
```

### Registration in RestController

```php
public function register_routes(): void {
    // Status endpoint stays here (it's the controller's own route).
    register_rest_route( self::NAMESPACE, '/status', array( /* ... */ ) );

    // REST modules.
    $controllers = array(
        new SequencesController(),
        new WorkflowController(),
        new NotificationsController(),
        new AbilitiesController(),
        new ToolsController(),
        new AuditLogController(),
        new ApiKeysController(),
        new GeneralSettingsController(),
        new JobsController(),
        new PackagesController(),
        new PitchesController(),
        new ClaimBoardController(),
        new AssetsController(),
        new ResearchProjectsController(),
        new AiAgentController(),
        new UtilityController(),
    );

    // Allow external plugins to add controllers.
    $controllers = apply_filters( 'vip_workflow_rest_controllers', $controllers );

    foreach ( $controllers as $controller ) {
        $controller->register_routes();
    }
}
```

### Admin Modules

Same pattern for `Admin::init()`:

```php
namespace VIPWorkflow\Admin;

interface AdminModuleInterface {
    public function init(): void;
}
```

Admin wires its sub-components the same way — array + loop.

## 4. What Changes in Existing Subsystems

Minimal. Each subsystem:

1. Adds `implements ModuleInterface` to its class declaration
2. Adds a `get_id()` method returning a string (e.g., `'ideation-post-types'`)
3. Keeps its existing `init()` method unchanged

Example diff for `IdeationPostTypes`:

```php
- class IdeationPostTypes {
+ class IdeationPostTypes implements \VIPWorkflow\ModuleInterface {
+
+     public function get_id(): string {
+         return 'ideation-post-types';
+     }

      public function init(): void {
          // Unchanged — same hook registrations as before.
      }
  }
```

## 5. Core Services vs Modules

Not everything becomes a module. **Core services** that other subsystems depend on stay as explicit properties on `Plugin`:

| Core Service | Why |
|---|---|
| `EventBus` | Referenced by 5+ subsystems via getter |
| `PostTypeManager` | Must init before StatusManager; referenced by many |
| `StatusManager` | Referenced by editor, dashboard, controllers |

These are initialized first, in order, before the module loop runs. They keep their existing getters on `Plugin`. The module loop handles everything else — subsystems that are self-contained and register hooks.

## 6. What This Does NOT Include

- **No dependency resolution.** Modules don't declare dependencies on each other. If ordering matters, use hook priorities (which subsystems already do).
- **No conditional loading.** Every module is loaded every time. If we need conditional loading later, add an `is_active(): bool` method to the interface then.
- **No auto-discovery.** Modules are explicitly listed. No directory scanning, no reflection.
- **No service container.** Subsystems still access shared services via `Plugin::get_instance()->get_*()`. Changing that is a separate, larger refactor.

## 7. Scope of Work

1. Create `includes/interface-module.php` with `ModuleInterface`
2. Create `includes/api/interface-rest-module.php` with `RestModuleInterface` (optional — can just keep the array in RestController)
3. Add `implements ModuleInterface` + `get_id()` to each existing subsystem (~15 classes)
4. Refactor `Plugin::init_components()` to use `register_module()` + loop
5. Refactor `RestController::register_routes()` to use array + loop
6. Refactor `Admin::init()` to use array + loop
7. Add `vip_workflow_register_modules` action and `vip_workflow_rest_controllers` filter
8. Verify all existing functionality works unchanged
