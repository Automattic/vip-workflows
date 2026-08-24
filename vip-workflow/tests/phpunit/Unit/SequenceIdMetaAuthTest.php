<?php
/**
 * Sequence-id meta auth_callback tests.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflow\Plugin;

/**
 * Verifies the _vip_workflow_sequence_id post meta enforces per-object edit
 * rights, not a bare edit_posts capability.
 */
class SequenceIdMetaAuthTest extends TestCase
{
    /**
     * Capture the auth_callback registered for _vip_workflow_sequence_id.
     */
    private function capture_sequence_id_auth_callback(): callable
    {
        $captured = null;

        Functions\when( 'register_post_meta' )->alias(
            function ( string $post_type, string $meta_key, array $args ) use ( &$captured ) {
                if ( '_vip_workflow_sequence_id' === $meta_key ) {
                    $captured = $args['auth_callback'];
                }
            }
        );

        // register_meta() registers the sequence-id meta first, then delegates
        // to register_metadata_fields() (which touches the DB). We only need the
        // first registration, so tolerate any later error.
        $plugin = ( new \ReflectionClass( Plugin::class ) )->newInstanceWithoutConstructor();
        try {
            $plugin->register_meta();
        } catch ( \Throwable $e ) {
            // register_metadata_fields() ran without a DB — irrelevant here.
        }

        $this->assertIsCallable( $captured, 'sequence-id auth_callback was not registered' );
        return $captured;
    }

    public function test_auth_callback_requires_edit_post_on_the_target_post(): void
    {
        $auth = $this->capture_sequence_id_auth_callback();

        Functions\when( 'current_user_can' )->alias(
            fn( $capability, $post_id = null ) => 'edit_post' === $capability && 123 === $post_id
        );

        $this->assertTrue( $auth( true, '_vip_workflow_sequence_id', 123 ) );
        $this->assertFalse( $auth( true, '_vip_workflow_sequence_id', 456 ) );
    }
}
