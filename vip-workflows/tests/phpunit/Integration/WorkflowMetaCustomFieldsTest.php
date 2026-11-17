<?php
/**
 * Workflow assignment meta is protected from custom-field writes.
 *
 * A post's workflow, its stage and its claim are workflow state, written only
 * by StatusManager through assignment, transitions and removal. None of the
 * three keys grants a meta capability to anyone, so core's custom-fields
 * surfaces (XML-RPC `custom_fields`, the classic Custom Fields box) can neither
 * show nor change them. `_vip_workflows_sequence_id` is registered, so it keeps
 * that default deny only through an `auth_callback` that refuses; the other two
 * are unregistered leading-underscore keys that core protects on its own.
 *
 * Driven through the real XML-RPC server so the capability checks under test
 * are the ones core's `set_custom_fields()` and `get_custom_fields()` make.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Workflow\StatusManager;

require_once ABSPATH . 'wp-admin/includes/admin.php';
require_once ABSPATH . WPINC . '/class-IXR.php';
require_once ABSPATH . WPINC . '/class-wp-xmlrpc-server.php';

/**
 * Real-WordPress tests for the workflow assignment meta's default deny.
 */
class WorkflowMetaCustomFieldsTest extends TestCase
{
	/**
	 * Claim meta key (unregistered).
	 */
	private const ASSIGNED_META_KEY = '_vip_workflows_assigned_to';

	/**
	 * Login and password shared by the XML-RPC test users.
	 */
	private const PASSWORD = 'password';

	/**
	 * The workflow the post is in.
	 *
	 * @var int
	 */
	private int $sequence_id;

	/**
	 * A second workflow the post is eligible for.
	 *
	 * @var int
	 */
	private int $other_sequence_id;

	/**
	 * An Author who owns the workflow post.
	 *
	 * @var int
	 */
	private int $author_id;

	/**
	 * An administrator.
	 *
	 * @var int
	 */
	private int $admin_id;

	/**
	 * Draft post seated at the `draft` stage, claimed by the Author.
	 *
	 * @var int
	 */
	private int $post_id;

	/**
	 * Per-post eligibility filter, removed in tear_down.
	 *
	 * @var callable
	 */
	private $make_eligible;

	public function set_up(): void
	{
		parent::set_up();

		// WP_UnitTestCase restores $wp_meta_keys between tests, so re-run the
		// plugin's registration to test it rather than test ordering.
		\VIPWorkflows\Plugin::get_instance()->register_meta();

		add_filter( 'xmlrpc_enabled', '__return_true' );

		$this->admin_id  = (int) self::factory()->user->create(
			array(
				'role'       => 'administrator',
				'user_login' => 'vipwf_meta_admin',
				'user_pass'  => self::PASSWORD,
			)
		);
		$this->author_id = (int) self::factory()->user->create(
			array(
				'role'       => 'author',
				'user_login' => 'vipwf_meta_author',
				'user_pass'  => self::PASSWORD,
			)
		);

		$repository              = new SequenceRepository();
		$this->sequence_id       = (int) $repository->create(
			'Protected Meta Flow',
			'protected-meta-flow',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => $this->stages(),
			),
			$this->admin_id
		);
		$this->other_sequence_id = (int) $repository->create(
			'Other Flow',
			'other-flow',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => $this->stages(),
			),
			$this->admin_id
		);

		// PostTypeManager builds its post-type map on `init`, before these
		// sequences exist, so eligibility goes through the per-post filter.
		$ids                 = array( $this->sequence_id, $this->other_sequence_id );
		$this->make_eligible = static function ( array $eligible ) use ( $ids ): array {
			return array_values( array_unique( array_merge( $eligible, $ids ) ) );
		};
		add_filter( 'vip_workflows_sequences_for_post', $this->make_eligible );

		$this->post_id = (int) self::factory()->post->create(
			array(
				'post_title'  => 'Protected meta post',
				'post_status' => 'draft',
				'post_author' => $this->author_id,
			)
		);
		update_post_meta( $this->post_id, StatusManager::SEQUENCE_META_KEY, $this->sequence_id );
		update_post_meta( $this->post_id, StatusManager::STAGE_META_KEY, 'draft' );
		update_post_meta( $this->post_id, self::ASSIGNED_META_KEY, $this->author_id );
	}

	public function tear_down(): void
	{
		remove_filter( 'vip_workflows_sequences_for_post', $this->make_eligible );
		remove_filter( 'xmlrpc_enabled', '__return_true' );

		parent::tear_down();
	}

	/**
	 * Two draft stages and a published one.
	 *
	 * @return array<int, array<string, mixed>>
	 */
	private function stages(): array
	{
		return array(
			array(
				'key'         => 'draft',
				'label'       => 'Draft',
				'status'      => 'draft',
				'transitions' => array( array( 'to' => 'edit' ) ),
			),
			array(
				'key'         => 'edit',
				'label'       => 'Edit',
				'status'      => 'draft',
				'transitions' => array( array( 'to' => 'live' ) ),
			),
			array(
				'key'         => 'live',
				'label'       => 'Live',
				'status'      => 'publish',
				'transitions' => array(),
			),
		);
	}

	/**
	 * The three workflow meta keys.
	 *
	 * @return array<string, array{0: string}>
	 */
	public static function data_workflow_meta_keys(): array
	{
		return array(
			'sequence id' => array( StatusManager::SEQUENCE_META_KEY ),
			'stage key'   => array( StatusManager::STAGE_META_KEY ),
			'claim'       => array( self::ASSIGNED_META_KEY ),
		);
	}

	/**
	 * A fresh XML-RPC server, built after the enabling filter is in place.
	 */
	private function xmlrpc(): \wp_xmlrpc_server
	{
		return new \wp_xmlrpc_server();
	}

	/**
	 * The meta id of a key on the test post.
	 *
	 * @param string $meta_key Meta key.
	 */
	private function meta_id( string $meta_key ): int
	{
		foreach ( (array) has_meta( $this->post_id ) as $meta ) {
			if ( $meta_key === $meta['meta_key'] ) {
				return (int) $meta['meta_id'];
			}
		}

		$this->fail( "No {$meta_key} row on the test post." );
	}

	/**
	 * How many workflow log rows of a type a post has.
	 *
	 * @param int    $post_id    Post ID.
	 * @param string $event_type Event type.
	 */
	private function event_count( int $post_id, string $event_type ): int
	{
		global $wpdb;

		$table = \VIPWorkflows\Database\Schema::get_table_name( 'workflows_events' );

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		return (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$table} WHERE post_id = %d AND event_type = %s",
				$post_id,
				$event_type
			)
		);
	}

	/**
	 * The post is still in its workflow, at its stage, claimed as before.
	 */
	private function assert_workflow_state_unchanged(): void
	{
		$this->assertSame( (string) $this->sequence_id, (string) get_post_meta( $this->post_id, StatusManager::SEQUENCE_META_KEY, true ), 'sequence id' );
		$this->assertSame( 'draft', get_post_meta( $this->post_id, StatusManager::STAGE_META_KEY, true ), 'stage key' );
		$this->assertSame( (string) $this->author_id, (string) get_post_meta( $this->post_id, self::ASSIGNED_META_KEY, true ), 'claim' );
		$this->assertCount( 1, get_post_meta( $this->post_id, StatusManager::SEQUENCE_META_KEY ), 'no second sequence id row' );
		$this->assertCount( 1, get_post_meta( $this->post_id, StatusManager::STAGE_META_KEY ), 'no second stage key row' );
	}

	/**
	 * Nobody holds a meta capability on the workflow keys: not the post's
	 * Author, and not an administrator.
	 *
	 * @dataProvider data_workflow_meta_keys
	 *
	 * @param string $meta_key Meta key.
	 */
	public function test_no_user_holds_a_meta_capability_on_the_key( string $meta_key ): void
	{
		foreach ( array( 'author' => $this->author_id, 'administrator' => $this->admin_id ) as $role => $user_id ) {
			wp_set_current_user( $user_id );

			$this->assertTrue( current_user_can( 'edit_post', $this->post_id ), "{$role} can edit the post itself" );

			foreach ( array( 'add_post_meta', 'edit_post_meta', 'delete_post_meta' ) as $capability ) {
				$this->assertFalse(
					current_user_can( $capability, $this->post_id, $meta_key ),
					"{$role} must not hold {$capability} on {$meta_key}"
				);
			}
		}
	}

	/**
	 * Each key is refused the way core refuses every protected key: the meta
	 * capability maps to itself, never to `do_not_allow`. That is what leaves
	 * a multisite super admin able to write it, since `WP_User::has_cap()`
	 * grants a super admin everything but `do_not_allow`. The suite runs
	 * single-site, where `has_cap()` never takes its super-admin path, so this
	 * pins the mapping that path reads instead.
	 *
	 * @dataProvider data_workflow_meta_keys
	 *
	 * @param string $meta_key Meta key.
	 */
	public function test_meta_capabilities_map_like_any_protected_key( string $meta_key ): void
	{
		foreach ( array( 'add_post_meta', 'edit_post_meta', 'delete_post_meta' ) as $capability ) {
			$caps     = map_meta_cap( $capability, $this->admin_id, $this->post_id, $meta_key );
			$baseline = map_meta_cap( $capability, $this->admin_id, $this->post_id, '_an_unregistered_protected_key' );

			$this->assertSame( $baseline, $caps, "{$capability} on {$meta_key} maps like an unregistered protected key" );
			$this->assertContains( $capability, $caps, "{$capability} on {$meta_key} requires itself" );
			$this->assertNotContains( 'do_not_allow', $caps, "{$capability} on {$meta_key} is not do_not_allow" );
		}
	}

	/**
	 * Deleting the sequence id by meta id, in the same call that publishes,
	 * leaves the post in its workflow, and the publish guard keeps it a draft.
	 */
	public function test_edit_post_cannot_delete_the_sequence_id_and_publish(): void
	{
		$result = $this->xmlrpc()->wp_editPost(
			array(
				1,
				'vipwf_meta_author',
				self::PASSWORD,
				$this->post_id,
				array(
					'post_status'   => 'publish',
					'custom_fields' => array(
						array( 'id' => $this->meta_id( StatusManager::SEQUENCE_META_KEY ) ),
						array( 'id' => $this->meta_id( StatusManager::STAGE_META_KEY ) ),
						array( 'id' => $this->meta_id( self::ASSIGNED_META_KEY ) ),
					),
				),
			)
		);

		$this->assertNotInstanceOf( \IXR_Error::class, $result );
		$this->assert_workflow_state_unchanged();
		$this->assertSame( 'draft', get_post_status( $this->post_id ), 'the publish guard kept the stored status' );
		$this->assertSame( 0, $this->event_count( $this->post_id, 'workflow.removed' ) );
	}

	/**
	 * Updating the sequence id or stage key in place, by meta id, changes nothing.
	 */
	public function test_edit_post_cannot_change_the_sequence_id_or_stage_by_meta_id(): void
	{
		$result = $this->xmlrpc()->wp_editPost(
			array(
				1,
				'vipwf_meta_author',
				self::PASSWORD,
				$this->post_id,
				array(
					'custom_fields' => array(
						array(
							'id'    => $this->meta_id( StatusManager::SEQUENCE_META_KEY ),
							'key'   => StatusManager::SEQUENCE_META_KEY,
							'value' => (string) $this->other_sequence_id,
						),
						array(
							'id'    => $this->meta_id( StatusManager::STAGE_META_KEY ),
							'key'   => StatusManager::STAGE_META_KEY,
							'value' => 'live',
						),
					),
				),
			)
		);

		$this->assertNotInstanceOf( \IXR_Error::class, $result );
		$this->assert_workflow_state_unchanged();
	}

	/**
	 * Adding a new row for the keys, by name, changes nothing either.
	 */
	public function test_edit_post_cannot_add_workflow_meta_rows(): void
	{
		$result = $this->xmlrpc()->wp_editPost(
			array(
				1,
				'vipwf_meta_author',
				self::PASSWORD,
				$this->post_id,
				array(
					'custom_fields' => array(
						array(
							'key'   => StatusManager::SEQUENCE_META_KEY,
							'value' => (string) $this->other_sequence_id,
						),
						array(
							'key'   => StatusManager::STAGE_META_KEY,
							'value' => 'live',
						),
					),
				),
			)
		);

		$this->assertNotInstanceOf( \IXR_Error::class, $result );
		$this->assert_workflow_state_unchanged();
	}

	/**
	 * A new post can't be created already in a workflow through custom fields.
	 */
	public function test_new_post_cannot_supply_a_sequence_id(): void
	{
		$result = $this->xmlrpc()->wp_newPost(
			array(
				1,
				'vipwf_meta_author',
				self::PASSWORD,
				array(
					'post_title'    => 'Created over XML-RPC',
					'post_status'   => 'draft',
					'custom_fields' => array(
						array(
							'key'   => StatusManager::SEQUENCE_META_KEY,
							'value' => (string) $this->sequence_id,
						),
						array(
							'key'   => StatusManager::STAGE_META_KEY,
							'value' => 'edit',
						),
					),
				),
			)
		);

		$this->assertNotInstanceOf( \IXR_Error::class, $result );
		$post_id = (int) $result;
		$this->assertGreaterThan( 0, $post_id, 'the post itself is created' );
		$this->assertSame( '', get_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, true ) );
		$this->assertSame( '', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
		$this->assertSame( 0, $this->event_count( $post_id, 'workflow.assigned' ) );
	}

	/**
	 * Reading a post over XML-RPC lists none of the workflow keys, for the
	 * Author or an administrator.
	 */
	public function test_get_post_lists_no_workflow_meta(): void
	{
		foreach ( array( 'vipwf_meta_author', 'vipwf_meta_admin' ) as $login ) {
			$post = $this->xmlrpc()->wp_getPost( array( 1, $login, self::PASSWORD, $this->post_id ) );

			$this->assertIsArray( $post, "{$login} can read the post" );
			$this->assertArrayHasKey( 'custom_fields', $post );

			$keys = wp_list_pluck( $post['custom_fields'], 'key' );
			$this->assertNotContains( StatusManager::SEQUENCE_META_KEY, $keys, $login );
			$this->assertNotContains( StatusManager::STAGE_META_KEY, $keys, $login );
			$this->assertNotContains( self::ASSIGNED_META_KEY, $keys, $login );
		}
	}

	/**
	 * A Contributor on their own draft and an Editor on someone else's post.
	 *
	 * @return array<string, array{0: string, 1: bool}>
	 */
	public static function data_other_editors(): array
	{
		return array(
			'contributor, own draft'   => array( 'contributor', true ),
			'editor, another\'s draft' => array( 'editor', false ),
		);
	}

	/**
	 * Other users who can edit the post hold no meta capability either, and
	 * core's custom-field writer refuses the keys in every spelling that maps
	 * to them, and refuses a meta id that belongs to another post.
	 *
	 * @dataProvider data_other_editors
	 *
	 * @param string $role      Role.
	 * @param bool   $owns_post Whether the user wrote the post.
	 */
	public function test_custom_field_writer_refuses_the_keys_for_other_editors( string $role, bool $owns_post ): void
	{
		$user_id = (int) self::factory()->user->create( array( 'role' => $role ) );
		$owner   = $owns_post ? $user_id : $this->author_id;
		$post_id = (int) self::factory()->post->create(
			array(
				'post_status' => 'draft',
				'post_author' => $owner,
			)
		);

		wp_set_current_user( $user_id );
		$this->assertTrue( current_user_can( 'edit_post', $post_id ), "{$role} can edit the post itself" );

		$server = $this->xmlrpc();

		foreach ( self::data_workflow_meta_keys() as $row ) {
			$meta_key = $row[0];

			foreach ( array( 'add_post_meta', 'edit_post_meta', 'delete_post_meta' ) as $capability ) {
				$this->assertFalse(
					current_user_can( $capability, $post_id, $meta_key ),
					"{$role} must not hold {$capability} on {$meta_key}"
				);
			}

			foreach ( array( $meta_key, strtoupper( $meta_key ), $meta_key . ' ', '\\' . $meta_key ) as $variant ) {
				$server->set_custom_fields( $post_id, array( array( 'key' => $variant, 'value' => '123' ) ) );
				wp_cache_delete( $post_id, 'post_meta' );
				$this->assertSame( '', get_post_meta( $post_id, $meta_key, true ), "{$role}, key spelled '{$variant}'" );
			}

			// The test post's own row, addressed by id from a different post.
			$server->set_custom_fields(
				$post_id,
				array(
					array(
						'id'    => $this->meta_id( $meta_key ),
						'key'   => $meta_key,
						'value' => 'changed',
					),
				)
			);
			$server->set_custom_fields( $post_id, array( array( 'id' => $this->meta_id( $meta_key ) ) ) );
		}

		$this->assert_workflow_state_unchanged();
	}

	/**
	 * metaWeblog.newPost and metaWeblog.editPost go through the same writer.
	 */
	public function test_metaweblog_custom_fields_change_nothing(): void
	{
		$fields = array();
		foreach ( self::data_workflow_meta_keys() as $row ) {
			$fields[] = array(
				'key'   => $row[0],
				'value' => '123',
			);
		}

		$post_id = $this->xmlrpc()->mw_newPost(
			array(
				1,
				'vipwf_meta_author',
				self::PASSWORD,
				array(
					'title'         => 'Created over metaWeblog',
					'custom_fields' => $fields,
				),
				false,
			)
		);

		$this->assertNotInstanceOf( \IXR_Error::class, $post_id );
		$this->assertGreaterThan( 0, (int) $post_id, 'the post itself is created' );

		$result = $this->xmlrpc()->mw_editPost(
			array(
				(int) $post_id,
				'vipwf_meta_author',
				self::PASSWORD,
				array(
					'title'         => 'Edited over metaWeblog',
					'custom_fields' => $fields,
				),
				false,
			)
		);

		$this->assertTrue( $result );
		foreach ( self::data_workflow_meta_keys() as $row ) {
			$this->assertSame( '', get_post_meta( (int) $post_id, $row[0], true ), $row[0] );
		}
	}

	/**
	 * A normal REST save that also sends the keys in `meta` succeeds, and the
	 * keys are ignored.
	 */
	public function test_rest_save_ignores_workflow_meta(): void
	{
		wp_set_current_user( $this->author_id );

		$request = new \WP_REST_Request( 'POST', '/wp/v2/posts/' . $this->post_id );
		$request->set_param( 'title', 'Saved normally' );
		$request->set_param(
			'meta',
			array(
				StatusManager::SEQUENCE_META_KEY => (string) $this->other_sequence_id,
				StatusManager::STAGE_META_KEY    => 'live',
				self::ASSIGNED_META_KEY          => (string) $this->admin_id,
			)
		);

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status(), (string) wp_json_encode( $response->get_data() ) );
		$this->assertSame( 'Saved normally', get_post( $this->post_id )->post_title );
		$this->assert_workflow_state_unchanged();
	}

	/**
	 * The XML-RPC assertions above aren't vacuous: a refused login and a
	 * disabled server both come back as IXR_Error.
	 */
	public function test_xmlrpc_reports_a_refused_login_and_a_disabled_server(): void
	{
		$edit = array(
			1,
			'vipwf_meta_author',
			'wrong-password',
			$this->post_id,
			array( 'post_title' => 'Refused' ),
		);
		$this->assertInstanceOf( \IXR_Error::class, $this->xmlrpc()->wp_editPost( $edit ) );

		add_filter( 'xmlrpc_enabled', '__return_false', 20 );
		$edit[2] = self::PASSWORD;
		$this->assertInstanceOf( \IXR_Error::class, $this->xmlrpc()->wp_editPost( $edit ) );
		remove_filter( 'xmlrpc_enabled', '__return_false', 20 );

		$this->assertSame( 'Protected meta post', get_the_title( $this->post_id ) );
	}

	/**
	 * The plugin's own writes don't go through meta capabilities, so assignment,
	 * transitions and removal still write and delete the keys.
	 */
	public function test_the_plugin_still_writes_workflow_meta(): void
	{
		$status_manager = new StatusManager();

		$post_id = (int) self::factory()->post->create(
			array(
				'post_status' => 'draft',
				'post_author' => $this->author_id,
			)
		);

		wp_set_current_user( $this->author_id );

		$this->assertTrue( $status_manager->assign_sequence( $post_id, $this->sequence_id ) );
		$this->assertSame( (string) $this->sequence_id, (string) get_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, true ) );
		$this->assertSame( 'draft', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
		$this->assertSame( 1, $this->event_count( $post_id, 'workflow.assigned' ) );

		$this->assertTrue( $status_manager->transition( $post_id, 'edit' ) );
		$this->assertSame( 'edit', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );

		// Removal as an administrator, who holds no meta capability on the key
		// either, so this still proves the write doesn't depend on one.
		wp_set_current_user( $this->admin_id );

		$this->assertTrue( $status_manager->remove_sequence( $post_id ) );
		$this->assertSame( '', get_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, true ) );
		$this->assertSame( '', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
		$this->assertSame( 1, $this->event_count( $post_id, 'workflow.removed' ) );
	}
}
