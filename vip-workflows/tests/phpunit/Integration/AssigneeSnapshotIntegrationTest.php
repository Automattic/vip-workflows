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
	 */
	public function test_an_omitted_assignment_is_preserved_without_an_unassigned_snapshot(): void {
		$post_id            = $this->make_workflow_post();
		$assignment_manager = new AssignmentManager();
		$assignment_manager->assign( $post_id, 'reviewer', $this->author_id, 'user' );
		$existing = $assignment_manager->get( $post_id, 'reviewer' );

		$result = ( new StatusManager() )->transition(
			$post_id,
			'status_2',
			array( 'input_data' => array( 'reviewer__name' => 'Reviewer' ) )
		);

		$this->assertTrue( $result, 'The transition should commit.' );
		$this->assertSame( $existing, $assignment_manager->get( $post_id, 'reviewer' ) );
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
	 * An assignee id that no longer resolves to a user (deleted, or never
	 * valid) records the raw stored value rather than losing the row.
	 */
	public function test_an_unresolvable_assignee_falls_back_to_the_raw_value(): void
	{
		$post_id = $this->make_workflow_post();

		( new StatusManager() )->transition(
			$post_id,
			'status_2',
			array(
				'input_data' => array(
					'reviewer'       => 999999,
					'reviewer__name' => 'Reviewer',
				),
			)
		);

		$data = $this->latest_event_data( $post_id, 'status_transition' );

		$this->assertSame(
			array( array( 'label' => 'Reviewer', 'value' => 999999 ) ),
			$data['notes']
		);
	}
}
