<?php
/**
 * PostTypeManager unit tests.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflow\Sequences\Sequence;
use VIPWorkflow\Sequences\SequenceRepository;
use VIPWorkflow\Workflow\PostTypeManager;

/**
 * Tests for the PostTypeManager class.
 */
class PostTypeManagerTest extends TestCase
{
    /**
     * Sequence repository mock.
     *
     * @var SequenceRepository|Mockery\MockInterface
     */
    private $sequence_repository;

    /**
     * Post type manager under test.
     *
     * @var PostTypeManager
     */
    private PostTypeManager $post_type_manager;

    /**
     * Set up test fixtures.
     */
    protected function setUp(): void
    {
        parent::setUp();

        $this->sequence_repository = Mockery::mock( SequenceRepository::class );
        $this->post_type_manager    = new PostTypeManager( $this->sequence_repository );

        // Seed the post_type => sequence map: sequence 1 maps to 'post'.
        $sequence = Sequence::from_row(
            (object) array(
                'id'          => 1,
                'uuid'        => 'test-uuid',
                'type'        => Sequence::TYPE_WORKFLOW,
                'name'        => 'Test Workflow',
                'slug'        => 'test-workflow',
                'description' => '',
                'version'     => 1,
                'status'      => 'active',
                'config'      => json_encode( array( 'post_types' => array( 'post' ) ) ),
                'created_by'  => 1,
                'created_at'  => '2026-01-01 00:00:00',
                'updated_at'  => '2026-01-01 00:00:00',
            )
        );

        $this->sequence_repository
            ->shouldReceive( 'get_workflow_sequences' )
            ->with( array( 'status' => 'active' ) )
            ->andReturn( array( $sequence ) );

        $this->post_type_manager->register_post_types();
    }

    /**
     * Without a filter, eligible sequences come straight from the post type map.
     */
    public function test_get_sequences_for_post_defaults_to_post_type_map(): void
    {
        $post = $this->create_mock_post( array( 'post_type' => 'post' ) );

        $this->assertSame( array( 1 ), $this->post_type_manager->get_sequences_for_post( $post ) );
    }

    /**
     * The sequences_for_post filter can narrow the eligible list (e.g. by section)
     * and receives the post being evaluated.
     */
    public function test_get_sequences_for_post_filter_can_restrict_by_post(): void
    {
        $post = $this->create_mock_post( array( 'post_type' => 'post' ) );

        $received_post = null;
        Functions\when( 'apply_filters' )->alias(
            function ( $tag, $value, $filtered_post = null ) use ( &$received_post ) {
                if ( 'vip_workflow_sequences_for_post' === $tag ) {
                    $received_post = $filtered_post;
                    // Restrict this post to no eligible sequences.
                    return array();
                }
                return $value;
            }
        );

        $this->assertSame( array(), $this->post_type_manager->get_sequences_for_post( $post ) );
        $this->assertSame( $post, $received_post );
    }

    /**
     * Filter return values are normalized to a clean list of integer IDs.
     */
    public function test_get_sequences_for_post_normalizes_filter_output(): void
    {
        $post = $this->create_mock_post( array( 'post_type' => 'post' ) );

        Functions\when( 'apply_filters' )->alias(
            function ( $tag, $value ) {
                if ( 'vip_workflow_sequences_for_post' === $tag ) {
                    return array( '2', '5' );
                }
                return $value;
            }
        );

        $this->assertSame( array( 2, 5 ), $this->post_type_manager->get_sequences_for_post( $post ) );
    }

    /**
     * A post type with no mapped sequences yields an empty list.
     */
    public function test_get_sequences_for_post_unmapped_post_type(): void
    {
        $post = $this->create_mock_post( array( 'post_type' => 'page' ) );

        $this->assertSame( array(), $this->post_type_manager->get_sequences_for_post( $post ) );
    }
}
