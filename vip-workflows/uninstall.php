<?php
/**
 * Uninstall script.
 *
 * @package VIPWorkflow
 */

// Exit if accessed directly or not during uninstall.
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

// Load the schema class to drop tables.
require_once __DIR__ . '/includes/database/class-schema.php';

$schema = new \VIPWorkflow\Database\Schema();
$schema->uninstall();

// Delete options.
delete_option( 'vip_workflow_db_version' );
