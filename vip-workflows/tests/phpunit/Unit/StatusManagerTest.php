<?php
/**
 * StatusManager unit tests.
 *
 * Covers the stage × status matrix model: same-region moves never
 * write post_status, region crossings write it through core before the stage
 * meta, the reconcile layer reseats at region entry stages, assign_sequence
 * seats by region, and region-crossing capability gates defer to core caps.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflows\Sequences\Sequence;
use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Workflow\PostTypeManager;
use VIPWorkflows\Workflow\StatusManager;

/**
 * Tests for the StatusManager class.
 */
class StatusManagerTest extends TestCase
{
    /**
     * Sequence repository mock.
     *
     * @var SequenceRepository|Mockery\MockInterface
     */
    private $sequence_repository;

    /**
     * Post type manager mock.
     *
     * @var PostTypeManager|Mockery\MockInterface
     */
    private $post_type_manager;

    /**
     * Status manager under test.
     *
     * @var StatusManager
     */
    private StatusManager $status_manager;

    /**
     * Sample sequence for testing.
     *
     * @var Sequence
     */
    private Sequence $sequence;

    /**
     * Set up test fixtures.
     */
    protected function setUp(): void
    {
        parent::setUp();

        $this->sequence_repository = Mockery::mock( SequenceRepository::class );
        $this->post_type_manager    = Mockery::mock( PostTypeManager::class );

        $this->status_manager = new StatusManager(
            $this->sequence_repository,
            $this->post_type_manager
        );

        $this->sequence = $this->create_test_sequence();
    }

    /**
     * Create a test sequence spanning the draft, pending, and publish regions.
     *
     * draft(draft*) -> review(draft) -> approval(pending*) -> published(publish*) -> promote(publish)
     * plus review -> published (crossing in) and published -> review (crossing out
     * of publish). Asterisks mark region entry stages.
     *
     * @return Sequence
     */
    private function create_test_sequence(): Sequence
    {
        $config = array(
            'statuses' => array(
                array(
                    'key'          => 'draft',
                    'label'        => 'Draft',
                    'status'       => 'draft',
                    'region_entry' => true,
                    'transitions'  => array(
                        array(
                            'to'    => 'review',
                            'label' => 'Submit for Review',
                        ),
                    ),
                ),
                array(
                    'key'         => 'review',
                    'label'       => 'In Review',
                    'status'      => 'draft',
                    'transitions' => array(
                        array( 'to' => 'draft' ),
                        array( 'to' => 'approval' ),
                        array( 'to' => 'published' ),
                    ),
                ),
                array(
                    'key'          => 'approval',
                    'label'        => 'Approval',
                    'status'       => 'pending',
                    'region_entry' => true,
                    'transitions'  => array(
                        array( 'to' => 'published' ),
                    ),
                ),
                array(
                    'key'          => 'published',
                    'label'        => 'Published',
                    'status'       => 'publish',
                    'region_entry' => true,
                    'transitions'  => array(
                        array( 'to' => 'promote' ),
                        array( 'to' => 'review' ),
                    ),
                ),
                array(
                    'key'         => 'promote',
                    'label'       => 'Promote',
                    'status'      => 'publish',
                    'is_terminal' => true,
                    'transitions' => array(),
                ),
            ),
        );

        return $this->sequence_from_config( $config, 1, 'test-workflow', 'Test Workflow' );
    }

    /**
     * Create a sequence that models only the draft and publish regions.
     *
     * @return Sequence
     */
    private function create_no_pending_sequence(): Sequence
    {
        $config = array(
            'statuses' => array(
                array(
                    'key'          => 'writing',
                    'label'        => 'Writing',
                    'status'       => 'draft',
                    'region_entry' => true,
                    'transitions'  => array( array( 'to' => 'live' ) ),
                ),
                array(
                    'key'          => 'live',
                    'label'        => 'Live',
                    'status'       => 'publish',
                    'region_entry' => true,
                    'is_terminal'  => true,
                    'transitions'  => array(),
                ),
            ),
        );

        return $this->sequence_from_config( $config, 2, 'no-pending', 'No Pending' );
    }

    /**
     * Build a Sequence entity from a config array.
     *
     * @param array  $config Sequence config.
     * @param int    $id     Sequence ID.
     * @param string $slug   Slug.
     * @param string $name   Name.
     * @return Sequence
     */
    private function sequence_from_config( array $config, int $id, string $slug, string $name ): Sequence
    {
        $row = (object) array(
            'id'          => $id,
            'uuid'        => 'test-uuid-' . $id,
            'type'        => Sequence::TYPE_WORKFLOW,
            'name'        => $name,
            'slug'        => $slug,
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

    // =========================================================================
    // Stub helpers
    // =========================================================================

    /**
     * Stub get_post_meta with a key => value map (missing keys return '').
     *
     * @param array $map Meta map.
     */
    private function stub_meta( array $map ): void
    {
        Functions\when( 'get_post_meta' )->alias(
            function ( $post_id, $key = '', $single = false ) use ( $map ) {
                return $map[ $key ] ?? '';
            }
        );
    }

    /**
     * Stub the current user as a non-bypass editor (default settings).
     */
    private function stub_editor_user(): void
    {
        Functions\when( 'get_current_user_id' )->justReturn( 5 );
        Functions\when( 'get_userdata' )->justReturn(
            (object) array(
                'roles'        => array( 'editor' ),
                'display_name' => 'Test Editor',
            )
        );
        Functions\when( 'get_option' )->justReturn( array() );
    }

    /**
     * Stub get_post_type_object with a standard cap object.
     */
    private function stub_post_type_caps(): void
    {
        Functions\when( 'get_post_type_object' )->justReturn(
            (object) array(
                'cap' => (object) array(
                    'publish_posts'        => 'publish_posts',
                    'edit_published_posts' => 'edit_published_posts',
                ),
            )
        );
    }

    /**
     * Capture do_action calls into an array of [hook, ...args].
     *
     * @param array $events Capture target (by reference).
     */
    private function capture_events( array &$events ): void
    {
        Functions\when( 'do_action' )->alias(
            function ( ...$args ) use ( &$events ) {
                $events[] = $args;
            }
        );
    }

    /**
     * Mock the global $wpdb for audit-log inserts.
     *
     * @return Mockery\MockInterface
     */
    private function mock_wpdb(): Mockery\MockInterface
    {
        global $wpdb;
        $wpdb         = Mockery::mock( 'wpdb' );
        $wpdb->prefix = 'wp_';
        $wpdb->shouldReceive( 'insert' )->andReturn( true )->byDefault();
        $wpdb->insert_id = 1;
        return $wpdb;
    }

    /**
     * Wire the standard stubs for a transition() call by a human editor.
     *
     * @param object $post          Post double.
     * @param string $current_stage Current stage meta.
     */
    private function stub_transition_context( object $post, string $current_stage ): void
    {
        Functions\when( 'get_post' )->justReturn( $post );
        $this->stub_meta(
            array(
                '_vip_workflows_sequence_id'  => '1',
                StatusManager::STAGE_META_KEY => $current_stage,
            )
        );
        $this->sequence_repository
            ->shouldReceive( 'find' )
            ->with( 1 )
            ->andReturn( $this->sequence );
        $this->stub_editor_user();
        $this->stub_post_type_caps();
        $this->mock_wpdb();
    }

    // =========================================================================
    // Lookups
    // =========================================================================

    /**
     * Test get_sequence_for_post returns null when post not found.
     */
    public function test_get_sequence_for_post_no_post(): void
    {
        Functions\expect( 'get_post' )
            ->once()
            ->with( 999 )
            ->andReturn( null );

        $result = $this->status_manager->get_sequence_for_post( 999 );

        $this->assertNull( $result );
    }

    /**
     * Test get_sequence_for_post returns null when no sequence assigned.
     */
    public function test_get_sequence_for_post_no_sequence_assigned(): void
    {
        $post = $this->create_mock_post( array( 'ID' => 1 ) );

        Functions\expect( 'get_post' )
            ->once()
            ->with( 1 )
            ->andReturn( $post );

        Functions\expect( 'get_post_meta' )
            ->once()
            ->with( 1, '_vip_workflows_sequence_id', true )
            ->andReturn( '' );

        $result = $this->status_manager->get_sequence_for_post( 1 );

        $this->assertNull( $result );
    }

    /**
     * Test get_sequence_for_post returns sequence when assigned.
     */
    public function test_get_sequence_for_post_with_sequence(): void
    {
        $post = $this->create_mock_post( array( 'ID' => 1 ) );

        Functions\expect( 'get_post' )
            ->once()
            ->with( 1 )
            ->andReturn( $post );

        Functions\expect( 'get_post_meta' )
            ->once()
            ->with( 1, '_vip_workflows_sequence_id', true )
            ->andReturn( '5' );

        $this->sequence_repository
            ->shouldReceive( 'find' )
            ->once()
            ->with( 5 )
            ->andReturn( $this->sequence );

        $result = $this->status_manager->get_sequence_for_post( 1 );

        $this->assertSame( $this->sequence, $result );
    }

    /**
     * Test get_current_status returns null when post not found.
     */
    public function test_get_current_status_no_post(): void
    {
        Functions\expect( 'get_post' )
            ->once()
            ->with( 999 )
            ->andReturn( null );

        $result = $this->status_manager->get_current_status( 999 );

        $this->assertNull( $result );
    }

    /**
     * Test get_current_status returns status info from stage meta.
     */
    public function test_get_current_status_returns_status(): void
    {
        $post = $this->create_mock_post(
            array(
                'ID'          => 1,
                'post_status' => 'draft',
            )
        );

        Functions\when( 'get_post' )->justReturn( $post );
        $this->stub_meta(
            array(
                '_vip_workflows_sequence_id'  => '1',
                StatusManager::STAGE_META_KEY => 'review',
            )
        );

        $this->sequence_repository
            ->shouldReceive( 'find' )
            ->once()
            ->with( 1 )
            ->andReturn( $this->sequence );

        $result = $this->status_manager->get_current_status( 1 );

        $this->assertIsArray( $result );
        $this->assertSame( 'review', $result['key'] );
        $this->assertSame( 'In Review', $result['label'] );
    }

    /**
     * A stage key that is not defined in the sequence is a data-integrity bug:
     * get_current_status logs and returns null instead of fabricating a
     * synthetic stage array.
     */
    public function test_get_current_status_dangling_stage_returns_null(): void
    {
        $post = $this->create_mock_post( array( 'ID' => 1 ) );

        Functions\when( 'get_post' )->justReturn( $post );
        $this->stub_meta(
            array(
                '_vip_workflows_sequence_id'  => '1',
                StatusManager::STAGE_META_KEY => 'ghost',
            )
        );

        $this->sequence_repository
            ->shouldReceive( 'find' )
            ->once()
            ->with( 1 )
            ->andReturn( $this->sequence );

        $this->assertNull( $this->status_manager->get_current_status( 1 ) );
    }

    /**
     * Test get_available_transitions returns empty for no post.
     */
    public function test_get_available_transitions_no_post(): void
    {
        Functions\expect( 'get_post' )
            ->once()
            ->with( 999 )
            ->andReturn( null );

        $result = $this->status_manager->get_available_transitions( 999 );

        $this->assertEmpty( $result );
    }

    /**
     * Test get_available_transitions returns empty for no sequence.
     */
    public function test_get_available_transitions_no_sequence(): void
    {
        $post = $this->create_mock_post( array( 'ID' => 1 ) );

        Functions\expect( 'get_post' )
            ->times( 2 )
            ->with( 1 )
            ->andReturn( $post );

        Functions\expect( 'get_post_meta' )
            ->once()
            ->with( 1, '_vip_workflows_sequence_id', true )
            ->andReturn( '' );

        $result = $this->status_manager->get_available_transitions( 1 );

        $this->assertEmpty( $result );
    }

    /**
     * Test get_available_sequences_for_post returns empty for no post.
     */
    public function test_get_available_sequences_no_post(): void
    {
        Functions\expect( 'get_post' )
            ->once()
            ->with( 999 )
            ->andReturn( null );

        $result = $this->status_manager->get_available_sequences_for_post( 999 );

        $this->assertEmpty( $result );
    }

    /**
     * Test get_available_sequences_for_post returns sequences.
     */
    public function test_get_available_sequences_returns_list(): void
    {
        $post = $this->create_mock_post(
            array(
                'ID'        => 1,
                'post_type' => 'post',
            )
        );

        Functions\expect( 'get_post' )
            ->once()
            ->with( 1 )
            ->andReturn( $post );

        $this->post_type_manager
            ->shouldReceive( 'get_sequences_for_post' )
            ->once()
            ->with( $post )
            ->andReturn( array( 1, 2 ) );

        $sequence2       = clone $this->sequence;
        $sequence2->id   = 2;
        $sequence2->name = 'Second Workflow';
        $sequence2->slug = 'second-workflow';

        $this->sequence_repository
            ->shouldReceive( 'find' )
            ->with( 1 )
            ->andReturn( $this->sequence );

        $this->sequence_repository
            ->shouldReceive( 'find' )
            ->with( 2 )
            ->andReturn( $sequence2 );

        $result = $this->status_manager->get_available_sequences_for_post( 1 );

        $this->assertCount( 2, $result );
        $this->assertSame( 1, $result[0]['id'] );
        $this->assertSame( 'Test Workflow', $result[0]['name'] );
        $this->assertSame( 2, $result[1]['id'] );
        $this->assertSame( 'Second Workflow', $result[1]['name'] );
    }

    // =========================================================================
    // transition() — guards
    // =========================================================================

    /**
     * Test transition returns error for non-existent post.
     */
    public function test_transition_invalid_post(): void
    {
        Functions\expect( 'get_post' )
            ->once()
            ->with( 999 )
            ->andReturn( null );

        $result = $this->status_manager->transition( 999, 'review' );

        $this->assertInstanceOf( \WP_Error::class, $result );
        $this->assertSame( 'invalid_post', $result->get_error_code() );
    }

    /**
     * A trashed post rejects transitions up front, before any other check, and
     * writes nothing.
     */
    public function test_transition_trashed_post_rejected(): void
    {
        $post = $this->create_mock_post(
            array(
                'ID'          => 1,
                'post_status' => 'trash',
            )
        );

        Functions\expect( 'get_post' )
            ->once()
            ->with( 1 )
            ->andReturn( $post );

        Functions\expect( 'update_post_meta' )->never();
        Functions\expect( 'wp_update_post' )->never();

        $result = $this->status_manager->transition( 1, 'review' );

        $this->assertInstanceOf( \WP_Error::class, $result );
        $this->assertSame( 'post_trashed', $result->get_error_code() );
        $this->assertSame( 409, $result->get_error_data()['status'] ?? null );
    }

    /**
     * The agent actor is a trusted system actor for workflow rules, but it does
     * NOT bypass the trash rejection.
     */
    public function test_transition_trashed_post_rejected_for_agent_actor(): void
    {
        $post = $this->create_mock_post(
            array(
                'ID'          => 1,
                'post_status' => 'trash',
            )
        );

        Functions\expect( 'get_post' )
            ->once()
            ->with( 1 )
            ->andReturn( $post );

        Functions\expect( 'update_post_meta' )->never();
        Functions\expect( 'wp_update_post' )->never();

        $result = $this->status_manager->transition( 1, 'review', array( 'agent_actor' => 'test/agent' ) );

        $this->assertInstanceOf( \WP_Error::class, $result );
        $this->assertSame( 'post_trashed', $result->get_error_code() );
        $this->assertSame( 409, $result->get_error_data()['status'] ?? null );
    }

    /**
     * Test transition returns error when no sequence assigned.
     */
    public function test_transition_no_sequence(): void
    {
        $post = $this->create_mock_post( array( 'ID' => 1 ) );

        Functions\expect( 'get_post' )
            ->times( 2 )
            ->with( 1 )
            ->andReturn( $post );

        Functions\expect( 'get_post_meta' )
            ->once()
            ->with( 1, '_vip_workflows_sequence_id', true )
            ->andReturn( '' );

        $result = $this->status_manager->transition( 1, 'review' );

        $this->assertInstanceOf( \WP_Error::class, $result );
        $this->assertSame( 'no_sequence', $result->get_error_code() );
        $this->assertSame( 409, $result->get_error_data()['status'] ?? null );
    }

    /**
     * Test transition returns error for invalid transition.
     */
    public function test_transition_invalid_transition(): void
    {
        $post = $this->create_mock_post(
            array(
                'ID'          => 1,
                'post_status' => 'draft',
            )
        );

        Functions\when( 'get_post' )->justReturn( $post );
        $this->stub_meta(
            array(
                '_vip_workflows_sequence_id'  => '1',
                StatusManager::STAGE_META_KEY => 'draft',
            )
        );

        $this->sequence_repository
            ->shouldReceive( 'find' )
            ->once()
            ->with( 1 )
            ->andReturn( $this->sequence );

        // draft -> published is not allowed (must go through review).
        $result = $this->status_manager->transition( 1, 'published' );

        $this->assertInstanceOf( \WP_Error::class, $result );
        $this->assertSame( 'invalid_transition', $result->get_error_code() );
        $this->assertSame( 422, $result->get_error_data()['status'] ?? null );
    }

    // =========================================================================
    // transition() — write rules
    // =========================================================================

    /**
     * A same-region move NEVER writes post_status: a core-set `pending` survives
     * a draft-region stage move untouched, and the event context carries the
     * committed status.
     */
    public function test_same_region_move_preserves_pending(): void
    {
        $post = $this->create_mock_post(
            array(
                'ID'          => 1,
                'post_status' => 'pending',
            )
        );
        $this->stub_transition_context( $post, 'draft' );
        Functions\when( 'current_user_can' )->justReturn( true );
        Functions\when( 'get_post_status' )->justReturn( 'pending' );

        $meta_writes = array();
        Functions\when( 'update_post_meta' )->alias(
            function ( $post_id, $key, $value ) use ( &$meta_writes ) {
                $meta_writes[] = array( $key, $value );
                return true;
            }
        );
        Functions\expect( 'wp_update_post' )->never();

        $events = array();
        $this->capture_events( $events );

        $result = $this->status_manager->transition( 1, 'review' );

        $this->assertTrue( $result );
        $this->assertContains( array( StatusManager::STAGE_META_KEY, 'review' ), $meta_writes );

        $transition_events = array_values( array_filter( $events, fn( $e ) => 'vip_workflows_status_transition' === $e[0] ) );
        $this->assertCount( 1, $transition_events );
        $this->assertSame( 'workflow', $transition_events[0][5]['cause'] );
        $this->assertSame( 'pending', $transition_events[0][5]['committed_status'] );
        $this->assertSame( 'pending', $transition_events[0][5]['previous_status'], 'No status write: previous equals committed.' );
    }

    /**
     * A same-region move within the publish region leaves a scheduled (`future`)
     * post scheduled — no post_status write, committed_status reports `future`.
     */
    public function test_same_region_move_preserves_future(): void
    {
        $post = $this->create_mock_post(
            array(
                'ID'          => 1,
                'post_status' => 'future',
            )
        );
        $this->stub_transition_context( $post, 'published' );
        Functions\when( 'current_user_can' )->justReturn( true );
        Functions\when( 'get_post_status' )->justReturn( 'future' );

        $meta_writes = array();
        Functions\when( 'update_post_meta' )->alias(
            function ( $post_id, $key, $value ) use ( &$meta_writes ) {
                $meta_writes[] = array( $key, $value );
                return true;
            }
        );
        Functions\expect( 'wp_update_post' )->never();

        $events = array();
        $this->capture_events( $events );

        $result = $this->status_manager->transition( 1, 'promote' );

        $this->assertTrue( $result );
        $this->assertContains( array( StatusManager::STAGE_META_KEY, 'promote' ), $meta_writes );

        $transition_events = array_values( array_filter( $events, fn( $e ) => 'vip_workflows_status_transition' === $e[0] ) );
        $this->assertSame( 'future', $transition_events[0][5]['committed_status'] );
    }

    /**
     * A crossing that lands mid-region — past the target region's `region_entry`
     * — writes that region's status and seats the stage the edge actually names.
     *
     * The status write has always been keyed on the regions differing, never on
     * the target being the checkpoint, so this is the runtime behaviour the
     * authoring rule used to keep anyone from reaching. Covered now that an
     * author can draw the edge.
     */
    public function test_crossing_into_a_region_mid_region_seats_the_named_stage(): void
    {
        $this->sequence = $this->sequence_from_config(
            array(
                'statuses' => array(
                    array(
                        'key'          => 'draft',
                        'label'        => 'Draft',
                        'status'       => 'draft',
                        'region_entry' => true,
                        // Straight past `published`, the publish checkpoint.
                        'transitions'  => array( array( 'to' => 'promote' ) ),
                    ),
                    array(
                        'key'          => 'published',
                        'label'        => 'Published',
                        'status'       => 'publish',
                        'region_entry' => true,
                        'transitions'  => array(),
                    ),
                    array(
                        'key'         => 'promote',
                        'label'       => 'Promote',
                        'status'      => 'publish',
                        'is_terminal' => true,
                        'transitions' => array(),
                    ),
                ),
            ),
            1,
            'mid-region-crossing',
            'Mid-region crossing'
        );

        $post = $this->create_mock_post(
            array(
                'ID'          => 1,
                'post_status' => 'draft',
            )
        );
        $this->stub_transition_context( $post, 'draft' );
        Functions\when( 'current_user_can' )->justReturn( true );
        $status_reads = 0;
        Functions\when( 'get_post_status' )->alias(
            function () use ( &$status_reads ) {
                return 1 === ++$status_reads ? 'draft' : 'publish';
            }
        );

        $meta_writes = array();
        Functions\when( 'update_post_meta' )->alias(
            function ( $post_id, $key, $value ) use ( &$meta_writes ) {
                $meta_writes[] = array( $key, $value );
                return true;
            }
        );
        $committed = array();
        Functions\when( 'wp_update_post' )->alias(
            function ( $data, $wp_error = false ) use ( &$committed ) {
                $committed[] = $data['post_status'];
                return $data['ID'];
            }
        );

        $events = array();
        $this->capture_events( $events );

        $result = $this->status_manager->transition( 1, 'promote' );

        $this->assertTrue( $result );
        $this->assertSame( array( 'publish' ), $committed, 'The target region\'s status is written.' );
        $this->assertContains(
            array( StatusManager::STAGE_META_KEY, 'promote' ),
            $meta_writes,
            'The post is seated at the stage the edge names, not at the region checkpoint.'
        );

        $transition_events = array_values( array_filter( $events, fn( $e ) => 'vip_workflows_status_transition' === $e[0] ) );
        $this->assertSame( 'publish', $transition_events[0][5]['committed_status'] );
        $this->assertSame( 'draft', $transition_events[0][5]['previous_status'] );
    }

    /**
     * A region crossing writes the target region's status through core BEFORE
     * the stage-meta write.
     */
    public function test_crossing_writes_status_before_stage_meta(): void
    {
        $post = $this->create_mock_post(
            array(
                'ID'          => 1,
                'post_status' => 'draft',
            )
        );
        $this->stub_transition_context( $post, 'review' );
        Functions\when( 'current_user_can' )->justReturn( true );
        // First read (previous_status capture, before any write) sees draft;
        // every later read sees the committed publish.
        $status_reads = 0;
        Functions\when( 'get_post_status' )->alias(
            function () use ( &$status_reads ) {
                return 1 === ++$status_reads ? 'draft' : 'publish';
            }
        );

        $sequence = array();
        Functions\when( 'wp_update_post' )->alias(
            function ( $data, $wp_error = false ) use ( &$sequence ) {
                $sequence[] = array( 'wp_update_post', $data['post_status'] );
                return $data['ID'];
            }
        );
        Functions\when( 'update_post_meta' )->alias(
            function ( $post_id, $key, $value ) use ( &$sequence ) {
                if ( StatusManager::STAGE_META_KEY === $key ) {
                    $sequence[] = array( 'update_post_meta', $value );
                }
                return true;
            }
        );

        $events = array();
        $this->capture_events( $events );

        $result = $this->status_manager->transition( 1, 'published' );

        $this->assertTrue( $result );
        $this->assertSame(
            array(
                array( 'wp_update_post', 'publish' ),
                array( 'update_post_meta', 'published' ),
            ),
            $sequence,
            'The region-status write goes through core before the stage meta moves.'
        );

        $transition_events = array_values( array_filter( $events, fn( $e ) => 'vip_workflows_status_transition' === $e[0] ) );
        $this->assertSame( 'workflow', $transition_events[0][5]['cause'] );
        $this->assertSame( 'publish', $transition_events[0][5]['committed_status'] );
        $this->assertSame( 'draft', $transition_events[0][5]['previous_status'], 'previous_status is the pre-write committed status.' );
    }

    /**
     * The static in-progress accessor reports true exactly while the crossing
     * write is in flight (consumers use it to suppress the mid-commit core hook).
     */
    public function test_is_transition_in_progress_during_crossing_write(): void
    {
        $post = $this->create_mock_post(
            array(
                'ID'          => 1,
                'post_status' => 'draft',
            )
        );
        $this->stub_transition_context( $post, 'review' );
        Functions\when( 'current_user_can' )->justReturn( true );
        Functions\when( 'get_post_status' )->justReturn( 'publish' );
        Functions\when( 'update_post_meta' )->justReturn( true );

        $this->assertFalse( StatusManager::is_transition_in_progress( 1 ), 'Not in progress before the transition.' );

        $seen_during_write = null;
        Functions\when( 'wp_update_post' )->alias(
            function ( $data, $wp_error = false ) use ( &$seen_during_write ) {
                $seen_during_write = StatusManager::is_transition_in_progress( $data['ID'] );
                return $data['ID'];
            }
        );

        $result = $this->status_manager->transition( 1, 'published' );

        $this->assertTrue( $result );
        $this->assertTrue( $seen_during_write, 'In progress while the status write is committing.' );
        $this->assertFalse( StatusManager::is_transition_in_progress( 1 ), 'Cleared after the transition.' );
    }

    /**
     * A WP_Error from the crossing write propagates and the stage meta is NOT
     * written — the stage does not advance when core refuses the status.
     */
    public function test_crossing_wp_error_propagates_without_meta_write(): void
    {
        $post = $this->create_mock_post(
            array(
                'ID'          => 1,
                'post_status' => 'draft',
            )
        );
        $this->stub_transition_context( $post, 'review' );
        Functions\when( 'current_user_can' )->justReturn( true );
        Functions\when( 'get_post_status' )->justReturn( 'draft' );

        $core_error = new \WP_Error( 'db_update_error', 'nope' );
        Functions\when( 'wp_update_post' )->justReturn( $core_error );
        Functions\expect( 'update_post_meta' )->never();

        $events = array();
        $this->capture_events( $events );

        $result = $this->status_manager->transition( 1, 'published' );

        $this->assertSame( $core_error, $result );
        $this->assertEmpty(
            array_filter( $events, fn( $e ) => 'vip_workflows_status_transition' === $e[0] ),
            'No stage-change event fires when the crossing write fails.'
        );
    }

    /**
     * Core may coerce a publish write to `future` for a future-dated post. The
     * coercion is accepted silently and the committed status is reported.
     */
    public function test_crossing_scheduled_coercion_accepted(): void
    {
        $post = $this->create_mock_post(
            array(
                'ID'          => 1,
                'post_status' => 'draft',
            )
        );
        $this->stub_transition_context( $post, 'review' );
        Functions\when( 'current_user_can' )->justReturn( true );
        Functions\when( 'wp_update_post' )->justReturn( 1 );
        // Core committed `future`, not the `publish` that was asked for; the
        // pre-write read sees the old draft.
        $status_reads = 0;
        Functions\when( 'get_post_status' )->alias(
            function () use ( &$status_reads ) {
                return 1 === ++$status_reads ? 'draft' : 'future';
            }
        );
        Functions\when( 'update_post_meta' )->justReturn( true );

        $events = array();
        $this->capture_events( $events );

        $result = $this->status_manager->transition( 1, 'published' );

        $this->assertTrue( $result, 'The coercion is accepted, not treated as a failure.' );

        $transition_events = array_values( array_filter( $events, fn( $e ) => 'vip_workflows_status_transition' === $e[0] ) );
        $this->assertSame( 'future', $transition_events[0][5]['committed_status'] );
        $this->assertSame( 'draft', $transition_events[0][5]['previous_status'] );
    }

    // =========================================================================
    // transition() — capability gates
    // =========================================================================

    /**
     * Baseline: every human transition requires edit_post on the post.
     */
    public function test_transition_baseline_requires_edit_post(): void
    {
        $post = $this->create_mock_post(
            array(
                'ID'          => 1,
                'post_status' => 'draft',
            )
        );
        $this->stub_transition_context( $post, 'draft' );
        Functions\when( 'current_user_can' )->justReturn( false );
        Functions\expect( 'wp_update_post' )->never();
        Functions\expect( 'update_post_meta' )->never();

        $result = $this->status_manager->transition( 1, 'review' );

        $this->assertInstanceOf( \WP_Error::class, $result );
        $this->assertSame( 'cannot_edit_post', $result->get_error_code() );
        $this->assertSame( 403, $result->get_error_data()['status'] ?? null );
    }

    /**
     * Crossing into the publish region requires the post type's publish cap.
     */
    public function test_crossing_into_publish_requires_publish_posts(): void
    {
        $post = $this->create_mock_post(
            array(
                'ID'          => 1,
                'post_status' => 'draft',
            )
        );
        $this->stub_transition_context( $post, 'review' );
        Functions\when( 'current_user_can' )->alias(
            fn( $cap ) => 'publish_posts' !== $cap
        );
        Functions\expect( 'wp_update_post' )->never();
        Functions\expect( 'update_post_meta' )->never();

        $result = $this->status_manager->transition( 1, 'published' );

        $this->assertInstanceOf( \WP_Error::class, $result );
        $this->assertSame( 'forbidden_region_crossing', $result->get_error_code() );
        $this->assertSame( 403, $result->get_error_data()['status'] ?? null );
    }

    /**
     * Crossing out of the publish region requires edit_published_posts.
     */
    public function test_crossing_out_of_publish_requires_edit_published_posts(): void
    {
        $post = $this->create_mock_post(
            array(
                'ID'          => 1,
                'post_status' => 'publish',
            )
        );
        $this->stub_transition_context( $post, 'published' );
        Functions\when( 'current_user_can' )->alias(
            fn( $cap ) => 'edit_published_posts' !== $cap
        );
        Functions\expect( 'wp_update_post' )->never();
        Functions\expect( 'update_post_meta' )->never();

        $result = $this->status_manager->transition( 1, 'review' );

        $this->assertInstanceOf( \WP_Error::class, $result );
        $this->assertSame( 'forbidden_region_crossing', $result->get_error_code() );
    }

    /**
     * A draft ↔ pending crossing needs the baseline only — no extra core cap.
     */
    public function test_draft_to_pending_crossing_needs_baseline_only(): void
    {
        $post = $this->create_mock_post(
            array(
                'ID'          => 1,
                'post_status' => 'draft',
            )
        );
        $this->stub_transition_context( $post, 'review' );
        // Only edit_post is granted; publish-level caps are NOT.
        Functions\when( 'current_user_can' )->alias(
            fn( $cap ) => 'edit_post' === $cap
        );
        Functions\when( 'wp_update_post' )->justReturn( 1 );
        Functions\when( 'get_post_status' )->justReturn( 'pending' );
        Functions\when( 'update_post_meta' )->justReturn( true );

        $result = $this->status_manager->transition( 1, 'approval' );

        $this->assertTrue( $result, 'draft -> pending crossing succeeds with the baseline cap alone.' );
    }

    /**
     * The agent actor does not consult the CURRENT user — it runs in a user-less
     * cron context, so there is nobody to consult — but it is still bound by the
     * capabilities of the actor it names. It waives the workflow's own rules (the
     * sequence role table, requires_assignment), never core capabilities.
     */
    public function test_agent_actor_is_bound_by_the_named_actors_capabilities(): void
    {
        $post = $this->create_mock_post(
            array(
                'ID'          => 1,
                'post_status' => 'draft',
            )
        );
        $this->stub_transition_context( $post, 'review' );
        Functions\expect( 'current_user_can' )->never();
        Functions\when( 'user_can' )->justReturn( true );
        Functions\when( 'wp_update_post' )->justReturn( 1 );
        Functions\when( 'get_post_status' )->justReturn( 'publish' );
        Functions\when( 'update_post_meta' )->justReturn( true );

        $result = $this->status_manager->transition(
            1,
            'published',
            array(
                'agent_actor'      => 'test/agent',
                'agent_actor_user' => 7,
            )
        );

        $this->assertTrue( $result, 'a capable named actor advances the post' );
    }

    /**
     * An agent run that names no actor has nobody to act for. uid 0 holds no
     * capabilities, so it is refused rather than waved through — this is the
     * cron case, where the runner has already restored the previous user.
     */
    public function test_agent_actor_without_a_named_user_is_refused(): void
    {
        $post = $this->create_mock_post(
            array(
                'ID'          => 1,
                'post_status' => 'draft',
            )
        );
        $this->stub_transition_context( $post, 'review' );
        Functions\when( 'current_user_can' )->justReturn( true );
        Functions\when( 'user_can' )->alias( fn( $uid ) => $uid > 0 );
        Functions\when( 'wp_update_post' )->justReturn( 1 );
        Functions\when( 'get_post_status' )->justReturn( 'draft' );
        Functions\when( 'update_post_meta' )->justReturn( true );

        $result = $this->status_manager->transition( 1, 'published', array( 'agent_actor' => 'test/agent' ) );

        $this->assertInstanceOf( 'WP_Error', $result );
        $this->assertSame( 'cannot_edit_post', $result->get_error_code() );
    }

    // =========================================================================
    // on_status_transition() — the reconcile layer
    // =========================================================================

    /**
     * Wire the standard reconcile stubs.
     *
     * @param object         $post      Post double.
     * @param string         $stage     Current stage meta.
     * @param Sequence|null $sequence Sequence the repository returns (default: the main fixture).
     */
    private function stub_reconcile_context( object $post, string $stage, ?Sequence $sequence = null ): void
    {
        $sequence = $sequence ?? $this->sequence;

        Functions\when( 'get_post' )->justReturn( $post );
        $this->stub_meta(
            array(
                '_vip_workflows_sequence_id'  => (string) $sequence->id,
                StatusManager::STAGE_META_KEY => $stage,
            )
        );
        $this->sequence_repository
            ->shouldReceive( 'find' )
            ->with( $sequence->id )
            ->andReturn( $sequence );
        Functions\when( 'get_current_user_id' )->justReturn( 5 );
        Functions\when( 'get_userdata' )->justReturn( (object) array( 'display_name' => 'Test' ) );
        $this->mock_wpdb();
    }

    /**
     * Core publish on a draft-region post reseats it at the publish region's
     * entry stage with cause 'core'.
     */
    public function test_reconcile_core_publish_seats_at_publish_entry(): void
    {
        $post = $this->create_mock_post(
            array(
                'ID'          => 1,
                'post_status' => 'publish',
            )
        );
        $this->stub_reconcile_context( $post, 'review' );
        Functions\when( 'get_post_status' )->justReturn( 'publish' );

        $meta_writes = array();
        Functions\when( 'update_post_meta' )->alias(
            function ( $post_id, $key, $value ) use ( &$meta_writes ) {
                $meta_writes[] = array( $key, $value );
                return true;
            }
        );

        $events = array();
        $this->capture_events( $events );

        $this->status_manager->on_status_transition( 'publish', 'draft', $post );

        $this->assertContains( array( StatusManager::STAGE_META_KEY, 'published' ), $meta_writes );

        $transition_events = array_values( array_filter( $events, fn( $e ) => 'vip_workflows_status_transition' === $e[0] ) );
        $this->assertCount( 1, $transition_events );
        $this->assertSame( 'published', $transition_events[0][2] );
        $this->assertSame( 'review', $transition_events[0][3] );
        $this->assertSame( 'core', $transition_events[0][5]['cause'] );
        $this->assertSame( 'publish', $transition_events[0][5]['committed_status'] );
        $this->assertSame( 'publish', $transition_events[0][5]['previous_status'], 'A reseat writes no status: previous equals committed.' );

        $this->assertCount( 1, array_filter( $events, fn( $e ) => 'vip_workflows_entered_published' === $e[0] ) );
        $this->assertCount( 1, array_filter( $events, fn( $e ) => 'vip_workflows_exited_review' === $e[0] ) );
    }

    /**
     * Core drives a publish-region post back to draft: reseat at the draft
     * region's entry stage.
     */
    public function test_reconcile_core_draft_on_public_stage_seats_at_draft_entry(): void
    {
        $post = $this->create_mock_post(
            array(
                'ID'          => 1,
                'post_status' => 'draft',
            )
        );
        $this->stub_reconcile_context( $post, 'promote' );
        Functions\when( 'get_post_status' )->justReturn( 'draft' );

        $meta_writes = array();
        Functions\when( 'update_post_meta' )->alias(
            function ( $post_id, $key, $value ) use ( &$meta_writes ) {
                $meta_writes[] = array( $key, $value );
                return true;
            }
        );

        $events = array();
        $this->capture_events( $events );

        $this->status_manager->on_status_transition( 'draft', 'publish', $post );

        $this->assertContains( array( StatusManager::STAGE_META_KEY, 'draft' ), $meta_writes );

        $transition_events = array_values( array_filter( $events, fn( $e ) => 'vip_workflows_status_transition' === $e[0] ) );
        $this->assertSame( 'core', $transition_events[0][5]['cause'] );
    }

    /**
     * Untrash needs no special case: it arrives as trash -> restored-status and
     * the generic rule seats the post at the restored region's entry stage.
     */
    public function test_reconcile_untrash_reseats_at_restored_region_entry(): void
    {
        $post = $this->create_mock_post(
            array(
                'ID'          => 1,
                'post_status' => 'draft',
            )
        );
        $this->stub_reconcile_context( $post, 'promote' );
        Functions\when( 'get_post_status' )->justReturn( 'draft' );

        $meta_writes = array();
        Functions\when( 'update_post_meta' )->alias(
            function ( $post_id, $key, $value ) use ( &$meta_writes ) {
                $meta_writes[] = array( $key, $value );
                return true;
            }
        );

        $events = array();
        $this->capture_events( $events );

        $this->status_manager->on_status_transition( 'draft', 'trash', $post );

        $this->assertContains( array( StatusManager::STAGE_META_KEY, 'draft' ), $meta_writes );
    }

    /**
     * Overlays (`future`, `trash`) have no regions: the stage never moves.
     */
    public function test_reconcile_overlays_leave_stage(): void
    {
        $post = $this->create_mock_post( array( 'ID' => 1 ) );
        $this->stub_reconcile_context( $post, 'review' );

        Functions\expect( 'update_post_meta' )->never();

        $events = array();
        $this->capture_events( $events );

        $this->status_manager->on_status_transition( 'future', 'draft', $post );
        $this->status_manager->on_status_transition( 'trash', 'publish', $post );

        $this->assertEmpty( $events );
    }

    /**
     * A stage already living in the target region is consistent — no reseat.
     * (This is also the go-live path: future -> publish on a publish-region stage.)
     */
    public function test_reconcile_same_region_stage_left_alone(): void
    {
        $post = $this->create_mock_post( array( 'ID' => 1 ) );
        $this->stub_reconcile_context( $post, 'published' );

        Functions\expect( 'update_post_meta' )->never();

        $events = array();
        $this->capture_events( $events );

        $this->status_manager->on_status_transition( 'publish', 'future', $post );

        $this->assertEmpty( $events );
    }

    /**
     * A core-set status whose region the sequence does not model is tolerated:
     * the stage stays, the condition is logged, nothing dispatches.
     */
    public function test_reconcile_unmodeled_region_tolerated(): void
    {
        $post = $this->create_mock_post( array( 'ID' => 1 ) );
        $this->stub_reconcile_context( $post, 'writing', $this->create_no_pending_sequence() );

        Functions\expect( 'update_post_meta' )->never();

        $events = array();
        $this->capture_events( $events );

        $this->status_manager->on_status_transition( 'pending', 'draft', $post );

        $this->assertEmpty( $events );
    }

    /**
     * Stage meta naming an undefined stage is a data-integrity condition: log
     * and bail — never fabricate, never reseat.
     */
    public function test_reconcile_dangling_stage_logs_and_returns(): void
    {
        $post = $this->create_mock_post( array( 'ID' => 1 ) );
        $this->stub_reconcile_context( $post, 'ghost' );

        Functions\expect( 'update_post_meta' )->never();

        $events = array();
        $this->capture_events( $events );

        $this->status_manager->on_status_transition( 'publish', 'draft', $post );

        $this->assertEmpty( $events );
    }

    /**
     * Missing stage meta on a workflow post: same integrity handling.
     */
    public function test_reconcile_missing_stage_meta_logs_and_returns(): void
    {
        $post = $this->create_mock_post( array( 'ID' => 1 ) );
        $this->stub_reconcile_context( $post, '' );

        Functions\expect( 'update_post_meta' )->never();

        $events = array();
        $this->capture_events( $events );

        $this->status_manager->on_status_transition( 'publish', 'draft', $post );

        $this->assertEmpty( $events );
    }

    // =========================================================================
    // assign_sequence()
    // =========================================================================

    /**
     * Wire the standard stubs for an assign_sequence() call.
     *
     * @param object $post Post double.
     */
    private function stub_assign_context( object $post ): void
    {
        $this->sequence_repository
            ->shouldReceive( 'find' )
            ->with( 1 )
            ->andReturn( $this->sequence );

        Functions\when( 'get_post' )->justReturn( $post );

        $this->post_type_manager
            ->shouldReceive( 'get_sequences_for_post' )
            ->with( $post )
            ->andReturn( array( 1 ) );

        $this->stub_meta( array() );
        Functions\when( 'get_current_user_id' )->justReturn( 5 );
        // Region-crossing caps granted by default; gate tests override.
        Functions\when( 'current_user_can' )->justReturn( true );
        $this->stub_post_type_caps();
        $this->mock_wpdb();
    }

    /**
     * Test assign_sequence returns false for non-existent sequence.
     */
    public function test_assign_sequence_invalid_sequence(): void
    {
        $this->sequence_repository
            ->shouldReceive( 'find' )
            ->once()
            ->with( 999 )
            ->andReturn( null );

        $result = $this->status_manager->assign_sequence( 1, 999 );

        $this->assertFalse( $result );
    }

    /**
     * Test assign_sequence returns false for non-existent post.
     */
    public function test_assign_sequence_invalid_post(): void
    {
        $this->sequence_repository
            ->shouldReceive( 'find' )
            ->once()
            ->with( 1 )
            ->andReturn( $this->sequence );

        Functions\expect( 'get_post' )
            ->once()
            ->with( 999 )
            ->andReturn( null );

        $result = $this->status_manager->assign_sequence( 999, 1 );

        $this->assertFalse( $result );
    }

    /**
     * Test assign_sequence rejects sequences filtered out for the post.
     */
    public function test_assign_sequence_rejects_ineligible_sequence(): void
    {
        $post = $this->create_mock_post(
            array(
                'ID'        => 1,
                'post_type' => 'post',
            )
        );

        $this->sequence_repository
            ->shouldReceive( 'find' )
            ->once()
            ->with( 1 )
            ->andReturn( $this->sequence );

        Functions\expect( 'get_post' )
            ->once()
            ->with( 1 )
            ->andReturn( $post );

        $this->post_type_manager
            ->shouldReceive( 'get_sequences_for_post' )
            ->once()
            ->with( $post )
            ->andReturn( array( 2 ) );

        Functions\expect( 'update_post_meta' )->never();
        Functions\expect( 'wp_update_post' )->never();

        $result = $this->status_manager->assign_sequence( 1, 1 );

        $this->assertFalse( $result );
    }

    /**
     * A draft post with no explicit stage seats at the draft region's entry
     * stage — no post_status write, and the stage-change dispatch fires with
     * cause 'workflow'.
     */
    public function test_assign_seats_draft_post_at_draft_entry(): void
    {
        $post = $this->create_mock_post(
            array(
                'ID'          => 1,
                'post_status' => 'draft',
            )
        );
        $this->stub_assign_context( $post );
        Functions\when( 'get_post_status' )->justReturn( 'draft' );

        $meta_writes = array();
        Functions\when( 'update_post_meta' )->alias(
            function ( $post_id, $key, $value ) use ( &$meta_writes ) {
                $meta_writes[] = array( $key, $value );
                return true;
            }
        );
        Functions\expect( 'wp_update_post' )->never();

        $events = array();
        $this->capture_events( $events );

        $result = $this->status_manager->assign_sequence( 1, 1 );

        $this->assertTrue( $result );
        $this->assertContains( array( StatusManager::SEQUENCE_META_KEY, 1 ), $meta_writes );
        $this->assertContains( array( StatusManager::STAGE_META_KEY, 'draft' ), $meta_writes );

        $transition_events = array_values( array_filter( $events, fn( $e ) => 'vip_workflows_status_transition' === $e[0] ) );
        $this->assertCount( 1, $transition_events );
        $this->assertSame( 'draft', $transition_events[0][2] );
        $this->assertSame( '', $transition_events[0][3], 'No prior stage: old stage is empty.' );
        $this->assertSame( 'workflow', $transition_events[0][5]['cause'] );
        $this->assertSame( 'draft', $transition_events[0][5]['previous_status'], 'Seating writes no status: previous equals committed.' );

        $this->assertCount( 1, array_filter( $events, fn( $e ) => 'vip_workflows_entered_draft' === $e[0] ) );
        $this->assertEmpty(
            array_filter( $events, fn( $e ) => str_starts_with( $e[0], 'vip_workflows_exited_' ) ),
            'No exited event fires when there was no prior stage.'
        );
    }

    /**
     * A published post seats at the publish region's entry stage and is never
     * silently unpublished (no post_status write).
     */
    public function test_assign_seats_published_post_at_publish_entry(): void
    {
        $post = $this->create_mock_post(
            array(
                'ID'          => 1,
                'post_status' => 'publish',
            )
        );
        $this->stub_assign_context( $post );
        Functions\when( 'get_post_status' )->justReturn( 'publish' );

        $meta_writes = array();
        Functions\when( 'update_post_meta' )->alias(
            function ( $post_id, $key, $value ) use ( &$meta_writes ) {
                $meta_writes[] = array( $key, $value );
                return true;
            }
        );
        Functions\expect( 'wp_update_post' )->never();

        $events = array();
        $this->capture_events( $events );

        $result = $this->status_manager->assign_sequence( 1, 1 );

        $this->assertTrue( $result );
        $this->assertContains( array( StatusManager::STAGE_META_KEY, 'published' ), $meta_writes );
    }

    /**
     * `future` counts as the publish region for seating: a scheduled post seats
     * at the publish entry stage and STAYS scheduled — no post_status write.
     */
    public function test_assign_seats_future_post_at_publish_entry_and_stays_scheduled(): void
    {
        $post = $this->create_mock_post(
            array(
                'ID'          => 1,
                'post_status' => 'future',
            )
        );
        $this->stub_assign_context( $post );
        Functions\when( 'get_post_status' )->justReturn( 'future' );

        $meta_writes = array();
        Functions\when( 'update_post_meta' )->alias(
            function ( $post_id, $key, $value ) use ( &$meta_writes ) {
                $meta_writes[] = array( $key, $value );
                return true;
            }
        );
        Functions\expect( 'wp_update_post' )->never();

        $events = array();
        $this->capture_events( $events );

        $result = $this->status_manager->assign_sequence( 1, 1 );

        $this->assertTrue( $result );
        $this->assertContains( array( StatusManager::STAGE_META_KEY, 'published' ), $meta_writes );

        $transition_events = array_values( array_filter( $events, fn( $e ) => 'vip_workflows_status_transition' === $e[0] ) );
        $this->assertSame( 'future', $transition_events[0][5]['committed_status'] );
    }

    /**
     * A trashed post refuses sequence assignment (false + log), no writes.
     */
    public function test_assign_trashed_post_refused(): void
    {
        $post = $this->create_mock_post(
            array(
                'ID'          => 1,
                'post_status' => 'trash',
            )
        );
        $this->stub_assign_context( $post );

        Functions\expect( 'update_post_meta' )->never();
        Functions\expect( 'wp_update_post' )->never();

        $this->assertFalse( $this->status_manager->assign_sequence( 1, 1 ) );
    }

    /**
     * A post whose status region the sequence does not model is refused.
     *
     * There is no seat that leaves the post where it is, and assignment never
     * moves a post to make room for itself — so this is an error the author
     * acts on, not a stage picker offering to change the post's status as the
     * price of entering the workflow.
     */
    public function test_assign_unmodeled_region_is_refused(): void
    {
        $post = $this->create_mock_post(
            array(
                'ID'          => 1,
                'post_status' => 'pending',
            )
        );

        $no_pending = $this->create_no_pending_sequence();
        $this->sequence_repository
            ->shouldReceive( 'find' )
            ->with( 2 )
            ->andReturn( $no_pending );
        Functions\when( 'get_post' )->justReturn( $post );
        $this->post_type_manager
            ->shouldReceive( 'get_sequences_for_post' )
            ->with( $post )
            ->andReturn( array( 2 ) );
        Functions\when( 'get_post_status_object' )->alias(
            fn( $status ) => 'pending' === $status ? (object) array( 'label' => 'Pending Review' ) : null
        );

        Functions\expect( 'update_post_meta' )->never();
        Functions\expect( 'wp_update_post' )->never();

        $result = $this->status_manager->assign_sequence( 1, 2 );

        $this->assertInstanceOf( 'WP_Error', $result );
        $this->assertSame( 'unmodeled_post_status', $result->get_error_code() );
        $this->assertSame( array( 'status' => 400 ), $result->get_error_data() );
        $this->assertStringContainsString( 'No Pending', $result->get_error_message(), 'The message names the sequence.' );
        $this->assertStringContainsString( 'Pending Review', $result->get_error_message(), 'The message names the status the sequence lacks.' );
    }

    /**
     * A scheduled post is publish-side, so it is refused by a sequence with no
     * published stage — rather than being unscheduled to fit one.
     *
     * The message names the region ("Published"), not the post's raw `future`
     * status: a published stage is what the sequence is actually missing.
     */
    public function test_assign_scheduled_post_without_publish_region_is_refused(): void
    {
        $post = $this->create_mock_post(
            array(
                'ID'          => 1,
                'post_status' => 'future',
            )
        );

        $draft_only = $this->sequence_from_config(
            array(
                'statuses' => array(
                    array(
                        'key'          => 'writing',
                        'label'        => 'Writing',
                        'status'       => 'draft',
                        'region_entry' => true,
                        'transitions'  => array(),
                    ),
                ),
            ),
            3,
            'draft-only',
            'Draft Only'
        );

        $this->sequence_repository
            ->shouldReceive( 'find' )
            ->with( 3 )
            ->andReturn( $draft_only );
        Functions\when( 'get_post' )->justReturn( $post );
        $this->post_type_manager
            ->shouldReceive( 'get_sequences_for_post' )
            ->with( $post )
            ->andReturn( array( 3 ) );
        Functions\when( 'get_post_status_object' )->alias(
            fn( $status ) => 'publish' === $status ? (object) array( 'label' => 'Published' ) : null
        );

        Functions\expect( 'update_post_meta' )->never();
        Functions\expect( 'wp_update_post' )->never();

        $result = $this->status_manager->assign_sequence( 1, 3 );

        $this->assertInstanceOf( 'WP_Error', $result );
        $this->assertSame( 'unmodeled_post_status', $result->get_error_code() );
        $this->assertStringContainsString( 'Published', $result->get_error_message() );
    }

    // =========================================================================
    // Agent actor authority (Invariant A)
    // =========================================================================

    /**
     * An agent-driven transition must not cross into the publish region on
     * behalf of an actor who could not cross it themselves.
     *
     * The runner restores the previous user before writing the exit transition,
     * so under cron the write lands at uid 0. `agent_actor` then waived the
     * capability gates outright, which meant nothing evaluated a capability
     * anywhere in the request. The actor is now passed explicitly and the
     * boundary is evaluated against them.
     *
     * current_user_can() is stubbed TRUE here on purpose: if the check were
     * still reading ambient state it would pass, and this test would not fail.
     */
    public function test_agent_transition_is_refused_when_the_actor_cannot_cross_the_publish_boundary(): void
    {
        $post = $this->create_mock_post(
            array(
                'ID'          => 1,
                'post_status' => 'draft',
            )
        );
        $this->stub_transition_context( $post, 'review' );
        Functions\when( 'current_user_can' )->justReturn( true );
        Functions\when( 'get_post_status' )->justReturn( 'draft' );

        // The named actor holds edit_posts but not publish_posts.
        Functions\when( 'user_can' )->alias(
            function ( $uid, $cap ) {
                return 'publish_posts' !== $cap;
            }
        );

        $wrote = array();
        Functions\when( 'wp_update_post' )->alias(
            function ( $data ) use ( &$wrote ) {
                $wrote[] = $data['post_status'];
                return $data['ID'];
            }
        );
        Functions\when( 'update_post_meta' )->justReturn( true );

        $result = $this->status_manager->transition(
            1,
            'published',
            array(
                'agent_actor'      => 'vip-workflows/test-agent',
                'agent_actor_user' => 9,
            )
        );

        $this->assertInstanceOf( 'WP_Error', $result, 'the crossing is refused' );
        $this->assertSame( 'forbidden_region_crossing', $result->get_error_code() );
        $this->assertSame( array(), $wrote, 'no post_status is written when the crossing is refused' );
    }

    /**
     * The same agent transition proceeds when the actor DOES hold the
     * capability — the fix refuses the unauthorised crossing, not agents.
     */
    public function test_agent_transition_proceeds_when_the_actor_can_cross(): void
    {
        $post = $this->create_mock_post(
            array(
                'ID'          => 1,
                'post_status' => 'draft',
            )
        );
        $this->stub_transition_context( $post, 'review' );
        Functions\when( 'current_user_can' )->justReturn( false );
        Functions\when( 'user_can' )->justReturn( true );

        $status_reads = 0;
        Functions\when( 'get_post_status' )->alias(
            function () use ( &$status_reads ) {
                return 1 === ++$status_reads ? 'draft' : 'publish';
            }
        );
        Functions\when( 'wp_update_post' )->alias( fn( $data ) => $data['ID'] );
        Functions\when( 'update_post_meta' )->justReturn( true );

        $result = $this->status_manager->transition(
            1,
            'published',
            array(
                'agent_actor'      => 'vip-workflows/test-agent',
                'agent_actor_user' => 7,
            )
        );

        $this->assertTrue( $result, 'an actor holding publish_posts still advances the post' );
    }
}
