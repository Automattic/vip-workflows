<?php
/**
 * AbilityExecutor event emission unit tests.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflows\Abilities\AbilityExecutor;
use VIPWorkflows\Abilities\AbilityResultRepository;
use VIPWorkflows\Abilities\AbilitySettings;
use VIPWorkflows\Automation\EventBus;

/**
 * A tool run is announced to extensions only through the EventBus: the
 * documented way to react to one is `vip_workflows_event_emitted` filtered on
 * `ability.executed` / `ability.failed`. These tests pin the event type and
 * the payload keys the extension docs promise.
 */
class AbilityExecutorEventTest extends TestCase
{
    /**
     * Events the executor emitted, as array( type, data, context ).
     *
     * @var array<int, array{0: string, 1: array, 2: array}>
     */
    private array $emitted = array();

    protected function setUp(): void
    {
        parent::setUp();

        // Ability enabled, no stored default options.
        Functions\when( 'get_option' )->justReturn( array() );
        Functions\when( 'get_current_user_id' )->justReturn( 1 );
        Functions\when( 'current_time' )->justReturn( '2026-08-17 12:00:00' );
        AbilitySettings::get_instance()->clear_cache();

        $this->emitted = array();
    }

    /**
     * Build an executor whose single registered ability returns $raw from execute().
     *
     * @param  mixed $raw What the ability's execute() returns.
     * @return AbilityExecutor
     */
    private function executor_returning( $raw ): AbilityExecutor
    {
        $ability = Mockery::mock( 'WP_Ability' );
        $ability->shouldReceive( 'execute' )->andReturn( $raw );

        Functions\when( 'wp_get_ability' )->justReturn( $ability );

        $repository = Mockery::mock( AbilityResultRepository::class );
        $repository->shouldReceive( 'save' )->andReturnUsing( fn( $r ) => $r );

        $event_bus = Mockery::mock( EventBus::class );
        $event_bus->shouldReceive( 'emit' )->andReturnUsing(
            function ( string $type, array $data, array $context = array() ): void {
                $this->emitted[] = array( $type, $data, $context );
            }
        );

        return new AbilityExecutor( $repository, $event_bus );
    }

    public function test_a_successful_run_emits_ability_executed_with_the_documented_payload(): void
    {
        $executor = $this->executor_returning( array( 'status' => 'pass' ) );

        $executor->execute( 'vip-workflows/some-check', array( 'post_id' => 42 ) );

        $this->assertCount( 1, $this->emitted );
        list( $type, $data, $context ) = $this->emitted[0];

        $this->assertSame( 'ability.executed', $type );
        $this->assertSame(
            array( 'ability_id', 'post_id', 'success', 'duration_ms', 'output' ),
            array_keys( $data )
        );
        $this->assertSame( 'vip-workflows/some-check', $data['ability_id'] );
        $this->assertSame( 42, $data['post_id'] );
        $this->assertTrue( $data['success'] );
        $this->assertSame( 'pass', $data['output']['status'] ?? null );
        $this->assertSame( array( 'post_id' => 42 ), $context );
    }

    public function test_a_failed_run_emits_ability_failed_with_the_same_payload_keys(): void
    {
        $executor = $this->executor_returning( new \WP_Error( 'boom', 'Something broke.' ) );

        $executor->execute( 'vip-workflows/some-check', array( 'post_id' => 42 ) );

        $this->assertCount( 1, $this->emitted );
        list( $type, $data ) = $this->emitted[0];

        $this->assertSame( 'ability.failed', $type );
        $this->assertSame(
            array( 'ability_id', 'post_id', 'success', 'duration_ms', 'output' ),
            array_keys( $data )
        );
        $this->assertFalse( $data['success'] );
    }
}
