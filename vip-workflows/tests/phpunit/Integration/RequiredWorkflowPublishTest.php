<?php
/**
 * Integration coverage for the required-workflow rule on every save path.
 *
 * With the enforcement mode set to "require", a non-override user can't move a
 * post with no workflow, of a post type a sequence covers, into the publish
 * region (`publish` or `future`). Drafts, pending and private stay allowed.
 * These tests drive the real WordPress save paths: REST create and update,
 * XML-RPC, wp_insert_post() and wp_update_post() as a plugin would call them,
 * Quick Draft, the classic-editor notice, Trash restores and cron.
 *
 * WP-CLI's exemption needs the WP_CLI constant, which can't be undefined once
 * set, so it is covered in the unit suite (WorkflowRequirementGuardTest) in a
 * separate process.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use ReflectionProperty;
use VIPWorkflows\Plugin;
use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Workflow\PostTypeManager;
use VIPWorkflows\Workflow\StatusManager;
use VIPWorkflows\Workflow\WorkflowRequirementGuard;

/**
 * Real-WordPress tests for WorkflowRequirementGuard.
 */
class RequiredWorkflowPublishTest extends TestCase
{
	/**
	 * Password given to every user created here (XML-RPC logs in with it).
	 */
	private const PASSWORD = 'required-workflow-test';

	/**
	 * Sequence covering `post`.
	 *
	 * @var int
	 */
	private int $sequence_id;

	/**
	 * Author (a non-override role that can publish its own posts).
	 *
	 * @var int
	 */
	private int $author_id;

	/**
	 * Administrator (an override role by default).
	 *
	 * @var int
	 */
	private int $admin_id;

	/**
	 * The plugin's post-type mapping before this test replaced it.
	 *
	 * @var array
	 */
	private array $saved_mapping = array();

	public function set_up(): void
	{
		parent::set_up();

		$this->admin_id  = self::factory()->user->create(
			array(
				'role'      => 'administrator',
				'user_pass' => self::PASSWORD,
			)
		);
		$this->author_id = self::factory()->user->create(
			array(
				'role'      => 'author',
				'user_pass' => self::PASSWORD,
			)
		);

		$this->sequence_id = (int) ( new SequenceRepository() )->create(
			'Required Workflow Test',
			'required-workflow-test',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'          => 'draft',
						'label'        => 'Draft',
						'status'       => 'draft',
						'region_entry' => true,
						'is_initial'   => true,
						'transitions'  => array( array( 'to' => 'published' ) ),
					),
					array(
						'key'          => 'published',
						'label'        => 'Published',
						'status'       => 'publish',
						'region_entry' => true,
						'is_terminal'  => true,
						'transitions'  => array(),
					),
				),
			),
			$this->admin_id
		);

		// The plugin's mapping is built once on `init`, before this sequence
		// existed. Point it at exactly this sequence for `post`, so `page` is a
		// post type no sequence covers, and put it back afterwards.
		$this->saved_mapping = $this->mapping()->getValue( $this->post_type_manager() );
		$this->mapping()->setValue( $this->post_type_manager(), array( 'post' => array( $this->sequence_id ) ) );

		$this->set_mode( 'require' );

		wp_set_current_user( $this->author_id );
	}

	public function tear_down(): void
	{
		$this->mapping()->setValue( $this->post_type_manager(), $this->saved_mapping );

		parent::tear_down();
	}

	// =========================================================================
	// Helpers
	// =========================================================================

	/**
	 * The plugin's own PostTypeManager (the one the registered guard reads).
	 *
	 * @return PostTypeManager
	 */
	private function post_type_manager(): PostTypeManager
	{
		return Plugin::get_instance()->get_post_type_manager();
	}

	/**
	 * Accessor for PostTypeManager's mapping.
	 *
	 * @return ReflectionProperty
	 */
	private function mapping(): ReflectionProperty
	{
		return new ReflectionProperty( PostTypeManager::class, 'post_type_sequences' );
	}

	/**
	 * Set the enforcement mode ('require', 'recommend', or '' for off).
	 *
	 * @param string $mode Mode.
	 */
	private function set_mode( string $mode ): void
	{
		update_option(
			'vip_workflows_settings',
			array(
				'workflow_enforcement'      => '' !== $mode,
				'workflow_enforcement_mode' => '' !== $mode ? $mode : 'require',
				'bypass_workflow_roles'     => array( 'administrator' ),
			)
		);
	}

	/**
	 * Create an unassigned post as the current user.
	 *
	 * @param  array $args Post args.
	 * @return int
	 */
	private function make_post( array $args = array() ): int
	{
		return (int) wp_insert_post(
			array_merge(
				array(
					'post_title'   => 'Unassigned story',
					'post_content' => 'Body',
					'post_status'  => 'draft',
					'post_author'  => get_current_user_id(),
				),
				$args
			),
			true
		);
	}

	/**
	 * Dispatch a REST write.
	 *
	 * @param  string $route  Route.
	 * @param  array  $params Body params.
	 * @return \WP_REST_Response
	 */
	private function rest( string $route, array $params ): \WP_REST_Response
	{
		$request = new \WP_REST_Request( 'POST', $route );
		$request->set_body_params( $params );

		return rest_do_request( $request );
	}

	/**
	 * Assert a REST response is the required-workflow refusal.
	 *
	 * @param \WP_REST_Response $response Response.
	 */
	private function assert_refused( \WP_REST_Response $response ): void
	{
		$this->assertSame( 409, $response->get_status() );
		$this->assertSame( WorkflowRequirementGuard::ERROR_CODE, $response->get_data()['code'] );
		$this->assertStringContainsString( 'can’t be published without a workflow', $response->get_data()['message'] );
	}

	/**
	 * An XML-RPC server, with the class loaded.
	 *
	 * @return \wp_xmlrpc_server
	 */
	private function xmlrpc(): \wp_xmlrpc_server
	{
		require_once ABSPATH . 'wp-admin/includes/admin.php';
		require_once ABSPATH . WPINC . '/class-IXR.php';
		require_once ABSPATH . WPINC . '/class-wp-xmlrpc-server.php';

		add_filter( 'xmlrpc_enabled', '__return_true' );

		return new \wp_xmlrpc_server();
	}

	// =========================================================================
	// Characterization: what core writes for a draft
	// =========================================================================

	/**
	 * A refused new post is the same shape as core's own draft for the same call.
	 */
	public function test_refused_new_post_matches_cores_draft_shape(): void
	{
		$args = array(
			'post_title'   => 'Shape check',
			'post_content' => 'Body',
			'post_author'  => $this->author_id,
		);

		$draft   = get_post( (int) wp_insert_post( $args + array( 'post_status' => 'draft' ) ) );
		$refused = get_post( (int) wp_insert_post( $args + array( 'post_status' => 'publish' ) ) );

		$this->assertSame( 'draft', $refused->post_status );
		$this->assertSame( $draft->post_name, $refused->post_name );
		$this->assertSame( '', $refused->post_name );
		$this->assertSame( $draft->post_date_gmt, $refused->post_date_gmt );
	}

	/**
	 * With a requested slug, both keep it.
	 */
	public function test_refused_new_post_keeps_a_requested_slug_like_cores_draft(): void
	{
		$args = array(
			'post_title'  => 'Slug check',
			'post_author' => $this->author_id,
		);

		$draft   = get_post( (int) wp_insert_post( $args + array( 'post_status' => 'draft', 'post_name' => 'Chosen Slug' ) ) );
		$refused = get_post( (int) wp_insert_post( $args + array( 'post_status' => 'publish', 'post_name' => 'Chosen Slug' ) ) );

		$this->assertSame( 'draft', $refused->post_status );
		$this->assertSame( $draft->post_name, $refused->post_name );
		$this->assertSame( $draft->post_date_gmt, $refused->post_date_gmt );
	}

	// =========================================================================
	// Drafts stay allowed
	// =========================================================================

	/**
	 * REST, plugin and Quick Draft drafts are all allowed.
	 */
	public function test_drafts_are_allowed_on_every_path(): void
	{
		$response = $this->rest(
			'/wp/v2/posts',
			array(
				'title'  => 'REST draft',
				'status' => 'draft',
			)
		);
		$this->assertSame( 201, $response->get_status() );
		$this->assertSame( 'draft', get_post_status( $response->get_data()['id'] ) );

		$this->assertSame( 'draft', get_post_status( $this->make_post() ) );
		$this->assertSame( 'pending', get_post_status( $this->make_post( array( 'post_status' => 'pending' ) ) ) );

		// Quick Draft: an auto-draft, then saved as a draft.
		require_once ABSPATH . 'wp-admin/includes/post.php';
		$auto = get_default_post_to_edit( 'post', true );
		wp_update_post(
			array(
				'ID'          => $auto->ID,
				'post_title'  => 'Quick Draft',
				'post_status' => 'draft',
			)
		);
		$this->assertSame( 'draft', get_post_status( $auto->ID ) );
	}

	// =========================================================================
	// Publishing refused
	// =========================================================================

	/**
	 * REST create with status publish: 409, and nothing is created.
	 */
	public function test_rest_create_publish_is_refused_and_creates_nothing(): void
	{
		$this->assert_refused(
			$this->rest(
				'/wp/v2/posts',
				array(
					'title'  => 'REST publish refused',
					'status' => 'publish',
				)
			)
		);

		$created = get_posts(
			array(
				'title'       => 'REST publish refused',
				'post_status' => 'any',
				'fields'      => 'ids',
			)
		);
		$this->assertSame( array(), $created );
	}

	/**
	 * REST update to publish: 409, and the post stays a draft.
	 */
	public function test_rest_update_publish_is_refused(): void
	{
		$post_id = $this->make_post();

		$this->assert_refused( $this->rest( '/wp/v2/posts/' . $post_id, array( 'status' => 'publish' ) ) );

		$this->assertSame( 'draft', get_post_status( $post_id ) );
	}

	/**
	 * Scheduling over REST is refused the same way.
	 */
	public function test_rest_schedule_is_refused(): void
	{
		$post_id = $this->make_post();

		$this->assert_refused(
			$this->rest(
				'/wp/v2/posts/' . $post_id,
				array(
					'status' => 'future',
					'date'   => gmdate( 'Y-m-d\TH:i:s', time() + DAY_IN_SECONDS ),
				)
			)
		);

		$this->assertSame( 'draft', get_post_status( $post_id ) );
	}

	/**
	 * A REST write straight out of the Trash to publish is refused.
	 */
	public function test_rest_restore_from_trash_to_publish_is_refused(): void
	{
		$post_id = $this->make_post();
		wp_trash_post( $post_id );

		$this->assert_refused( $this->rest( '/wp/v2/posts/' . $post_id, array( 'status' => 'publish' ) ) );

		$this->assertSame( 'trash', get_post_status( $post_id ) );
	}

	/**
	 * wp_update_post() to publish keeps the post a draft, with no public slug,
	 * while the title change in the same call lands.
	 */
	public function test_plugin_update_to_publish_is_reverted(): void
	{
		$post_id = $this->make_post();

		wp_update_post(
			array(
				'ID'          => $post_id,
				'post_title'  => 'Retitled',
				'post_status' => 'publish',
			)
		);

		$post = get_post( $post_id );
		$this->assertSame( 'draft', $post->post_status );
		$this->assertSame( '', $post->post_name );
		$this->assertSame( '0000-00-00 00:00:00', $post->post_date_gmt );
		$this->assertSame( 'Retitled', $post->post_title );
	}

	/**
	 * wp_insert_post() of a new published post creates a draft with no slug.
	 */
	public function test_plugin_insert_publish_creates_a_draft(): void
	{
		$post_id = $this->make_post( array( 'post_status' => 'publish' ) );

		$this->assertGreaterThan( 0, $post_id );
		$this->assertSame( 'draft', get_post_status( $post_id ) );
		$this->assertSame( '', get_post( $post_id )->post_name );
	}

	/**
	 * Quick Draft's auto-draft can't be published either, and stays a draft
	 * (not an auto-draft that core would later delete).
	 */
	public function test_auto_draft_publish_becomes_a_draft(): void
	{
		require_once ABSPATH . 'wp-admin/includes/post.php';
		$auto = get_default_post_to_edit( 'post', true );

		wp_update_post(
			array(
				'ID'          => $auto->ID,
				'post_title'  => 'From auto-draft',
				'post_status' => 'publish',
			)
		);

		$this->assertSame( 'draft', get_post_status( $auto->ID ) );
	}

	/**
	 * Untrashing to a previous `publish` status lands as a draft, not in the Trash.
	 */
	public function test_untrash_to_publish_lands_as_a_draft(): void
	{
		$post_id = $this->make_post();
		wp_trash_post( $post_id );

		$restore_to_publish = static function () {
			return 'publish';
		};
		add_filter( 'wp_untrash_post_status', $restore_to_publish );
		wp_untrash_post( $post_id );
		remove_filter( 'wp_untrash_post_status', $restore_to_publish );

		$this->assertSame( 'draft', get_post_status( $post_id ) );
	}

	/**
	 * XML-RPC wp.newPost with publish succeeds, and the post is a draft.
	 */
	public function test_xmlrpc_new_post_publish_is_written_as_a_draft(): void
	{
		$user   = get_userdata( $this->author_id );
		$result = $this->xmlrpc()->wp_newPost(
			array(
				1,
				$user->user_login,
				self::PASSWORD,
				array(
					'post_type'    => 'post',
					'post_status'  => 'publish',
					'post_title'   => 'XML-RPC story',
					'post_content' => 'Body',
				),
			)
		);

		$this->assertNotInstanceOf( \IXR_Error::class, $result );
		$this->assertSame( 'draft', get_post_status( (int) $result ) );
	}

	/**
	 * XML-RPC wp.editPost to publish leaves the post a draft.
	 */
	public function test_xmlrpc_edit_post_publish_is_reverted(): void
	{
		$post_id = $this->make_post();
		$user    = get_userdata( $this->author_id );

		$result = $this->xmlrpc()->wp_editPost(
			array(
				1,
				$user->user_login,
				self::PASSWORD,
				$post_id,
				array( 'post_status' => 'publish' ),
			)
		);

		$this->assertTrue( $result );
		$this->assertSame( 'draft', get_post_status( $post_id ) );
	}

	/**
	 * A classic save queues the notice, and it renders once on post.php.
	 */
	public function test_classic_save_queues_a_notice_shown_once(): void
	{
		$post_id = $this->make_post( array( 'post_title' => 'Classic story' ) );

		wp_update_post(
			array(
				'ID'          => $post_id,
				'post_status' => 'publish',
			)
		);

		$GLOBALS['post'] = get_post( $post_id );
		$guard           = new WorkflowRequirementGuard( Plugin::get_instance()->get_status_manager(), $this->post_type_manager() );

		ob_start();
		$guard->render_notice();
		$first = (string) ob_get_clean();

		ob_start();
		$guard->render_notice();
		$second = (string) ob_get_clean();

		unset( $GLOBALS['post'] );

		$this->assertStringContainsString( 'Classic story', $first );
		$this->assertStringContainsString( 'can’t be published without a workflow', $first );
		$this->assertSame( '', $second );
	}

	// =========================================================================
	// Allowed
	// =========================================================================

	/**
	 * An administrator (override role) publishes an unassigned post over REST.
	 */
	public function test_override_role_can_publish(): void
	{
		wp_set_current_user( $this->admin_id );

		$response = $this->rest(
			'/wp/v2/posts',
			array(
				'title'  => 'Admin publish',
				'status' => 'publish',
			)
		);

		$this->assertSame( 201, $response->get_status() );
		$this->assertSame( 'publish', get_post_status( $response->get_data()['id'] ) );
	}

	/**
	 * Recommend mode and enforcement off don't refuse.
	 */
	public function test_recommend_and_off_allow_publishing(): void
	{
		$this->set_mode( 'recommend' );
		$this->assertSame( 'publish', get_post_status( $this->make_post( array( 'post_status' => 'publish' ) ) ) );

		$this->set_mode( '' );
		$this->assertSame( 'publish', get_post_status( $this->make_post( array( 'post_status' => 'publish' ) ) ) );
	}

	/**
	 * A post type no sequence covers is never trapped.
	 */
	public function test_uncovered_post_type_can_be_published(): void
	{
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

		$response = $this->rest(
			'/wp/v2/pages',
			array(
				'title'  => 'A page',
				'status' => 'publish',
			)
		);

		$this->assertSame( 201, $response->get_status() );
	}

	/**
	 * An eligibility filter that removes every sequence makes the post publishable.
	 */
	public function test_eligibility_filter_that_removes_every_sequence_allows_publishing(): void
	{
		add_filter( 'vip_workflows_sequences_for_post', '__return_empty_array' );

		$post_id = $this->make_post();
		$this->assertSame( 200, $this->rest( '/wp/v2/posts/' . $post_id, array( 'status' => 'publish' ) )->get_status() );
		$this->assertSame( 'publish', get_post_status( $post_id ) );

		remove_filter( 'vip_workflows_sequences_for_post', '__return_empty_array' );
	}

	/**
	 * An already-published unassigned post can be saved again and rescheduled.
	 */
	public function test_already_published_post_can_be_saved_and_rescheduled(): void
	{
		wp_set_current_user( $this->admin_id );
		$post_id = $this->make_post(
			array(
				'post_status' => 'publish',
				'post_author' => $this->author_id,
			)
		);
		wp_set_current_user( $this->author_id );

		$this->assertSame( 200, $this->rest( '/wp/v2/posts/' . $post_id, array( 'title' => 'Fixed typo' ) )->get_status() );
		$this->assertSame( 'publish', get_post_status( $post_id ) );

		$response = $this->rest(
			'/wp/v2/posts/' . $post_id,
			array(
				'status' => 'future',
				'date'   => gmdate( 'Y-m-d\TH:i:s', time() + DAY_IN_SECONDS ),
			)
		);
		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'future', get_post_status( $post_id ) );
	}

	/**
	 * Private is not publishing.
	 */
	public function test_private_is_allowed(): void
	{
		$post_id = $this->make_post();

		$this->assertSame( 200, $this->rest( '/wp/v2/posts/' . $post_id, array( 'status' => 'private' ) )->get_status() );
		$this->assertSame( 'private', get_post_status( $post_id ) );
	}

	/**
	 * A scheduled post goes live on cron, even with an Author logged in.
	 */
	public function test_scheduled_post_goes_live_on_cron(): void
	{
		wp_set_current_user( $this->admin_id );
		$post_id = $this->make_post(
			array(
				'post_status' => 'future',
				'post_date'   => gmdate( 'Y-m-d H:i:s', time() + HOUR_IN_SECONDS ),
				'post_author' => $this->author_id,
			)
		);
		$this->assertSame( 'future', get_post_status( $post_id ) );
		wp_set_current_user( $this->author_id );

		// Make it due, then run core's scheduled-publish handler.
		global $wpdb;
		$past = gmdate( 'Y-m-d H:i:s', time() - MINUTE_IN_SECONDS );
		$wpdb->update( $wpdb->posts, array( 'post_date' => $past, 'post_date_gmt' => $past ), array( 'ID' => $post_id ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		clean_post_cache( $post_id );

		add_filter( 'wp_doing_cron', '__return_true' );
		check_and_publish_future_post( $post_id );
		remove_filter( 'wp_doing_cron', '__return_true' );

		$this->assertSame( 'publish', get_post_status( $post_id ) );
	}

	/**
	 * Cron writes are exempt even when they publish an unpublished post.
	 */
	public function test_cron_write_can_publish(): void
	{
		$post_id = $this->make_post();

		add_filter( 'wp_doing_cron', '__return_true' );
		wp_update_post(
			array(
				'ID'          => $post_id,
				'post_status' => 'publish',
			)
		);
		remove_filter( 'wp_doing_cron', '__return_true' );

		$this->assertSame( 'publish', get_post_status( $post_id ) );
	}

	/**
	 * A write with no logged-in user (importer, seeder) is exempt.
	 */
	public function test_userless_insert_can_publish(): void
	{
		wp_set_current_user( 0 );

		$post_id = $this->make_post(
			array(
				'post_status' => 'publish',
				'post_author' => $this->author_id,
			)
		);

		$this->assertSame( 'publish', get_post_status( $post_id ) );
	}

	/**
	 * The plugin's own writes: assigning a workflow and moving the post through
	 * it to a published stage, as the Author, both work.
	 */
	public function test_assignment_and_workflow_transition_are_unaffected(): void
	{
		$post_id = $this->make_post();
		$manager = Plugin::get_instance()->get_status_manager();

		$assigned = $manager->assign_sequence( $post_id, $this->sequence_id );
		$this->assertNotInstanceOf( \WP_Error::class, $assigned );

		$moved = $manager->transition( $post_id, 'published' );
		$this->assertNotInstanceOf( \WP_Error::class, $moved );
		$this->assertSame( 'publish', get_post_status( $post_id ) );
	}

	/**
	 * Content writes that don't touch the status (what stage agents and the
	 * update-post-fields tool do) are unaffected.
	 */
	public function test_content_write_without_a_status_is_unaffected(): void
	{
		$post_id = $this->make_post();

		$result = wp_update_post(
			array(
				'ID'           => $post_id,
				'post_content' => 'Rewritten body',
			),
			true
		);

		$this->assertSame( $post_id, $result );
		$this->assertSame( 'Rewritten body', get_post( $post_id )->post_content );
	}

	/**
	 * A post in a workflow is PublishBoundaryGuard's to judge, not this guard's.
	 */
	public function test_assigned_post_is_left_to_the_publish_guard(): void
	{
		$post_id = $this->make_post();
		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $this->sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'draft' );

		$boundary = new \VIPWorkflows\Workflow\PublishBoundaryGuard( Plugin::get_instance()->get_status_manager() );
		$expected = rest_convert_error_to_response( $boundary->veto_rest_insert( (object) array( 'ID' => $post_id, 'post_status' => 'publish' ), new \WP_REST_Request() ) );
		$response = $this->rest( '/wp/v2/posts/' . $post_id, array( 'status' => 'publish' ) );

		$this->assertSame( 409, $response->get_status() );
		$this->assertSame( 'vip_workflows_publish_boundary', $response->get_data()['code'] );
		$this->assertSame( $expected->get_data(), $response->get_data() );
		$this->assertSame( array( 'status' => 409, 'post_id' => $post_id ), $response->get_data()['data'] );
		$this->assertSame( 'draft', get_post_status( $post_id ) );
	}

	/**
	 * Multisite: the mode is read from the current site's option.
	 */
	public function test_mode_is_read_per_site(): void
	{
		if ( ! is_multisite() ) {
			$this->markTestSkipped( 'Multisite only.' );
		}

		$blog_id = self::factory()->blog->create();
		switch_to_blog( $blog_id );
		delete_option( 'vip_workflows_settings' );

		$post_id = $this->make_post( array( 'post_status' => 'publish' ) );
		$this->assertSame( 'publish', get_post_status( $post_id ) );

		restore_current_blog();
	}

	/** Additional save-path coverage. */
	public function test_save_path_rest_create_schedule_and_date_coercion(): void
	{
		foreach ( array(
			array( 'status' => 'future', 'date' => gmdate( 'Y-m-d\TH:i:s', time() + DAY_IN_SECONDS ) ),
			array( 'status' => 'future', 'date' => gmdate( 'Y-m-d\TH:i:s', time() - DAY_IN_SECONDS ) ),
			array( 'status' => 'publish', 'date' => gmdate( 'Y-m-d\TH:i:s', time() + DAY_IN_SECONDS ) ),
		) as $params ) {
			global $wpdb;
			$before = array();
			foreach ( array( 'posts', 'postmeta', 'term_relationships' ) as $table ) {
				$before[ $table ] = $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->$table}" );
			}
			$response = $this->rest( '/wp/v2/posts', array_merge( array( 'title' => 'Schedule check', 'categories' => array( 1 ) ), $params ) );
			$this->assert_refused( $response );
			$this->assertSame( array( 'status' => 409, 'post_id' => 0 ), $response->get_data()['data'] );
			foreach ( $before as $table => $count ) {
				$this->assertSame( $count, $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->$table}" ), $table );
			}
		}
	}

	public function test_save_path_rest_update_all_unpublished_statuses(): void
	{
		foreach ( array( 'draft', 'pending', 'private', 'auto-draft', 'trash' ) as $status ) {
			foreach ( array( 'publish', 'future' ) as $target ) {
				$id = $this->make_post( array( 'post_status' => $status ) );
				$response = $this->rest( '/wp/v2/posts/' . $id, array( 'status' => $target, 'date' => gmdate( 'Y-m-d\TH:i:s', time() + DAY_IN_SECONDS ) ) );
				$this->assert_refused( $response );
				$this->assertSame( $status, get_post_status( $id ) );
			}
		}
	}

	public function test_save_path_bulk_edit_and_classic_edit(): void
	{
		require_once ABSPATH . 'wp-admin/includes/post.php';
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
		$id = $this->make_post();
		$result = bulk_edit_posts( array( 'post' => array( $id ), '_status' => 'publish', 'post_type' => 'post' ) );
		$this->assertContains( $id, $result['updated'] );
		$this->assertSame( 'draft', get_post_status( $id ) );
		$auto = get_default_post_to_edit( 'post', true );
		edit_post( array( 'post_ID' => $auto->ID, 'post_type' => 'post', 'post_title' => 'Classic publish', 'post_status' => 'publish', 'publish' => 'Publish', 'user_ID' => get_current_user_id() ) );
		$this->assertSame( 'draft', get_post_status( $auto->ID ) );
	}

	public function test_save_path_xmlrpc_other_publish_methods(): void
	{
		$user = get_userdata( $this->author_id );
		foreach ( array( 'mw_newPost', 'blogger_newPost', 'mt_publishPost', 'mw_editPost' ) as $method ) {
			$server = $this->xmlrpc();
			$id = $this->make_post();
			if ( 'mw_newPost' === $method ) {
				$args = array( 1, $user->user_login, self::PASSWORD, array( 'title' => 'Meta create', 'description' => 'Body' ), true );
			} elseif ( 'blogger_newPost' === $method ) {
				$args = array( '', 1, $user->user_login, self::PASSWORD, '<title>Blogger title</title>Blogger body', true );
			} elseif ( 'mw_editPost' === $method ) {
				$args = array( $id, $user->user_login, self::PASSWORD, array( 'title' => 'Meta edit', 'description' => 'Body' ), true );
			} else {
				$args = array( $id, $user->user_login, self::PASSWORD );
			}
			$result = $server->$method( $args );
			$this->assertNotInstanceOf( \IXR_Error::class, $result, $method );
			$this->assertNotFalse( $result, $method );
			if ( in_array( $method, array( 'mw_newPost', 'blogger_newPost' ), true ) ) {
				$id = (int) $result;
			}
			$this->assertSame( 'draft', get_post_status( $id ), $method );
		}
	}

	public function test_save_path_refused_insert_matches_core_draft_shape(): void
	{
		foreach ( array(
			array(),
			array( 'post_name' => 'Chosen Slug' ),
			array( 'post_name' => 'Dash — and “quotes”' ),
			array( 'post_date' => '2027-01-02 10:00:00', 'edit_date' => true ),
			array( 'post_date_gmt' => '2027-01-02 10:00:00' ),
			array( 'post_date' => '2027-01-02 10:00:00', 'post_date_gmt' => '2027-01-02 10:00:00', 'post_name' => 'named' ),
		) as $args ) {
			$draft = get_post( $this->make_post( $args ) );
			$refused = get_post( $this->make_post( array_merge( $args, array( 'post_status' => 'publish' ) ) ) );
			foreach ( array( 'post_status', 'post_name', 'post_date', 'post_date_gmt' ) as $field ) {
				$this->assertSame( $draft->$field, $refused->$field, $field . ' ' . wp_json_encode( $args ) );
			}
			$this->assertSame( get_option( 'home' ) . '/?p=' . $refused->ID, $refused->guid );
		}
	}

	public function test_save_path_late_rest_type_gets_a_refusal_response(): void
	{
		rest_get_server();
		register_post_type( 'review_late', array( 'public' => true, 'show_in_rest' => true, 'rest_base' => 'review-late', 'supports' => array( 'title', 'editor' ) ) );
		$this->mapping()->setValue( $this->post_type_manager(), array( 'review_late' => array( $this->sequence_id ) ) );
		$controller = new \WP_REST_Posts_Controller( 'review_late' );
		$controller->register_routes();
		try {
			$this->assert_refused( $this->rest( '/wp/v2/review-late', array( 'title' => 'Late registered', 'status' => 'publish' ) ) );
		} finally {
			unregister_post_type( 'review_late' );
		}
	}

	public function test_save_path_post_type_change_uses_target_type_eligibility(): void
	{
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
		$id = $this->make_post( array( 'post_type' => 'page' ) );
		wp_update_post( array( 'ID' => $id, 'post_type' => 'post', 'post_status' => 'publish' ) );
		$this->assertSame( 'post', get_post_type( $id ) );
		$this->assertSame( 'draft', get_post_status( $id ) );

		$id = $this->make_post();
		$this->assertSame( $id, wp_update_post( array( 'ID' => $id, 'post_type' => 'page', 'post_status' => 'publish' ), true ) );
		$this->assertSame( 'page', get_post_type( $id ) );
		$this->assertSame( 'publish', get_post_status( $id ) );
	}

	public function test_save_path_rest_registration_waits_for_rest_and_is_deduplicated(): void
	{
		global $wp_actions, $wp_filter;
		$rest_count = $wp_actions['rest_api_init'] ?? null;
		$guard = null;
		foreach ( $wp_filter['registered_post_type']->callbacks[10] as $callback ) {
			if ( is_array( $callback['function'] ) && $callback['function'][0] instanceof WorkflowRequirementGuard ) {
				$guard = $callback['function'][0];
			}
		}
		$this->assertInstanceOf( WorkflowRequirementGuard::class, $guard );
		$hook = 'rest_pre_insert_required_hook';
		$args = array( 'public' => true, 'show_in_rest' => true );
		try {
			unset( $wp_actions['rest_api_init'] );
			register_post_type( 'required_hook', $args );
			$this->assertFalse( has_filter( $hook, array( $guard, 'filter_rest_insert' ) ) );
			$guard->register_rest_guards();
			$this->assertSame( 10, has_filter( $hook, array( $guard, 'filter_rest_insert' ) ) );
			$wp_actions['rest_api_init'] = 1;
			register_post_type( 'required_hook', $args );
			$guard->register_rest_guards();
			$callbacks = array_filter( $wp_filter[$hook]->callbacks[10], static function ( $callback ) use ( $guard ) {
				return array( $guard, 'filter_rest_insert' ) === $callback['function'];
			} );
			$this->assertCount( 1, $callbacks );
			unregister_post_type( 'required_hook' );
			register_post_type( 'required_hook', array( 'show_in_rest' => false ) );
			remove_filter( $hook, array( $guard, 'filter_rest_insert' ), 10 );
			$guard->register_late_rest_guard( 'required_hook', get_post_type_object( 'required_hook' ) );
			$this->assertFalse( has_filter( $hook, array( $guard, 'filter_rest_insert' ) ) );
		} finally {
			unregister_post_type( 'required_hook' );
			remove_filter( $hook, array( $guard, 'filter_rest_insert' ), 10 );
			if ( null === $rest_count ) {
				unset( $wp_actions['rest_api_init'] );
			} else {
				$wp_actions['rest_api_init'] = $rest_count;
			}
		}
	}

	public function test_save_path_future_posts_before_require_and_direct_publish(): void
	{
		$this->set_mode( 'recommend' );
		$id = $this->make_post( array( 'post_status' => 'future', 'post_date' => gmdate( 'Y-m-d H:i:s', time() + DAY_IN_SECONDS ) ) );
		$this->assertSame( 'future', get_post_status( $id ) );
		$this->set_mode( 'require' );
		global $wpdb;
		$past = gmdate( 'Y-m-d H:i:s', time() - DAY_IN_SECONDS );
		$wpdb->update( $wpdb->posts, array( 'post_date' => $past, 'post_date_gmt' => $past ), array( 'ID' => $id ) );
		clean_post_cache( $id );
		wp_update_post( array( 'ID' => $id, 'post_title' => 'Due scheduled post' ) );
		$this->assertSame( 'publish', get_post_status( $id ) );
		$draft = $this->make_post();
		wp_publish_post( $draft );
		$this->assertSame( 'publish', get_post_status( $draft ) );
	}


	public function test_save_path_rest_preserves_an_earlier_error_even_when_mode_is_off(): void
	{
		$this->set_mode( '' );
		$error = new \WP_Error( 'earlier_validation_error', 'Earlier validation refused this post.', array( 'status' => 422 ) );
		$filter = static function () use ( $error ) { return $error; };
		add_filter( 'rest_pre_insert_post', $filter, 9 );
		try {
			$response = $this->rest( '/wp/v2/posts', array( 'title' => 'Earlier validation', 'status' => 'draft' ) );
			$this->assertSame( 422, $response->get_status() );
			$this->assertSame( 'earlier_validation_error', $response->get_data()['code'] );
		} finally {
			remove_filter( 'rest_pre_insert_post', $filter, 9 );
		}
	}

	public function test_save_path_rest_batch_refuses_publish_and_keeps_draft(): void
	{
		$response = $this->rest( '/batch/v1', array( 'requests' => array(
			array( 'method' => 'POST', 'path' => '/wp/v2/posts', 'body' => array( 'title' => 'Batch publish', 'status' => 'publish' ) ),
			array( 'method' => 'POST', 'path' => '/wp/v2/posts', 'body' => array( 'title' => 'Batch draft', 'status' => 'draft' ) ),
		) ) );
		$this->assertSame( 207, $response->get_status() );
		$this->assertSame( 409, $response->get_data()['responses'][0]['status'] );
		$this->assertSame( 201, $response->get_data()['responses'][1]['status'] );
	}

	public function test_save_path_unmapped_core_and_plugin_post_types_are_unchanged(): void
	{
		foreach ( array( 'page', 'attachment', 'nav_menu_item', 'wp_block', 'wp_navigation', 'wp_template', 'wp_global_styles', 'customize_changeset', 'vip_ideation', 'vip_story' ) as $type ) {
			$id = $this->make_post( array( 'post_type' => $type, 'post_status' => 'attachment' === $type ? 'inherit' : 'publish' ) );
			$this->assertSame( 'attachment' === $type ? 'inherit' : ( 'customize_changeset' === $type ? 'trash' : 'publish' ), get_post( $id )->post_status, $type );
		}
		foreach ( array( 'draft', 'pending', 'private' ) as $status ) {
			$id = $this->make_post( array( 'post_status' => $status, 'post_name' => 'explicit-' . $status, 'post_date' => '2026-01-01 10:00:00', 'post_date_gmt' => '2026-01-01 10:00:00' ) );
			$this->assertSame( $status, get_post_status( $id ) );
			$this->assertSame( 'explicit-' . $status, get_post( $id )->post_name );
			$this->assertSame( '2026-01-01 10:00:00', get_post( $id )->post_date_gmt );
		}
	}

	public function test_save_path_editor_override_and_empty_override_list(): void
	{
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
		$this->assertSame( 'draft', get_post_status( $this->make_post( array( 'post_status' => 'publish' ) ) ) );
		$settings = get_option( 'vip_workflows_settings' );
		$settings['bypass_workflow_roles'] = array( 'editor' );
		update_option( 'vip_workflows_settings', $settings );
		$this->assertSame( 'publish', get_post_status( $this->make_post( array( 'post_status' => 'publish' ) ) ) );
		$settings['bypass_workflow_roles'] = array();
		update_option( 'vip_workflows_settings', $settings );
		wp_set_current_user( $this->admin_id );
		$this->assertSame( 'draft', get_post_status( $this->make_post( array( 'post_status' => 'publish' ) ) ) );
	}


	public function test_save_path_author_cannot_schedule_through_insert_or_xmlrpc(): void
	{
		$date = gmdate( 'Y-m-d H:i:s', time() + DAY_IN_SECONDS );
		$id = $this->make_post( array( 'post_status' => 'future', 'post_date' => $date ) );
		$this->assertSame( 'draft', get_post_status( $id ) );
		$this->assertFalse( wp_next_scheduled( 'publish_future_post', array( $id ) ) );
		$user = get_userdata( $this->author_id );
		$result = $this->xmlrpc()->wp_newPost( array( 1, $user->user_login, self::PASSWORD, array( 'post_title' => 'XML schedule', 'post_status' => 'publish', 'post_date' => new \IXR_Date( $date ) ) ) );
		$this->assertNotInstanceOf( \IXR_Error::class, $result );
		$this->assertGreaterThan( 0, (int) $result );
		$this->assertSame( 'draft', get_post_status( (int) $result ) );
		$this->assertFalse( wp_next_scheduled( 'publish_future_post', array( (int) $result ) ) );
	}

	/**
	 * A refused publish from pending or private keeps the stored slug and dates,
	 * not only the status.
	 */
	public function test_refused_publish_from_pending_and_private_keeps_slug_and_dates(): void
	{
		foreach ( array( 'pending', 'private' ) as $status ) {
			$post_id = $this->make_post(
				array(
					'post_status' => $status,
					'post_name'   => $status . '-slug',
					'post_date'   => '2026-03-04 05:06:07',
					'edit_date'   => true,
				)
			);
			$before  = get_post( $post_id );

			wp_update_post(
				array(
					'ID'          => $post_id,
					'post_status' => 'publish',
					'post_date'   => '2026-05-06 07:08:09',
					'edit_date'   => true,
				)
			);

			$after = get_post( $post_id );
			foreach ( array( 'post_status', 'post_name', 'post_date', 'post_date_gmt' ) as $field ) {
				$this->assertSame( $before->$field, $after->$field, $status . ' ' . $field );
			}
			$this->assertSame( $status . '-slug', $after->post_name );
		}
	}

	/**
	 * The status endpoint tells the editor which unassigned posts the rule
	 * covers, so the editor can refuse the publish before saving.
	 */
	public function test_status_endpoint_marks_posts_that_need_a_workflow(): void
	{
		$post_id = $this->make_post();
		$read    = static function ( int $id ): array {
			return rest_do_request( new \WP_REST_Request( 'GET', '/vip-workflows/v1/workflow/post/' . $id . '/status' ) )->get_data();
		};

		$data = $read( $post_id );
		$this->assertFalse( $data['has_workflow'] );
		$this->assertSame(
			array(
				'workflow_required' => true,
				'current_region'    => 'draft',
				'can_bypass'        => false,
				'agent_pending'     => false,
			),
			$data['guard']
		);

		wp_set_current_user( $this->admin_id );
		$this->assertTrue( $read( $post_id )['guard']['can_bypass'] );

		$this->set_mode( 'recommend' );
		$this->assertArrayNotHasKey( 'guard', $read( $post_id ) );

		$this->set_mode( 'require' );
		$page_id = $this->make_post( array( 'post_type' => 'page' ) );
		$this->assertArrayNotHasKey( 'guard', $read( $page_id ) );
	}
}
