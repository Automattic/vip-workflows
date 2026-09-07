<?php
/**
 * `_vip_workflows_sequence_id` is workflow state, not a public field.
 *
 * Previously, the key was registered for every post type with
 * `show_in_rest => true` and an `auth_callback`. The callback gated writes but
 * said nothing about reads, so core served the value to anonymous callers on
 * any published post. Supplying the `auth_callback` also overrode core's
 * `is_protected_meta()` default-deny for a leading-underscore key, so the key
 * became writable over `/wp/v2/posts` by anyone holding `edit_post`.
 *
 * Writing it is how a post leaves the workflow. Setting it to 0 (or deleting it)
 * makes `PublishBoundaryGuard::resolve_veto()` short-circuit and
 * `crosses_publish_boundary()` return false, and the post exits with no
 * `workflow.removed` audit event, no stage or claim cleanup, and an orphaned
 * `_vip_workflows_current_stage_key`. The plugin has a first-class route for
 * that same operation whose docblock calls the audit entry "the entire reason
 * this operation is acceptable". This was the unaudited door beside it.
 *
 * The key is read nowhere in src/ or build/, so removing it from REST costs
 * nothing.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

class SequenceIdMetaNotInRestTest extends TestCase {

	/**
	 * The meta key under test.
	 */
	private const META_KEY = '_vip_workflows_sequence_id';

	/**
	 * A published post already seated in a workflow.
	 *
	 * @var int
	 */
	private int $post_id;

	public function set_up(): void {
		parent::set_up();

		// WP_UnitTestCase restores $wp_meta_keys between tests, so the
		// registration the plugin performed on init is gone by the second test in
		// the file. Re-running it here is what makes these assertions about the
		// plugin's own registration rather than about test ordering — and with
		// executionOrder="depends,defects" that order is not even stable.
		\VIPWorkflows\Plugin::get_instance()->register_meta();

		$this->post_id = (int) self::factory()->post->create( array( 'post_status' => 'publish' ) );
		update_post_meta( $this->post_id, self::META_KEY, 7 );
	}

	/**
	 * An anonymous reader is not told which workflow a post is in.
	 *
	 * A sentinel key is registered alongside so the response is guaranteed to
	 * carry a `meta` object at all. Without it this assertion passes whenever
	 * nothing else on the post type is REST-exposed — the response simply omits
	 * `meta`, and an absent object trivially does not contain the key.
	 */
	public function test_anonymous_read_does_not_expose_the_key(): void {
		register_post_meta(
			'post',
			'vipwf_sentinel',
			array(
				'type'         => 'string',
				'single'       => true,
				'show_in_rest' => true,
			)
		);
		update_post_meta( $this->post_id, 'vipwf_sentinel', 'present' );
		self::reset_rest_server();

		wp_set_current_user( 0 );

		$response = rest_get_server()->dispatch(
			new \WP_REST_Request( 'GET', '/wp/v2/posts/' . $this->post_id )
		);
		$data = $response->get_data();

		unregister_post_meta( 'post', 'vipwf_sentinel' );

		$this->assertSame( 200, $response->get_status(), 'the post itself is still public' );
		$this->assertArrayHasKey( 'meta', $data, 'the response carries a meta object' );
		$this->assertSame( 'present', $data['meta']['vipwf_sentinel'], 'and the sentinel proves it is populated' );
		$this->assertArrayNotHasKey( self::META_KEY, $data['meta'] );
	}

	/**
	 * The registration itself does not opt the key into REST.
	 *
	 * Asserted against the registry rather than a response, because that is the
	 * single fact every route derives from — the key is registered for every
	 * post type, so checking one route's output would leave the others unproven.
	 */
	public function test_the_registration_is_not_exposed_to_rest(): void {
		$registered = get_registered_meta_keys( 'post', '' );

		$this->assertArrayHasKey( self::META_KEY, $registered, 'the meta is still registered' );
		$this->assertFalse( $registered[ self::META_KEY ]['show_in_rest'] );
	}

	/**
	 * A post cannot be walked out of its workflow through the meta endpoint.
	 *
	 * This is the finding. The actor set is the same one the plugin already
	 * authorises on its own audited removal route, so no capability is gained —
	 * what is gained is a way to do it with nothing written to the audit trail.
	 */
	public function test_rest_write_cannot_detach_the_post_from_its_workflow(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

		$request = new \WP_REST_Request( 'POST', '/wp/v2/posts/' . $this->post_id );
		$request->set_header( 'content-type', 'application/json' );
		$request->set_body( wp_json_encode( array( 'meta' => array( self::META_KEY => 0 ) ) ) );
		rest_get_server()->dispatch( $request );

		$this->assertSame(
			'7',
			(string) get_post_meta( $this->post_id, self::META_KEY, true ),
			'the workflow seat must survive a REST meta write'
		);
	}

	/**
	 * The value is still there for the code that owns it.
	 *
	 * The counterweight: this removes a REST field, not the meta. Everything
	 * server-side reads it exactly as before.
	 */
	public function test_the_meta_itself_is_untouched(): void {
		$this->assertSame( '7', (string) get_post_meta( $this->post_id, self::META_KEY, true ) );
	}
}
