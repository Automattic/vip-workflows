<?php
/**
 * A select metadata field holds one of its options, or nothing.
 *
 * A select field is registered as string post meta, so the meta API alone takes
 * any text for it. These tests pin that a person can't set it to a value that
 * isn't one of the field's options, by any of the paths a person writes post
 * meta through: the core REST `meta` field (how the block editor saves),
 * XML-RPC `custom_fields` and the Custom Fields box (which reach
 * add_post_meta() and update_metadata_by_mid()), and update_post_meta().
 *
 * They also pin what the check must leave alone: a value that is already
 * stored. The block editor sends every meta value with a save, changed or not,
 * and an option can be removed from a sequence after posts have chosen it.
 *
 * Integration because the paths under test are core's own REST controller,
 * XML-RPC server, revisions and meta API, with the plugin's real registration.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Plugin;
use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Workflow\StatusManager;

require_once ABSPATH . 'wp-admin/includes/admin.php';
require_once ABSPATH . WPINC . '/class-IXR.php';
require_once ABSPATH . WPINC . '/class-wp-xmlrpc-server.php';

/**
 * Real-WordPress tests for the values a select metadata field takes.
 */
class SelectFieldOptionsTest extends TestCase
{
	/**
	 * Password shared by the test users.
	 */
	private const PASSWORD = 'password';

	/**
	 * Administrator who owns the sequence.
	 *
	 * @var int
	 */
	private int $admin_id;

	/**
	 * Author who owns the post.
	 *
	 * @var int
	 */
	private int $author_id;

	/**
	 * Sequence with a required select field and a text field.
	 *
	 * @var int
	 */
	private int $sequence_id;

	/**
	 * Draft post in the sequence, owned by the Author.
	 *
	 * @var int
	 */
	private int $post_id;

	/**
	 * Meta key of the select field.
	 *
	 * @var string
	 */
	private string $select_key;

	/**
	 * Meta key of the text field.
	 *
	 * @var string
	 */
	private string $text_key;

	public function set_up(): void
	{
		parent::set_up();

		add_filter( 'xmlrpc_enabled', '__return_true' );

		$this->admin_id  = (int) self::factory()->user->create( array( 'role' => 'administrator' ) );
		$this->author_id = (int) self::factory()->user->create(
			array(
				'role'       => 'author',
				'user_login' => 'vipwf_select_author',
				'user_pass'  => self::PASSWORD,
			)
		);

		$this->sequence_id = (int) ( new SequenceRepository() )->create(
			'Photo Desk',
			'photo-desk-' . wp_generate_password( 6, false ),
			'',
			$this->config( array( 'No photo needed', 'Staff photo', 'Archive photo' ) ),
			$this->admin_id
		);
		$this->select_key  = 'wf_meta_' . $this->sequence_id . '_photo_needs';
		$this->text_key    = 'wf_meta_' . $this->sequence_id . '_photo_brief';

		// Registration runs on `init`, before this sequence existed, and
		// WP_UnitTestCase restores the registered meta between tests.
		Plugin::get_instance()->register_meta();

		$this->post_id = (int) self::factory()->post->create(
			array(
				'post_title'  => 'Select field post',
				'post_status' => 'draft',
				'post_author' => $this->author_id,
			)
		);
		update_post_meta( $this->post_id, StatusManager::SEQUENCE_META_KEY, $this->sequence_id );
		update_post_meta( $this->post_id, StatusManager::STAGE_META_KEY, 'writing' );

		wp_set_current_user( $this->author_id );
	}

	public function tear_down(): void
	{
		remove_filter( 'xmlrpc_enabled', '__return_true' );
		wp_set_current_user( 0 );

		parent::tear_down();
	}

	// =========================================================================
	// Fixtures
	// =========================================================================

	/**
	 * Sequence config: one draft stage, one published stage, a required select
	 * field with the given options, and a text field.
	 *
	 * @param  string[] $options Options of the select field.
	 * @return array<string, mixed>
	 */
	private function config( array $options ): array
	{
		return array(
			'post_types'      => array( 'post' ),
			'statuses'        => array(
				array(
					'key'         => 'writing',
					'label'       => 'Writing',
					'status'      => 'draft',
					'transitions' => array( array( 'to' => 'live' ) ),
				),
				array(
					'key'         => 'live',
					'label'       => 'Live',
					'status'      => 'publish',
					'transitions' => array(),
				),
			),
			'metadata_fields' => array(
				array(
					'key'      => 'photo_needs',
					'label'    => 'Photo needs',
					'type'     => 'select',
					'options'  => $options,
					'required' => true,
				),
				array(
					'key'   => 'photo_brief',
					'label' => 'Photo brief',
					'type'  => 'text',
				),
			),
		);
	}

	/**
	 * Take an option out of the sequence, as a later edit of the sequence does.
	 *
	 * @param string[] $options Options the select field keeps.
	 */
	private function replace_options( array $options ): void
	{
		wp_set_current_user( $this->admin_id );
		( new SequenceRepository() )->update( $this->sequence_id, array( 'config' => $this->config( $options ) ) );
		Plugin::get_instance()->register_meta();
		wp_set_current_user( $this->author_id );
	}

	/**
	 * Save the post over REST as the current user.
	 *
	 * @param  array $params Body params.
	 * @param  int   $post_id Post to update, or 0 to create one.
	 * @return \WP_REST_Response
	 */
	private function rest_save( array $params, int $post_id = -1 ): \WP_REST_Response
	{
		$post_id = -1 === $post_id ? $this->post_id : $post_id;
		$request = new \WP_REST_Request( 'POST', $post_id ? "/wp/v2/posts/{$post_id}" : '/wp/v2/posts' );
		foreach ( $params as $key => $value ) {
			$request->set_param( $key, $value );
		}

		return rest_do_request( $request );
	}

	/**
	 * The stored value of the select field.
	 *
	 * @return string
	 */
	private function stored(): string
	{
		return (string) get_post_meta( $this->post_id, $this->select_key, true );
	}

	/**
	 * The meta id of the select field's row on the test post.
	 *
	 * @return int
	 */
	private function select_meta_id(): int
	{
		foreach ( (array) has_meta( $this->post_id ) as $meta ) {
			if ( $this->select_key === $meta['meta_key'] ) {
				return (int) $meta['meta_id'];
			}
		}

		$this->fail( 'No select field row on the test post.' );
	}

	// =========================================================================
	// REST, how the block editor saves
	// =========================================================================

	public function test_rest_refuses_a_value_that_is_not_an_option(): void
	{
		$response = $this->rest_save(
			array(
				'title' => 'Renamed post',
				'meta'  => array( $this->select_key => 'Banana' ),
			)
		);

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'vip_workflows_invalid_metadata_option', $response->get_data()['code'] );
		$this->assertSame( '“Banana” isn’t one of the options for “Photo needs”.', $response->get_data()['message'] );
		$this->assertSame( '', $this->stored() );
		$this->assertSame( 'Select field post', get_post( $this->post_id )->post_title, 'nothing from the refused save is written' );
	}

	public function test_a_refused_value_leaves_the_required_field_missing(): void
	{
		$this->rest_save( array( 'meta' => array( $this->select_key => 'Banana' ) ) );

		$missing = ( new SequenceRepository() )->find( $this->sequence_id )->get_missing_required_metadata( $this->post_id );

		$this->assertSame( array( 'photo_needs' ), array_column( $missing, 'key' ) );
	}

	public function test_rest_stores_an_option_and_clears_the_field(): void
	{
		$chosen = $this->rest_save( array( 'meta' => array( $this->select_key => 'Staff photo' ) ) );

		$this->assertSame( 200, $chosen->get_status() );
		$this->assertSame( 'Staff photo', $this->stored() );

		$cleared = $this->rest_save( array( 'meta' => array( $this->select_key => '' ) ) );

		$this->assertSame( 200, $cleared->get_status() );
		$this->assertSame( '', $this->stored() );
	}

	public function test_rest_does_not_check_other_field_types(): void
	{
		$response = $this->rest_save( array( 'meta' => array( $this->text_key => 'Banana' ) ) );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'Banana', get_post_meta( $this->post_id, $this->text_key, true ) );
	}

	public function test_rest_refuses_a_new_post_with_a_value_that_is_not_an_option(): void
	{
		$before = (int) wp_count_posts()->draft;

		$response = $this->rest_save(
			array(
				'title'  => 'New post',
				'status' => 'draft',
				'meta'   => array( $this->select_key => 'Banana' ),
			),
			0
		);

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'vip_workflows_invalid_metadata_option', $response->get_data()['code'] );
		$this->assertSame( $before, (int) wp_count_posts()->draft, 'no post was created' );
	}

	/**
	 * The block editor sends every meta value with a save. A value whose option
	 * was removed from the sequence is sent back unchanged, and the save must
	 * go through with the value kept.
	 */
	public function test_rest_keeps_a_stored_value_whose_option_was_removed(): void
	{
		$this->rest_save( array( 'meta' => array( $this->select_key => 'Archive photo' ) ) );
		$this->replace_options( array( 'No photo needed', 'Staff photo' ) );

		$response = $this->rest_save(
			array(
				'title' => 'Renamed post',
				'meta'  => array(
					$this->select_key => 'Archive photo',
					$this->text_key   => 'At the town hall.',
				),
			)
		);

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'Archive photo', $this->stored() );
		$this->assertSame( 'At the town hall.', get_post_meta( $this->post_id, $this->text_key, true ) );
		$this->assertSame( 'Renamed post', get_post( $this->post_id )->post_title );
	}

	public function test_rest_refuses_a_change_to_another_value_that_is_not_an_option(): void
	{
		$this->rest_save( array( 'meta' => array( $this->select_key => 'Archive photo' ) ) );
		$this->replace_options( array( 'No photo needed', 'Staff photo' ) );

		$response = $this->rest_save( array( 'meta' => array( $this->select_key => 'Banana' ) ) );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'Archive photo', $this->stored() );
	}

	// =========================================================================
	// The other paths a person writes post meta through
	// =========================================================================

	public function test_update_post_meta_does_not_store_a_value_that_is_not_an_option(): void
	{
		$this->assertFalse( update_post_meta( $this->post_id, $this->select_key, 'Banana' ) );
		$this->assertSame( '', $this->stored() );

		$this->assertNotFalse( update_post_meta( $this->post_id, $this->select_key, 'Staff photo' ) );
		$this->assertFalse( update_post_meta( $this->post_id, $this->select_key, 'Banana' ) );
		$this->assertSame( 'Staff photo', $this->stored(), 'the stored value is kept' );
	}

	public function test_add_post_meta_does_not_store_a_value_that_is_not_an_option(): void
	{
		$this->assertFalse( add_post_meta( $this->post_id, $this->select_key, 'Banana' ) );
		$this->assertSame( array(), get_post_meta( $this->post_id, $this->select_key ) );
	}

	public function test_xmlrpc_custom_fields_do_not_store_a_value_that_is_not_an_option(): void
	{
		update_post_meta( $this->post_id, $this->select_key, 'Staff photo' );
		$server = new \wp_xmlrpc_server();

		// By meta id (how an existing Custom Fields row is edited), then by name.
		foreach ( array( array( 'id' => $this->select_meta_id() ), array() ) as $row ) {
			$result = $server->wp_editPost(
				array(
					1,
					'vipwf_select_author',
					self::PASSWORD,
					$this->post_id,
					array(
						'custom_fields' => array(
							array_merge(
								$row,
								array(
									'key'   => $this->select_key,
									'value' => 'Banana',
								)
							),
						),
					),
				)
			);

			$this->assertNotInstanceOf( \IXR_Error::class, $result );
			$this->assertSame( array( 'Staff photo' ), get_post_meta( $this->post_id, $this->select_key ) );
		}
	}

	public function test_xmlrpc_custom_fields_store_an_option(): void
	{
		update_post_meta( $this->post_id, $this->select_key, 'Staff photo' );

		$result = ( new \wp_xmlrpc_server() )->wp_editPost(
			array(
				1,
				'vipwf_select_author',
				self::PASSWORD,
				$this->post_id,
				array(
					'custom_fields' => array(
						array(
							'id'    => $this->select_meta_id(),
							'key'   => $this->select_key,
							'value' => 'No photo needed',
						),
					),
				),
			)
		);

		$this->assertNotInstanceOf( \IXR_Error::class, $result );
		$this->assertSame( 'No photo needed', $this->stored() );
	}

	// =========================================================================
	// Writes that are not a person choosing a value
	// =========================================================================

	public function test_a_write_with_no_logged_in_user_is_stored(): void
	{
		wp_set_current_user( 0 );

		update_post_meta( $this->post_id, $this->select_key, 'Imported value' );

		$this->assertSame( 'Imported value', $this->stored() );
	}

	/**
	 * Core restores a revision's meta by deleting the post's row and adding
	 * the revision's value. A value whose option was removed since must come
	 * back, or the restore would lose it.
	 */
	public function test_restoring_a_revision_brings_back_a_value_whose_option_was_removed(): void
	{
		$this->rest_save(
			array(
				'content' => 'First version.',
				'meta'    => array( $this->select_key => 'Archive photo' ),
			)
		);
		$this->rest_save(
			array(
				'content' => 'Second version.',
				'meta'    => array( $this->select_key => 'Staff photo' ),
			)
		);

		$first = null;
		foreach ( wp_get_post_revisions( $this->post_id ) as $revision ) {
			if ( 'First version.' === $revision->post_content ) {
				$first = $revision;
			}
		}
		$this->assertNotNull( $first, 'the first save left a revision' );
		$this->assertSame( 'Archive photo', get_metadata( 'post', $first->ID, $this->select_key, true ), 'the revision holds the first value' );

		$this->replace_options( array( 'No photo needed', 'Staff photo' ) );

		wp_restore_post_revision( $first->ID );

		$this->assertSame( 'First version.', get_post( $this->post_id )->post_content );
		$this->assertSame( 'Archive photo', $this->stored() );
	}

	public function test_a_save_still_copies_the_stored_value_to_its_revision(): void
	{
		$this->rest_save( array( 'meta' => array( $this->select_key => 'Archive photo' ) ) );
		$this->replace_options( array( 'No photo needed', 'Staff photo' ) );

		$this->rest_save( array( 'content' => 'A later version.' ) );

		$latest = current( wp_get_post_revisions( $this->post_id ) );
		$this->assertSame( 'A later version.', $latest->post_content );
		$this->assertSame( 'Archive photo', get_metadata( 'post', $latest->ID, $this->select_key, true ) );
	}
}
