<?php
/**
 * AuditLogController integration tests.
 *
 * Exercises the multi-select event-type / user filters and the global search
 * JOIN against the real database. These paths build SQL dynamically, so they
 * are verified end-to-end against a booted WordPress + MySQL rather than mocked.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\API\AuditLogController;
use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Database\Schema;
use VIPWorkflows\Workflow\StatusManager;
use WP_REST_Request;

/**
 * @covers \VIPWorkflows\API\AuditLogController
 */
class AuditLogControllerTest extends TestCase
{
	private AuditLogController $controller;
	private string $table;
	private int $admin_id;

	public function set_up(): void
	{
		parent::set_up();

		global $wpdb;

		$this->controller = new AuditLogController();
		$this->table      = Schema::get_table_name( 'workflows_events' );

		// Administrators have full audit-log access by default, so the query is
		// not scoped to the current user's own activity.
		$this->admin_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $this->admin_id );

		// Start from a clean events table for deterministic counts.
		$wpdb->query( "DELETE FROM {$this->table}" ); // phpcs:ignore WordPress.DB
	}

	/**
	 * Insert a raw event row.
	 *
	 * @param array $args Overrides for the event columns.
	 * @return int Inserted row id.
	 */
	private function insert_event( array $args = array() ): int
	{
		global $wpdb;

		$wpdb->insert(
			$this->table,
			array(
				'post_id'    => $args['post_id'] ?? null,
				'event_type' => $args['event_type'] ?? 'status_transition',
				'event_data' => wp_json_encode( $args['event_data'] ?? array() ),
				'actor_id'   => $args['actor_id'] ?? $this->admin_id,
				'actor_type' => $args['actor_type'] ?? 'user',
				'created_at' => $args['created_at'] ?? current_time( 'mysql' ),
			)
		);

		return (int) $wpdb->insert_id;
	}

	/**
	 * Call get_events with the given query params and return the response data.
	 *
	 * @param array $params Query parameters.
	 * @return array Response payload.
	 */
	private function get_events( array $params = array() ): array
	{
		// Route registration normally supplies these defaults; a bare request
		// does not, so mirror them here.
		$params  = array_merge(
			array(
				'page'     => 1,
				'per_page' => 25,
				'orderby'  => 'created_at',
				'order'    => 'desc',
			),
			$params
		);
		$request = new WP_REST_Request( 'GET', '/vip-workflows/v1/audit-log' );
		foreach ( $params as $key => $value ) {
			$request->set_param( $key, $value );
		}

		return $this->controller->get_events( $request )->get_data();
	}

	/**
	 * Pluck the event_type values from a response payload.
	 *
	 * @param array $data Response payload.
	 * @return string[] Event types.
	 */
	private function event_types( array $data ): array
	{
		return wp_list_pluck( $data['events'], 'event_type' );
	}

	public function test_returns_all_events_without_filters(): void
	{
		$this->insert_event( array( 'event_type' => 'status_transition' ) );
		$this->insert_event( array( 'event_type' => 'workflow.assigned' ) );

		$data = $this->get_events();

		$this->assertSame( 2, $data['total'] );
		$this->assertCount( 2, $data['events'] );
	}

	public function test_filters_by_multiple_event_types(): void
	{
		$this->insert_event( array( 'event_type' => 'status_transition' ) );
		$this->insert_event( array( 'event_type' => 'workflow.assigned' ) );
		$this->insert_event( array( 'event_type' => 'ability.failed' ) );

		$data = $this->get_events(
			array( 'event_type' => array( 'status_transition', 'workflow.assigned' ) )
		);

		$this->assertSame( 2, $data['total'] );
		$this->assertEqualsCanonicalizing(
			array( 'status_transition', 'workflow.assigned' ),
			$this->event_types( $data )
		);
	}

	public function test_filters_by_single_event_type_passed_as_scalar(): void
	{
		$this->insert_event( array( 'event_type' => 'status_transition' ) );
		$this->insert_event( array( 'event_type' => 'ability.failed' ) );

		// A bare string (not an array) must still work.
		$data = $this->get_events( array( 'event_type' => 'ability.failed' ) );

		$this->assertSame( 1, $data['total'] );
		$this->assertSame( array( 'ability.failed' ), $this->event_types( $data ) );
	}

	public function test_filters_by_multiple_users(): void
	{
		$other_user = self::factory()->user->create( array( 'role' => 'author' ) );
		$third_user = self::factory()->user->create( array( 'role' => 'author' ) );

		$this->insert_event( array( 'actor_id' => $this->admin_id ) );
		$this->insert_event( array( 'actor_id' => $other_user ) );
		$this->insert_event( array( 'actor_id' => $third_user ) );

		$data = $this->get_events(
			array( 'user_id' => array( $this->admin_id, $other_user ) )
		);

		$this->assertSame( 2, $data['total'] );
		$actor_ids = wp_list_pluck( wp_list_pluck( $data['events'], 'actor' ), 'id' );
		$this->assertEqualsCanonicalizing( array( $this->admin_id, $other_user ), $actor_ids );
	}

	public function test_search_matches_post_title(): void
	{
		$found_post   = self::factory()->post->create( array( 'post_title' => 'Quarterly Findable Report' ) );
		$ignored_post = self::factory()->post->create( array( 'post_title' => 'Unrelated Memo' ) );

		$this->insert_event( array( 'event_type' => 'status_transition', 'post_id' => $found_post ) );
		$this->insert_event( array( 'event_type' => 'status_transition', 'post_id' => $ignored_post ) );

		$data = $this->get_events( array( 'search' => 'Findable' ) );

		$this->assertSame( 1, $data['total'] );
		$this->assertSame( $found_post, $data['events'][0]['post']['id'] );
	}

	public function test_search_matches_event_type_slug(): void
	{
		$this->insert_event( array( 'event_type' => 'ability.failed' ) );
		$this->insert_event( array( 'event_type' => 'status_transition' ) );

		$data = $this->get_events( array( 'search' => 'ability' ) );

		$this->assertSame( 1, $data['total'] );
		$this->assertSame( array( 'ability.failed' ), $this->event_types( $data ) );
	}

	public function test_search_is_case_insensitive_and_partial(): void
	{
		$post = self::factory()->post->create( array( 'post_title' => 'Breaking News Tonight' ) );
		$this->insert_event( array( 'post_id' => $post ) );
		$this->insert_event( array( 'event_type' => 'workflow.removed' ) );

		$data = $this->get_events( array( 'search' => 'breaking' ) );

		$this->assertSame( 1, $data['total'] );
		$this->assertSame( $post, $data['events'][0]['post']['id'] );
	}

	public function test_pagination_reports_totals(): void
	{
		for ( $i = 0; $i < 5; $i++ ) {
			$this->insert_event();
		}

		$data = $this->get_events( array( 'per_page' => 2, 'page' => 1 ) );

		$this->assertSame( 5, $data['total'] );
		$this->assertSame( 3, $data['total_pages'] );
		$this->assertCount( 2, $data['events'] );
	}

	public function test_one_stage_change_reads_as_one_audit_row(): void
	{
		// The three rows one stage change writes: StatusManager's canonical
		// `status_transition` audit row, then the EventBus's bookkeeping copies
		// of its `post.stage_changed` and `stage.{key}.entered` emissions.
		$post_id = self::factory()->post->create();
		$this->insert_event( array( 'event_type' => 'status_transition', 'post_id' => $post_id ) );
		$this->insert_event( array( 'event_type' => 'post.stage_changed', 'post_id' => $post_id ) );
		$this->insert_event( array( 'event_type' => 'stage.review.entered', 'post_id' => $post_id ) );

		$data = $this->get_events();

		$this->assertSame( 1, $data['total'] );
		$this->assertSame( array( 'status_transition' ), $this->event_types( $data ) );
	}

	public function test_bus_bookkeeping_is_not_reachable_by_explicit_filter(): void
	{
		$this->insert_event( array( 'event_type' => 'post.stage_changed' ) );

		// The exclusion is structural, not a default a filter can undo.
		$data = $this->get_events( array( 'event_type' => 'post.stage_changed' ) );

		$this->assertSame( 0, $data['total'] );
	}

	public function test_event_type_options_omit_bus_bookkeeping(): void
	{
		$this->insert_event( array( 'event_type' => 'status_transition' ) );
		$this->insert_event( array( 'event_type' => 'post.stage_changed' ) );
		$this->insert_event( array( 'event_type' => 'stage.review.entered' ) );
		$this->insert_event( array( 'event_type' => 'stage.review.completed' ) );
		// The exclusion is the two narrow bookkeeping families, not the whole
		// `stage.` namespace: an extension's event under it, with no canonical
		// row of its own, must stay visible.
		$this->insert_event( array( 'event_type' => 'stage.custom.alert' ) );

		$types = wp_list_pluck( $this->controller->get_event_types()->get_data(), 'value' );

		$this->assertSame( array( 'stage.custom.alert', 'status_transition' ), $types );
	}

	public function test_user_options_omit_actors_only_present_on_bookkeeping(): void
	{
		$other = self::factory()->user->create( array( 'role' => 'author' ) );

		$this->insert_event( array( 'event_type' => 'status_transition', 'actor_id' => $this->admin_id ) );
		$this->insert_event( array( 'event_type' => 'post.stage_changed', 'actor_id' => $other ) );

		$user_ids = wp_list_pluck( $this->controller->get_users()->get_data(), 'value' );

		$this->assertSame( array( $this->admin_id ), $user_ids );
	}

	/**
	 * The end-to-end form of the exclusion: a real transition through
	 * StatusManager, with every production writer attached, must surface in the
	 * audit stream as exactly one stage-change entry carrying both ends of the
	 * move — whatever bookkeeping the EventBus stored beside it.
	 */
	public function test_a_real_stage_change_yields_exactly_one_audit_row(): void
	{
		global $wpdb;

		$sequence_id = (int) ( new SequenceRepository() )->create(
			'Audit Flow',
			'audit-flow',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'          => 'draft',
						'label'        => 'Draft',
						'status'       => 'draft',
						'region_entry' => true,
						'transitions'  => array( array( 'to' => 'review' ) ),
					),
					array(
						'key'         => 'review',
						'label'       => 'In Review',
						'status'      => 'draft',
						'transitions' => array( array( 'to' => 'draft' ) ),
					),
				),
			),
			$this->admin_id
		);

		$post_id = self::factory()->post->create( array( 'post_status' => 'draft' ) );
		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'draft' );

		$this->assertTrue( ( new StatusManager() )->transition( $post_id, 'review' ) );

		// The writers wrote exactly one canonical audit row for the change.
		$canonical = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$this->table} WHERE post_id = %d AND event_type = 'status_transition'", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
				$post_id
			)
		);
		$this->assertSame( 1, $canonical );

		// And the audit stream serves that row alone, both ends on its payload.
		$data = $this->get_events( array( 'post_id' => $post_id ) );

		$this->assertSame( 1, $data['total'] );
		$this->assertSame( array( 'status_transition' ), $this->event_types( $data ) );
		$this->assertSame( 'Draft', $data['events'][0]['event_data']['from_label'] );
		$this->assertSame( 'In Review', $data['events'][0]['event_data']['to_label'] );
	}
}
