<?php
/**
 * Integration coverage for the remove-from-workflow ability.
 *
 * The publish veto names exactly two ways through, and one of them — take the
 * post out of the workflow, which is recorded — had no Abilities-API equivalent.
 * An agent told to do what the veto told it to do could not.
 *
 * Driven end to end because the ability delegates wholly to
 * StatusManager::remove_sequence(), and the properties that matter (no
 * post_status write, the audit entry, the claim cleanup) are that method's.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Workflow\StatusManager;

require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/helpers.php';
require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/remove-from-workflow.php';

/**
 * Real-WordPress tests for the veto's audited escape hatch.
 */
class RemoveFromWorkflowAbilityIntegrationTest extends TestCase
{
	/**
	 * Sequence ID.
	 *
	 * @var int
	 */
	private int $sequence_id;

	/**
	 * Admin user ID.
	 *
	 * @var int
	 */
	private int $admin_id;

	public function set_up(): void
	{
		parent::set_up();

		$this->admin_id = (int) self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $this->admin_id );

		$this->sequence_id = (int) ( new SequenceRepository() )->create(
			'Escape Hatch Flow',
			'escape-hatch-flow',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'         => 'draft',
						'label'       => 'Draft',
						'status'      => 'draft',
						'transitions' => array(),
					),
				),
			),
			get_current_user_id()
		);
	}

	/**
	 * A workflow post at `draft`, optionally claimed.
	 *
	 * @return int Post ID.
	 */
	private function make_workflow_post(): int
	{
		$post_id = (int) self::factory()->post->create(
			array(
				'post_status' => 'draft',
				'post_author' => $this->admin_id,
			)
		);

		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $this->sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'draft' );
		update_post_meta( $post_id, '_vip_workflows_assigned_to', $this->admin_id );

		return $post_id;
	}

	/**
	 * Removal frees the post, reports what it was removed from, and writes NO
	 * post_status — the whole point is that the post stays exactly where core has
	 * it so the caller can then publish it normally, unguarded.
	 */
	public function test_removal_frees_the_post_without_touching_its_status(): void
	{
		$post_id = $this->make_workflow_post();

		$result = \VIPWorkflows\Abilities\Tools\execute_remove_from_workflow( array( 'post_id' => $post_id ) );

		$this->assertIsArray( $result );
		$this->assertTrue( $result['success'] );
		$this->assertSame( 'Escape Hatch Flow', $result['workflow_name'] );
		$this->assertSame( 'draft', $result['removed_stage'] );
		$this->assertSame( 'draft', $result['post_status'] );

		// The workflow identity is gone, including the claim.
		$this->assertSame( '', get_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, true ) );
		$this->assertSame( '', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
		$this->assertSame( '', get_post_meta( $post_id, '_vip_workflows_assigned_to', true ) );

		// Core still has the post exactly where it was.
		$this->assertSame( 'draft', get_post_status( $post_id ) );
	}

	/**
	 * The removal is recorded. This audit trail is the entire reason the veto is
	 * acceptable — an escape hatch nobody can see is just a hole.
	 */
	public function test_removal_is_recorded_in_the_workflow_log(): void
	{
		global $wpdb;

		$post_id = $this->make_workflow_post();

		\VIPWorkflows\Abilities\Tools\execute_remove_from_workflow( array( 'post_id' => $post_id ) );

		$table = \VIPWorkflows\Database\Schema::get_table_name( 'workflows_events' );

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$logged = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$table} WHERE post_id = %d AND event_type = %s",
				$post_id,
				'workflow.removed'
			)
		);

		$this->assertSame( 1, (int) $logged, 'Removing a post from its workflow must be recorded.' );
	}

	/**
	 * Removing a post that is not in a workflow is a caller error, not a no-op:
	 * the caller believed it was managed, and silently reporting success would
	 * let an agent conclude it had cleared a workflow that was never there.
	 */
	public function test_removing_an_unmanaged_post_is_an_error(): void
	{
		$post_id = (int) self::factory()->post->create( array( 'post_author' => $this->admin_id ) );

		$result = \VIPWorkflows\Abilities\Tools\execute_remove_from_workflow( array( 'post_id' => $post_id ) );

		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'no_sequence', $result->get_error_code() );
	}

	/**
	 * A post whose sequence row was DELETED is exactly the case removal exists
	 * to clean up: it is frozen by the save-layer guard until the dangling meta
	 * goes. The ability must free it rather than refuse because it cannot name
	 * the workflow.
	 */
	public function test_removal_clears_a_dangling_workflow_identity(): void
	{
		$post_id = $this->make_workflow_post();

		( new SequenceRepository() )->delete( $this->sequence_id );

		$result = \VIPWorkflows\Abilities\Tools\execute_remove_from_workflow( array( 'post_id' => $post_id ) );

		$this->assertIsArray( $result );
		$this->assertTrue( $result['success'] );
		$this->assertSame( '', $result['workflow_name'], 'There is no workflow left to name.' );
		$this->assertSame( '', get_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, true ) );
	}

	/**
	 * Edit access is required — removal is a workflow-state change, not a read.
	 */
	public function test_removal_requires_edit_access(): void
	{
		$post_id = $this->make_workflow_post();

		wp_set_current_user( (int) self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		$result = \VIPWorkflows\Abilities\Tools\execute_remove_from_workflow( array( 'post_id' => $post_id ) );

		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'forbidden', $result->get_error_code() );
		$this->assertSame( (string) $this->sequence_id, (string) get_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, true ) );
	}
}
