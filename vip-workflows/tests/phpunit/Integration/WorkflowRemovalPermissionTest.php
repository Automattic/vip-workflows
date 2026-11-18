<?php
/**
 * Integration coverage for who can remove a post from its workflow, or replace it.
 *
 * Only the workflow override roles (`bypass_workflow_roles`, default
 * administrator) can remove a post from its workflow, replace its workflow, or
 * re-seat it in the same one. Anyone who can edit a post can still give an
 * unassigned post its first workflow. A write with no logged-in user is a
 * system actor and is never refused.
 *
 * The limit lives in StatusManager::remove_sequence() and assign_sequence(),
 * which every surface reaches, so these tests drive the real REST routes and
 * the real ability rather than the methods alone.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Database\Schema;
use VIPWorkflows\Plugin;
use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Workflow\AssignmentManager;
use VIPWorkflows\Workflow\StatusManager;
use WP_REST_Request;

require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/helpers.php';
require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/remove-from-workflow.php';

/**
 * Real-WordPress tests for the removal and replacement limit.
 */
class WorkflowRemovalPermissionTest extends TestCase
{
	/**
	 * Route template.
	 */
	private const ROUTE = '/vip-workflows/v1/workflow/post/%d/sequence';

	/**
	 * Settings option name.
	 */
	private const OPTION = 'vip_workflows_settings';

	/**
	 * The refusal sentence with the default override list.
	 */
	private const REFUSAL = 'Only someone with the Administrator role can remove a post from its workflow or change its workflow.';

	/**
	 * The post's sequence.
	 *
	 * @var int
	 */
	private int $sequence_id;

	/**
	 * A second sequence the post is also eligible for.
	 *
	 * @var int
	 */
	private int $other_sequence_id;

	/**
	 * Administrator user ID (in the default override list).
	 *
	 * @var int
	 */
	private int $admin_id;

	/**
	 * Author user ID (outside it).
	 *
	 * @var int
	 */
	private int $author_id;

	/**
	 * Filter making both sequences eligible for every post.
	 *
	 * @var callable
	 */
	private $make_eligible;

	public function set_up(): void
	{
		parent::set_up();

		delete_option( self::OPTION );

		$this->admin_id  = (int) self::factory()->user->create( array( 'role' => 'administrator' ) );
		$this->author_id = (int) self::factory()->user->create( array( 'role' => 'author' ) );

		wp_set_current_user( $this->admin_id );

		$repository              = new SequenceRepository();
		$this->sequence_id       = (int) $repository->create( 'Desk Flow', 'desk-flow-removal', '', $this->config(), $this->admin_id );
		$this->other_sequence_id = (int) $repository->create( 'Loose Flow', 'loose-flow-removal', '', $this->config(), $this->admin_id );

		// PostTypeManager builds its post-type map on `init`, which has already
		// fired; eligibility is granted through the documented per-post filter.
		$ids                 = array( $this->sequence_id, $this->other_sequence_id );
		$this->make_eligible = static function ( array $eligible ) use ( $ids ): array {
			return array_values( array_unique( array_merge( $eligible, $ids ) ) );
		};
		add_filter( 'vip_workflows_sequences_for_post', $this->make_eligible );
	}

	public function tear_down(): void
	{
		remove_filter( 'vip_workflows_sequences_for_post', $this->make_eligible );
		delete_option( self::OPTION );

		parent::tear_down();
	}

	/**
	 * Two draft-region stages (so a post can sit past the entry stage) and one
	 * published stage.
	 *
	 * @return array Sequence config.
	 */
	private function config(): array
	{
		return array(
			'post_types' => array( 'post' ),
			'statuses'   => array(
				array(
					'key'         => 'draft',
					'label'       => 'Draft',
					'status'      => 'draft',
					'transitions' => array(),
				),
				array(
					'key'         => 'review',
					'label'       => 'Review',
					'status'      => 'draft',
					'transitions' => array(),
				),
				array(
					'key'         => 'published',
					'label'       => 'Published',
					'status'      => 'publish',
					'transitions' => array(),
				),
			),
		);
	}

	/**
	 * A draft post by the author, seated at `review` in the desk flow, claimed,
	 * and holding one pending assignment.
	 *
	 * @param  int $author_id Post author.
	 * @return int Post ID.
	 */
	private function make_workflow_post( int $author_id = 0 ): int
	{
		$post_id = (int) self::factory()->post->create(
			array(
				'post_status' => 'draft',
				'post_author' => $author_id ? $author_id : $this->author_id,
			)
		);

		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $this->sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'review' );
		update_post_meta( $post_id, '_vip_workflows_assigned_to', $this->admin_id );
		( new AssignmentManager() )->assign( $post_id, 'reviewer', $this->admin_id, 'user' );

		return $post_id;
	}

	/**
	 * Dispatch a sequence route.
	 *
	 * @param  string   $method      `POST` or `DELETE`.
	 * @param  int      $post_id     Post ID.
	 * @param  int|null $sequence_id Sequence to assign (POST only).
	 * @return \WP_REST_Response
	 */
	private function dispatch( string $method, int $post_id, ?int $sequence_id = null ): \WP_REST_Response
	{
		$request = new WP_REST_Request( $method, sprintf( self::ROUTE, $post_id ) );
		if ( null !== $sequence_id ) {
			$request->set_header( 'Content-Type', 'application/json' );
			$request->set_body( (string) wp_json_encode( array( 'sequence_id' => $sequence_id ) ) );
		}

		return rest_get_server()->dispatch( $request );
	}

	/**
	 * Count the audit rows of one type for a post.
	 *
	 * @param  int    $post_id    Post ID.
	 * @param  string $event_type Event type.
	 * @return int
	 */
	private function count_events( int $post_id, string $event_type ): int
	{
		global $wpdb;

		$table = Schema::get_table_name( 'workflows_events' );

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$table} WHERE post_id = %d AND event_type = %s", $post_id, $event_type ) );
	}

	/**
	 * The actor of the newest audit row of one type for a post.
	 *
	 * @param  int    $post_id    Post ID.
	 * @param  string $event_type Event type.
	 * @return int|null
	 */
	private function event_actor( int $post_id, string $event_type ): ?int
	{
		global $wpdb;

		$table = Schema::get_table_name( 'workflows_events' );

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$actor = $wpdb->get_var( $wpdb->prepare( "SELECT actor_id FROM {$table} WHERE post_id = %d AND event_type = %s ORDER BY id DESC LIMIT 1", $post_id, $event_type ) );

		return null === $actor ? null : (int) $actor;
	}

	/**
	 * Assert the post still holds its whole workflow identity: sequence, stage,
	 * claim, and a pending assignment.
	 *
	 * @param int    $post_id     Post ID.
	 * @param int    $sequence_id Expected sequence.
	 * @param string $stage       Expected stage.
	 */
	private function assert_workflow_intact( int $post_id, int $sequence_id, string $stage = 'review' ): void
	{
		$this->assertSame( (string) $sequence_id, (string) get_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, true ) );
		$this->assertSame( $stage, get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
		$this->assertSame( (string) $this->admin_id, (string) get_post_meta( $post_id, '_vip_workflows_assigned_to', true ) );

		$assignment = ( new AssignmentManager() )->get( $post_id, 'reviewer' );
		$this->assertIsArray( $assignment );
		$this->assertSame( AssignmentManager::STATUS_PENDING, $assignment['status'] );
	}

	// =========================================================================
	// Removal
	// =========================================================================

	/**
	 * An administrator (in the default override list) removes a post over REST:
	 * the identity is gone and the removal is audited with them as the actor.
	 */
	public function test_an_override_user_can_remove_over_rest(): void
	{
		$post_id = $this->make_workflow_post();

		$response = $this->dispatch( 'DELETE', $post_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( '', get_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, true ) );
		$this->assertSame( '', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
		$this->assertSame( '', get_post_meta( $post_id, '_vip_workflows_assigned_to', true ) );
		$this->assertSame( 1, $this->count_events( $post_id, 'workflow.removed' ) );
		$this->assertSame( $this->admin_id, $this->event_actor( $post_id, 'workflow.removed' ) );
	}

	/**
	 * Adding a role to the override list lets that role remove.
	 */
	public function test_an_editor_in_the_override_list_can_remove(): void
	{
		update_option( self::OPTION, array( 'bypass_workflow_roles' => array( 'editor', 'administrator' ) ) );
		$editor_id = (int) self::factory()->user->create( array( 'role' => 'editor' ) );
		$post_id   = $this->make_workflow_post();
		wp_set_current_user( $editor_id );

		$response = $this->dispatch( 'DELETE', $post_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( '', get_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, true ) );
		$this->assertSame( $editor_id, $this->event_actor( $post_id, 'workflow.removed' ) );
	}

	/**
	 * An author who owns the post can edit it but is outside the override list:
	 * a 403 naming who to ask, nothing changed, nothing audited.
	 */
	public function test_an_author_cannot_remove_over_rest(): void
	{
		$post_id = $this->make_workflow_post();
		wp_set_current_user( $this->author_id );

		$response = $this->dispatch( 'DELETE', $post_id );
		$data     = $response->get_data();

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( 'vip_workflows_removal_restricted', $data['code'] );
		$this->assertSame( self::REFUSAL, $data['message'] );
		$this->assert_workflow_intact( $post_id, $this->sequence_id );
		$this->assertSame( 0, $this->count_events( $post_id, 'workflow.removed' ) );
	}

	/**
	 * The ability (and so MCP) reaches the same refusal.
	 */
	public function test_an_author_cannot_remove_through_the_ability(): void
	{
		$post_id = $this->make_workflow_post();
		wp_set_current_user( $this->author_id );

		$result = \VIPWorkflows\Abilities\Tools\execute_remove_from_workflow( array( 'post_id' => $post_id ) );

		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'vip_workflows_removal_restricted', $result->get_error_code() );
		$this->assertSame( self::REFUSAL, $result->get_error_message() );
		$this->assert_workflow_intact( $post_id, $this->sequence_id );
	}

	/**
	 * A contributor can edit their own draft, and is refused too.
	 */
	public function test_a_contributor_cannot_remove_their_own_draft(): void
	{
		$contributor_id = (int) self::factory()->user->create( array( 'role' => 'contributor' ) );
		$post_id        = $this->make_workflow_post( $contributor_id );
		wp_set_current_user( $contributor_id );

		$this->assertTrue( current_user_can( 'edit_post', $post_id ), 'Precondition: the contributor can edit the draft.' );

		$response = $this->dispatch( 'DELETE', $post_id );

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( 'vip_workflows_removal_restricted', $response->get_data()['code'] );
		$this->assert_workflow_intact( $post_id, $this->sequence_id );
	}

	/**
	 * A user who cannot edit the post still gets the edit-access 403 from the
	 * route's permission callback, not the override refusal.
	 */
	public function test_a_user_without_edit_access_gets_the_routes_own_403(): void
	{
		$post_id    = $this->make_workflow_post();
		$subscriber = (int) self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $subscriber );

		$response = $this->dispatch( 'DELETE', $post_id );

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( 'rest_forbidden', $response->get_data()['code'] );
		$this->assert_workflow_intact( $post_id, $this->sequence_id );
	}

	/**
	 * A post whose sequence row was deleted can only be freed by removal; the
	 * author has to ask, and an administrator can do it.
	 */
	public function test_an_orphaned_post_follows_the_same_limit(): void
	{
		global $wpdb;

		$post_id = $this->make_workflow_post();
		$wpdb->delete( Schema::get_table_name( 'sequences' ), array( 'id' => $this->sequence_id ), array( '%d' ) );
		wp_cache_flush();

		wp_set_current_user( $this->author_id );
		$refused = $this->dispatch( 'DELETE', $post_id );
		$this->assertSame( 403, $refused->get_status() );
		$this->assertSame( (string) $this->sequence_id, (string) get_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, true ) );

		wp_set_current_user( $this->admin_id );
		$removed = $this->dispatch( 'DELETE', $post_id );
		$this->assertSame( 200, $removed->get_status() );
		$this->assertSame( '', get_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, true ) );
	}

	/**
	 * A write with no logged-in user is a system actor: it removes, and the
	 * audit row records no person.
	 */
	public function test_a_userless_removal_is_allowed(): void
	{
		$post_id = $this->make_workflow_post();
		wp_set_current_user( 0 );

		$result = Plugin::get_instance()->get_status_manager()->remove_sequence( $post_id );

		$this->assertTrue( $result );
		$this->assertSame( '', get_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, true ) );
		$this->assertSame( 0, $this->event_actor( $post_id, 'workflow.removed' ) );
	}

	/**
	 * An empty override list leaves no logged-in user able to remove, and the
	 * refusal says so without naming anyone.
	 */
	public function test_an_empty_override_list_refuses_everyone_logged_in(): void
	{
		update_option( self::OPTION, array( 'bypass_workflow_roles' => array() ) );
		$post_id = $this->make_workflow_post();

		$response = $this->dispatch( 'DELETE', $post_id );

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( 'You can’t remove a post from its workflow or change its workflow.', $response->get_data()['message'] );
		$this->assert_workflow_intact( $post_id, $this->sequence_id );
	}

	/**
	 * A refused removal leaves the publish veto in force: the author still
	 * can't publish the post directly over REST.
	 */
	public function test_after_a_refused_removal_the_publish_veto_still_holds(): void
	{
		$post_id = $this->make_workflow_post();
		wp_set_current_user( $this->author_id );

		$this->assertSame( 403, $this->dispatch( 'DELETE', $post_id )->get_status() );

		$request = new WP_REST_Request( 'POST', '/wp/v2/posts/' . $post_id );
		$request->set_header( 'Content-Type', 'application/json' );
		$request->set_body( (string) wp_json_encode( array( 'status' => 'publish' ) ) );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 409, $response->get_status() );
		$this->assertSame( 'vip_workflows_publish_boundary', $response->get_data()['code'] );
		$this->assertStringContainsString( 'Ask someone with the Administrator role to publish it.', $response->get_data()['message'] );
		$this->assertSame( 'draft', get_post_status( $post_id ) );
	}

	// =========================================================================
	// Replacement and re-seating
	// =========================================================================

	/**
	 * An author can't switch an enrolled post to another workflow: 403, and the
	 * post keeps its sequence, stage, claim and assignment.
	 */
	public function test_an_author_cannot_replace_the_workflow(): void
	{
		$post_id = $this->make_workflow_post();
		wp_set_current_user( $this->author_id );

		$response = $this->dispatch( 'POST', $post_id, $this->other_sequence_id );

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( 'vip_workflows_removal_restricted', $response->get_data()['code'] );
		$this->assert_workflow_intact( $post_id, $this->sequence_id );
		$this->assertSame( 0, $this->count_events( $post_id, 'workflow.assigned' ) );
	}

	/**
	 * An author can't re-seat a post in its own workflow to move it back to the
	 * entry stage.
	 */
	public function test_an_author_cannot_reseat_in_the_same_workflow(): void
	{
		$post_id = $this->make_workflow_post();
		wp_set_current_user( $this->author_id );

		$response = $this->dispatch( 'POST', $post_id, $this->sequence_id );

		$this->assertSame( 403, $response->get_status() );
		$this->assert_workflow_intact( $post_id, $this->sequence_id, 'review' );
	}

	/**
	 * An administrator can replace the workflow; the post is seated at the new
	 * workflow's entry stage and the assignment is logged.
	 */
	public function test_an_override_user_can_replace_the_workflow(): void
	{
		$post_id = $this->make_workflow_post();

		$response = $this->dispatch( 'POST', $post_id, $this->other_sequence_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( (string) $this->other_sequence_id, (string) get_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, true ) );
		$this->assertSame( 'draft', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
		$this->assertSame( 1, $this->count_events( $post_id, 'workflow.assigned' ) );
	}

	/**
	 * Giving an unassigned post its first workflow stays open to anyone who can
	 * edit it.
	 */
	public function test_an_author_can_still_assign_a_first_workflow(): void
	{
		wp_set_current_user( $this->author_id );
		$post_id = (int) self::factory()->post->create(
			array(
				'post_status' => 'draft',
				'post_author' => $this->author_id,
			)
		);

		$response = $this->dispatch( 'POST', $post_id, $this->sequence_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( (string) $this->sequence_id, (string) get_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, true ) );
		$this->assertSame( 'draft', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
		$this->assertSame( 1, $this->count_events( $post_id, 'workflow.assigned' ) );
		$this->assertSame( $this->author_id, $this->event_actor( $post_id, 'workflow.assigned' ) );
	}

	/**
	 * After an override user removes a post, its author can give it a
	 * workflow again: that is a first assignment.
	 */
	public function test_an_author_can_assign_again_after_an_override_user_removes(): void
	{
		$post_id = $this->make_workflow_post();
		$this->assertSame( 200, $this->dispatch( 'DELETE', $post_id )->get_status() );

		wp_set_current_user( $this->author_id );
		$response = $this->dispatch( 'POST', $post_id, $this->sequence_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'draft', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
	}

	// =========================================================================
	// Who to ask, in the status payload
	// =========================================================================

	/**
	 * The status route serves the override role names in the guard payload,
	 * for an enrolled post and for an orphaned one, so the editor can say the
	 * same thing the server says.
	 */
	public function test_status_payload_names_the_override_roles(): void
	{
		global $wpdb;

		update_option( self::OPTION, array( 'bypass_workflow_roles' => array( 'editor', 'administrator' ) ) );
		$post_id = $this->make_workflow_post();
		wp_set_current_user( $this->author_id );

		$status = rest_get_server()->dispatch( new WP_REST_Request( 'GET', '/vip-workflows/v1/workflow/post/' . $post_id . '/status' ) );
		$this->assertSame( 200, $status->get_status() );
		$this->assertFalse( $status->get_data()['guard']['can_bypass'] );
		$this->assertSame( array( 'Editor', 'Administrator' ), $status->get_data()['guard']['override_roles'] );

		$wpdb->delete( Schema::get_table_name( 'sequences' ), array( 'id' => $this->sequence_id ), array( '%d' ) );
		wp_cache_flush();

		$orphaned = rest_get_server()->dispatch( new WP_REST_Request( 'GET', '/vip-workflows/v1/workflow/post/' . $post_id . '/status' ) );
		$this->assertTrue( $orphaned->get_data()['orphaned'] );
		$this->assertSame( array( 'Editor', 'Administrator' ), $orphaned->get_data()['guard']['override_roles'] );
	}

	/** A registered ability must preserve the domain refusal. */
	public function test_registered_ability_refuses_an_author(): void
	{
		$post_id = $this->make_workflow_post();
		wp_set_current_user( $this->author_id );
		$ability = wp_get_ability( 'vip-workflows/remove-from-workflow' );
		$this->assertNotNull( $ability );
		$result = $ability->execute( array( 'post_id' => $post_id ) );
		$this->assertWPError( $result );
		$this->assertSame( 'vip_workflows_removal_restricted', $result->get_error_code() );
		$this->assertSame( self::REFUSAL, $result->get_error_message() );
		$this->assert_workflow_intact( $post_id, $this->sequence_id );
	}

	/** This ability is not offered on the Abilities REST endpoint. */
	public function test_abilities_rest_does_not_offer_removal(): void
	{
		$post_id = $this->make_workflow_post();
		wp_set_current_user( $this->author_id );
		$request = new WP_REST_Request( 'POST', '/wp-abilities/v1/abilities/vip-workflows/remove-from-workflow/run' );
		$request->set_param( 'input', array( 'post_id' => $post_id ) );
		$response = rest_get_server()->dispatch( $request );
		$this->assertSame( 404, $response->get_status() );
		$this->assertSame( 'rest_ability_not_found', $response->get_data()['code'] );
		$this->assert_workflow_intact( $post_id, $this->sequence_id );
	}

	/** A same-sequence request at the entry stage is still a replacement. */
	public function test_an_author_cannot_reseat_at_the_entry_stage(): void
	{
		$post_id = $this->make_workflow_post();
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'draft' );
		wp_set_current_user( $this->author_id );
		$this->assertSame( 403, $this->dispatch( 'POST', $post_id, $this->sequence_id )->get_status() );
		$this->assert_workflow_intact( $post_id, $this->sequence_id, 'draft' );
	}

	/** Calls without a route must enforce the same rule without side effects. */
	public function test_direct_calls_refuse_without_dispatching_stage_hooks(): void
	{
		$post_id = $this->make_workflow_post();
		wp_set_current_user( $this->author_id );
		$before = did_action( 'vip_workflows_status_transition' );
		$manager = Plugin::get_instance()->get_status_manager();
		$this->assertWPError( $manager->remove_sequence( $post_id ) );
		$this->assertWPError( $manager->assign_sequence( $post_id, $this->other_sequence_id ) );
		$this->assertSame( $before, did_action( 'vip_workflows_status_transition' ) );
		$this->assertSame( 0, $this->count_events( $post_id, 'workflow.removed' ) );
		$this->assertSame( 0, $this->count_events( $post_id, 'workflow.assigned' ) );
		$this->assert_workflow_intact( $post_id, $this->sequence_id );
	}

	/** A userless replacement still records the system actor. */
	public function test_a_userless_replacement_is_allowed(): void
	{
		$post_id = $this->make_workflow_post();
		wp_set_current_user( 0 );
		$this->assertTrue( Plugin::get_instance()->get_status_manager()->assign_sequence( $post_id, $this->other_sequence_id ) );
		$this->assertSame( 1, $this->count_events( $post_id, 'workflow.assigned' ) );
		$this->assertSame( 0, $this->event_actor( $post_id, 'workflow.assigned' ) );
	}

	/** The settings REST route accepts an explicitly empty override list. */
	public function test_settings_rest_can_save_an_empty_override_list(): void
	{
		$request = new WP_REST_Request( 'POST', '/vip-workflows/v1/settings/general' );
		$request->set_header( 'Content-Type', 'application/json' );
		$request->set_body( (string) wp_json_encode( array( 'bypass_workflow_roles' => array() ) ) );
		$response = rest_get_server()->dispatch( $request );
		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array(), \VIPWorkflows\Admin\Settings::get_bypass_workflow_roles() );
	}

	/** Holding an override role among several roles is enough. */
	public function test_a_user_with_multiple_roles_can_remove(): void
	{
		$post_id = $this->make_workflow_post();
		$user = get_userdata( $this->author_id );
		$user->add_role( 'administrator' );
		wp_set_current_user( $this->author_id );
		$this->assertSame( 200, $this->dispatch( 'DELETE', $post_id )->get_status() );
	}

	/** Malformed stored identity must not turn replacement into first assignment. */
	public function test_an_author_cannot_replace_a_nonnumeric_stored_identity(): void
	{
		global $wpdb;
		$post_id = $this->make_workflow_post();
		// Model older or directly imported data without the integer meta sanitizer.
		$wpdb->update( $wpdb->postmeta, array( 'meta_value' => 'missing-workflow' ), array( 'post_id' => $post_id, 'meta_key' => StatusManager::SEQUENCE_META_KEY ) );
		wp_cache_delete( $post_id, 'post_meta' );
		wp_set_current_user( $this->author_id );
		$this->assertSame( 403, $this->dispatch( 'DELETE', $post_id )->get_status() );
		$this->assertSame( 403, $this->dispatch( 'POST', $post_id, $this->other_sequence_id )->get_status() );
		$this->assertSame( 'missing-workflow', get_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, true ) );
		$this->assertSame( 'review', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
	}

	/** A zero sequence value has always meant an unassigned post. */
	public function test_zero_sequence_value_allows_first_assignment(): void
	{
		$post_id = $this->make_workflow_post();
		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, 0 );
		wp_set_current_user( $this->author_id );
		$this->assertSame( 200, $this->dispatch( 'POST', $post_id, $this->other_sequence_id )->get_status() );
	}

	/** The regular post REST endpoint cannot edit the hidden workflow meta. */
	public function test_post_rest_meta_does_not_clear_the_workflow(): void
	{
		$post_id = $this->make_workflow_post();
		wp_set_current_user( $this->author_id );
		$request = new WP_REST_Request( 'POST', '/wp/v2/posts/' . $post_id );
		$request->set_header( 'Content-Type', 'application/json' );
		$request->set_body( (string) wp_json_encode( array( 'meta' => array( StatusManager::SEQUENCE_META_KEY => 0 ) ) ) );
		rest_get_server()->dispatch( $request );
		$this->assert_workflow_intact( $post_id, $this->sequence_id );
	}

	/** Trashing and restoring keep the workflow identity. */
	public function test_trash_and_restore_keep_the_workflow(): void
	{
		$post_id = $this->make_workflow_post();
		wp_set_current_user( $this->author_id );
		wp_trash_post( $post_id );
		wp_untrash_post( $post_id );
		$this->assertSame( (string) $this->sequence_id, (string) get_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, true ) );
		$this->assertSame( 'review', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
	}

	/**
	 * The MCP execution adapter must return the refusal text to its caller.
	 *
	 * The tests environment installs the adapter as a plugin
	 * (`.wp-env.tests.json`) but never activates it, so its autoloader is
	 * loaded here from the plugins directory rather than relied on.
	 */
	public function test_mcp_execution_adapter_returns_the_author_refusal(): void
	{
		$autoload = WP_PLUGIN_DIR . '/mcp-adapter/vendor/autoload.php';
		if ( ! file_exists( $autoload ) ) {
			$this->markTestSkipped( 'The MCP adapter plugin is not installed in this environment.' );
		}
		require_once $autoload;
		$post_id = $this->make_workflow_post();
		wp_set_current_user( $this->author_id );
		$result = \WP\MCP\Abilities\ExecuteAbilityAbility::execute(
			array( 'ability_name' => 'vip-workflows/remove-from-workflow', 'parameters' => array( 'post_id' => $post_id ) )
		);
		$this->assertFalse( $result['success'] );
		$this->assertSame( self::REFUSAL, $result['error'] );
		$this->assert_workflow_intact( $post_id, $this->sequence_id );
	}

	// =========================================================================
	// The limit is checked before the target sequence's stages
	// =========================================================================

	/**
	 * A post in Pending Review, which neither test sequence has a stage for,
	 * so seating it anywhere fails the stage check with a 400.
	 *
	 * @param  bool $enrolled Whether the post already has a workflow.
	 * @return int Post ID.
	 */
	private function make_pending_post( bool $enrolled ): int
	{
		$post_id = (int) self::factory()->post->create(
			array(
				'post_status' => 'pending',
				'post_author' => $this->author_id,
			)
		);

		if ( $enrolled ) {
			update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $this->sequence_id );
			update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'review' );
		}

		return $post_id;
	}

	/**
	 * An author replacing an enrolled post's workflow with one that has no
	 * stage for the post gets the 403 naming who to ask, not the 400 about
	 * the stage: fixing the stage would only lead to the same refusal.
	 */
	public function test_an_author_replacing_with_an_unseatable_sequence_gets_the_403(): void
	{
		$post_id = $this->make_pending_post( true );
		wp_set_current_user( $this->author_id );

		$response = $this->dispatch( 'POST', $post_id, $this->other_sequence_id );

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( 'vip_workflows_removal_restricted', $response->get_data()['code'] );
		$this->assertSame( self::REFUSAL, $response->get_data()['message'] );
		$this->assertSame( (string) $this->sequence_id, (string) get_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, true ) );
		$this->assertSame( 'review', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
	}

	/**
	 * The same request from an override user gets past the limit and is
	 * refused by the stage check, which is the answer that helps them.
	 */
	public function test_an_override_user_replacing_with_an_unseatable_sequence_gets_the_400(): void
	{
		$post_id = $this->make_pending_post( true );

		$response = $this->dispatch( 'POST', $post_id, $this->other_sequence_id );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'unmodeled_post_status', $response->get_data()['code'] );
		$this->assertSame( (string) $this->sequence_id, (string) get_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, true ) );
		$this->assertSame( 0, $this->count_events( $post_id, 'workflow.assigned' ) );
	}

	/**
	 * A first assignment is not limited, so an author giving an unassigned
	 * post a sequence with no stage for it still gets the stage check's 400.
	 */
	public function test_a_first_assignment_of_an_unseatable_sequence_gets_the_400(): void
	{
		$post_id = $this->make_pending_post( false );
		wp_set_current_user( $this->author_id );

		$response = $this->dispatch( 'POST', $post_id, $this->sequence_id );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'unmodeled_post_status', $response->get_data()['code'] );
		$this->assertSame( '', get_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, true ) );
	}

	/**
	 * An author naming a sequence that does not exist, for an enrolled post,
	 * also gets the 403 rather than the generic 400.
	 */
	public function test_an_author_replacing_with_a_missing_sequence_gets_the_403(): void
	{
		$post_id = $this->make_workflow_post();
		wp_set_current_user( $this->author_id );

		$response = $this->dispatch( 'POST', $post_id, 999999 );

		$this->assertSame( 403, $response->get_status() );
		$this->assert_workflow_intact( $post_id, $this->sequence_id );
	}

	/** A numeric identity whose sequence row is missing cannot be replaced. */
	public function test_an_author_cannot_replace_a_deleted_workflow(): void
	{
		global $wpdb;
		$post_id = $this->make_workflow_post();
		$wpdb->delete( Schema::get_table_name( 'sequences' ), array( 'id' => $this->sequence_id ), array( '%d' ) );
		wp_cache_flush();
		wp_set_current_user( $this->author_id );
		$this->assertSame( 403, $this->dispatch( 'POST', $post_id, $this->other_sequence_id )->get_status() );
		$this->assert_workflow_intact( $post_id, $this->sequence_id );
	}
}
