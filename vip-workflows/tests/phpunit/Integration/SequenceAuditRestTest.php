<?php
/**
 * Every sequence change made over REST writes its audit row, once.
 *
 * Runs through rest_do_request(), so the request attributes are the ones the
 * REST server sets, as they are for the sequence editor and REST clients.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Database\Schema;
use VIPWorkflows\Sequences\Sequence;
use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Workflow\StatusManager;

/**
 * @covers \VIPWorkflows\API\SequencesController
 * @covers \VIPWorkflows\Sequences\SequenceAudit
 */
class SequenceAuditRestTest extends TestCase
{
    private int $admin_id = 0;

    private SequenceRepository $repository;

    public function set_up(): void
    {
        parent::set_up();

        $this->admin_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
        wp_set_current_user( $this->admin_id );

        $this->repository = new SequenceRepository();
    }

    /**
     * Writing (draft) -> Review (pending) -> Live (publish).
     *
     * @return array
     */
    private function statuses(): array
    {
        return array(
            array(
                'key'         => 'writing',
                'label'       => 'Writing',
                'status'      => 'draft',
                'transitions' => array( array( 'to' => 'review', 'label' => 'Submit' ) ),
            ),
            array(
                'key'         => 'review',
                'label'       => 'Review',
                'status'      => 'pending',
                'transitions' => array( array( 'to' => 'live', 'label' => 'Publish' ) ),
            ),
            array(
                'key'    => 'live',
                'label'  => 'Live',
                'status' => 'publish',
            ),
        );
    }

    /**
     * Highest event id written before the test's own action.
     *
     * @var int
     */
    private int $baseline = 0;

    /**
     * Create a fixture sequence over REST, so its stored config is exactly what
     * a later save of the same stages builds, then start counting rows after it.
     *
     * @param string $status Lifecycle state.
     * @return Sequence
     */
    private function create_sequence( string $status = 'active' ): Sequence
    {
        global $wpdb;

        $response = $this->post(
            array(
                'name'   => 'Audit Flow',
                'status' => $status,
            )
        );
        $this->assertSame( 201, $response->get_status() );

        $this->baseline = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT MAX(id) FROM %i', Schema::get_table_name( 'workflows_events' ) ) );

        return $this->repository->find( (int) $response->get_data()['id'] );
    }

    /**
     * Sequence audit rows for one sequence written after the fixture, oldest first.
     *
     * @param int $sequence_id Sequence ID.
     * @return array<int, array{type: string, actor_type: string, actor_id: int, post_id: mixed, data: array}>
     */
    private function rows_for( int $sequence_id ): array
    {
        global $wpdb;

        $rows = $wpdb->get_results(
            $wpdb->prepare(
                'SELECT * FROM %i WHERE event_type LIKE %s AND id > %d ORDER BY id ASC',
                Schema::get_table_name( 'workflows_events' ),
                'sequence.%',
                $this->baseline
            )
        );

        $mine = array();
        foreach ( $rows as $row ) {
            $data = json_decode( $row->event_data, true ) ?? array();
            if ( (int) ( $data['sequence_id'] ?? 0 ) !== $sequence_id ) {
                continue;
            }
            $mine[] = array(
                'type'       => $row->event_type,
                'actor_type' => $row->actor_type,
                'actor_id'   => (int) $row->actor_id,
                'post_id'    => $row->post_id,
                'data'       => $data,
            );
        }

        return $mine;
    }

    /**
     * PUT a sequence with the given stages and extra params.
     *
     * @param Sequence $sequence Sequence.
     * @param array    $statuses Stages.
     * @param array    $extra    Extra params.
     * @return \WP_REST_Response
     */
    private function put( Sequence $sequence, array $statuses, array $extra = array() ): \WP_REST_Response
    {
        $request = new \WP_REST_Request( 'PUT', '/vip-workflows/v1/sequences/' . $sequence->id );
        $request->set_param( 'name', $sequence->name );
        $request->set_param( 'post_types', array( 'post' ) );
        $request->set_param( 'statuses', $statuses );
        foreach ( $extra as $key => $value ) {
            $request->set_param( $key, $value );
        }

        return rest_do_request( $request );
    }

    /**
     * POST a new sequence.
     *
     * @param array $extra Extra params.
     * @return \WP_REST_Response
     */
    private function post( array $extra = array() ): \WP_REST_Response
    {
        $request = new \WP_REST_Request( 'POST', '/vip-workflows/v1/sequences' );
        $request->set_param( 'name', 'Created Flow' );
        $request->set_param( 'post_types', array( 'post' ) );
        $request->set_param( 'statuses', $this->statuses() );
        foreach ( $extra as $key => $value ) {
            $request->set_param( $key, $value );
        }

        return rest_do_request( $request );
    }

    /**
     * The statuses with one more stage.
     *
     * @return array
     */
    private function statuses_with_legal(): array
    {
        $statuses   = $this->statuses();
        $statuses[] = array( 'key' => 'legal', 'label' => 'Legal review', 'status' => 'pending' );
        return $statuses;
    }

    // -------------------------------------------------------------------------
    // Create and import
    // -------------------------------------------------------------------------

    public function test_create_writes_one_created_row_as_the_user(): void
    {
        $response = $this->post();
        $this->assertSame( 201, $response->get_status() );

        $rows = $this->rows_for( (int) $response->get_data()['id'] );

        $this->assertCount( 1, $rows );
        $this->assertSame( 'sequence.created', $rows[0]['type'] );
        $this->assertSame( 'user', $rows[0]['actor_type'] );
        $this->assertSame( $this->admin_id, $rows[0]['actor_id'] );
        $this->assertNull( $rows[0]['post_id'] );
        $this->assertSame( 'rest', $rows[0]['data']['via'] );
        $this->assertSame( 'active', $rows[0]['data']['sequence_status'] );
        $this->assertSame( 'Created Flow', $rows[0]['data']['sequence_name'] );
        $this->assertSame( 3, $rows[0]['data']['statuses_count'] );
        $this->assertArrayNotHasKey( 'agent_actor', $rows[0]['data'] );
    }

    public function test_create_as_a_draft_writes_no_status_row(): void
    {
        $response = $this->post( array( 'status' => 'draft' ) );
        $this->assertSame( 201, $response->get_status() );

        $rows = $this->rows_for( (int) $response->get_data()['id'] );

        $this->assertSame( array( 'sequence.created' ), array_column( $rows, 'type' ) );
        $this->assertSame( 'draft', $rows[0]['data']['sequence_status'] );
    }

    public function test_an_invalid_create_writes_nothing(): void
    {
        global $wpdb;

        $before = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE event_type LIKE %s', Schema::get_table_name( 'workflows_events' ), 'sequence.%' ) );

        $statuses                            = $this->statuses();
        $statuses[0]['transitions'][0]['to'] = 'nowhere';

        $response = $this->post( array( 'statuses' => $statuses ) );
        $this->assertSame( 422, $response->get_status() );

        $after = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE event_type LIKE %s', Schema::get_table_name( 'workflows_events' ), 'sequence.%' ) );
        $this->assertSame( $before, $after );
    }

    public function test_import_writes_one_imported_row_and_names_the_source(): void
    {
        $request = new \WP_REST_Request( 'POST', '/vip-workflows/v1/sequences/import' );
        $request->set_param(
            'sequence_json',
            array(
                'type'   => 'workflow',
                'name'   => 'Exported Flow',
                'config' => array(
                    'post_types' => array( 'post' ),
                    'statuses'   => $this->statuses(),
                ),
            )
        );
        $request->set_param( 'name', 'Renamed On Import' );

        $response = rest_do_request( $request );
        $this->assertSame( 201, $response->get_status() );

        $rows = $this->rows_for( (int) $response->get_data()['sequence']['id'] );

        $this->assertCount( 1, $rows );
        $this->assertSame( 'sequence.imported', $rows[0]['type'] );
        $this->assertSame( 'rest', $rows[0]['data']['via'] );
        $this->assertSame( 'draft', $rows[0]['data']['sequence_status'] );
        $this->assertSame( 'Renamed On Import', $rows[0]['data']['sequence_name'] );
        $this->assertSame( 'Exported Flow', $rows[0]['data']['source_name'] );
    }

    // -------------------------------------------------------------------------
    // Update and status
    // -------------------------------------------------------------------------

    public function test_update_adding_a_stage_writes_one_updated_row_naming_it(): void
    {
        $sequence = $this->create_sequence();

        $this->assertSame( 200, $this->put( $sequence, $this->statuses_with_legal() )->get_status() );

        $rows = $this->rows_for( $sequence->id );
        $this->assertCount( 1, $rows );
        $this->assertSame( 'sequence.updated', $rows[0]['type'] );
        $this->assertSame( 'user', $rows[0]['actor_type'] );
        $this->assertSame( 'rest', $rows[0]['data']['via'] );
        $this->assertSame( 4, $rows[0]['data']['statuses_count'] );
        $this->assertSame(
            array( array( 'key' => 'legal', 'label' => 'Legal review' ) ),
            $rows[0]['data']['changes']['stages_added']
        );
    }

    public function test_a_status_only_save_writes_only_the_activation_row(): void
    {
        $sequence = $this->create_sequence( 'draft' );

        $this->put( $sequence, $this->statuses(), array( 'status' => 'active' ) );

        $rows = $this->rows_for( $sequence->id );
        $this->assertSame( array( 'sequence.activated' ), array_column( $rows, 'type' ) );
        $this->assertSame( 'draft', $rows[0]['data']['previous_status'] );
        $this->assertSame( 'active', $rows[0]['data']['sequence_status'] );
    }

    public function test_an_edit_plus_deactivate_save_writes_both_rows(): void
    {
        $sequence = $this->create_sequence();

        $this->put( $sequence, $this->statuses_with_legal(), array( 'status' => 'draft' ) );

        $this->assertSame(
            array( 'sequence.updated', 'sequence.deactivated' ),
            array_column( $this->rows_for( $sequence->id ), 'type' )
        );
    }

    public function test_moving_only_the_start_stage_is_still_an_update(): void
    {
        $sequence = $this->create_sequence();

        $statuses                  = $this->statuses();
        $statuses[1]['is_initial'] = true;

        $this->put( $sequence, $statuses );

        $rows = $this->rows_for( $sequence->id );
        $this->assertCount( 1, $rows );
        $this->assertSame( array( 'fields_changed' => array( 'stages' ) ), $rows[0]['data']['changes'] );
    }

    public function test_a_save_that_changes_nothing_writes_nothing(): void
    {
        $sequence = $this->create_sequence();

        $this->assertSame( 200, $this->put( $sequence, $this->statuses() )->get_status() );

        $this->assertSame( array(), $this->rows_for( $sequence->id ) );
    }

    public function test_an_update_the_strand_guard_refuses_writes_nothing(): void
    {
        $sequence = $this->create_sequence();
        $post_id  = self::factory()->post->create();
        update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $sequence->id );
        update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'review' );

        $statuses = $this->statuses();
        unset( $statuses[1] );
        $statuses[0]['transitions'][0]['to'] = 'live';

        $this->assertSame( 409, $this->put( $sequence, array_values( $statuses ) )->get_status() );
        $this->assertSame( array(), $this->rows_for( $sequence->id ) );
    }

    public function test_a_client_cannot_claim_to_be_an_ability(): void
    {
        $sequence = $this->create_sequence();

        $request = new \WP_REST_Request( 'PUT', '/vip-workflows/v1/sequences/' . $sequence->id );
        $request->set_query_params( array( 'vip_workflows_ability' => 'vip-workflows/update-sequence' ) );
        $request->set_body_params(
            array(
                'name'                  => 'Forged',
                'post_types'            => array( 'post' ),
                'statuses'              => $this->statuses(),
                'vip_workflows_ability' => 'vip-workflows/update-sequence',
            )
        );

        $this->assertSame( 200, rest_do_request( $request )->get_status() );

        $rows = $this->rows_for( $sequence->id );
        $this->assertCount( 1, $rows );
        $this->assertSame( 'user', $rows[0]['actor_type'] );
        $this->assertSame( 'rest', $rows[0]['data']['via'] );
        $this->assertArrayNotHasKey( 'agent_actor', $rows[0]['data'] );
    }

    // -------------------------------------------------------------------------
    // Region repair
    // -------------------------------------------------------------------------

    public function test_region_repair_is_recorded_as_an_update_with_what_it_dropped(): void
    {
        global $wpdb;

        $now = current_time( 'mysql' );
        $wpdb->insert(
            Schema::get_table_name( 'sequences' ),
            array(
                'uuid'        => wp_generate_uuid4(),
                'type'        => Sequence::TYPE_WORKFLOW,
                'name'        => 'Legacy Flow',
                'slug'        => 'legacy-flow-' . wp_generate_password( 6, false ),
                'description' => '',
                'version'     => 1,
                'status'      => 'draft',
                'config'      => wp_json_encode(
                    array(
                        'post_types' => array( 'post' ),
                        'statuses'   => array(
                            array(
                                'key'         => 'writing',
                                'label'       => 'Writing',
                                'transitions' => array(
                                    array( 'to' => 'live', 'label' => 'Ship' ),
                                    array( 'to' => 'live', 'label' => 'Ship again' ),
                                ),
                            ),
                            array( 'key' => 'live', 'label' => 'Live' ),
                        ),
                    )
                ),
                'created_by'  => $this->admin_id,
                'created_at'  => $now,
                'updated_at'  => $now,
            )
        );
        $id = (int) $wpdb->insert_id;

        $response = rest_do_request( new \WP_REST_Request( 'POST', '/vip-workflows/v1/sequences/' . $id . '/repair-regions' ) );
        $this->assertSame( 200, $response->get_status() );

        $rows = $this->rows_for( $id );
        $this->assertCount( 1, $rows );
        $this->assertSame( 'sequence.updated', $rows[0]['type'] );
        $this->assertTrue( $rows[0]['data']['repair'] );

        $changes = $rows[0]['data']['changes'];
        $this->assertSame( array( null ), array_unique( array_column( $changes['regions_changed'], 'from' ) ) );
        $this->assertSame( 'draft', $changes['regions_changed'][0]['to'] );

        $dropped = $response->get_data()['repair']['dropped'];
        $this->assertCount( count( $dropped ), $changes['transitions_removed'] );
        $this->assertSame( 'writing', $changes['transitions_removed'][0]['from'] );
        $this->assertSame( 'live', $changes['transitions_removed'][0]['to'] );
    }

    // -------------------------------------------------------------------------
    // Delete
    // -------------------------------------------------------------------------

    public function test_delete_writes_a_row_that_still_names_the_sequence(): void
    {
        $sequence = $this->create_sequence();

        $response = rest_do_request( new \WP_REST_Request( 'DELETE', '/vip-workflows/v1/sequences/' . $sequence->id ) );
        $this->assertSame( 200, $response->get_status() );
        $this->assertNull( $this->repository->find( $sequence->id ) );

        $rows = $this->rows_for( $sequence->id );
        $this->assertCount( 1, $rows );
        $this->assertSame( 'sequence.deleted', $rows[0]['type'] );
        $this->assertSame( 'Audit Flow', $rows[0]['data']['sequence_name'] );
        $this->assertSame( 3, $rows[0]['data']['statuses_count'] );
    }

    public function test_a_refused_delete_writes_nothing(): void
    {
        $sequence = $this->create_sequence();
        $post_id  = self::factory()->post->create();
        update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $sequence->id );
        update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'writing' );

        $response = rest_do_request( new \WP_REST_Request( 'DELETE', '/vip-workflows/v1/sequences/' . $sequence->id ) );

        $this->assertSame( 409, $response->get_status() );
        $this->assertSame( array(), $this->rows_for( $sequence->id ) );
    }

    // -------------------------------------------------------------------------
    // Audit Log
    // -------------------------------------------------------------------------

    public function test_the_audit_log_serves_the_new_event_types(): void
    {
        $id = (int) $this->post()->get_data()['id'];
        rest_do_request( new \WP_REST_Request( 'DELETE', '/vip-workflows/v1/sequences/' . $id ) );

        $request = new \WP_REST_Request( 'GET', '/vip-workflows/v1/audit-log' );
        $request->set_param( 'event_type', 'sequence.deleted' );
        $response = rest_do_request( $request );

        $this->assertSame( 200, $response->get_status() );
        $events = $response->get_data()['events'];
        $this->assertNotEmpty( $events );
        $this->assertSame( 'sequence.deleted', $events[0]['event_type'] );
        $this->assertSame( 'Sequence deleted', $events[0]['event_type_label'] );
        $this->assertNull( $events[0]['post'] );

        $types = wp_list_pluck( rest_do_request( new \WP_REST_Request( 'GET', '/vip-workflows/v1/audit-log/event-types' ) )->get_data(), 'label', 'value' );
        $this->assertSame( 'Sequence created', $types['sequence.created'] );
        $this->assertSame( 'Sequence deleted', $types['sequence.deleted'] );
    }
}
