<?php
/**
 * Integration coverage for transition rules on core status changes.
 *
 * A core status change on a workflow post (the Publish panel, Quick Edit, Bulk
 * Edit, REST, XML-RPC, a plugin calling wp_update_post()) reseats the post at
 * the target region's entry stage. That reseat is the same move as the
 * transition between the two stages, so a non-override user may make the
 * status change only when they could take that transition: the edge exists,
 * it is routed when the stage is an AI stage, their role is allowed, and it
 * needs no required tools or inputs. These tests run against real WordPress
 * with real roles, real REST dispatch and the real save hooks.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use ReflectionProperty;
use VIPWorkflows\Plugin;
use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Workflow\StatusManager;

/**
 * Core status changes are held to the reseat transition's rules.
 */
class CoreStatusChangeRulesTest extends TestCase
{

	/**
	 * Administrator (in the override roles by default).
	 *
	 * @var int
	 */
	private int $admin_id;

	/**
	 * Author.
	 *
	 * @var int
	 */
	private int $author_id;

	/**
	 * Contributor.
	 *
	 * @var int
	 */
	private int $contributor_id;

	/**
	 * Settings served in place of the stored option, or null for the stored one.
	 *
	 * @var array|null
	 */
	private ?array $settings = null;

	public function set_up(): void
	{
		parent::set_up();

		$this->admin_id       = (int) self::factory()->user->create( array( 'role' => 'administrator' ) );
		$this->author_id      = (int) self::factory()->user->create(
			array(
				'role'       => 'author',
				'user_login' => 'rules_author',
				'user_pass'  => 'rules-author-pass',
			)
		);
		$this->contributor_id = (int) self::factory()->user->create(
			array(
				'role'       => 'contributor',
				'user_login' => 'rules_contributor',
				'user_pass'  => 'rules-contributor-pass',
			)
		);

		add_filter(
			'pre_option_vip_workflows_settings',
			function ( $value ) {
				return null === $this->settings ? $value : $this->settings;
			}
		);
	}

	public function tear_down(): void
	{
		$property = new ReflectionProperty( StatusManager::class, 'transition_in_progress' );
		$property->setValue( null, array() );

		wp_set_current_user( 0 );

		parent::tear_down();
	}

	// =========================================================================
	// Fixtures
	// =========================================================================

	/**
	 * The status manager the plugin's hooks use.
	 *
	 * @return StatusManager
	 */
	private function status_manager(): StatusManager
	{
		return Plugin::get_instance()->get_status_manager();
	}

	/**
	 * Create the test sequence.
	 *
	 * Draft A (draft, entry) → Review (pending, entry) → Legal (pending) →
	 * Published (publish, entry). Draft A → Review is limited to authors;
	 * Review → Draft A to editors. Legal has no edge back to Draft A.
	 *
	 * @param  array $draft_to_review Extra keys for the Draft A → Review edge.
	 * @param  array $draft_a_extra   Extra keys for the Draft A stage (an agent block, say).
	 * @return int Sequence ID.
	 */
	private function create_sequence( array $draft_to_review = array(), array $draft_a_extra = array() ): int
	{
		return (int) ( new SequenceRepository() )->create(
			'Rules Flow',
			'rules-flow-' . wp_generate_password( 6, false ),
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array_merge(
						array(
							'key'          => 'draft_a',
							'label'        => 'Draft A',
							'status'       => 'draft',
							'region_entry' => true,
							'transitions'  => array(
								array_merge(
									array(
										'to'            => 'review',
										'allowed_roles' => array( 'author' ),
									),
									$draft_to_review
								),
								array( 'to' => 'draft_b' ),
							),
						),
						$draft_a_extra
					),
					array(
						'key'         => 'draft_b',
						'label'       => 'Draft B',
						'status'      => 'draft',
						'transitions' => array( array( 'to' => 'review' ) ),
					),
					array(
						'key'          => 'review',
						'label'        => 'Review',
						'status'       => 'pending',
						'region_entry' => true,
						'transitions'  => array(
							array(
								'to'            => 'draft_a',
								'allowed_roles' => array( 'editor' ),
							),
							array( 'to' => 'legal' ),
						),
					),
					array(
						'key'         => 'legal',
						'label'       => 'Legal',
						'status'      => 'pending',
						'transitions' => array( array( 'to' => 'published' ) ),
					),
					array(
						'key'          => 'published',
						'label'        => 'Published',
						'status'       => 'publish',
						'region_entry' => true,
						'transitions'  => array(),
					),
				),
			),
			$this->admin_id
		);
	}

	/**
	 * Create a post seated at a stage.
	 *
	 * @param  int    $sequence_id Sequence ID.
	 * @param  string $stage       Stage key.
	 * @param  string $post_status Committed post_status.
	 * @param  int    $author      Post author (defaults to the contributor).
	 * @return int Post ID.
	 */
	private function make_post( int $sequence_id, string $stage, string $post_status = 'draft', int $author = 0 ): int
	{
		$post_id = (int) self::factory()->post->create(
			array(
				'post_status'  => $post_status,
				'post_author'  => $author ? $author : $this->contributor_id,
				'post_title'   => 'Rules Post',
				'post_content' => 'Original content.',
			)
		);

		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, $stage );

		return $post_id;
	}

	/**
	 * Stage the post is seated at.
	 *
	 * @param  int $post_id Post ID.
	 * @return string
	 */
	private function stage_of( int $post_id ): string
	{
		return (string) get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true );
	}

	/**
	 * Update a post over REST as the current user.
	 *
	 * @param  int   $post_id Post ID.
	 * @param  array $params  Body params.
	 * @return \WP_REST_Response
	 */
	private function rest_update( int $post_id, array $params ): \WP_REST_Response
	{
		$request = new \WP_REST_Request( 'POST', "/wp/v2/posts/{$post_id}" );
		foreach ( $params as $key => $value ) {
			$request->set_param( $key, $value );
		}

		return rest_do_request( $request );
	}

	/**
	 * Ask the predicate directly.
	 *
	 * @param  int    $post_id       Post ID.
	 * @param  string $target_status Target status.
	 * @param  int    $user_id       User.
	 * @return \WP_Error|null
	 */
	private function refusal( int $post_id, string $target_status, int $user_id ): ?\WP_Error
	{
		return $this->status_manager()->core_status_change_refusal( $post_id, $target_status, $user_id );
	}

	// =========================================================================
	// The predicate
	// =========================================================================

	public function test_allows_a_status_change_whose_transition_the_user_can_take(): void
	{
		$post_id = $this->make_post( $this->create_sequence(), 'draft_a', 'draft', $this->author_id );

		$this->assertNull( $this->refusal( $post_id, 'pending', $this->author_id ) );
	}

	public function test_refuses_a_role_the_transition_does_not_allow(): void
	{
		$post_id = $this->make_post( $this->create_sequence(), 'draft_a' );

		$refusal = $this->refusal( $post_id, 'pending', $this->contributor_id );

		$this->assertInstanceOf( \WP_Error::class, $refusal );
		$this->assertSame( 'vip_workflows_status_change_rules', $refusal->get_error_code() );
		$this->assertSame( 403, $refusal->get_error_data()['status'] );
		$this->assertSame( 'role', $refusal->get_error_data()['check'] );
		$this->assertSame( 'draft_a', $refusal->get_error_data()['from_stage'] );
		$this->assertSame( 'review', $refusal->get_error_data()['to_stage'] );
		$this->assertSame(
			'“Rules Post” is in the “Rules Flow” workflow, and this status change would move it to “Review”. You can’t make that move from here. Use the workflow panel instead.',
			$refusal->get_error_message()
		);
	}

	public function test_refuses_a_move_with_no_edge(): void
	{
		$post_id = $this->make_post( $this->create_sequence(), 'legal', 'pending', $this->author_id );

		$refusal = $this->refusal( $post_id, 'draft', $this->author_id );

		$this->assertInstanceOf( \WP_Error::class, $refusal );
		$this->assertSame( 'edge', $refusal->get_error_data()['check'] );
	}

	public function test_refuses_an_edge_with_required_tools_unless_the_user_skips_tool_checks(): void
	{
		$post_id = $this->make_post(
			$this->create_sequence( array( 'required_tools' => array( 'vip-workflows/seo-check' ) ) ),
			'draft_a',
			'draft',
			$this->author_id
		);

		$refusal = $this->refusal( $post_id, 'pending', $this->author_id );
		$this->assertInstanceOf( \WP_Error::class, $refusal );
		$this->assertSame( 'tools', $refusal->get_error_data()['check'] );

		$this->settings = array( 'bypass_tool_check_roles' => array( 'administrator', 'author' ) );

		$this->assertNull( $this->refusal( $post_id, 'pending', $this->author_id ) );
	}

	public function test_refuses_an_edge_with_a_required_input(): void
	{
		$post_id = $this->make_post(
			$this->create_sequence(
				array(
					'inputs' => array(
						array(
							'type'          => 'assignment',
							'meta_key'      => 'reviewer',
							'assignee_type' => 'user',
							'label'         => 'Reviewer',
							'required'      => true,
						),
					),
				)
			),
			'draft_a',
			'draft',
			$this->author_id
		);

		$refusal = $this->refusal( $post_id, 'pending', $this->author_id );

		$this->assertInstanceOf( \WP_Error::class, $refusal );
		$this->assertSame( 'inputs', $refusal->get_error_data()['check'] );
	}

	public function test_refuses_an_unrouted_exit_from_an_ai_stage(): void
	{
		$post_id = $this->make_post(
			$this->create_sequence(
				array(),
				array(
					'agent' => array(
						'ability_id' => 'vip-workflows/test-agent',
						'routing'    => array(
							'pass'  => 'draft_b',
							'fail'  => 'draft_b',
							'error' => 'draft_b',
						),
					),
				)
			),
			'draft_a',
			'draft',
			$this->author_id
		);

		$refusal = $this->refusal( $post_id, 'pending', $this->author_id );

		$this->assertInstanceOf( \WP_Error::class, $refusal );
		$this->assertSame( 'routing', $refusal->get_error_data()['check'] );
	}

	public function test_checks_nothing_for_a_region_the_sequence_does_not_model(): void
	{
		$post_id = $this->make_post( $this->create_sequence(), 'draft_a' );

		$this->assertNull( $this->refusal( $post_id, 'private', $this->contributor_id ) );
	}

	public function test_checks_nothing_for_the_region_the_stage_already_lives_in(): void
	{
		$post_id = $this->make_post( $this->create_sequence(), 'draft_b' );

		$this->assertNull( $this->refusal( $post_id, 'draft', $this->contributor_id ) );
	}

	public function test_override_roles_and_userless_writes_are_never_refused(): void
	{
		$sequence_id = $this->create_sequence( array( 'required_tools' => array( 'vip-workflows/seo-check' ) ) );

		$this->settings = array( 'bypass_tool_check_roles' => array() );

		$at_draft = $this->make_post( $sequence_id, 'draft_a' );
		$at_legal = $this->make_post( $sequence_id, 'legal', 'pending' );

		$this->assertNotNull( $this->refusal( $at_draft, 'pending', $this->contributor_id ), 'precondition: refused for the contributor' );
		$this->assertNull( $this->refusal( $at_draft, 'pending', $this->admin_id ) );
		$this->assertNull( $this->refusal( $at_legal, 'draft', $this->admin_id ) );
		$this->assertNull( $this->refusal( $at_draft, 'pending', 0 ) );
	}

	public function test_unmanaged_and_broken_stage_posts_are_not_checked(): void
	{
		$unmanaged = (int) self::factory()->post->create( array( 'post_author' => $this->contributor_id ) );
		$broken    = $this->make_post( $this->create_sequence(), 'no_such_stage' );

		$this->assertNull( $this->refusal( $unmanaged, 'pending', $this->contributor_id ) );
		$this->assertNull( $this->refusal( $broken, 'pending', $this->contributor_id ) );
	}

	// =========================================================================
	// The save layer
	// =========================================================================

	public function test_rest_refuses_the_status_change_with_a_403_and_moves_nothing(): void
	{
		$post_id = $this->make_post( $this->create_sequence(), 'draft_a' );
		$history = $this->status_manager()->count_transition_history( $post_id );
		wp_set_current_user( $this->contributor_id );

		$response = $this->rest_update( $post_id, array( 'status' => 'pending' ) );

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( 'vip_workflows_status_change_rules', $response->get_data()['code'] );
		$this->assertStringContainsString( 'would move it to “Review”', $response->get_data()['message'] );
		$this->assertSame( 'draft', get_post_status( $post_id ) );
		$this->assertSame( 'draft_a', $this->stage_of( $post_id ) );
		$this->assertSame( $history, $this->status_manager()->count_transition_history( $post_id ), 'no reseat was recorded' );
	}

	public function test_rest_allows_a_status_change_the_user_could_take_and_reseats(): void
	{
		$post_id = $this->make_post( $this->create_sequence(), 'draft_a', 'draft', $this->author_id );
		$history = $this->status_manager()->count_transition_history( $post_id );
		wp_set_current_user( $this->author_id );

		$response = $this->rest_update( $post_id, array( 'status' => 'pending' ) );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'pending', get_post_status( $post_id ) );
		$this->assertSame( 'review', $this->stage_of( $post_id ) );
		$this->assertSame( $history + 1, $this->status_manager()->count_transition_history( $post_id ) );
	}

	public function test_wp_update_post_reverts_only_the_status(): void
	{
		$post_id = $this->make_post( $this->create_sequence(), 'draft_a' );
		wp_set_current_user( $this->contributor_id );

		wp_update_post(
			array(
				'ID'           => $post_id,
				'post_status'  => 'pending',
				'post_content' => 'Changed content.',
			)
		);

		$this->assertSame( 'draft', get_post_status( $post_id ) );
		$this->assertSame( 'draft_a', $this->stage_of( $post_id ) );
		$this->assertSame( 'Changed content.', get_post_field( 'post_content', $post_id ) );
	}

	public function test_bulk_edit_reverts_each_refused_post(): void
	{
		include_once ABSPATH . 'wp-admin/includes/post.php';

		$sequence_id = $this->create_sequence();
		$first       = $this->make_post( $sequence_id, 'draft_a' );
		$second      = $this->make_post( $sequence_id, 'draft_a' );
		wp_set_current_user( $this->contributor_id );

		bulk_edit_posts(
			array(
				'post_type' => 'post',
				'post'      => array( $first, $second ),
				'_status'   => 'pending',
			)
		);

		foreach ( array( $first, $second ) as $post_id ) {
			$this->assertSame( 'draft', get_post_status( $post_id ) );
			$this->assertSame( 'draft_a', $this->stage_of( $post_id ) );
		}
	}

	public function test_xmlrpc_edit_post_leaves_the_status_unchanged(): void
	{
		include_once ABSPATH . 'wp-admin/includes/admin.php';
		include_once ABSPATH . WPINC . '/class-IXR.php';
		include_once ABSPATH . WPINC . '/class-wp-xmlrpc-server.php';

		add_filter( 'xmlrpc_enabled', '__return_true' );

		$post_id = $this->make_post( $this->create_sequence(), 'draft_a' );

		$server = new \wp_xmlrpc_server();
		$result = $server->wp_editPost(
			array(
				1,
				'rules_contributor',
				'rules-contributor-pass',
				$post_id,
				array( 'post_status' => 'pending' ),
			)
		);

		$this->assertNotInstanceOf( \IXR_Error::class, $result );
		$this->assertSame( 'draft', get_post_status( $post_id ) );
		$this->assertSame( 'draft_a', $this->stage_of( $post_id ) );
	}

	/**
	 * Restore a post with wp_untrash_post(), with the restore status filtered.
	 *
	 * @param  int    $post_id  Post ID.
	 * @param  string $status   Status the `wp_untrash_post_status` filter returns.
	 * @param  int    $priority Filter priority.
	 * @return mixed What wp_untrash_post() returned.
	 */
	private function untrash_to( int $post_id, string $status, int $priority = 10 )
	{
		$restore_to = static function () use ( $status ) {
			return $status;
		};
		add_filter( 'wp_untrash_post_status', $restore_to, $priority );
		try {
			return wp_untrash_post( $post_id );
		} finally {
			remove_filter( 'wp_untrash_post_status', $restore_to, $priority );
		}
	}

	/**
	 * Assert the post is still in the Trash, at its stage, with core's Trash bookkeeping intact.
	 *
	 * @param int    $post_id Post ID.
	 * @param string $stage   Stage it should still be seated at.
	 * @param string $trashed_from Status it was trashed from.
	 */
	private function assert_still_in_the_trash( int $post_id, string $stage, string $trashed_from = 'draft' ): void
	{
		$this->assertSame( 'trash', get_post_status( $post_id ) );
		$this->assertSame( $stage, $this->stage_of( $post_id ) );
		$this->assertSame( $trashed_from, get_post_meta( $post_id, '_wp_trash_meta_status', true ) );
		$this->assertTrue( metadata_exists( 'post', $post_id, '_wp_trash_meta_time' ) );
	}

	public function test_restoring_from_the_trash_is_not_refused(): void
	{
		$post_id = $this->make_post( $this->create_sequence(), 'review', 'pending' );

		wp_set_current_user( $this->admin_id );
		wp_trash_post( $post_id );
		$this->assertSame( 'review', $this->stage_of( $post_id ), 'precondition: trashing leaves the stage' );

		// Untrashing restores to `draft` by default, which reseats Review →
		// Draft A, an edge only editors may take. Leaving the Trash for draft
		// is never refused.
		wp_set_current_user( $this->contributor_id );
		$result = wp_untrash_post( $post_id );

		$this->assertInstanceOf( \WP_Post::class, $result );
		$this->assertSame( 'draft', get_post_status( $post_id ) );
		$this->assertSame( 'draft_a', $this->stage_of( $post_id ) );
	}

	public function test_writing_draft_to_a_trashed_post_keeps_a_draft_region_stage(): void
	{
		$post_id = $this->make_post( $this->create_sequence(), 'draft_b' );
		wp_set_current_user( $this->contributor_id );
		wp_trash_post( $post_id );

		// The block editor and the DataView restore by writing draft over REST.
		$response = $this->rest_update( $post_id, array( 'status' => 'draft' ) );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'draft', get_post_status( $post_id ) );
		$this->assertSame( 'draft_b', $this->stage_of( $post_id ), 'a stage already in the draft region stays' );
	}

	public function test_a_filtered_restore_the_user_could_not_make_is_refused_before_anything_changes(): void
	{
		$post_id = $this->make_post( $this->create_sequence(), 'draft_a' );
		wp_set_current_user( $this->contributor_id );
		wp_trash_post( $post_id );
		$history = $this->status_manager()->count_transition_history( $post_id );

		// A site that restores to `pending`: Draft A → Review is an edge the
		// contributor can't take.
		$result = $this->untrash_to( $post_id, 'pending' );

		$this->assertFalse( $result );
		$this->assert_still_in_the_trash( $post_id, 'draft_a' );
		$this->assertSame( $history, $this->status_manager()->count_transition_history( $post_id ) );

		// A retry is refused the same way.
		$this->assertFalse( $this->untrash_to( $post_id, 'pending' ) );
		$this->assert_still_in_the_trash( $post_id, 'draft_a' );

		// Someone who can make the move restores it.
		wp_set_current_user( $this->author_id );
		$result = $this->untrash_to( $post_id, 'pending' );

		$this->assertInstanceOf( \WP_Post::class, $result );
		$this->assertSame( 'pending', get_post_status( $post_id ) );
		$this->assertSame( 'review', $this->stage_of( $post_id ) );
		$this->assertFalse( metadata_exists( 'post', $post_id, '_wp_trash_meta_status' ) );
	}

	public function test_a_restore_status_filter_registered_last_is_still_checked(): void
	{
		$post_id = $this->make_post( $this->create_sequence(), 'draft_a' );
		wp_set_current_user( $this->contributor_id );
		wp_trash_post( $post_id );

		// Registered after the plugin's hooks, at the latest priority: the
		// check runs the whole filter, so it sees this callback's answer.
		$this->assertFalse( $this->untrash_to( $post_id, 'pending', PHP_INT_MAX ) );
		$this->assert_still_in_the_trash( $post_id, 'draft_a' );

		$this->assertInstanceOf( \WP_Post::class, $this->untrash_to( $post_id, 'draft', PHP_INT_MAX ) );
		$this->assertSame( 'draft', get_post_status( $post_id ) );
	}

	public function test_a_restore_to_publish_the_user_could_not_make_is_refused_before_anything_changes(): void
	{
		$sequence_id = $this->create_sequence();
		$post_id     = $this->make_post( $sequence_id, 'draft_a', 'draft', $this->author_id );
		wp_set_current_user( $this->author_id );
		wp_trash_post( $post_id );

		$this->assertFalse( $this->untrash_to( $post_id, 'publish' ) );
		$this->assert_still_in_the_trash( $post_id, 'draft_a' );
	}

	public function test_a_previous_status_restore_the_user_can_make_is_not_refused(): void
	{
		// What the list table's "Undo" after Trash does. Review is already in
		// the pending region, so nothing reseats.
		$post_id = $this->make_post( $this->create_sequence(), 'review', 'pending' );
		wp_set_current_user( $this->contributor_id );
		wp_trash_post( $post_id );

		add_filter( 'wp_untrash_post_status', 'wp_untrash_post_set_previous_status', 10, 3 );
		try {
			$result = wp_untrash_post( $post_id );
		} finally {
			remove_filter( 'wp_untrash_post_status', 'wp_untrash_post_set_previous_status', 10 );
		}

		$this->assertInstanceOf( \WP_Post::class, $result );
		$this->assertSame( 'pending', get_post_status( $post_id ) );
		$this->assertSame( 'review', $this->stage_of( $post_id ) );
		$this->assertFalse( metadata_exists( 'post', $post_id, '_wp_trash_meta_status' ) );
	}

	public function test_a_previous_status_restore_the_user_could_not_make_is_refused(): void
	{
		// Status and stage disagree: the post is `pending` but seated at Draft A,
		// so restoring its previous status would reseat Draft A → Review.
		$post_id = $this->make_post( $this->create_sequence(), 'draft_a', 'pending' );
		wp_set_current_user( $this->contributor_id );
		wp_trash_post( $post_id );

		add_filter( 'wp_untrash_post_status', 'wp_untrash_post_set_previous_status', 10, 3 );
		try {
			$result = wp_untrash_post( $post_id );
		} finally {
			remove_filter( 'wp_untrash_post_status', 'wp_untrash_post_set_previous_status', 10 );
		}

		$this->assertFalse( $result );
		$this->assert_still_in_the_trash( $post_id, 'draft_a', 'pending' );
	}

	public function test_a_content_write_during_a_restore_does_not_stop_it(): void
	{
		$post_id = $this->make_post( $this->create_sequence(), 'draft_a', 'draft', $this->author_id );
		wp_set_current_user( $this->author_id );
		wp_trash_post( $post_id );
		// A callback saves the title while core is part-way through the restore.
		$update_title = static function ( $meta_ids, $object_id, $meta_key ) use ( $post_id ) {
			if ( $post_id === (int) $object_id && '_wp_trash_meta_time' === $meta_key ) {
				wp_update_post(
					array(
						'ID'         => $post_id,
						'post_title' => 'Updated title',
					)
				);
			}
		};
		add_action( 'deleted_post_meta', $update_title, 20, 3 );
		try {
			$result = $this->untrash_to( $post_id, 'pending' );
		} finally {
			remove_action( 'deleted_post_meta', $update_title, 20 );
		}

		$this->assertInstanceOf( \WP_Post::class, $result );
		$this->assertSame( 'Updated title', get_the_title( $post_id ) );
		$this->assertSame( 'pending', get_post_status( $post_id ) );
		$this->assertSame( 'review', $this->stage_of( $post_id ) );
	}

	public function test_a_status_write_from_a_restore_callback_is_held_to_the_rules(): void
	{
		$post_id = $this->make_post( $this->create_sequence(), 'draft_a' );
		wp_set_current_user( $this->contributor_id );
		wp_trash_post( $post_id );
		// A callback writes `pending` while core restores to `draft`.
		$write_pending = static function ( $restoring_id ) use ( $post_id ) {
			if ( $post_id === (int) $restoring_id ) {
				wp_update_post(
					array(
						'ID'          => $post_id,
						'post_status' => 'pending',
					)
				);
			}
		};
		add_action( 'untrash_post', $write_pending );
		try {
			$result = wp_untrash_post( $post_id );
		} finally {
			remove_action( 'untrash_post', $write_pending );
		}

		// The callback's write out of the Trash is refused; core's own restore
		// to draft lands.
		$this->assertInstanceOf( \WP_Post::class, $result );
		$this->assertSame( 'draft', get_post_status( $post_id ) );
		$this->assertSame( 'draft_a', $this->stage_of( $post_id ) );
	}

	public function test_a_late_filter_cancelling_a_restore_leaves_the_post_in_the_trash(): void
	{
		$post_id = $this->make_post( $this->create_sequence(), 'draft_a' );
		wp_set_current_user( $this->contributor_id );
		wp_trash_post( $post_id );

		// The plugin allows the default restore; a later callback cancels it.
		$cancel = static function () {
			return false;
		};
		add_filter( 'pre_untrash_post', $cancel, PHP_INT_MAX );
		try {
			$result = wp_untrash_post( $post_id );
		} finally {
			remove_filter( 'pre_untrash_post', $cancel, PHP_INT_MAX );
		}

		$this->assertFalse( $result );
		$this->assert_still_in_the_trash( $post_id, 'draft_a' );

		// Nothing is left over: the next restore and the next direct write
		// are decided on their own.
		$response = $this->rest_update( $post_id, array( 'status' => 'pending' ) );
		$this->assertSame( 403, $response->get_status() );
		$this->assert_still_in_the_trash( $post_id, 'draft_a' );

		$this->assertInstanceOf( \WP_Post::class, wp_untrash_post( $post_id ) );
		$this->assertSame( 'draft', get_post_status( $post_id ) );
	}

	public function test_retrying_a_restore_after_a_failed_write_completes(): void
	{
		$post_id = $this->make_post( $this->create_sequence(), 'draft_a', 'draft', $this->author_id );
		wp_set_current_user( $this->author_id );
		wp_trash_post( $post_id );
		$refuse_insert = static function ( $is_empty, $postarr ) use ( $post_id ) {
			return (int) ( $postarr['ID'] ?? 0 ) === $post_id ? true : $is_empty;
		};
		add_filter( 'wp_insert_post_empty_content', $refuse_insert, 10, 2 );
		try {
			// Core has deleted its Trash bookkeeping by the time the write fails.
			$first = $this->untrash_to( $post_id, 'pending' );
		} finally {
			remove_filter( 'wp_insert_post_empty_content', $refuse_insert, 10 );
		}
		$this->assertFalse( $first, 'precondition: the first restore write failed' );
		$this->assertSame( 'trash', get_post_status( $post_id ) );
		$this->assertFalse( metadata_exists( 'post', $post_id, '_wp_trash_meta_time' ) );

		$retry = $this->untrash_to( $post_id, 'pending' );

		$this->assertInstanceOf( \WP_Post::class, $retry );
		$this->assertSame( 'pending', get_post_status( $post_id ) );
		$this->assertSame( 'review', $this->stage_of( $post_id ) );
	}

	public function test_writing_pending_to_a_trashed_post_is_held_to_the_rules(): void
	{
		$post_id = $this->make_post( $this->create_sequence(), 'draft_a' );

		wp_set_current_user( $this->contributor_id );
		wp_trash_post( $post_id );
		$this->assertSame( 'trash', get_post_status( $post_id ), 'precondition: the contributor may trash their own draft' );
		$this->assertSame( array( 'pending' ), $this->status_manager()->refused_status_regions( $post_id, $this->contributor_id ), 'the payload refuses what the save layer refuses, and never draft' );
		$history = $this->status_manager()->count_transition_history( $post_id );

		$response = $this->rest_update( $post_id, array( 'status' => 'pending' ) );

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( 'vip_workflows_status_change_rules', $response->get_data()['code'] );
		$this->assert_still_in_the_trash( $post_id, 'draft_a' );
		$this->assertSame( $history, $this->status_manager()->count_transition_history( $post_id ) );

		wp_update_post(
			array(
				'ID'          => $post_id,
				'post_status' => 'pending',
			)
		);
		$this->assert_still_in_the_trash( $post_id, 'draft_a' );
	}

	public function test_writing_pending_to_a_trashed_post_is_allowed_when_the_user_can_make_the_move(): void
	{
		$post_id = $this->make_post( $this->create_sequence(), 'draft_a', 'draft', $this->author_id );

		wp_set_current_user( $this->author_id );
		wp_trash_post( $post_id );
		$this->assertSame( array(), $this->status_manager()->refused_status_regions( $post_id, $this->author_id ) );

		$response = $this->rest_update( $post_id, array( 'status' => 'pending' ) );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'pending', get_post_status( $post_id ) );
		$this->assertSame( 'review', $this->stage_of( $post_id ) );
	}

	public function test_removing_trash_time_outside_a_restore_changes_nothing(): void
	{
		$post_id = $this->make_post( $this->create_sequence(), 'draft_a' );
		wp_set_current_user( $this->contributor_id );
		wp_trash_post( $post_id );

		delete_post_meta( $post_id, '_wp_trash_meta_time' );
		wp_update_post(
			array(
				'ID'          => $post_id,
				'post_status' => 'pending',
			)
		);

		$this->assertSame( 'trash', get_post_status( $post_id ) );
		$this->assertSame( 'draft_a', $this->stage_of( $post_id ) );
	}

	public function test_a_status_change_after_a_restore_is_held_to_the_rules(): void
	{
		$post_id = $this->make_post( $this->create_sequence(), 'draft_a' );
		wp_set_current_user( $this->contributor_id );
		wp_trash_post( $post_id );
		wp_untrash_post( $post_id );
		$this->assertSame( 'draft', get_post_status( $post_id ), 'precondition: default restore to draft' );
		$history = $this->status_manager()->count_transition_history( $post_id );

		// The post is out of the Trash, so the exemption is over.
		$response = $this->rest_update( $post_id, array( 'status' => 'pending' ) );

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( 'vip_workflows_status_change_rules', $response->get_data()['code'] );
		$this->assertSame( 'draft', get_post_status( $post_id ) );
		$this->assertSame( 'draft_a', $this->stage_of( $post_id ) );
		$this->assertSame( $history, $this->status_manager()->count_transition_history( $post_id ), 'no reseat was recorded' );

		wp_update_post(
			array(
				'ID'          => $post_id,
				'post_status' => 'pending',
			)
		);

		$this->assertSame( 'draft', get_post_status( $post_id ) );
		$this->assertSame( 'draft_a', $this->stage_of( $post_id ) );
	}

	public function test_a_private_region_restore_is_held_to_the_rules(): void
	{
		$repository  = new SequenceRepository();
		$sequence_id = $this->create_sequence();
		$config      = $repository->find( $sequence_id )->config;
		foreach ( $config['statuses'] as &$stage ) {
			if ( in_array( $stage['key'], array( 'review', 'legal' ), true ) ) {
				$stage['status'] = 'private';
			}
		}
		unset( $stage );
		$repository->update( $sequence_id, array( 'config' => $config ) );
		$post_id = $this->make_post( $sequence_id, 'draft_a' );
		wp_set_current_user( $this->contributor_id );
		$this->assertNotNull( $this->refusal( $post_id, 'private', $this->contributor_id ) );
		wp_trash_post( $post_id );
		$this->assertSame( array( 'private' ), $this->status_manager()->refused_status_regions( $post_id, $this->contributor_id ) );

		$this->assertFalse( $this->untrash_to( $post_id, 'private', PHP_INT_MAX ) );
		$this->assert_still_in_the_trash( $post_id, 'draft_a' );

		wp_set_current_user( $this->admin_id );
		$this->assertInstanceOf( \WP_Post::class, $this->untrash_to( $post_id, 'private', PHP_INT_MAX ) );
		$this->assertSame( 'private', get_post_status( $post_id ) );
		$this->assertSame( 'review', $this->stage_of( $post_id ) );
	}

	public function test_retry_after_a_late_restore_abort_has_no_stale_exemption(): void
	{
		$post_id = $this->make_post( $this->create_sequence(), 'draft_a' );
		wp_set_current_user( $this->contributor_id );
		wp_trash_post( $post_id );
		$refuse_insert = static function ( $is_empty, $postarr ) use ( $post_id ) {
			return (int) ( $postarr['ID'] ?? 0 ) === $post_id ? true : $is_empty;
		};
		add_filter( 'wp_insert_post_empty_content', $refuse_insert, PHP_INT_MAX, 2 );
		try {
			$this->assertFalse( wp_untrash_post( $post_id ) );
		} finally {
			remove_filter( 'wp_insert_post_empty_content', $refuse_insert, PHP_INT_MAX );
		}
		$this->assertSame( 'trash', get_post_status( $post_id ) );
		$this->assertFalse( metadata_exists( 'post', $post_id, '_wp_trash_meta_time' ) );
		$this->assertInstanceOf( \WP_Post::class, wp_untrash_post( $post_id ) );
		$this->assertSame( 'draft', get_post_status( $post_id ) );
		$response = $this->rest_update( $post_id, array( 'status' => 'pending' ) );
		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( 'draft', get_post_status( $post_id ) );
		$this->assertSame( 'draft_a', $this->stage_of( $post_id ) );
	}

	public function test_publish_and_future_targets_from_trashed_drafts_keep_the_boundary(): void
	{
		$sequence_id = $this->create_sequence();
		foreach ( array( 'publish', 'future' ) as $target ) {
			wp_set_current_user( 0 );
			$post_id = $this->make_post( $sequence_id, 'draft_a', 'draft', $this->author_id );
			wp_set_current_user( $this->author_id );
			wp_trash_post( $post_id );
			$this->assertSame( 'trash', get_post_status( $post_id ) );
			$history = $this->status_manager()->count_transition_history( $post_id );
			$response = $this->rest_update( $post_id, array( 'status' => $target ) );
			$this->assertSame( 409, $response->get_status() );
			$this->assertSame( 'vip_workflows_publish_boundary', $response->get_data()['code'] );
			wp_update_post( array( 'ID' => $post_id, 'post_status' => $target ) );
			$this->assertSame( 'trash', get_post_status( $post_id ) );
			$this->assertSame( 'draft_a', $this->stage_of( $post_id ) );
			$this->assertSame( $history, $this->status_manager()->count_transition_history( $post_id ) );
		}
	}

	public function test_draft_writes_out_of_trash_keep_or_reseat_the_stage_on_each_path(): void
	{
		$sequence_id = $this->create_sequence();
		foreach ( array( 'draft_b' => 'draft', 'legal' => 'pending', 'published' => 'publish' ) as $stage => $status ) {
			foreach ( array( 'untrash', 'rest', 'update' ) as $path ) {
				wp_set_current_user( 0 );
				$post_id = $this->make_post( $sequence_id, $stage, $status, $this->author_id );
				wp_set_current_user( $this->author_id );
				wp_trash_post( $post_id );
				$this->assertSame( 'trash', get_post_status( $post_id ) );
				if ( 'untrash' === $path ) {
					$this->assertInstanceOf( \WP_Post::class, wp_untrash_post( $post_id ) );
				} elseif ( 'rest' === $path ) {
					$this->assertSame( 200, $this->rest_update( $post_id, array( 'status' => 'draft' ) )->get_status() );
				} else {
					$this->assertSame( $post_id, wp_update_post( array( 'ID' => $post_id, 'post_status' => 'draft' ) ) );
				}
				$this->assertSame( 'draft', get_post_status( $post_id ), $stage . ': ' . $path );
				$this->assertSame( 'draft_b' === $stage ? 'draft_b' : 'draft_a', $this->stage_of( $post_id ) );
			}
		}
	}

	public function test_direct_pending_rest_write_from_trash_is_refused_without_prediction(): void
	{
		$post_id = $this->make_post( $this->create_sequence(), 'draft_a' );
		wp_set_current_user( $this->contributor_id );
		wp_trash_post( $post_id );
		$before = get_post_meta( $post_id );
		$this->assertSame( 403, $this->rest_update( $post_id, array( 'status' => 'pending' ) )->get_status() );
		$this->assertSame( 'trash', get_post_status( $post_id ) );
		$this->assertSame( $before, get_post_meta( $post_id ) );
	}

	public function test_late_aborted_restore_does_not_allow_pending_while_still_trashed(): void
	{
		$post_id = $this->make_post( $this->create_sequence(), 'draft_a' );
		wp_set_current_user( $this->contributor_id );
		wp_trash_post( $post_id );
		$abort = static function ( $empty, $postarr ) use ( $post_id ) {
			return (int) ( $postarr['ID'] ?? 0 ) === $post_id ? true : $empty;
		};
		add_filter( 'wp_insert_post_empty_content', $abort, PHP_INT_MAX, 2 );
		try {
			$this->assertFalse( wp_untrash_post( $post_id ) );
		} finally {
			remove_filter( 'wp_insert_post_empty_content', $abort, PHP_INT_MAX );
		}
		$this->assertSame( 'trash', get_post_status( $post_id ) );
		$this->assertSame( 403, $this->rest_update( $post_id, array( 'status' => 'pending' ) )->get_status() );
		$this->assertSame( 'trash', get_post_status( $post_id ) );
		$this->assertSame( 'draft_a', $this->stage_of( $post_id ) );
	}

	public function test_cron_and_userless_writes_are_not_refused(): void
	{
		$sequence_id = $this->create_sequence();
		$under_cron  = $this->make_post( $sequence_id, 'draft_a' );
		$userless    = $this->make_post( $sequence_id, 'draft_a' );

		wp_set_current_user( $this->contributor_id );
		add_filter( 'wp_doing_cron', '__return_true' );
		wp_update_post(
			array(
				'ID'          => $under_cron,
				'post_status' => 'pending',
			)
		);
		remove_filter( 'wp_doing_cron', '__return_true' );

		wp_set_current_user( 0 );
		wp_update_post(
			array(
				'ID'          => $userless,
				'post_status' => 'pending',
			)
		);

		$this->assertSame( 'pending', get_post_status( $under_cron ) );
		$this->assertSame( 'review', $this->stage_of( $under_cron ) );
		$this->assertSame( 'pending', get_post_status( $userless ) );
		$this->assertSame( 'review', $this->stage_of( $userless ) );
	}

	public function test_a_write_during_a_workflow_transition_is_not_refused(): void
	{
		$post_id = $this->make_post( $this->create_sequence(), 'draft_a' );

		$property = new ReflectionProperty( StatusManager::class, 'transition_in_progress' );
		$property->setValue( null, array( $post_id => true ) );

		wp_set_current_user( $this->contributor_id );
		wp_update_post(
			array(
				'ID'          => $post_id,
				'post_status' => 'pending',
			)
		);

		$this->assertSame( 'pending', get_post_status( $post_id ) );
	}

	public function test_agent_writes_are_not_refused(): void
	{
		$post_id = $this->make_post(
			$this->create_sequence(
				array(),
				array(
					'agent' => array(
						'ability_id' => 'vip-workflows/test-agent',
						'routing'    => array(
							'pass'  => 'review',
							'fail'  => 'draft_b',
							'error' => 'draft_b',
						),
					),
				)
			),
			'draft_a'
		);

		// A stage agent acting for the contributor writes content, not status.
		wp_set_current_user( $this->contributor_id );
		wp_update_post(
			array(
				'ID'           => $post_id,
				'post_content' => 'Agent content.',
			)
		);
		$this->assertSame( 'Agent content.', get_post_field( 'post_content', $post_id ) );

		// Its exit goes through transition(), which writes the status with the
		// in-progress flag set: the contributor's role limit on the edge does
		// not apply to the agent, and neither does the save layer.
		wp_set_current_user( 0 );
		$result = $this->status_manager()->transition(
			$post_id,
			'review',
			array(
				'agent_actor'      => 'vip-workflows/test-agent',
				'agent_actor_user' => $this->contributor_id,
			)
		);

		$this->assertNotInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'pending', get_post_status( $post_id ) );
		$this->assertSame( 'review', $this->stage_of( $post_id ) );
	}

	// =========================================================================
	// The client payload
	// =========================================================================

	public function test_status_payload_lists_the_refused_regions_for_the_user(): void
	{
		$post_id = $this->make_post( $this->create_sequence(), 'draft_a' );

		wp_set_current_user( $this->contributor_id );
		$contributor = rest_do_request( new \WP_REST_Request( 'GET', "/vip-workflows/v1/workflow/post/{$post_id}/status" ) );

		wp_set_current_user( $this->admin_id );
		$admin = rest_do_request( new \WP_REST_Request( 'GET', "/vip-workflows/v1/workflow/post/{$post_id}/status" ) );

		$this->assertSame( 200, $contributor->get_status() );
		$this->assertSame( array( 'pending' ), $contributor->get_data()['guard']['refused_regions'] );
		$this->assertSame( array(), $admin->get_data()['guard']['refused_regions'] );
	}

	public function test_region_prediction_reuses_primed_reads_and_logs_nothing_for_one_hundred_rows(): void
	{
		global $wpdb;
		$sequence_id = $this->create_sequence();
		$posts       = array();
		for ( $i = 0; $i < 100; ++$i ) {
			$posts[] = $this->make_post( $sequence_id, 'draft_a' );
		}
		foreach ( $posts as $post_id ) {
			get_post( $post_id );
			get_post_meta( $post_id );
		}
		$this->status_manager()->refused_status_regions( $posts[0], $this->contributor_id );
		$queries = $wpdb->num_queries;
		$log_path = tempnam( sys_get_temp_dir(), 'rules-read-' );
		$previous_log = ini_set( 'error_log', $log_path );
		try {
			foreach ( $posts as $post_id ) {
				$this->assertSame( array( 'pending' ), $this->status_manager()->refused_status_regions( $post_id, $this->contributor_id ) );
			}
		} finally {
			ini_set( 'error_log', $previous_log );
			$messages = file_get_contents( $log_path );
			unlink( $log_path );
		}
		$this->assertLessThanOrEqual( 1, $wpdb->num_queries - $queries );
		$this->assertSame( 0, substr_count( $messages, 'moved to status' ), 'Predicting a status change must not log one as made.' );
	}

	public function test_status_refusal_copy_preserves_quotes_percent_and_markup(): void
	{
		$this->assertSame(
			'“Title "quoted" 50% <em>x</em>” is in the “Flow & desk” workflow, and this status change would move it to “Review %s <b>now</b>”. You can’t make that move from here. Use the workflow panel instead.',
			StatusManager::status_change_rules_message( 'Title "quoted" 50% <em>x</em>', 'Flow & desk', 'Review %s <b>now</b>' )
		);
	}
}
