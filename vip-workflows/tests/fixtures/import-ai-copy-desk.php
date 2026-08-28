<?php
/**
 * Dev helper: import the AI Copy Desk demo sequence and activate it.
 *
 * Usage: wp eval-file tests/fixtures/import-ai-copy-desk.php
 *
 * @package VIPWorkflow
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$json_path = __DIR__ . '/ai-copy-desk-workflow.json';
$raw       = file_get_contents( $json_path );
$sequence = json_decode( $raw, true );

if ( ! is_array( $sequence ) ) {
	WP_CLI::error( 'Could not parse ai-copy-desk-workflow.json' );
}

// Author as an administrator (import uses the current user as creator).
$admin = get_users( array( 'role' => 'administrator', 'number' => 1 ) );
if ( ! empty( $admin ) ) {
	wp_set_current_user( $admin[0]->ID );
}

$request = new WP_REST_Request( 'POST', '/vip-workflow/v1/sequences/import' );
$request->set_param( 'sequence_json', $sequence );

$controller = new \VIPWorkflow\API\SequencesController();
$response   = $controller->import_sequence( $request );

if ( is_wp_error( $response ) ) {
	WP_CLI::error( $response->get_error_code() . ': ' . $response->get_error_message() );
}

$data = $response->get_data();
$bp   = $data['sequence'] ?? array();
$id   = (int) ( $bp['id'] ?? 0 );

if ( ! $id ) {
	WP_CLI::error( 'Import returned no sequence id.' );
}

// Import creates the sequence as a draft; activate it so it registers on init.
( new \VIPWorkflow\Sequences\SequenceRepository() )->update( $id, array( 'status' => 'active' ) );

WP_CLI::success(
	sprintf(
		'Imported "%s" (id %d, slug %s) and set to active. Reload the Sequences screen.',
		$bp['name'] ?? 'AI Copy Desk',
		$id,
		$bp['slug'] ?? '?'
	)
);
