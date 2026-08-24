<?php
/**
 * ActionDispatcher unit tests.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Mockery;
use VIPWorkflow\Automation\ActionDispatcher;
use VIPWorkflow\Automation\ActionHandlerInterface;

/**
 * Smoke tests for ActionDispatcher.
 */
class ActionDispatcherTest extends TestCase
{
    private ActionDispatcher $dispatcher;

    protected function setUp(): void
    {
        parent::setUp();
        $this->dispatcher = new ActionDispatcher();
    }

    public function test_constructor_registers_default_handler_types(): void
    {
        $types = $this->dispatcher->get_registered_types();
        $this->assertContains( 'notification', $types );
        $this->assertContains( 'state_change', $types );
        $this->assertContains( 'task_create', $types );
        $this->assertContains( 'ability_execute', $types );
        $this->assertContains( 'webhook', $types );
    }

    public function test_dispatch_unknown_action_type_returns_skipped(): void
    {
        $results = $this->dispatcher->dispatch( [ [ 'type' => 'no_such_handler' ] ], [] );

        $this->assertCount( 1, $results );
        $this->assertSame( 'skipped', $results[0]['status'] );
        $this->assertSame( 'no_such_handler', $results[0]['action_type'] );
    }

    public function test_dispatch_calls_registered_handler(): void
    {
        $handler = Mockery::mock( ActionHandlerInterface::class );
        $handler->shouldReceive( 'execute' )
            ->once()
            ->with( [ 'key' => 'val' ], [ 'ctx' => 1 ] )
            ->andReturn( [ 'done' => true ] );

        $this->dispatcher->register( 'test_action', $handler );

        $results = $this->dispatcher->dispatch(
            [ [ 'type' => 'test_action', 'config' => [ 'key' => 'val' ] ] ],
            [ 'ctx' => 1 ]
        );

        $this->assertCount( 1, $results );
        $this->assertSame( 'success', $results[0]['status'] );
        $this->assertSame( [ 'done' => true ], $results[0]['result'] );
    }

    public function test_dispatch_multiple_actions_returns_multiple_results(): void
    {
        $handler = Mockery::mock( ActionHandlerInterface::class );
        $handler->shouldReceive( 'execute' )->twice()->andReturn( [] );

        $this->dispatcher->register( 'multi_action', $handler );

        $results = $this->dispatcher->dispatch(
            [
                [ 'type' => 'multi_action' ],
                [ 'type' => 'multi_action' ],
            ],
            []
        );

        $this->assertCount( 2, $results );
        $this->assertSame( 'success', $results[0]['status'] );
        $this->assertSame( 'success', $results[1]['status'] );
    }

    public function test_dispatch_on_failure_continue_keeps_going_after_exception(): void
    {
        $handler = Mockery::mock( ActionHandlerInterface::class );
        $handler->shouldReceive( 'execute' )
            ->once()
            ->andThrow( new \Exception( 'handler failed' ) );

        $this->dispatcher->register( 'failing_action', $handler );

        // on_failure defaults to 'continue'.
        $results = $this->dispatcher->dispatch( [ [ 'type' => 'failing_action' ] ], [] );

        $this->assertSame( 'failed', $results[0]['status'] );
        $this->assertSame( 'handler failed', $results[0]['error'] );
    }

    public function test_dispatch_on_failure_stop_throws_exception(): void
    {
        $handler = Mockery::mock( ActionHandlerInterface::class );
        $handler->shouldReceive( 'execute' )
            ->once()
            ->andThrow( new \Exception( 'stop me' ) );

        $this->dispatcher->register( 'stop_action', $handler );

        $this->expectException( \Exception::class );
        $this->expectExceptionMessage( 'stop me' );

        $this->dispatcher->dispatch(
            [ [ 'type' => 'stop_action', 'on_failure' => 'stop' ] ],
            []
        );
    }

    public function test_register_overrides_existing_handler(): void
    {
        $first  = Mockery::mock( ActionHandlerInterface::class );
        $second = Mockery::mock( ActionHandlerInterface::class );
        $second->shouldReceive( 'execute' )->once()->andReturn( [ 'from' => 'second' ] );

        $this->dispatcher->register( 'my_action', $first );
        $this->dispatcher->register( 'my_action', $second ); // override

        $results = $this->dispatcher->dispatch( [ [ 'type' => 'my_action' ] ], [] );
        $this->assertSame( [ 'from' => 'second' ], $results[0]['result'] );
    }

    public function test_dispatch_passes_empty_config_when_config_key_absent(): void
    {
        $handler = Mockery::mock( ActionHandlerInterface::class );
        $handler->shouldReceive( 'execute' )
            ->once()
            ->with( [], Mockery::any() ) // empty config
            ->andReturn( [] );

        $this->dispatcher->register( 'no_config', $handler );

        $results = $this->dispatcher->dispatch( [ [ 'type' => 'no_config' ] ], [] );
        $this->assertSame( 'success', $results[0]['status'] );
    }
}
