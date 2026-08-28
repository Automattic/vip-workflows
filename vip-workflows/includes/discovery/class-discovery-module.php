<?php
/**
 * Discovery Module.
 *
 * Initializes the Story Discovery framework: provider registry,
 * REST endpoints, and admin hooks.
 *
 * @package VIPWorkflow\Discovery
 */

declare( strict_types=1 );

namespace VIPWorkflow\Discovery;

use VIPWorkflow\ModuleInterface;

/**
 * Discovery Module.
 */
class DiscoveryModule implements ModuleInterface {

	/**
	 * Get the identifier.
	 *
	 * @return string
	 */
	public function get_id(): string {
		return 'discovery';
	}

	/**
	 * Initialize the module.
	 *
	 * @return void
	 */
	public function init(): void {
		add_action( 'rest_api_init', array( $this, 'localize_discovery_data' ) );
	}

	/**
	 * Make provider metadata available to admin JS via the existing
	 * vip-workflow-admin script handle (already enqueued by core).
	 */
	public function localize_discovery_data(): void {
		add_action(
			'admin_enqueue_scripts',
			function ( string $hook ): void {
				if ( 'toplevel_page_vip-workflow' !== $hook ) {
					return;
				}

				$registry  = DiscoveryProviderRegistry::get_instance();
				$providers = array();

				foreach ( $registry->get_all() as $slug => $provider ) {
					$providers[] = array(
						'slug'        => $slug,
						'label'       => $provider['label'],
						'description' => $provider['description'],
						'icon'        => $provider['icon'],
						'features'    => $provider['features'],
						'available'   => $registry->is_available( $slug ),
					);
				}

				wp_localize_script(
					'vip-workflow-admin',
					'vipWorkflowDiscovery',
					array(
						'providers' => $providers,
					)
				);
			}
		);
	}
}
