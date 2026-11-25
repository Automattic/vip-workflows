<?php
/**
 * MetadataOptionGuard unit tests.
 *
 * Covers the decision: which values a select metadata field takes, which
 * writes are let through whatever the value, and what each hook answers. The
 * paths themselves (REST, XML-RPC, revisions) run against real WordPress in
 * SelectFieldOptionsTest.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflows\Workflow\MetadataOptionGuard;

/**
 * Tests for the guard that keeps a select field to its options.
 */
class MetadataOptionGuardTest extends TestCase
{
    /**
     * Meta key of the select field the guard knows.
     */
    private const KEY = 'wf_meta_4_photo_needs';

    /**
     * Post ID used throughout.
     */
    private const POST_ID = 42;

    /**
     * Guard under test.
     *
     * @var MetadataOptionGuard
     */
    private MetadataOptionGuard $guard;

    /**
     * Value stored for the select field on the fixture post.
     *
     * @var string
     */
    private string $stored = '';

    /**
     * Every row stored for the select field, when a test needs more than the
     * one row `$stored` stands for.
     *
     * @var array<int, mixed>|null
     */
    private ?array $rows = null;

    /**
     * Post IDs the guard read the stored rows of.
     *
     * @var int[]
     */
    private array $posts_read = array();

    protected function setUp(): void
    {
        parent::setUp();

        Functions\when( 'sanitize_text_field' )->alias(
            static function ( $value ) {
                return trim( (string) preg_replace( '/\s+/', ' ', (string) $value ) );
            }
        );
        Functions\when( 'get_current_user_id' )->justReturn( 5 );
        Functions\when( 'wp_is_post_revision' )->justReturn( false );
        Functions\when( 'doing_action' )->justReturn( false );
        Functions\when( 'get_post_meta' )->alias(
            function ( $post_id, $key = '', $single = false ) {
                $this->posts_read[] = (int) $post_id;
                $rows               = $this->rows ?? ( '' === $this->stored ? array() : array( $this->stored ) );

                return $single ? ( $rows[0] ?? '' ) : $rows;
            }
        );

        $this->guard = new MetadataOptionGuard();
        $this->guard->set_fields(
            array(
                self::KEY => array(
                    'label'   => 'Photo needs',
                    'options' => array( 'No photo needed', 'Staff  photo', 7 ),
                ),
            )
        );
    }

    /**
     * Run a callback with error_log() captured, and return what was logged.
     *
     * @param  callable $callback Work that may log.
     * @return string The log output.
     */
    private function capture_log( callable $callback ): string
    {
        $file     = (string) tempnam( sys_get_temp_dir(), 'vipwf-option-guard-log' );
        $previous = ini_set( 'error_log', $file );
        try {
            $callback();
        } finally {
            ini_set( 'error_log', (string) $previous );
        }
        $log = (string) file_get_contents( $file );
        unlink( $file );

        return $log;
    }

    /**
     * Ask the update_post_metadata filter about a value, with the log captured.
     *
     * @param  mixed  $value    Value to store.
     * @param  string $meta_key Meta key.
     * @return mixed The filter's answer.
     */
    private function write( $value, string $meta_key = self::KEY )
    {
        $answer = null;
        $this->capture_log(
            function () use ( &$answer, $value, $meta_key ): void {
                $answer = $this->guard->check_write( null, self::POST_ID, $meta_key, $value );
            }
        );

        return $answer;
    }

    /**
     * A REST request carrying the given meta.
     *
     * @param  mixed $meta The request's `meta` param.
     * @return \WP_REST_Request
     */
    private function request( $meta ): \WP_REST_Request
    {
        $request = new \WP_REST_Request( 'POST', '/wp/v2/posts/' . self::POST_ID );
        $request->set_param( 'meta', $meta );

        return $request;
    }

    // =========================================================================
    // Which values a select field takes
    // =========================================================================

    /**
     * @return array<string, array{0: mixed}>
     */
    public static function provide_allowed_values(): array
    {
        return array(
            'an option'                                  => array( 'No photo needed' ),
            'empty, which clears the field'              => array( '' ),
            'spaces only, stored as empty'               => array( '   ' ),
            'an option with its spaces as stored'        => array( 'Staff photo' ),
            'an option as typed in the sequence'         => array( 'Staff  photo' ),
            'an option the sequence gives as a number'   => array( '7' ),
        );
    }

    /**
     * @dataProvider provide_allowed_values
     *
     * @param mixed $value Value to store.
     */
    public function test_lets_an_allowed_value_through( $value ): void
    {
        $this->assertNull( $this->write( $value ) );
    }

    /**
     * @return array<string, array{0: mixed}>
     */
    public static function provide_refused_values(): array
    {
        return array(
            'text that is not an option' => array( 'Banana' ),
            'an option in another case'  => array( 'no photo needed' ),
            'part of an option'          => array( 'No photo' ),
            'zero, which is not empty'   => array( '0' ),
        );
    }

    /**
     * @dataProvider provide_refused_values
     *
     * @param mixed $value Value to store.
     */
    public function test_refuses_a_value_that_is_not_an_option( $value ): void
    {
        $this->assertFalse( $this->write( $value ) );
    }

    public function test_a_refused_write_is_logged_with_the_field_post_and_user(): void
    {
        $log = $this->capture_log(
            function (): void {
                $this->guard->check_write( null, self::POST_ID, self::KEY, 'Banana' );
            }
        );

        $this->assertStringContainsString( self::KEY, $log );
        $this->assertStringContainsString( 'post 42', $log );
        $this->assertStringContainsString( 'user 5', $log );
    }

    // =========================================================================
    // Writes the meta API hooks leave alone
    // =========================================================================

    /**
     * The filter runs on every post meta write on the site, so a key that is
     * not a select field is answered before anything else is read.
     */
    public function test_does_not_look_at_a_key_that_is_not_a_select_field(): void
    {
        $asked = static function (): void {
            throw new \LogicException( 'The guard read more than the meta key.' );
        };
        Functions\when( 'sanitize_text_field' )->alias( $asked );
        Functions\when( 'get_current_user_id' )->alias( $asked );
        Functions\when( 'wp_is_post_revision' )->alias( $asked );

        $this->assertNull( $this->guard->check_write( null, self::POST_ID, 'wf_meta_4_photo_brief', 'Banana' ) );
    }

    public function test_keeps_another_callbacks_decision(): void
    {
        $this->assertTrue( $this->guard->check_write( true, self::POST_ID, self::KEY, 'Banana' ) );
        $this->assertTrue( $this->guard->check_write_by_mid( true, 9, 'Banana' ) );
    }

    public function test_a_write_with_no_logged_in_user_is_let_through(): void
    {
        Functions\when( 'get_current_user_id' )->justReturn( 0 );

        $this->assertNull( $this->write( 'Banana' ) );
    }

    /**
     * Core copies a post's rows to each revision and autosave, so a revision
     * row takes a value its post holds.
     */
    public function test_a_revision_row_takes_a_value_its_post_holds(): void
    {
        Functions\when( 'wp_is_post_revision' )->justReturn( 41 );
        $this->rows = array( 'Old option', 'Archive  photo' );

        $this->assertNull( $this->write( 'Old option' ) );
        $this->assertNull( $this->write( 'Archive  photo' ) );
        $this->assertSame( array( 41, 41 ), $this->posts_read );
    }

    /**
     * A revision row is restored onto the post with no check, so it takes no
     * other value the post could not.
     */
    public function test_a_revision_row_does_not_take_a_value_its_post_does_not_hold(): void
    {
        Functions\when( 'wp_is_post_revision' )->justReturn( 41 );
        $this->rows = array( 'Old option' );

        $this->assertFalse( $this->write( 'Banana' ) );
        $this->assertFalse( $this->write( 'old option' ) );
    }

    public function test_a_revision_row_takes_an_option_and_nothing(): void
    {
        Functions\when( 'wp_is_post_revision' )->justReturn( 41 );

        $this->assertNull( $this->write( 'No photo needed' ) );
        $this->assertNull( $this->write( '' ) );
        $this->assertSame( array(), $this->posts_read );
    }

    public function test_a_revision_row_is_not_checked_with_no_logged_in_user(): void
    {
        Functions\when( 'wp_is_post_revision' )->justReturn( 41 );
        Functions\when( 'get_current_user_id' )->justReturn( 0 );

        $this->assertNull( $this->write( 'Banana' ) );
    }

    public function test_a_write_during_a_revision_restore_is_let_through(): void
    {
        Functions\when( 'doing_action' )->alias(
            static function ( $hook ) {
                return 'wp_restore_post_revision' === $hook;
            }
        );

        $this->assertNull( $this->write( 'Banana' ) );
    }

    // =========================================================================
    // A row edited by its meta id
    // =========================================================================

    /**
     * Ask the by-mid filter about a value, with the log captured.
     *
     * @param  mixed        $value    Value to store.
     * @param  string|false $meta_key New meta key, or false to keep the row's.
     * @return mixed The filter's answer.
     */
    private function write_by_mid( $value, $meta_key = false )
    {
        $answer = null;
        $this->capture_log(
            function () use ( &$answer, $value, $meta_key ): void {
                $answer = $this->guard->check_write_by_mid( null, 9, $value, $meta_key );
            }
        );

        return $answer;
    }

    public function test_by_mid_reads_the_key_from_the_row(): void
    {
        Functions\when( 'get_metadata_by_mid' )->justReturn(
            (object) array(
                'meta_key' => self::KEY,
                'post_id'  => self::POST_ID,
            )
        );

        $this->assertFalse( $this->write_by_mid( 'Banana' ) );
        $this->assertNull( $this->write_by_mid( 'No photo needed' ) );
    }

    public function test_by_mid_checks_the_key_a_row_is_renamed_to(): void
    {
        Functions\when( 'get_metadata_by_mid' )->justReturn(
            (object) array(
                'meta_key' => 'some_other_key',
                'post_id'  => self::POST_ID,
            )
        );

        $this->assertFalse( $this->write_by_mid( 'Banana', self::KEY ) );
        $this->assertNull( $this->write_by_mid( 'Banana', 'yet_another_key' ) );
    }

    public function test_by_mid_leaves_a_row_of_another_key_or_no_row_alone(): void
    {
        Functions\when( 'get_metadata_by_mid' )->justReturn(
            (object) array(
                'meta_key' => 'wf_meta_4_photo_brief',
                'post_id'  => self::POST_ID,
            )
        );
        $this->assertNull( $this->write_by_mid( 'Banana' ) );

        Functions\when( 'get_metadata_by_mid' )->justReturn( false );
        $this->assertNull( $this->write_by_mid( 'Banana' ) );
    }

    // =========================================================================
    // REST
    // =========================================================================

    public function test_rest_refuses_a_value_that_is_not_an_option_and_names_the_field(): void
    {
        $prepared = (object) array( 'ID' => self::POST_ID );

        $result = $this->guard->check_rest_insert( $prepared, $this->request( array( self::KEY => ' Banana ' ) ) );

        $this->assertInstanceOf( \WP_Error::class, $result );
        $this->assertSame( 'vip_workflows_invalid_metadata_option', $result->get_error_code() );
        $this->assertSame( '“Banana” isn’t one of the options for “Photo needs”.', $result->get_error_message() );
        $this->assertSame( 400, $result->get_error_data()['status'] );
        $this->assertSame( self::KEY, $result->get_error_data()['meta_key'] );
        $this->assertSame( array( 'No photo needed', 'Staff photo', '7' ), $result->get_error_data()['options'] );
    }

    /**
     * @return array<string, array{0: mixed}>
     */
    public static function provide_rest_meta_that_passes(): array
    {
        return array(
            'an option'                   => array( array( self::KEY => 'No photo needed' ) ),
            'empty'                       => array( array( self::KEY => '' ) ),
            'null, which resets the field' => array( array( self::KEY => null ) ),
            'another field only'          => array( array( 'wf_meta_4_photo_brief' => 'Banana' ) ),
            'no meta in the request'      => array( null ),
        );
    }

    /**
     * @dataProvider provide_rest_meta_that_passes
     *
     * @param mixed $meta The request's `meta` param.
     */
    public function test_rest_passes_a_request_with_nothing_to_refuse( $meta ): void
    {
        $prepared = (object) array( 'ID' => self::POST_ID );

        $this->assertSame( $prepared, $this->guard->check_rest_insert( $prepared, $this->request( $meta ) ) );
    }

    /**
     * The editor sends every meta value with a save. A value equal to the
     * stored one is not this request's choice.
     */
    public function test_rest_passes_a_value_that_is_already_stored(): void
    {
        $this->stored = 'Archive photo';
        $prepared     = (object) array( 'ID' => self::POST_ID );

        $this->assertSame( $prepared, $this->guard->check_rest_insert( $prepared, $this->request( array( self::KEY => 'Archive photo' ) ) ) );
        $this->assertInstanceOf( \WP_Error::class, $this->guard->check_rest_insert( $prepared, $this->request( array( self::KEY => 'Banana' ) ) ) );
    }

    /**
     * Core skips the write of an unchanged value only when the post has one
     * row for the key. With more rows it writes, and that write would be
     * refused after the post is saved, so the value is refused here first.
     */
    public function test_rest_refuses_a_stored_value_when_the_post_has_more_than_one_row(): void
    {
        $this->rows = array( 'Archive photo', 'No photo needed' );
        $prepared   = (object) array( 'ID' => self::POST_ID );

        $result = $this->guard->check_rest_insert( $prepared, $this->request( array( self::KEY => 'Archive photo' ) ) );

        $this->assertInstanceOf( \WP_Error::class, $result );
        $this->assertSame( 'vip_workflows_invalid_metadata_option', $result->get_error_code() );
    }

    public function test_rest_counts_a_row_that_is_not_text_as_a_row(): void
    {
        $this->rows = array( array( 'not text' ), 'Archive photo' );
        $prepared   = (object) array( 'ID' => self::POST_ID );

        $this->assertInstanceOf( \WP_Error::class, $this->guard->check_rest_insert( $prepared, $this->request( array( self::KEY => 'Archive photo' ) ) ) );
    }

    public function test_rest_passes_an_option_whatever_rows_the_post_has(): void
    {
        $this->rows = array( 'Archive photo', 'No photo needed' );
        $prepared   = (object) array( 'ID' => self::POST_ID );

        $this->assertSame( $prepared, $this->guard->check_rest_insert( $prepared, $this->request( array( self::KEY => 'No photo needed' ) ) ) );
    }

    public function test_rest_has_no_stored_value_to_compare_for_a_new_post(): void
    {
        Functions\when( 'get_post_meta' )->alias(
            static function (): void {
                throw new \LogicException( 'A new post has no stored value to read.' );
            }
        );

        $result = $this->guard->check_rest_insert( (object) array(), $this->request( array( self::KEY => 'Banana' ) ) );

        $this->assertInstanceOf( \WP_Error::class, $result );
    }

    /**
     * Core's autosaves controller runs this filter and does not read an error
     * from it, so an autosave is not refused here. Its row is held at the
     * write.
     */
    public function test_rest_does_not_refuse_an_autosave(): void
    {
        $prepared = (object) array( 'ID' => self::POST_ID );
        $request  = $this->request( array( self::KEY => 'Banana' ) );
        $request->set_attributes( array( 'callback' => array( \Mockery::mock( 'WP_REST_Autosaves_Controller' ), 'create_item' ) ) );

        $this->assertSame( $prepared, $this->guard->check_rest_insert( $prepared, $request ) );
    }

    public function test_rest_refuses_a_save_whatever_other_controller_handles_it(): void
    {
        $prepared = (object) array( 'ID' => self::POST_ID );
        $request  = $this->request( array( self::KEY => 'Banana' ) );
        $request->set_attributes( array( 'callback' => array( \Mockery::mock( 'WP_REST_Posts_Controller' ), 'update_item' ) ) );

        $this->assertInstanceOf( \WP_Error::class, $this->guard->check_rest_insert( $prepared, $request ) );
    }

    public function test_rest_keeps_an_error_an_earlier_callback_returned(): void
    {
        $earlier = new \WP_Error( 'earlier', 'Refused earlier.' );

        $this->assertSame( $earlier, $this->guard->check_rest_insert( $earlier, $this->request( array( self::KEY => 'Banana' ) ) ) );
    }

    // =========================================================================
    // Wiring
    // =========================================================================

    public function test_hooks_the_three_meta_api_writes_and_the_rest_save(): void
    {
        $hooks = array();
        Functions\when( 'add_filter' )->alias(
            function ( $hook, $callback ) use ( &$hooks ) {
                $hooks[ $hook ] = $callback[1];
                return true;
            }
        );

        $this->guard->init();
        $this->guard->guard_rest_post_type( 'post' );

        $this->assertSame(
            array(
                'add_post_metadata'           => 'check_write',
                'update_post_metadata'        => 'check_write',
                'update_post_metadata_by_mid' => 'check_write_by_mid',
                'rest_pre_insert_post'        => 'check_rest_insert',
            ),
            $hooks
        );
    }
}
