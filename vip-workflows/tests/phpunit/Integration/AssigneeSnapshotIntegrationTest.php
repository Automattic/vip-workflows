<?php
/**
 * Integration coverage: a transition's assignment input records who it was
 * assigned to, resolved to a display name, in the workflow audit trail.
 *
 * Before this, `log_transition()` either recorded the assignee's raw stored
 * value (a numeric user id, or a role slug) undecorated, or — whenever a
 * free-text note rode along with the assignment — dropped the assignee
 * entirely and kept only the note. Both left the audit log unable to answer
 * "who was this assigned to."
 *
 * Driven end to end (real sequence rows, real posts, real StatusManager)
 * because log_transition() is private and reachable only through
 * transition().
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Database\Schema;
use VIPWorkflows\Workflow\AssignmentManager;
use VIPWorkflows\Workflow\StatusManager;

/**
 * Real-WordPress tests for assignee snapshots in the audit trail.
 */
class AssigneeSnapshotIntegrationTest extends TestCase
{
	private const SEQUENCE_NAME = 'Assignee Snapshot Flow';

	/**
	 * Sequence ID.
	 *
	 * @var int
	 */
	private int $sequence_id;

	/**
	 * The post author / actor performing every transition.
	 *
	 * @var int
	 */
	private int $author_id;

	public function set_up(): void
	{
		parent::set_up();

		$this->author_id = (int) self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $this->author_id );

		// Every stage sits in the `draft` region: no move crosses a region
		// boundary, so the test is isolated to what the audit row records.
		$this->sequence_id = (int) ( new SequenceRepository() )->create(
			self::SEQUENCE_NAME,
			'assignee-snapshot-flow',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'          => 'status_1',
						'label'        => 'Ideas',
						'status'       => 'draft',
						'region_entry' => true,
						'transitions'  => array(
							array(
								'to'     => 'status_2',
								'inputs' => array(
									array(
										'type'          => 'assignment',
										'meta_key'      => 'reviewer',
										'assignee_type' => 'user',
										'label'         => 'Reviewer',
									),
								),
							),
							array(
								'to'     => 'status_3',
								'inputs' => array(
									array(
										'type'          => 'assignment',
										'meta_key'      => 'approver',
										'assignee_type' => 'role',
										'label'         => 'Approver',
									),
								),
							),
						),
					),
					array(
						'key'         => 'status_2',
						'label'       => 'In Review',
						'status'      => 'draft',
						'transitions' => array(),
					),
					array(
						'key'         => 'status_3',
						'label'       => 'Approved',
						'status'      => 'draft',
						'transitions' => array(),
					),
				),
			),
			$this->author_id
		);
	}

	/**
	 * A draft post seated at `status_1` of the fixture sequence.
	 *
	 * @return int Post ID.
	 */
	private function make_workflow_post(): int
	{
		$post_id = (int) self::factory()->post->create(
			array(
				'post_status' => 'draft',
				'post_author' => $this->author_id,
			)
		);

		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $this->sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'status_1' );

		return $post_id;
	}

	/**
	 * Fetch the decoded event_data of the most recent event of a type for a post.
	 *
	 * @param  int    $post_id    Post ID.
	 * @param  string $event_type Event type.
	 * @return array
	 */
	private function latest_event_data( int $post_id, string $event_type ): array
	{
		global $wpdb;

		$table = Schema::get_table_name( 'workflows_events' );

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$json = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT event_data FROM {$table} WHERE post_id = %d AND event_type = %s ORDER BY id DESC LIMIT 1",
				$post_id,
				$event_type
			)
		);

		$this->assertNotNull( $json, "No {$event_type} event was recorded for post {$post_id}." );

		return (array) json_decode( (string) $json, true );
	}

	/**
	 * A committed user assignment records the assignee's display name, not
	 * the raw stored user id.
	 */
	public function test_user_assignment_snapshots_the_assignees_display_name(): void
	{
		$reviewer_id = (int) self::factory()->user->create(
			array(
				'role'         => 'editor',
				'display_name' => 'Jane Reviewer',
			)
		);
		$post_id = $this->make_workflow_post();

		$result = ( new StatusManager() )->transition(
			$post_id,
			'status_2',
			array(
				'input_data' => array(
					'reviewer'         => $reviewer_id,
					'reviewer__name'   => 'Reviewer',
				),
			)
		);
		$this->assertTrue( $result, 'The transition should commit.' );

		$data = $this->latest_event_data( $post_id, 'status_transition' );

		$this->assertSame(
			array( array( 'label' => 'Reviewer', 'value' => 'Jane Reviewer' ) ),
			$data['notes'],
			'The audit row should name who the post was assigned to, not the raw user id.'
		);
	}

	/**
	 * A committed role assignment records the role's display name, not the
	 * raw stored slug.
	 */
	public function test_role_assignment_snapshots_the_role_display_name(): void
	{
		$post_id = $this->make_workflow_post();

		$result = ( new StatusManager() )->transition(
			$post_id,
			'status_3',
			array(
				'input_data' => array(
					'approver'       => 'editor',
					'approver__name' => 'Approver',
				),
			)
		);
		$this->assertTrue( $result, 'The transition should commit.' );

		$data = $this->latest_event_data( $post_id, 'status_transition' );

		$this->assertSame(
			array( array( 'label' => 'Approver', 'value' => 'Editor' ) ),
			$data['notes']
		);
	}

	/**
	 * An assignment explicitly submitted empty — the one way an optional
	 * assignment popover has to clear one (AssignmentManager::unassign()) —
	 * snapshots as "Unassigned" rather than resolving to nothing and
	 * printing as a blank value next to the field's label.
	 *
	 * @dataProvider cleared_assignment_values
	 * @param mixed $value Explicit empty assignment input.
	 */
	public function test_a_cleared_assignment_snapshots_as_unassigned( $value ): void {
		$post_id            = $this->make_workflow_post();
		$assignment_manager = new AssignmentManager();
		$assignment_manager->assign( $post_id, 'reviewer', $this->author_id, 'user' );
		$this->assertNotNull( $assignment_manager->get( $post_id, 'reviewer' ) );

		$result = ( new StatusManager() )->transition(
			$post_id,
			'status_2',
			array(
				'input_data' => array(
					'reviewer'       => $value,
					'reviewer__name' => 'Reviewer',
				),
			)
		);
		$this->assertTrue( $result, 'The transition should commit.' );
		$this->assertFalse( metadata_exists( 'post', $post_id, '_vip_workflows_assignment_reviewer' ) );
		$this->assertSame( 'status_2', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );

		$data = $this->latest_event_data( $post_id, 'status_transition' );

		$this->assertSame(
			array(
				array(
					'label' => 'Reviewer',
					'value' => 'Unassigned',
				),
			),
			$data['notes']
		);
	}

	/**
	 * Explicit empty inputs both clear an optional assignment.
	 *
	 * @return array
	 */
	public static function cleared_assignment_values(): array {
		return array(
			'empty string' => array( '' ),
			'null'         => array( null ),
		);
	}

	/**
	 * Omitting an optional assignment preserves it without recording a clear.
	 *
	 * The slot keeps its assignee and assignment record. Leaving `status_1`
	 * still completes it, as it completes any pending user assignment of the
	 * stage the post leaves.
	 */
	public function test_an_omitted_assignment_is_preserved_without_an_unassigned_snapshot(): void {
		$post_id            = $this->make_workflow_post();
		$assignment_manager = new AssignmentManager();
		$assignment_manager->assign( $post_id, 'reviewer', $this->author_id, 'user' );
		$existing = $assignment_manager->get( $post_id, 'reviewer' );
		$this->assertSame( AssignmentManager::STATUS_PENDING, $existing['status'] );

		$result = ( new StatusManager() )->transition(
			$post_id,
			'status_2',
			array( 'input_data' => array( 'reviewer__name' => 'Reviewer' ) )
		);

		$this->assertTrue( $result, 'The transition should commit.' );
		$stored = $assignment_manager->get( $post_id, 'reviewer' );
		$this->assertSame(
			array_diff_key( $existing, array( 'status' => true ) ),
			array_diff_key(
				$stored,
				array(
					'status'       => true,
					'completed_at' => true,
					'completed_by' => true,
				)
			)
		);
		$this->assertSame( AssignmentManager::STATUS_COMPLETED, $stored['status'] );
		$this->assertSame( get_current_user_id(), $stored['completed_by'] );
		$this->assertSame( 'status_2', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
		$this->assertSame( array(), $this->latest_event_data( $post_id, 'status_transition' )['notes'] );
	}

	/**
	 * A free-text note riding alongside the assignment no longer displaces
	 * it — both the assignee and the note survive into the audit row.
	 */
	public function test_a_note_alongside_the_assignment_does_not_drop_the_assignee(): void
	{
		$reviewer_id = (int) self::factory()->user->create(
			array(
				'role'         => 'editor',
				'display_name' => 'Jane Reviewer',
			)
		);
		$post_id = $this->make_workflow_post();

		( new StatusManager() )->transition(
			$post_id,
			'status_2',
			array(
				'input_data' => array(
					'reviewer'             => $reviewer_id,
					'reviewer__name'       => 'Reviewer',
					'reviewer_notes'       => 'Please double check the sourcing.',
					'reviewer_notes__name' => 'Notes',
				),
			)
		);

		$data = $this->latest_event_data( $post_id, 'status_transition' );

		$this->assertSame(
			array(
				array( 'label' => 'Reviewer', 'value' => 'Jane Reviewer' ),
				array( 'label' => 'Notes', 'value' => 'Please double check the sourcing.' ),
			),
			$data['notes']
		);
	}

	/**
	 * An input key the transition does not declare (a retired free-text note,
	 * another edge's slot, an arbitrary key a client made up) fails the
	 * transition with a 400 naming the key. Nothing is stored, logged or
	 * assigned, and the post stays where it was.
	 *
	 * @dataProvider undeclared_input_provider
	 *
	 * @param string $key   The undeclared key.
	 * @param mixed  $value Its value.
	 */
	public function test_an_undeclared_input_key_rejects_the_transition_without_changes( string $key, $value ): void
	{
		$reviewer_id = (int) self::factory()->user->create(
			array(
				'role'         => 'editor',
				'display_name' => 'Jane Reviewer',
			)
		);
		$post_id = $this->make_workflow_post();

		$result = ( new StatusManager() )->transition(
			$post_id,
			'status_2',
			array(
				'input_data' => array(
					'reviewer'       => $reviewer_id,
					'reviewer__name' => 'Reviewer',
					$key            => $value,
				),
			)
		);

		$this->assertWPError( $result );
		$this->assertSame( 'unknown_transition_input', $result->get_error_code() );
		$this->assertSame( 400, $result->get_error_data()['status'] );
		$this->assertSame( $key, $result->get_error_data()['key'] );
		$this->assertSame( 'This transition doesn’t accept the “' . $key . '” input.', $result->get_error_message() );

		$this->assertSame( 'status_1', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ), 'The post must not move.' );
		$this->assertSame( '', get_post_meta( $post_id, '_vip_workflows_transition_data', true ), 'Nothing should be stored in transition meta.' );
		$this->assertNull( ( new AssignmentManager() )->get( $post_id, 'reviewer' ), 'The declared assignment must not be written either.' );
		$this->assertNull( ( new AssignmentManager() )->get( $post_id, 'approver' ), 'Another edge\'s slot must not be assigned.' );
	}

	/**
	 * Undeclared keys.
	 *
	 * @return array
	 */
	public static function undeclared_input_provider(): array
	{
		return array(
			'retired note'         => array( 'wfp_n1_why', 'Injected note.' ),
			'another edge\'s slot' => array( 'approver', 'editor' ),
			'arbitrary key'        => array( 'anything', 'Arbitrary text.' ),
		);
	}

	/**
	 * The v1 REST route answers an undeclared key with a 400 naming it.
	 */
	public function test_the_rest_route_answers_an_undeclared_key_with_a_400(): void
	{
		$post_id = $this->make_workflow_post();

		$request = new \WP_REST_Request( 'POST', '/vip-workflows/v1/workflow/post/' . $post_id . '/transition' );
		$request->set_header( 'Content-Type', 'application/json' );
		$request->set_body(
			(string) wp_json_encode(
				array(
					'to_status'  => 'status_2',
					'input_data' => array( 'note' => 'Please review.' ),
				)
			)
		);

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'unknown_transition_input', $response->get_data()['code'] );
		$this->assertSame( 'This transition doesn’t accept the “note” input.', $response->get_data()['message'] );
		$this->assertSame( 'status_1', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
	}

	/**
	 * An invalid assignee rejects the transition without replacing an existing
	 * assignment or recording a successful status transition.
	 */
	public function test_an_unresolvable_assignee_rejects_the_transition_without_changes(): void {
		global $wpdb;

		$post_id        = $this->make_workflow_post();
		$assignment_key = '_vip_workflows_assignment_reviewer';
		$assignment     = array(
			'value'       => $this->author_id,
			'type'        => 'user',
			'status'      => 'pending',
			'assigned_at' => current_time( 'mysql' ),
			'assigned_by' => $this->author_id,
		);
		update_post_meta( $post_id, $assignment_key, $assignment );
		$this->assertFalse( get_userdata( 999999 ), 'The submitted assignee must not resolve to a user.' );

		$result = ( new StatusManager() )->transition(
			$post_id,
			'status_2',
			array(
				'input_data' => array(
					'reviewer'       => 999999,
					'reviewer__name' => 'Reviewer',
				),
			)
		);

		$this->assertWPError( $result );
		$this->assertSame( 'invalid_assignee', $result->get_error_code() );
		$this->assertSame( 422, $result->get_error_data()['status'] );
		$this->assertSame( 'reviewer', $result->get_error_data()['meta_key'] );
		$this->assertSame( 'status_1', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
		$this->assertSame( 'draft', get_post_status( $post_id ) );
		$this->assertSame( $assignment, get_post_meta( $post_id, $assignment_key, true ) );

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Inspect the real audit table after the rejected transition.
		$transition_count = $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM %i WHERE post_id = %d AND event_type = %s',
				Schema::get_table_name( 'workflows_events' ),
				$post_id,
				'status_transition'
			)
		);
		$this->assertSame(
			0,
			(int) $transition_count,
			'A rejected assignment must not create a successful transition audit row.'
		);
	}
}
