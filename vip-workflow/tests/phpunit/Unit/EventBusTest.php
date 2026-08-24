<?php
/**
 * EventBus unit tests.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflow\Automation\EventBus;
use VIPWorkflow\Automation\EventRegistry;

/**
 * Tests for the EventBus class.
 */
class EventBusTest extends TestCase
{
    /**
     * Event registry mock.
     *
     * @var EventRegistry|Mockery\MockInterface
     */
    private $registry;

    /**
     * Mock wpdb instance.
     *
     * @var object
     */
    private $wpdb;

    /**
     * Event bus under test.
     *
     * @var EventBus
     */
    private EventBus $event_bus;

    /**
     * Set up test fixtures.
     */
    protected function setUp(): void
    {
        parent::setUp();

        $this->registry = Mockery::mock( EventRegistry::class );

        // Create mock wpdb with required properties.
        $this->wpdb         = Mockery::mock( 'wpdb' );
        $this->wpdb->prefix = 'wp_';
        $this->wpdb->shouldReceive( 'prepare' )->andReturnUsing(
            function ( $query ) {
                return $query;
            }
        );

        // Replace global $wpdb with our mock.
        global $wpdb;
        $wpdb = $this->wpdb;

        $this->event_bus = new EventBus( $this->registry );
    }

    /**
     * Test emit stores event in database.
     */
    public function test_emit_stores_event(): void
    {
        $this->wpdb->shouldReceive( 'insert' )
            ->once()
            ->with(
                'wp_vip_workflow_events',
                Mockery::on(
                    function ( $data ) {
                        return 'status.transition' === $data['event_type'];
                    }
                )
            )
            ->andReturn( true );

        $this->wpdb->insert_id = 1;

        // No global flows.
        $this->wpdb->shouldReceive( 'get_results' )
            ->once()
            ->andReturn( array() );

        Functions\when( 'get_current_user_id' )->justReturn( 1 );

        // Don't pass post_id to avoid triggering sequence lookup which requires Plugin init.
        $this->event_bus->emit(
            'status.transition',
            array( 'from' => 'draft', 'to' => 'review' )
        );

        // No assertion needed - Mockery verifies the insert was called.
        $this->assertTrue( true );
    }

    /**
     * Test emit triggers do_action hook.
     */
    public function test_emit_fires_action(): void
    {
        $this->wpdb->shouldReceive( 'insert' )
            ->once()
            ->andReturn( true );

        $this->wpdb->insert_id = 1;

        $this->wpdb->shouldReceive( 'get_results' )
            ->once()
            ->andReturn( array() );

        Functions\when( 'get_current_user_id' )->justReturn( 1 );

        // Verify do_action is called with the correct event.
        $action_called = false;
        Functions\when( 'do_action' )->alias(
            function ( $tag ) use ( &$action_called ) {
                if ( 'vip_workflow_event_emitted' === $tag ) {
                    $action_called = true;
                }
            }
        );

        $this->event_bus->emit( 'test.event', array( 'data' => 'value' ) );

        $this->assertTrue( $action_called );
    }

    /**
     * Test get_registry returns the event registry.
     */
    public function test_get_registry(): void
    {
        $result = $this->event_bus->get_registry();

        $this->assertSame( $this->registry, $result );
    }

    /**
     * Test event matching with exact match.
     */
    public function test_event_matching_exact(): void
    {
        // Create a global flow that matches exactly.
        $flow_row = (object) array(
            'id'             => 1,
            'name'           => 'Test Flow',
            'status'         => 'active',
            'trigger_events' => '["status.draft.entered"]',
            'conditions'     => '[]',
            'actions'        => '[]',
            'sequence_id'   => null,
            'priority'       => 10,
        );

        // Expect exactly 2 inserts: one for event storage, one for flow execution.
        $insert_count = 0;
        $this->wpdb->shouldReceive( 'insert' )
            ->twice()
            ->andReturnUsing(
                function () use ( &$insert_count ) {
                    $insert_count++;
                    return true;
                }
            );

        $this->wpdb->insert_id = 1;

        // Return the flow from global flows query.
        $this->wpdb->shouldReceive( 'get_results' )
            ->once()
            ->andReturn( array( $flow_row ) );

        // Expect flow execution to be updated (status change).
        $this->wpdb->shouldReceive( 'update' )
            ->once()
            ->andReturn( true );

        Functions\when( 'get_current_user_id' )->justReturn( 1 );

        $this->event_bus->emit( 'status.draft.entered', array() );

        // Verify both inserts happened.
        $this->assertSame( 2, $insert_count, 'Expected 2 inserts: event + flow execution' );
    }

    /**
     * Test event matching with wildcard pattern.
     */
    public function test_event_matching_wildcard(): void
    {
        // Create a global flow with wildcard pattern.
        $flow_row = (object) array(
            'id'             => 1,
            'name'           => 'Wildcard Flow',
            'status'         => 'active',
            'trigger_events' => '["status.*.entered"]',
            'conditions'     => '[]',
            'actions'        => '[]',
            'sequence_id'   => null,
            'priority'       => 10,
        );

        // Expect exactly 2 inserts: one for event storage, one for flow execution.
        $insert_count = 0;
        $this->wpdb->shouldReceive( 'insert' )
            ->twice()
            ->andReturnUsing(
                function () use ( &$insert_count ) {
                    $insert_count++;
                    return true;
                }
            );

        $this->wpdb->insert_id = 1;

        $this->wpdb->shouldReceive( 'get_results' )
            ->once()
            ->andReturn( array( $flow_row ) );

        // Expect flow execution to be updated.
        $this->wpdb->shouldReceive( 'update' )
            ->once()
            ->andReturn( true );

        Functions\when( 'get_current_user_id' )->justReturn( 1 );

        // Should match "status.review.entered" against "status.*.entered".
        $this->event_bus->emit( 'status.review.entered', array() );

        // Verify wildcard matching triggered flow execution.
        $this->assertSame( 2, $insert_count, 'Expected 2 inserts: event + flow execution (wildcard match)' );
    }

    /**
     * Test non-matching events don't trigger flows.
     */
    public function test_event_not_matching(): void
    {
        // Create a global flow that shouldn't match.
        $flow_row = (object) array(
            'id'             => 1,
            'name'           => 'Specific Flow',
            'status'         => 'active',
            'trigger_events' => '["status.published.entered"]',
            'conditions'     => '[]',
            'actions'        => '[]',
            'sequence_id'   => null,
            'priority'       => 10,
        );

        $this->wpdb->shouldReceive( 'insert' )
            ->once()
            ->andReturn( true );

        $this->wpdb->insert_id = 1;

        $this->wpdb->shouldReceive( 'get_results' )
            ->once()
            ->andReturn( array( $flow_row ) );

        Functions\expect( 'get_current_user_id' )->andReturn( 1 );

        // This event should NOT match "status.published.entered".
        $this->event_bus->emit( 'status.draft.entered', array() );

        // No execution insert should happen (only event insert).
        $this->assertTrue( true );
    }

    /**
     * Test emit with actor context.
     */
    public function test_emit_with_actor_context(): void
    {
        $this->wpdb->shouldReceive( 'insert' )
            ->once()
            ->with(
                'wp_vip_workflow_events',
                Mockery::on(
                    function ( $data ) {
                        return 5 === $data['actor_id']
                            && 'system' === $data['actor_type'];
                    }
                )
            )
            ->andReturn( true );

        $this->wpdb->insert_id = 1;

        $this->wpdb->shouldReceive( 'get_results' )
            ->once()
            ->andReturn( array() );

        $this->event_bus->emit(
            'cron.job.completed',
            array( 'job' => 'cleanup' ),
            array(
                'actor_id'   => 5,
                'actor_type' => 'system',
            )
        );

        $this->assertTrue( true );
    }
}
