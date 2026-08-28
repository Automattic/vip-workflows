<?php
/**
 * AbilityExecutor error-handling unit tests.
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
 * A WP_Error returned by an ability is a failure, whatever it carries.
 */
class AbilityExecutorErrorHandlingTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        // Ability enabled, no stored default options.
        Functions\when( 'get_option' )->justReturn( array() );
        Functions\when( 'get_current_user_id' )->justReturn( 1 );
        Functions\when( 'current_time' )->justReturn( '2026-08-17 12:00:00' );
        AbilitySettings::get_instance()->clear_cache();
    }

    /**
     * Build an executor whose single registered ability returns $raw from execute().
     *
     * @param  mixed $raw What the ability's execute() returns.
     * @return array{0: AbilityExecutor, 1: object} Executor and the repository spy.
     */
    private function executor_returning( $raw ): array
    {
        $ability = Mockery::mock( 'WP_Ability' );
        $ability->shouldReceive( 'execute' )->andReturn( $raw );

        Functions\when( 'wp_get_ability' )->justReturn( $ability );

        $repository = Mockery::mock( AbilityResultRepository::class );
        $repository->shouldReceive( 'save' )->andReturnUsing( fn( $r ) => $r );

        $event_bus = Mockery::mock( EventBus::class );
        $event_bus->shouldIgnoreMissing();

        return array( new AbilityExecutor( $repository, $event_bus ), $repository );
    }

    /**
     * A permission denial is a WP_Error whose data is an array — the shape
     * WordPress uses for a REST status. It must not be recorded as a run that
     * succeeded, or a gate that refused reads downstream as a gate that passed.
     */
    public function test_wp_error_carrying_array_data_is_a_failure(): void
    {
        list( $executor ) = $this->executor_returning(
            new \WP_Error( 'rest_forbidden', 'Sorry, you are not allowed to do that.', array( 'status' => 403 ) )
        );

        $result = $executor->execute( 'vip-workflows/some-check' );

        $this->assertFalse(
            $result->success,
            'a WP_Error is a failure even when its data happens to be an array'
        );
        $this->assertNotEmpty( $result->error, 'the failure must carry the error message' );
    }

    /**
     * The scalar-data branch already behaved correctly; assert it so the fix
     * cannot regress it while changing the array branch.
     */
    public function test_wp_error_carrying_scalar_data_is_a_failure(): void
    {
        list( $executor ) = $this->executor_returning(
            new \WP_Error( 'boom', 'Something broke.', 'context-string' )
        );

        $result = $executor->execute( 'vip-workflows/some-check' );

        $this->assertFalse( $result->success );
        $this->assertSame( 'Something broke.', $result->error );
    }

    /**
     * A genuine success must still be a success — the fix must not turn every
     * array-returning ability into a failure.
     */
    public function test_array_return_is_still_a_success(): void
    {
        list( $executor ) = $this->executor_returning( array( 'status' => 'pass', 'issues' => array() ) );

        $result = $executor->execute( 'vip-workflows/some-check' );

        $this->assertTrue( $result->success );
        $this->assertSame( 'pass', $result->output['status'] ?? null );
    }
}
