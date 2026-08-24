# VIP Workflow Plugin Integration Guide

## Overview

VIP Workflow's admin screens are standard WordPress admin pages under a top-level **Workflows** menu — they render in the normal wp-admin canvas, with the native admin menu and admin bar intact. Third-party plugins add their own pages the ordinary WordPress way; nothing special is required.

> **Note:** Earlier versions wrapped every Workflow page in a custom fullscreen "app shell" that hid the WordPress chrome and injected a React sidebar. That shell was removed — pages now render natively. If you previously relied on the shell (auto-injected sidebar, `is-workflow-plugin-page` body class, fullscreen takeover), see [Migrating off the app shell](#migrating-off-the-app-shell) below.

## Adding a Page Under the Workflows Menu

### Basic Integration

To add your plugin page beside the core Workflow screens, register it as a submenu under the `vip-workflow` parent:

```php
add_action( 'admin_menu', function() {
    add_submenu_page(
        'vip-workflow',           // Parent slug
        'My Plugin Page',         // Page title
        'My Plugin',              // Menu title
        'edit_posts',             // Capability
        'my-plugin-page',         // Menu slug
        'my_plugin_render_page'   // Callback function
    );
}, 20 );
```

Your page will:
- Appear in the **Workflows** submenu, after the core screens (the menu is ordered Main → System → Integrations; third-party pages land in the trailing Integrations group)
- Render as a normal wp-admin page inside `#wpbody-content`, with the standard admin menu and admin bar
- Use standard WordPress admin styling (plus anything you enqueue yourself)

### How It Works

1. **Standard registration**: You register a submenu page with WordPress core's `add_submenu_page()` — exactly as you would for any plugin.
2. **Native rendering**: Your render callback outputs standard admin HTML into `#wpbody-content`. VIP Workflow does not intercept, buffer, or re-wrap it.
3. **Menu ordering only**: VIP Workflow reorders its own submenu so core screens are grouped sensibly and third-party pages follow. It does not modify your page's content or chrome.
4. **No configuration**: No special hooks, filters, or body classes are involved.

### Menu Position

You can influence where your item appears with the optional position argument:

```php
add_submenu_page(
    'vip-workflow',
    'My Tool',
    'My Tool',
    'edit_posts',
    'my-tool',
    'render_my_tool_page',
    10  // Position (optional)
);
```

VIP Workflow groups its own core items ahead of third-party pages, so external pages render in the Integrations group regardless of a low position number. Native wp-admin submenu items do not display icons.

### Important Notes

1. **Capabilities**: Make sure to use appropriate WordPress capabilities. Common ones:
   - `edit_posts` - Authors, editors, admins
   - `edit_others_posts` - Editors and admins
   - `manage_options` - Admins only

2. **Priority**: Register your submenu with priority 20 or higher to ensure VIP Workflow's core pages load first.

3. **Render Function**: Your render callback should output standard WordPress admin HTML. No special wrappers or divs needed.

4. **Styling**: Your page inherits the standard WordPress admin styles. If you need custom styles, enqueue them normally with `admin_enqueue_scripts`.

5. **Scripts**: Enqueue JavaScript as you normally would. VIP Workflow does not enqueue its admin bundle on third-party pages and does not interfere with your scripts.

### Example: Complete Plugin Integration

```php
<?php
/**
 * Plugin Name: My Workflow Extension
 * Description: Adds custom functionality to VIP Workflow
 */

class My_Workflow_Extension {

    public function __construct() {
        add_action( 'admin_menu', array( $this, 'register_menu' ), 20 );
        add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_assets' ) );
    }

    public function register_menu(): void {
        add_submenu_page(
            'vip-workflow',
            __( 'My Extension', 'my-plugin' ),
            __( 'My Extension', 'my-plugin' ),
            'edit_posts',
            'my-workflow-extension',
            array( $this, 'render_page' )
        );
    }

    public function render_page(): void {
        ?>
        <div class="wrap">
            <h1><?php echo esc_html( get_admin_page_title() ); ?></h1>
            <p><?php esc_html_e( 'Welcome to my workflow extension!', 'my-plugin' ); ?></p>

            <!-- Your custom content here -->
            <div class="my-extension-content">
                <!-- Tables, forms, cards, etc. -->
            </div>
        </div>
        <?php
    }

    public function enqueue_assets( string $hook_suffix ): void {
        // Only load on our page. Submenu pages under the "Workflows" menu get
        // the hook prefix "workflows_page_" (sanitized from the parent title).
        if ( 'workflows_page_my-workflow-extension' !== $hook_suffix ) {
            return;
        }

        wp_enqueue_style(
            'my-extension-style',
            plugins_url( 'assets/style.css', __FILE__ ),
            array(),
            '1.0.0'
        );

        wp_enqueue_script(
            'my-extension-script',
            plugins_url( 'assets/script.js', __FILE__ ),
            array( 'jquery' ),
            '1.0.0',
            true
        );
    }
}

new My_Workflow_Extension();
```

### Testing Your Integration

1. Activate your plugin
2. Open the **Workflows** menu in the WordPress admin
3. Your menu item should appear in the Workflows submenu, in the Integrations group after the core screens
4. Click your menu item — it should load as a normal wp-admin page
5. Test that your scripts and styles load correctly

### Debugging

If your page doesn't appear or doesn't render correctly:

1. **Check the parent slug**: Must be exactly `vip-workflow`
2. **Check capabilities**: Ensure the current user has the required capability
3. **Check the hook suffix**: For pages under the Workflows menu it is `workflows_page_{your-menu-slug}` (note the plural, sanitized from the "Workflows" parent title)
4. **Browser console**: Check for JavaScript errors
5. **View source**: Ensure your content is being output

### React Pages (Advanced)

If your plugin uses React for its admin interface, mount it the standard way — your app renders in the normal admin canvas:

```php
public function render_page(): void {
    echo '<div id="my-react-root"></div>';
}

public function enqueue_assets( string $hook_suffix ): void {
    if ( 'workflows_page_my-react-page' !== $hook_suffix ) {
        return;
    }

    $asset_file = include plugin_dir_path( __FILE__ ) . 'build/index.asset.php';

    wp_enqueue_script(
        'my-react-app',
        plugins_url( 'build/index.js', __FILE__ ),
        $asset_file['dependencies'],
        $asset_file['version'],
        true
    );

    wp_enqueue_style(
        'my-react-app',
        plugins_url( 'build/index.css', __FILE__ ),
        array(),
        $asset_file['version']
    );
}
```

Then in your React app's `index.js`:

```javascript
import { createRoot } from '@wordpress/element';
import App from './App';

document.addEventListener( 'DOMContentLoaded', () => {
    const root = document.getElementById( 'my-react-root' );
    if ( root ) {
        createRoot( root ).render( <App /> );
    }
} );
```

---

## Extending VIP Workflow Services

Beyond admin pages, VIP Workflow exposes several filter-based extension points that let plugins add functionality to core systems. Every extension uses the same pattern: implement an interface, register via a WordPress filter.

### Media Providers

Add custom image or video sources to the Story Ideation workspace. Media providers are discovered by `MediaScout` and run automatically when a journalist submits an ideation seed.

#### The Interface

```php
use VIPWorkflow\Ideation\Assistants\MediaProviderInterface;

interface MediaProviderInterface {
    public function get_id(): string;        // Unique slug, e.g. 'unsplash'
    public function get_name(): string;      // Human-readable name
    public function is_configured(): bool;   // Ready to use? (API key set, etc.)
    public function is_generative(): bool;   // Generates new media vs. searches existing
    public function search_media( string $query, int $max_results = 8, array $context = array() );
}
```

`search_media()` returns an array of results. Each result:

```php
array(
    'url'          => string,       // Media URL (image src or video page)
    'title'        => string,       // Caption or alt text
    'source_url'   => string|null,  // Page the media is from
    'domain'       => string,       // Source domain
    'thumbnail'    => string|null,  // Thumbnail URL (for videos)
    'media_type'   => string,       // 'image' or 'video'
    'duration'     => string|null,  // Video duration, e.g. '3:45'
    'width'        => int|null,
    'height'       => int|null,
    'provider'     => string,       // Your provider ID
    'is_generated' => bool,         // True for AI-generated content
)
```

#### Registering a Provider

```php
add_filter( 'vip_workflow_media_providers', function( $providers ) {
    $providers[] = new My_Unsplash_Provider();
    return $providers;
} );
```

**Non-generative** providers (`is_generative() === false`) run automatically during ideation. **Generative** providers (`is_generative() === true`) only run on-demand when a user explicitly requests AI generation.

#### Complete Example: Unsplash Provider

```php
<?php
/**
 * Plugin Name: Workflow Provider: Unsplash
 * Description: Adds Unsplash photo search to VIP Workflow ideation.
 * Requires Plugins: vip-workflow
 */

use VIPWorkflow\Ideation\Assistants\MediaProviderInterface;

class Unsplash_Media_Provider implements MediaProviderInterface {

    private const API_URL = 'https://api.unsplash.com/search/photos';

    public function get_id(): string {
        return 'unsplash';
    }

    public function get_name(): string {
        return 'Unsplash Photos';
    }

    public function is_configured(): bool {
        return defined( 'WORKFLOW_UNSPLASH_KEY' ) && '' !== (string) constant( 'WORKFLOW_UNSPLASH_KEY' );
    }

    public function is_generative(): bool {
        return false;
    }

    public function search_media( string $query, int $max_results = 8, array $context = array() ) {
        $api_key = defined( 'WORKFLOW_UNSPLASH_KEY' ) ? (string) constant( 'WORKFLOW_UNSPLASH_KEY' ) : '';

        $response = wp_remote_get(
            add_query_arg(
                array(
                    'query'    => $query,
                    'per_page' => $max_results,
                ),
                self::API_URL
            ),
            array(
                'headers' => array( 'Authorization' => 'Client-ID ' . $api_key ),
                'timeout' => 15,
            )
        );

        if ( is_wp_error( $response ) ) {
            return $response;
        }

        $data    = json_decode( wp_remote_retrieve_body( $response ), true );
        $results = array();

        foreach ( $data['results'] ?? array() as $photo ) {
            $results[] = array(
                'url'          => $photo['urls']['regular'],
                'title'        => $photo['description'] ?? $photo['alt_description'] ?? '',
                'source_url'   => $photo['links']['html'],
                'domain'       => 'unsplash.com',
                'thumbnail'    => $photo['urls']['thumb'],
                'media_type'   => 'image',
                'duration'     => null,
                'width'        => $photo['width'],
                'height'       => $photo['height'],
                'provider'     => $this->get_id(),
                'is_generated' => false,
            );
        }

        return $results;
    }
}

// Register the media provider.
add_filter( 'vip_workflow_media_providers', function( $providers ) {
    $providers[] = new Unsplash_Media_Provider();
    return $providers;
} );

// Provide the API key via a wp-config.php constant:
// define( 'WORKFLOW_UNSPLASH_KEY', 'your-unsplash-access-key' );
```

> **Note:** API key entry for the built-in AI providers moved to the WordPress
> core **Connectors** screen (Settings → Connectors). The plugin's
> old `vip_workflow_api_key_fields` filter and `ApiKeysController` were removed.
> Third-party providers should read their own key from a `wp-config.php` constant
> (as above) or register a WordPress core connector for it.

#### Removing or Replacing a Built-in Provider

To disable a built-in provider (e.g. remove YouTube search):

```php
add_filter( 'vip_workflow_media_providers', function( $providers ) {
    return array_filter( $providers, function( $p ) {
        return $p->get_id() !== 'youtube';
    } );
} );
```

Built-in providers: `tavily-images`, `tavily-videos`, `youtube`, `openai-dalle`.

---

### API Keys

The plugin's built-in AI provider keys (OpenAI, Anthropic,
Google, Tavily, YouTube) are managed by the WordPress core **Connectors** API
under **Settings → Connectors**, not by the plugin. The old bespoke stack — the
`vip_workflow_api_key_fields` filter, the `ApiKeysController` class, and the
`/vip-workflow/v1/settings/api-keys` REST routes — has been removed.

Internally, all credential reads now go through the `VIPWorkflow\AI\Credentials`
facade, which honors a `VIP_WORKFLOW_*_KEY` constant first and otherwise resolves
from core connectors (or a legacy fallback store on environments without
connectors).

#### Providing a Key for a Third-Party Service

External plugins should read their own key from a `wp-config.php` constant:

```php
define( 'MY_PLUGIN_SERVICE_KEY', 'sk-abc123...' );
```

```php
$key = defined( 'MY_PLUGIN_SERVICE_KEY' )
    ? (string) constant( 'MY_PLUGIN_SERVICE_KEY' )
    : '';
```

For first-class admin entry, register a WordPress core connector for the service
so it appears under Settings → Connectors alongside the built-in providers.

---

### Notification Channels

Add custom delivery channels for workflow notifications.

```php
use VIPWorkflow\Notifications\NotificationChannel;
use VIPWorkflow\Notifications\Notification;

class My_Channel extends NotificationChannel {
    public function get_id(): string { return 'my-channel'; }
    public function get_name(): string { return 'My Channel'; }
    public function send( Notification $notification ): bool {
        // Deliver the notification
        return true;
    }
}

add_filter( 'vip_workflow_notification_channels', function( $channels ) {
    $channels[] = new My_Channel();
    return $channels;
} );
```

Notification channels can be packaged as standalone plugins.

---

### Content Tools (Abilities)

Register check or helper tools that run in the editor sidebar.

```php
add_action( 'vip_workflow_register_abilities', function() {
    wp_register_ability( 'my-plugin/brand-check', array(
        'label'              => 'Brand Check',
        'category'           => 'vip-workflow',
        'execute_callback'   => 'my_brand_check_execute',
        'permission_callback' => function() { return current_user_can( 'edit_posts' ); },
    ) );
} );
```

See `workflow-tool-checklist/` for a check tool maintained in this repository.

---

### Background Jobs

Register recurring background tasks.

```php
use VIPWorkflow\Jobs\Job;

class My_Sync_Job extends Job {
    public function get_id(): string { return 'my-sync'; }
    public function get_name(): string { return 'My Sync'; }
    public function get_schedule(): string { return 'daily'; }
    public function execute( array $args = array() ): void {
        // Your task logic
    }
}

add_action( 'vip_workflow_jobs_init', function( $scheduler ) {
    $scheduler->register_job( new My_Sync_Job() );
} );
```

Background jobs can be packaged as standalone plugins.

---

### Event Listeners

Hook into workflow lifecycle events:

```php
// Any status transition
add_action( 'vip_workflow_status_transition', function( $post_id, $new, $old, $sequence ) {
    // React to transitions
}, 10, 4 );

// Specific status entry
add_action( 'vip_workflow_entered_review', function( $post_id, $old_status, $sequence ) {
    // Post entered review
}, 10, 3 );

// Pitch lifecycle
add_action( 'vip_workflow_pitch_approved', function( $pitch_id ) {
    // Pitch was approved
}, 10, 1 );

// Tool execution
add_action( 'vip_workflow_ability_executed', function( $ability_id, $post_id, $result ) {
    // Tool finished running
}, 10, 3 );
```

---

## Migrating off the app shell

VIP Workflow used to render every page inside a custom fullscreen "app shell": it hid the WordPress admin menu, admin bar, and footer with `!important` CSS, added an `is-fullscreen-mode` body class, suppressed the native submenu flyout, and injected a React sidebar. Third-party pages were given an `is-workflow-plugin-page` body class and repositioned next to that sidebar.

That shell has been removed. The core screens are now ordinary wp-admin pages and the native menu provides navigation. For integrators this means:

- **No code change is required.** A submenu registered under `vip-workflow` keeps working — it now renders as a plain admin page instead of inside the shell.
- **The shell affordances are gone.** There is no injected sidebar, no `is-workflow-plugin-page` body class, and no fullscreen takeover. If your page styled itself against those (e.g. compensating for the hidden admin menu, or targeting `body.is-workflow-plugin-page`), remove that styling — your page now lives in the standard canvas.
- **Hook suffix unchanged.** Pages under the Workflows menu still get the `workflows_page_{slug}` hook suffix for `admin_enqueue_scripts`.

## Architecture Notes

For VIP Workflow core developers:

- **No hardcoding**: The core never references specific plugin pages
- **Native rendering**: Every page (core and third-party) renders normally into `#wpbody-content`; there is no output buffering, capture, or chrome injection
- **Menu ordering only**: `Admin::cleanup_menu()` reorders the plugin's own submenu (Main → System → Integrations) via the `$submenu` global; third-party pages fall into the trailing Integrations group
- **Bundle scoping**: The admin bundle enqueues only on core `vip-workflow` pages (hook suffix contains `vip-workflow`), never on third-party pages

## Support

If you encounter issues integrating with VIP Workflow:

1. Check this documentation
2. Review the example code above
3. Inspect the VIP Workflow source: `includes/admin/class-admin.php`
4. File an issue in the VIP Workflow repository
