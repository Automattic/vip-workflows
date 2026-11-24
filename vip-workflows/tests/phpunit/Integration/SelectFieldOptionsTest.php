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
	 * The meta id of the select field's row on a post.
	 *
	 * @param  int $post_id Post or revision that holds the row; the test post when 0.
	 * @return int
	 */
	private function select_meta_id( int $post_id = 0 ): int
	{
		foreach ( (array) has_meta( $post_id ? $post_id : $this->post_id ) as $meta ) {
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

	// =========================================================================
	// More than one row for a field
	// =========================================================================

	/**
	 * Give the test post two rows for the select field, as old or imported
	 * data can have. The first is not an option.
	 */
	private function store_two_rows(): void
	{
		wp_set_current_user( 0 );
		add_post_meta( $this->post_id, $this->select_key, 'Old option' );
		add_post_meta( $this->post_id, $this->select_key, 'Staff photo' );
		wp_set_current_user( $this->author_id );
	}

	/**
	 * The editor sends the first row back with every save. Core writes it when
	 * the post has more than one row, so the save is refused before the post
	 * is written, with the message that names the field.
	 */
	public function test_rest_refuses_a_stored_value_that_is_one_of_two_rows_before_anything_is_saved(): void
	{
		$this->store_two_rows();

		$response = $this->rest_save(
			array(
				'title' => 'New title',
				'meta'  => array(
					$this->text_key   => 'New brief',
					$this->select_key => 'Old option',
				),
			)
		);

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'vip_workflows_invalid_metadata_option', $response->get_data()['code'] );
		$this->assertSame( 'Select field post', get_post( $this->post_id )->post_title );
		$this->assertSame( '', (string) get_post_meta( $this->post_id, $this->text_key, true ) );
		$this->assertSame( array( 'Old option', 'Staff photo' ), get_post_meta( $this->post_id, $this->select_key, false ) );
	}

	public function test_rest_stores_an_option_over_two_rows(): void
	{
		$this->store_two_rows();

		$response = $this->rest_save( array( 'meta' => array( $this->select_key => 'No photo needed' ) ) );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array( 'No photo needed', 'No photo needed' ), get_post_meta( $this->post_id, $this->select_key, false ) );
	}

	// =========================================================================
	// Autosaves
	// =========================================================================

	/**
	 * Publish the test post, so an autosave is stored in its own row and does
	 * not write the post.
	 */
	private function publish_the_post(): void
	{
		wp_set_current_user( 0 );
		wp_update_post(
			array(
				'ID'          => $this->post_id,
				'post_status' => 'publish',
			)
		);
		update_post_meta( $this->post_id, StatusManager::STAGE_META_KEY, 'live' );
		wp_set_current_user( $this->author_id );
	}

	/**
	 * Autosave the test post over REST as the current user.
	 *
	 * @param  array $params Body params.
	 * @return \WP_REST_Response
	 */
	private function rest_autosave( array $params ): \WP_REST_Response
	{
		// Core's autosaves route defines DOING_AUTOSAVE as true for the rest
		// of the PHP process, and no later test in the run would then save a
		// revision. Core leaves the constant alone when it is defined, and
		// reads `false` the same as not defined.
		if ( ! defined( 'DOING_AUTOSAVE' ) ) {
			define( 'DOING_AUTOSAVE', false );
		}

		$request = new \WP_REST_Request( 'POST', "/wp/v2/posts/{$this->post_id}/autosaves" );
		foreach ( $params as $key => $value ) {
			$request->set_param( $key, $value );
		}

		return rest_do_request( $request );
	}

	/**
	 * The current user's autosave of the test post.
	 *
	 * @return \WP_Post
	 */
	private function autosave_row(): \WP_Post
	{
		$autosave = wp_get_post_autosave( $this->post_id, get_current_user_id() );
		$this->assertInstanceOf( \WP_Post::class, $autosave, 'the post has an autosave' );

		return $autosave;
	}

	/**
	 * An autosave's row is restored onto the post with no check, so the row
	 * must not take a value the post could not.
	 */
	public function test_restoring_an_autosave_does_not_put_a_value_that_is_not_an_option_on_the_post(): void
	{
		$this->publish_the_post();
		$this->rest_autosave(
			array(
				'title'   => 'Typed title',
				'content' => 'Typed content.',
			)
		);
		$this->rest_autosave(
			array(
				'title'   => 'Typed title again',
				'content' => 'Typed content again.',
				'meta'    => array( $this->select_key => 'Banana' ),
			)
		);

		$autosave = $this->autosave_row();
		$this->assertSame( '', (string) get_metadata( 'post', $autosave->ID, $this->select_key, true ) );

		wp_restore_post_revision( $autosave->ID );

		$this->assertSame( '', $this->stored() );
	}

	/**
	 * Core's autosave route runs the REST check and does not read an error
	 * from it, so an error there would store the autosave without its text.
	 */
	public function test_an_autosave_keeps_its_text_when_its_value_is_not_an_option(): void
	{
		$this->publish_the_post();

		$response = $this->rest_autosave(
			array(
				'title'   => 'Typed title',
				'content' => 'Typed content.',
				'meta'    => array( $this->select_key => 'Banana' ),
			)
		);

		$autosave = $this->autosave_row();
		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'Typed title', $autosave->post_title );
		$this->assertSame( 'Typed content.', $autosave->post_content );
		$this->assertSame( '', (string) get_metadata( 'post', $autosave->ID, $this->select_key, true ) );
		$this->assertSame( '', $this->stored() );
	}

	/**
	 * An autosave of the author's own draft writes the post itself.
	 */
	public function test_an_autosave_of_the_authors_own_draft_keeps_its_text_when_its_value_is_not_an_option(): void
	{
		$response = $this->rest_autosave(
			array(
				'title'   => 'Typed title',
				'content' => 'Typed content.',
				'meta'    => array( $this->select_key => 'Banana' ),
			)
		);

		$post = get_post( $this->post_id );
		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'Typed title', $post->post_title );
		$this->assertSame( 'Typed content.', $post->post_content );
		$this->assertSame( '', $this->stored() );
	}

	/**
	 * The classic editor's autosave reads revisioned meta from the posted form.
	 */
	public function test_a_classic_autosave_does_not_store_a_value_that_is_not_an_option(): void
	{
		$this->publish_the_post();
		$form = array(
			'post_ID'         => $this->post_id,
			'post_type'       => 'post',
			'post_title'      => 'Typed title',
			'content'         => 'Typed content.',
			$this->select_key => 'Banana',
		);

		$_POST = $form;
		try {
			wp_create_post_autosave( wp_slash( $form ) );
		} finally {
			$_POST = array();
		}

		$autosave = $this->autosave_row();
		$this->assertSame( 'Typed title', $autosave->post_title );
		$this->assertSame( '', (string) get_metadata( 'post', $autosave->ID, $this->select_key, true ) );
	}

	/**
	 * The Custom Fields box and XML-RPC change a row by its meta id, and an
	 * autosave's row has one too.
	 */
	public function test_an_autosave_row_edited_by_its_meta_id_does_not_take_a_value_that_is_not_an_option(): void
	{
		$this->publish_the_post();
		$this->rest_autosave(
			array(
				'title'   => 'Typed title',
				'content' => 'Typed content.',
				'meta'    => array( $this->select_key => 'Staff photo' ),
			)
		);
		$autosave = $this->autosave_row();

		$updated = update_metadata_by_mid( 'post', $this->select_meta_id( $autosave->ID ), 'Banana' );

		$this->assertFalse( $updated );
		$this->assertSame( 'Staff photo', get_metadata( 'post', $autosave->ID, $this->select_key, true ) );
	}

	/**
	 * The editor sends every meta value with an autosave too, so the autosave
	 * takes a value the post holds, whatever it is.
	 */
	public function test_an_autosave_takes_a_stored_value_whose_option_was_removed(): void
	{
		$this->rest_save( array( 'meta' => array( $this->select_key => 'Archive photo' ) ) );
		$this->publish_the_post();
		$this->replace_options( array( 'No photo needed', 'Staff photo' ) );

		$response = $this->rest_autosave(
			array(
				'title'   => 'Typed title',
				'content' => 'Typed content.',
				'meta'    => array( $this->select_key => 'Archive photo' ),
			)
		);

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'Archive photo', get_metadata( 'post', $this->autosave_row()->ID, $this->select_key, true ) );
	}
}
