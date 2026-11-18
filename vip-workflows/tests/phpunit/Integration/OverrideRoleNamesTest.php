<?php
/**
 * Integration coverage for Settings::get_override_role_names().
 *
 * Every "ask someone with…" sentence — the publish veto, a refused removal or
 * replacement, and the `override_roles` list the editor and list-table clients
 * build the same sentences from — names the workflow override roles through
 * this one helper. Driven against real WordPress roles because the answer is
 * core's role registry, translated.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Admin\Settings;

/**
 * Real-WordPress tests for the override role display names.
 */
class OverrideRoleNamesTest extends TestCase
{
	/**
	 * Settings option name.
	 */
	private const OPTION = 'vip_workflows_settings';

	public function tear_down(): void
	{
		delete_option( self::OPTION );
		remove_role( 'desk_chief' );

		parent::tear_down();
	}

	/**
	 * With no settings saved, the override list is administrator alone.
	 */
	public function test_default_settings_name_the_administrator(): void
	{
		delete_option( self::OPTION );

		$this->assertSame( array( 'Administrator' ), Settings::get_override_role_names() );
	}

	/**
	 * Every configured role is named, in the order it was configured.
	 */
	public function test_names_every_configured_role_in_order(): void
	{
		update_option( self::OPTION, array( 'bypass_workflow_roles' => array( 'editor', 'administrator' ) ) );

		$this->assertSame( array( 'Editor', 'Administrator' ), Settings::get_override_role_names() );
	}

	/**
	 * A custom role is named by its display name, not its slug.
	 */
	public function test_names_a_custom_role_by_its_display_name(): void
	{
		add_role( 'desk_chief', 'Desk Chief', array( 'read' => true ) );
		update_option( self::OPTION, array( 'bypass_workflow_roles' => array( 'desk_chief' ) ) );

		$this->assertSame( array( 'Desk Chief' ), Settings::get_override_role_names() );
	}

	/**
	 * A slug that names no registered role — one removed or renamed after it
	 * was saved — is skipped rather than shown raw.
	 */
	public function test_skips_a_slug_with_no_registered_role(): void
	{
		update_option( self::OPTION, array( 'bypass_workflow_roles' => array( 'no_such_role', 'editor' ) ) );

		$this->assertSame( array( 'Editor' ), Settings::get_override_role_names() );
	}

	/**
	 * An empty list names nobody.
	 */
	public function test_an_empty_list_names_nobody(): void
	{
		update_option( self::OPTION, array( 'bypass_workflow_roles' => array() ) );

		$this->assertSame( array(), Settings::get_override_role_names() );
	}

	/**
	 * On multisite the list is the current site's: each site saves its own
	 * settings option.
	 */
	public function test_multisite_reads_the_current_sites_list(): void
	{
		if ( ! is_multisite() ) {
			$this->markTestSkipped( 'Multisite only: the integration environment runs single-site by default.' );
		}

		update_option( self::OPTION, array( 'bypass_workflow_roles' => array( 'administrator' ) ) );

		$other_site = (int) self::factory()->blog->create();
		switch_to_blog( $other_site );
		try {
			update_option( self::OPTION, array( 'bypass_workflow_roles' => array( 'editor' ) ) );
			$this->assertSame( array( 'Editor' ), Settings::get_override_role_names() );
		} finally {
			restore_current_blog();
		}

		$this->assertSame( array( 'Administrator' ), Settings::get_override_role_names() );
	}
}
