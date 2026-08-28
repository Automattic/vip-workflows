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

        Functions\when( 'get_current_user_id' )->justReturn( 1 );

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
