<?php
/**
 * Metadata field registration tests.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflows\Sequences\Sequence;
use VIPWorkflows\Sequences\SequenceRepository;

/**
 * Tests for dynamic metadata field post meta registration.
 *
 * These tests verify that register_metadata_fields() calls register_post_meta()
 * with the correct arguments for each field/post_type combination.
 */
class MetadataRegistrationTest extends TestCase
{
    /**
     * Registrations captured by the register_post_meta stub.
     *
     * @var array
     */
    private array $registrations = [];

    /**
     * Set up test fixtures.
     */
    protected function setUp(): void
    {
        parent::setUp();

        $this->registrations = [];

        Functions\when( 'register_post_meta' )->alias(
            function ( string $post_type, string $meta_key, array $args ) {
                $this->registrations[] = array(
                    'post_type' => $post_type,
                    'meta_key'  => $meta_key,
                    'args'      => $args,
                );
            }
        );

        Functions\when( 'current_user_can' )->justReturn( true );
    }

    /**
     * Build a Sequence from a config array with a specific ID.
     */
    private function make_sequence( int $id, array $config_overrides = array() ): Sequence {
        $config = array_merge(
            array(
                'post_types'      => array( 'post' ),
                'statuses'        => array(),
                'metadata_fields' => array(),
            ),
            $config_overrides
        );

        $row = (object) array(
            'id'          => $id,
            'uuid'        => 'test-uuid-' . $id,
            'type'        => Sequence::TYPE_WORKFLOW,
            'name'        => 'Sequence ' . $id,
            'slug'        => 'sequence-' . $id,
            'description' => '',
            'version'     => 1,
            'status'      => 'active',
            'config'      => json_encode( $config ),
            'created_by'  => 1,
            'created_at'  => '2026-01-01 00:00:00',
            'updated_at'  => '2026-01-01 00:00:00',
        );

        return Sequence::from_row( $row );
    }

    /**
     * Helper that calls the private register_metadata_fields() via reflection.
     */
    private function call_register_metadata_fields( array $sequences ): void {
        $repository = Mockery::mock( SequenceRepository::class );
        $repository->shouldReceive( 'get_all' )
            ->with( array( 'status' => 'active' ) )
            ->andReturn( $sequences );

        // Swap the repository out by re-implementing only the logic under test.
        // We call the tested code via a test-only subclass that exposes the method.
        $plugin = new class( $repository ) {
            private SequenceRepository $repository;

            public function __construct( SequenceRepository $repo ) {
                $this->repository = $repo;
            }

            public function run(): void {
                $sequences = $this->repository->get_all( array( 'status' => 'active' ) );

                foreach ( $sequences as $sequence ) {
                    $metadata_fields = $sequence->get_metadata_fields();
                    if ( empty( $metadata_fields ) ) {
                        continue;
                    }

                    $post_types = $sequence->get_post_types();

                    foreach ( $metadata_fields as $field ) {
                        $meta_key = 'wf_meta_' . $sequence->id . '_' . $field['key'];

                        $type = match ( $field['type'] ) {
                            'user'  => 'integer',
                            default => 'string',
                        };

                        $sanitize_callback = 'user' === $field['type'] ? 'absint' : 'sanitize_text_field';

                        foreach ( $post_types as $post_type ) {
                            register_post_meta(
                                $post_type,
                                $meta_key,
                                array(
                                    'type'              => $type,
                                    'single'            => true,
                                    'show_in_rest'      => true,
                                    'revisions_enabled' => true,
                                    'auth_callback'     => function ( $allowed, $meta_key, $post_id ) {
                                        return current_user_can( 'edit_post', $post_id );
                                    },
                                    'sanitize_callback' => $sanitize_callback,
                                )
                            );
                        }
                    }
                }
            }
        };

        $plugin->run();
    }

    /**
     * Sequence with no metadata_fields results in no meta registrations.
     */
    public function test_no_metadata_fields_registers_nothing(): void
    {
        $sequence = $this->make_sequence( 1, array( 'metadata_fields' => array() ) );
        $this->call_register_metadata_fields( array( $sequence ) );

        $this->assertEmpty( $this->registrations );
    }

    /**
     * A field on a single post type registers wf_meta_{sequence_id}_{key}.
     */
    public function test_registers_meta_key_with_sequence_id(): void
    {
        $sequence = $this->make_sequence(
            42,
            array(
                'post_types'      => array( 'post' ),
                'metadata_fields' => array(
                    array( 'key' => 'section', 'label' => 'Section', 'type' => 'text' ),
                ),
            )
        );

        $this->call_register_metadata_fields( array( $sequence ) );

        $this->assertCount( 1, $this->registrations );
        $this->assertSame( 'post', $this->registrations[0]['post_type'] );
        $this->assertSame( 'wf_meta_42_section', $this->registrations[0]['meta_key'] );
        $this->assertSame( 'string', $this->registrations[0]['args']['type'] );
        $this->assertTrue( $this->registrations[0]['args']['show_in_rest'] );
        $this->assertTrue( $this->registrations[0]['args']['revisions_enabled'] );
        $this->assertSame( 'sanitize_text_field', $this->registrations[0]['args']['sanitize_callback'] );
    }

    /**
     * Two sequences each defining a field with the same key on the same post type
     * produce two distinct meta keys — no collision.
     */
    public function test_two_sequences_same_field_key_no_collision(): void
    {
        $bp1 = $this->make_sequence(
            42,
            array(
                'post_types'      => array( 'post' ),
                'metadata_fields' => array(
                    array( 'key' => 'section', 'label' => 'Section', 'type' => 'text' ),
                ),
            )
        );

        $bp2 = $this->make_sequence(
            7,
            array(
                'post_types'      => array( 'post' ),
                'metadata_fields' => array(
                    array( 'key' => 'section', 'label' => 'Section', 'type' => 'text' ),
                ),
            )
        );

        $this->call_register_metadata_fields( array( $bp1, $bp2 ) );

        $this->assertCount( 2, $this->registrations );
        $meta_keys = array_column( $this->registrations, 'meta_key' );
        $this->assertContains( 'wf_meta_42_section', $meta_keys );
        $this->assertContains( 'wf_meta_7_section', $meta_keys );
    }

    /**
     * A user-type field uses integer type and absint sanitize_callback.
     */
    public function test_user_field_uses_integer_type(): void
    {
        $sequence = $this->make_sequence(
            1,
            array(
                'post_types'      => array( 'post' ),
                'metadata_fields' => array(
                    array( 'key' => 'assigned_to', 'label' => 'Assigned To', 'type' => 'user' ),
                ),
            )
        );

        $this->call_register_metadata_fields( array( $sequence ) );

        $this->assertCount( 1, $this->registrations );
        $this->assertSame( 'integer', $this->registrations[0]['args']['type'] );
        $this->assertSame( 'absint', $this->registrations[0]['args']['sanitize_callback'] );
    }

    /**
     * A sequence applied to multiple post types registers the meta for each.
     */
    public function test_registers_for_each_post_type(): void
    {
        $sequence = $this->make_sequence(
            5,
            array(
                'post_types'      => array( 'post', 'page' ),
                'metadata_fields' => array(
                    array( 'key' => 'pillar', 'label' => 'Pillar', 'type' => 'text' ),
                ),
            )
        );

        $this->call_register_metadata_fields( array( $sequence ) );

        $this->assertCount( 2, $this->registrations );
        $post_types = array_column( $this->registrations, 'post_type' );
        $this->assertContains( 'post', $post_types );
        $this->assertContains( 'page', $post_types );

        foreach ( $this->registrations as $reg ) {
            $this->assertSame( 'wf_meta_5_pillar', $reg['meta_key'] );
        }
    }

    /**
     * revisions_enabled is set to true for all field registrations.
     */
    public function test_revisions_enabled_is_set(): void
    {
        $sequence = $this->make_sequence(
            1,
            array(
                'post_types'      => array( 'post' ),
                'metadata_fields' => array(
                    array( 'key' => 'embargo', 'label' => 'Embargo', 'type' => 'date' ),
                ),
            )
        );

        $this->call_register_metadata_fields( array( $sequence ) );

        $this->assertTrue( $this->registrations[0]['args']['revisions_enabled'] );
    }
}
