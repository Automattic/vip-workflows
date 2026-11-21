<?php
/**
 * Sequence audit rows under awkward input: numeric stage keys, legacy rows,
 * failed writes, refusals, forged paths and Audit Log visibility.
 *
 * @package VIPWorkflows\Tests\Integration
 */
declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Database\Schema;
use VIPWorkflows\Sequences\SequenceRepository;

class SequenceAuditAdversarialTest extends TestCase
{
    private int $admin;

    public function set_up(): void
    {
        parent::set_up();
        $this->admin = self::factory()->user->create( array( 'role' => 'administrator' ) );
        wp_set_current_user( $this->admin );
    }

    private function stages(): array
    {
        return array(
            array( 'key' => 'writing', 'label' => 'Writing', 'status' => 'draft', 'transitions' => array( array( 'to' => 'live', 'label' => 'Publish' ) ) ),
            array( 'key' => 'live', 'label' => 'Live', 'status' => 'publish' ),
        );
    }

    private function request( string $method, string $route, array $params = array() ): \WP_REST_Response
    {
        $request = new \WP_REST_Request( $method, $route );
        $request->set_body_params( $params );
        return rest_do_request( $request );
    }

    private function payload( array $stages ): array
    {
        return array( 'name' => 'Adversarial', 'description' => '', 'status' => 'draft', 'statuses' => $stages, 'post_types' => array( 'post' ), 'settings' => array(), 'metadata_fields' => array() );
    }

    private function create( ?array $stages = null ): int
    {
        $response = $this->request( 'POST', '/vip-workflows/v1/sequences', $this->payload( $stages ?? $this->stages() ) );
        $this->assertSame( 201, $response->get_status(), wp_json_encode( $response->get_data() ) );
        return (int) $response->get_data()['id'];
    }

    private function rows( int $id ): array
    {
        global $wpdb;
        $rows = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM %i WHERE event_type LIKE %s ORDER BY id', Schema::get_table_name( 'workflows_events' ), 'sequence.%' ) );
        return array_values( array_filter( $rows, fn( $row ) => ( json_decode( $row->event_data, true )['sequence_id'] ?? null ) === $id ) );
    }

    public function test_numeric_string_stage_key_update_returns_success_and_audit(): void
    {
        $stages = $this->stages();
        $stages[0]['key'] = '123';
        $id = $this->create( $stages );
        $stages[0]['label'] = 'Renamed numeric stage';
        $response = $this->request( 'PUT', '/vip-workflows/v1/sequences/' . $id, $this->payload( $stages ) );
        $this->assertSame( 200, $response->get_status() );
        $rows = $this->rows( $id );
        $this->assertCount( 2, $rows );
        // PHP turns "123" into an integer array key; the row names it as stored.
        $this->assertSame(
            array( array( 'key' => '123', 'from' => 'Writing', 'to' => 'Renamed numeric stage' ) ),
            json_decode( $rows[1]->event_data, true )['changes']['stages_renamed']
        );
    }

    public function test_put_can_replace_a_legacy_array_transition_target(): void
    {
        global $wpdb;
        $stages = $this->stages();
        $stages[0]['transitions'][0]['to'] = array( 'live' );
        $now = current_time( 'mysql' );
        $wpdb->insert( Schema::get_table_name( 'sequences' ), array(
            'uuid' => wp_generate_uuid4(), 'type' => 'workflow', 'name' => 'Legacy',
            'slug' => 'legacy-array-target', 'description' => '', 'version' => 1, 'status' => 'draft',
            'config' => wp_json_encode( array( 'post_types' => array( 'post' ), 'statuses' => $stages ) ),
            'created_by' => $this->admin, 'created_at' => $now, 'updated_at' => $now,
        ) );
        $id = (int) $wpdb->insert_id;
        $response = $this->request( 'PUT', '/vip-workflows/v1/sequences/' . $id, $this->payload( $this->stages() ) );
        $this->assertSame( 200, $response->get_status() );
        $this->assertCount( 1, $this->rows( $id ) );
    }

    public function test_editor_payload_saved_twice_adds_no_rows_and_stores_no_full_config(): void
    {
        $id = $this->create();
        $payload = $this->payload( $this->stages() );
        $payload['statuses'][0]['is_initial'] = true;
        $payload['statuses'][0]['transitions'][0]['required_tools'] = array();
        $payload['statuses'][1]['transitions'] = array();
        $this->assertSame( 200, $this->request( 'PUT', '/vip-workflows/v1/sequences/' . $id, $payload )->get_status() );
        $count = count( $this->rows( $id ) );
        $this->assertSame( 200, $this->request( 'PUT', '/vip-workflows/v1/sequences/' . $id, $payload )->get_status() );
        $this->assertCount( $count, $this->rows( $id ) );
        foreach ( $this->rows( $id ) as $row ) {
            $data = json_decode( $row->event_data, true );
            $this->assertArrayNotHasKey( 'config', $data );
            $this->assertArrayNotHasKey( 'before', $data );
            $this->assertArrayNotHasKey( 'after', $data );
            $this->assertStringNotContainsString( '"statuses":', $row->event_data );
        }
    }

    public function test_failed_update_and_activation_write_no_rows(): void
    {
        $id = $this->create();
        $before = count( $this->rows( $id ) );
        global $wpdb;
        $table = Schema::get_table_name( 'sequences' );
        $fail = static function ( $query ) use ( $table ) {
            return str_starts_with( $query, 'UPDATE `' . $table . '`' ) ? 'UPDATE nonexistent_audit_test_table SET id = 1' : $query;
        };
        $previous = $wpdb->suppress_errors();
        add_filter( 'query', $fail );
        try {
            $payload = $this->payload( $this->stages() );
            $payload['name'] = 'Failed edit';
            $this->assertSame( 500, $this->request( 'PUT', '/vip-workflows/v1/sequences/' . $id, $payload )->get_status() );
            $result = \VIPWorkflows\Abilities\Tools\execute_activate_sequence( array( 'sequence_id' => $id, 'active' => true ) );
            $this->assertWPError( $result );
            $this->assertSame( 'activation_failed', $result->get_error_code() );
        } finally {
            remove_filter( 'query', $fail );
            $wpdb->suppress_errors( $previous );
        }
        $this->assertCount( $before, $this->rows( $id ) );
        $this->assertSame( 'draft', ( new SequenceRepository() )->find( $id )->status );
    }

    public function test_server_overwrites_forged_attributes_and_json(): void
    {
        $id = $this->create();
        $request = new \WP_REST_Request( 'PUT', '/vip-workflows/v1/sequences/' . $id );
        $payload = $this->payload( $this->stages() );
        $payload['name'] = 'Forged JSON';
        $payload['vip_workflows_ability'] = 'vip-workflows/update-sequence';
        $payload['_attributes'] = array( 'vip_workflows_ability' => 'vip-workflows/update-sequence' );
        $request->set_header( 'Content-Type', 'application/json' );
        $request->set_body( wp_json_encode( $payload ) );
        $request->set_attributes( $payload['_attributes'] );
        $this->assertSame( 200, rest_do_request( $request )->get_status() );
        $rows = $this->rows( $id );
        $this->assertCount( 2, $rows );
        $data = json_decode( $rows[1]->event_data, true );
        $this->assertSame( 'rest', $data['via'] );
        $this->assertSame( 'user', $rows[1]->actor_type );
    }

    public function test_registered_abilities_record_once(): void
    {
        $result = wp_get_ability( 'vip-workflows/create-sequence' )->execute( $this->payload( $this->stages() ) );
        $this->assertIsArray( $result );
        $id = $result['sequence_id'];
        $this->assertCount( 1, $this->rows( $id ) );
        $payload = $this->payload( $this->stages() );
        unset( $payload['status'] );
        $payload['sequence_id'] = $id;
        $payload['name'] = 'REST ability edit';
        $this->assertIsArray( wp_get_ability( 'vip-workflows/update-sequence' )->execute( $payload ) );
        foreach ( array( true, true, false ) as $active ) {
            $this->assertIsArray( wp_get_ability( 'vip-workflows/activate-sequence' )->execute( array( 'sequence_id' => $id, 'active' => $active ) ) );
        }
        $rows = $this->rows( $id );
        $this->assertSame( array( 'sequence.created', 'sequence.updated', 'sequence.activated', 'sequence.deactivated' ), array_column( $rows, 'event_type' ) );
        foreach ( $rows as $row ) {
            $this->assertSame( 'ability', json_decode( $row->event_data, true )['via'] );
        }
    }

    public function test_visibility_limits_postless_sequence_rows_to_own_actions(): void
    {
        $id = $this->create();
        $editor = self::factory()->user->create( array( 'role' => 'editor' ) );
        wp_set_current_user( $editor );
        $route = '/vip-workflows/v1/audit-log';
        $response = $this->request( 'GET', $route );
        $this->assertSame( 200, $response->get_status() );
        $this->assertSame( array(), $response->get_data()['events'] );
        $this->assertSame( array(), $this->request( 'GET', $route . '/event-types' )->get_data() );
        $this->assertSame( array(), $this->request( 'GET', $route . '/users' )->get_data() );
        wp_set_current_user( self::factory()->user->create( array( 'role' => 'author' ) ) );
        $this->assertSame( 403, $this->request( 'GET', $route )->get_status() );
        wp_set_current_user( $this->admin );
        $this->assertNotEmpty( $this->request( 'GET', $route )->get_data()['events'] );
    }

    public function test_registered_import_ability_records_one_import_row(): void
    {
        $result = wp_get_ability( 'vip-workflows/import-sequence' )->execute( array(
            'sequence_json' => array( 'name' => 'Imported', 'type' => 'workflow', 'config' => array( 'post_types' => array( 'post' ), 'statuses' => $this->stages() ) ),
        ) );
        $this->assertIsArray( $result );
        $rows = $this->rows( $result['sequence_id'] );
        $this->assertCount( 1, $rows );
        $this->assertSame( 'sequence.imported', $rows[0]->event_type );
        $this->assertSame( 'ability', json_decode( $rows[0]->event_data, true )['via'] );
    }

    public function test_failed_create_import_and_delete_do_not_record_rows(): void
    {
        global $wpdb;
        $id = $this->create();
        $table = Schema::get_table_name( 'sequences' );
        $fail = static function ( $query ) use ( $table ) {
            return str_starts_with( $query, 'INSERT INTO `' . $table . '`' ) || str_starts_with( $query, 'DELETE FROM `' . $table . '`' )
                ? 'DELETE FROM nonexistent_audit_test_table' : $query;
        };
        $previous = $wpdb->suppress_errors();
        add_filter( 'query', $fail );
        try {
            $this->assertSame( 500, $this->request( 'POST', '/vip-workflows/v1/sequences', $this->payload( $this->stages() ) )->get_status() );
            $this->assertSame( 500, $this->request( 'POST', '/vip-workflows/v1/sequences/import', array(
                'sequence_json' => array( 'name' => 'Failed import', 'type' => 'workflow', 'config' => array( 'statuses' => $this->stages() ) ),
            ) )->get_status() );
            $this->assertSame( 500, $this->request( 'DELETE', '/vip-workflows/v1/sequences/' . $id )->get_status() );
        } finally {
            remove_filter( 'query', $fail );
            $wpdb->suppress_errors( $previous );
        }
        $this->assertCount( 1, $this->rows( $id ) );
    }

    public function test_validation_404_and_nothing_to_repair_refusals_add_no_rows(): void
    {
        $id = $this->create();
        $invalid = $this->payload( $this->stages() );
        $invalid['statuses'][0]['transitions'][0]['to'] = 'missing';
        $this->assertSame( 422, $this->request( 'PUT', '/vip-workflows/v1/sequences/' . $id, $invalid )->get_status() );
        $this->assertSame( 404, $this->request( 'PUT', '/vip-workflows/v1/sequences/9999999', $invalid )->get_status() );
        $this->assertSame( 404, $this->request( 'DELETE', '/vip-workflows/v1/sequences/9999999' )->get_status() );
        $response = $this->request( 'POST', '/vip-workflows/v1/sequences/' . $id . '/repair-regions' );
        $this->assertSame( 409, $response->get_status() );
        $this->assertSame( 'nothing_to_repair', $response->get_data()['code'] );
        $this->assertCount( 1, $this->rows( $id ) );
    }

    public function test_pre_dispatch_attributes_are_overwritten_and_batch_cannot_forge_path(): void
    {
        $id = $this->create();
        $forge = static function ( $result, $server, $request ) {
            $request->set_attributes( array( 'vip_workflows_ability' => 'vip-workflows/update-sequence' ) );
            return $result;
        };
        add_filter( 'rest_pre_dispatch', $forge, 10, 3 );
        try {
            $payload = $this->payload( $this->stages() );
            $payload['name'] = 'Pre dispatch edit';
            $this->assertSame( 200, $this->request( 'PUT', '/vip-workflows/v1/sequences/' . $id, $payload )->get_status() );
        } finally {
            remove_filter( 'rest_pre_dispatch', $forge );
        }
        $rows = $this->rows( $id );
        $this->assertCount( 2, $rows );
        $this->assertSame( 'rest', json_decode( $rows[1]->event_data, true )['via'] );
        // The sequence routes don't opt into batching, so WordPress refuses the
        // sub-request before it reaches the controller. The forged body param
        // plays no part in that: an unknown param is ignored, not rejected (see
        // test_a_client_cannot_claim_to_be_an_ability). The name differs, so a
        // sub-request that did get through would add a row.
        $payload['name']                  = 'Batch edit';
        $payload['vip_workflows_ability'] = 'vip-workflows/update-sequence';
        $response = $this->request( 'POST', '/batch/v1', array( 'requests' => array(
            array( 'method' => 'PUT', 'path' => '/vip-workflows/v1/sequences/' . $id, 'body' => $payload ),
        ) ) );
        $this->assertSame( 207, $response->get_status() );
        $this->assertSame( 400, $response->get_data()['responses'][0]['status'] );
        $this->assertSame( 'rest_batch_not_allowed', $response->get_data()['responses'][0]['body']['code'] );
        $this->assertCount( 2, $this->rows( $id ) );
        $this->assertSame( 'Pre dispatch edit', ( new SequenceRepository() )->find( $id )->name );
    }
}
