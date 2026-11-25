<?php
/**
 * Metadata Option Guard - keeps a select metadata field to its options.
 *
 * @package VIPWorkflows
 */

declare( strict_types=1 );

namespace VIPWorkflows\Workflow;

/**
 * Refuses a value for a select metadata field that isn't one of its options.
 *
 * A select field is registered as string post meta (Plugin::register_metadata_fields()),
 * so the meta API takes any text for it. The editor only offers the field's
 * options, but the value can also be written through the core REST `meta`
 * field, XML-RPC `custom_fields`, the Custom Fields box and update_post_meta().
 * A required field that holds any text passes the required-fields check
 * (Sequence::metadata_value_is_empty()), so the options have to be held at the
 * write.
 *
 * A value is allowed when it is one of the options, or empty, which clears the
 * field. The check works in two places:
 *
 * - `rest_pre_insert_{post_type}` returns a 400 that names the field, before
 *   anything from the request is saved. The block editor saves this way.
 * - `add_post_metadata`, `update_post_metadata` and
 *   `update_post_metadata_by_mid` stop the write on every other path. The
 *   write reports failure and the stored value stays as it was.
 *
 * A value that is already stored is never touched, whatever it is. An option
 * can be removed from a sequence, or reworded, after posts have chosen it, and
 * those posts keep their value until someone chooses another. That is why this
 * is not a sanitize callback: the block editor sends every meta value with a
 * save, changed or not, and a callback that emptied a value outside the options
 * would empty those posts' values on their next save. It is also why three
 * kinds of write are let through below (see is_exempt_write()).
 *
 * A revision or autosave row is held too, to an option or a value its post
 * holds, because a restore copies the row onto the post. The classic editor's
 * autosave deletes its row before it adds a value, so a value that would be
 * refused is taken out of its posted fields first (see
 * drop_refused_autosave_fields()).
 *
 * Only fields of active sequences are known here, the same fields that are
 * registered as post meta.
 */
class MetadataOptionGuard {

	/**
	 * Select fields, keyed by meta key.
	 *
	 * @var array<string, array{label: string, options: string[]}>
	 */
	private array $fields = array();

	/**
	 * Replace the select fields the guard knows.
	 *
	 * Options are compared the way a value is stored: as a string, after the
	 * `sanitize_text_field` the meta is registered with. An option that
	 * sanitizing changes (doubled spaces, say) would otherwise never match the
	 * value the editor stored for it.
	 *
	 * @param array<string, array{label: string, options: array}> $fields Select fields, keyed by meta key.
	 */
	public function set_fields( array $fields ): void {
		$this->fields = array();

		foreach ( $fields as $meta_key => $field ) {
			$options = array();
			foreach ( (array) ( $field['options'] ?? array() ) as $option ) {
				if ( is_scalar( $option ) ) {
					$options[] = sanitize_text_field( (string) $option );
				}
			}

			$this->fields[ (string) $meta_key ] = array(
				'label'   => (string) ( $field['label'] ?? $meta_key ),
				'options' => $options,
			);
		}
	}

	/**
	 * Hook the meta API and the classic editor's autosave. Safe to call again:
	 * the same callbacks replace themselves.
	 */
	public function init(): void {
		add_filter( 'add_post_metadata', array( $this, 'check_write' ), 10, 4 );
		add_filter( 'update_post_metadata', array( $this, 'check_write' ), 10, 4 );
		add_filter( 'update_post_metadata_by_mid', array( $this, 'check_write_by_mid' ), 10, 4 );

		// Before core's own callback at 10, which reads the posted fields.
		add_action( 'wp_creating_autosave', array( $this, 'drop_refused_autosave_fields' ), 9 );
	}

	/**
	 * Hook the REST save of a post type the fields are registered on.
	 *
	 * @param string $post_type Post type slug.
	 */
	public function guard_rest_post_type( string $post_type ): void {
		add_filter( "rest_pre_insert_{$post_type}", array( $this, 'check_rest_insert' ), 10, 2 );
	}

	/**
	 * REST: refuse the save with a message that names the field.
	 *
	 * Runs before the post is written, so nothing from a refused request is
	 * saved. The editor sends every meta value with a save, so a value equal
	 * to the stored one is not this request's choice and is let through; core
	 * then sees no change and writes nothing for it. That holds only when the
	 * post has one row for the key. With more rows core writes the value, and
	 * the write would be refused after the post is saved, so the value is
	 * refused here first.
	 *
	 * An autosave is not refused here. Core's autosaves route runs this filter
	 * and does not read an error from it, so an error would store the autosave
	 * without its title and content. An autosave's value is held where it is
	 * written (see is_exempt_write()), and the person's own save gets the 400.
	 *
	 * @param  \stdClass|\WP_Error $prepared_post Post object prepared for the database.
	 * @param  \WP_REST_Request    $request       The REST request.
	 * @return \stdClass|\WP_Error The prepared post, or WP_Error when a value is refused.
	 */
	public function check_rest_insert( $prepared_post, $request ) {
		if ( is_wp_error( $prepared_post ) || ! $request instanceof \WP_REST_Request || $this->is_autosave_request( $request ) ) {
			return $prepared_post;
		}

		$meta = $request->get_param( 'meta' );
		if ( ! is_array( $meta ) ) {
			return $prepared_post;
		}

		$post_id = (int) ( $prepared_post->ID ?? 0 );

		foreach ( array_intersect_key( $meta, $this->fields ) as $meta_key => $value ) {
			// Null resets the field (core deletes the row) and reads as empty here.
			if ( $this->is_allowed_value( (string) $meta_key, $value ) ) {
				continue;
			}

			$value = $this->as_stored( $value );

			if ( $post_id > 0 && array( $value ) === $this->stored_values( $post_id, (string) $meta_key ) ) {
				continue;
			}

			return new \WP_Error(
				'vip_workflows_invalid_metadata_option',
				sprintf(
					/* translators: 1: the value that was sent, 2: metadata field label. */
					__( '“%1$s” isn’t one of the options for “%2$s”.', 'vip-workflows' ),
					$value,
					$this->fields[ $meta_key ]['label']
				),
				array(
					'status'   => 400,
					'meta_key' => (string) $meta_key, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key -- error data, not a query.
					'options'  => $this->fields[ $meta_key ]['options'],
				)
			);
		}

		return $prepared_post;
	}

	/**
	 * Whether a REST request is handled by core's autosaves controller.
	 *
	 * @param  \WP_REST_Request $request The REST request.
	 * @return bool
	 */
	private function is_autosave_request( \WP_REST_Request $request ): bool {
		$attributes = $request->get_attributes();
		$callback   = is_array( $attributes ) ? ( $attributes['callback'] ?? null ) : null;

		return is_array( $callback ) && ( $callback[0] ?? null ) instanceof \WP_REST_Autosaves_Controller;
	}

	/**
	 * The meta API: stop add_post_meta() and update_post_meta() storing a refused value.
	 *
	 * Returning false makes the write report failure and leaves the stored
	 * value as it was. This filter runs on every post meta write on the site,
	 * so the first test is the cheapest: a key that is not a select field.
	 *
	 * @param  mixed  $check      Null, unless another callback has decided the write.
	 * @param  int    $object_id  Post ID.
	 * @param  string $meta_key   Meta key.
	 * @param  mixed  $meta_value Value to store.
	 * @return mixed The value given, or false when the write is refused.
	 */
	public function check_write( $check, $object_id, $meta_key, $meta_value ) {
		if ( null !== $check || ! isset( $this->fields[ (string) $meta_key ] ) ) {
			return $check;
		}

		return $this->refuses( (int) $object_id, (string) $meta_key, $meta_value ) ? false : $check;
	}

	/**
	 * The meta API: the same check for a row edited by its meta id.
	 *
	 * This is how the Custom Fields box and XML-RPC `custom_fields` change an
	 * existing row. The key is only passed when the edit renames the row, so
	 * it is read from the row otherwise.
	 *
	 * @param  mixed        $check      Null, unless another callback has decided the write.
	 * @param  int          $meta_id    Meta row ID.
	 * @param  mixed        $meta_value Value to store.
	 * @param  string|false $meta_key   New meta key, or false to keep the row's key.
	 * @return mixed The value given, or false when the write is refused.
	 */
	public function check_write_by_mid( $check, $meta_id, $meta_value, $meta_key = false ) {
		if ( null !== $check || empty( $this->fields ) ) {
			return $check;
		}

		$row = get_metadata_by_mid( 'post', (int) $meta_id );
		if ( ! $row ) {
			return $check;
		}

		$meta_key = is_string( $meta_key ) && '' !== $meta_key ? $meta_key : (string) $row->meta_key;
		if ( ! isset( $this->fields[ $meta_key ] ) ) {
			return $check;
		}

		return $this->refuses( (int) $row->post_id, $meta_key, $meta_value ) ? false : $check;
	}

	/**
	 * The classic editor's autosave: take a value that would be refused out of
	 * the posted fields.
	 *
	 * Core's callback on `wp_creating_autosave` reads each revisioned meta key
	 * from the posted fields, deletes the autosave's row and adds the posted
	 * value (wp_autosave_post_revisioned_meta_fields()). When the add is
	 * refused the row is gone, and a restore of that autosave would empty the
	 * post's field. With the key out of the posted fields, core leaves the
	 * autosave's row as it is.
	 *
	 * The fields are `$_POST` for the editor form, or
	 * `$_POST['data']['wp_autosave']` for the heartbeat, the same two places
	 * core reads. Core has checked the nonce before this action fires.
	 *
	 * @param array $new_autosave The autosave revision, as an array.
	 */
	public function drop_refused_autosave_fields( $new_autosave ): void {
		$autosave_id = is_array( $new_autosave ) ? (int) ( $new_autosave['ID'] ?? 0 ) : 0;
		if ( $autosave_id <= 0 ) {
			return;
		}

		// phpcs:disable WordPress.Security.NonceVerification.Missing, WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- core verified the nonce before this action; the values are only compared here, never stored.
		$in_heartbeat = isset( $_POST['data']['wp_autosave'] ) && is_array( $_POST['data']['wp_autosave'] );
		$posted       = $in_heartbeat ? $_POST['data']['wp_autosave'] : $_POST;

		foreach ( array_keys( array_intersect_key( $this->fields, $posted ) ) as $meta_key ) {
			if ( ! $this->refuses( $autosave_id, (string) $meta_key, wp_unslash( $posted[ $meta_key ] ) ) ) {
				continue;
			}

			if ( $in_heartbeat ) {
				unset( $_POST['data']['wp_autosave'][ $meta_key ] );
			} else {
				unset( $_POST[ $meta_key ] );
			}
		}
		// phpcs:enable
	}

	/**
	 * Whether a meta API write is refused, logging it when it is.
	 *
	 * @param  int    $post_id  Post the value would be stored on.
	 * @param  string $meta_key Meta key of a select field.
	 * @param  mixed  $value    Value to store.
	 * @return bool
	 */
	private function refuses( int $post_id, string $meta_key, $value ): bool {
		if ( $this->is_allowed_value( $meta_key, $value ) || $this->is_exempt_write( $post_id, $meta_key, $value ) ) {
			return false;
		}

		// These paths can't show a message (the Custom Fields box and XML-RPC
		// report the save as made), so the log is where a refusal is recorded.
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( sprintf( '[VIP Workflows] Did not store a value for the select field "%s" on post %d for user %d: it is not one of the field\'s options.', $meta_key, $post_id, get_current_user_id() ) );

		return true;
	}

	/**
	 * Whether a value is one a select field takes: one of its options, or empty.
	 *
	 * @param  string $meta_key Meta key of a select field.
	 * @param  mixed  $value    Value to store.
	 * @return bool
	 */
	private function is_allowed_value( string $meta_key, $value ): bool {
		$value = $this->as_stored( $value );

		return '' === $value || in_array( $value, $this->fields[ $meta_key ]['options'], true );
	}

	/**
	 * A value as the registered sanitize callback stores it.
	 *
	 * @param  mixed $value Value to store.
	 * @return string
	 */
	private function as_stored( $value ): string {
		return is_scalar( $value ) ? sanitize_text_field( (string) $value ) : '';
	}

	/**
	 * Whether a meta API write is one that copies a value, not one a person chose.
	 *
	 * These writes can carry a value that was an option when it was stored and
	 * is not one now. Refusing them would lose it:
	 *
	 * - No logged-in user: WP-CLI, a seeder or cron. An import run from
	 *   wp-admin is checked. The same rule PublishBoundaryGuard applies to a
	 *   status change.
	 * - A revision or autosave row that takes a value its post holds: core
	 *   copies a post's meta to each revision and autosave. An autosave also
	 *   takes values from the request, and the row is restored onto the post
	 *   with no check, so the row takes no other value the post could not.
	 * - A revision restore: core deletes the post's row and adds the
	 *   revision's value (wp_restore_post_revision_meta()), so refusing the
	 *   add would leave the field empty.
	 *
	 * @param  int    $post_id  Post the value would be stored on.
	 * @param  string $meta_key Meta key of a select field.
	 * @param  mixed  $value    Value to store.
	 * @return bool
	 */
	private function is_exempt_write( int $post_id, string $meta_key, $value ): bool {
		if ( ! get_current_user_id() ) {
			return true;
		}

		$parent_id = (int) wp_is_post_revision( $post_id );
		if ( $parent_id > 0 ) {
			// Compared as given: core copies a row as it is stored.
			return is_scalar( $value ) && in_array( (string) $value, $this->stored_values( $parent_id, $meta_key ), true );
		}

		return (bool) doing_action( 'wp_restore_post_revision' );
	}

	/**
	 * The values a post holds for a select field, one for each meta row.
	 *
	 * @param  int    $post_id  Post ID.
	 * @param  string $meta_key Meta key of a select field.
	 * @return array<int, string|null> A row that isn't text is null, so it counts as a row and equals no value.
	 */
	private function stored_values( int $post_id, string $meta_key ): array {
		$values = array();

		foreach ( (array) get_post_meta( $post_id, $meta_key, false ) as $row ) {
			$values[] = is_scalar( $row ) ? (string) $row : null;
		}

		return $values;
	}
}
