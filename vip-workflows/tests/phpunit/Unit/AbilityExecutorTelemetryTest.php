<?php
/**
 * AbilityExecutor telemetry unit tests.
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
use VIPWorkflows\Telemetry\Tracker;

/**
 * What the executor reports to product telemetry.
 *
 * Only a tool a person runs directly. A transition gate is one event from the
 * status manager and an agent run is one from the stage agent runner, so the
 * executor staying quiet for those is what stops a gate being counted twice.
 */
class AbilityExecutorTelemetryTest extends TestCase
{
    /**
     * Recording double for the VIP Telemetry library.
     *
     * @var RecordingTelemetry
     */
    private RecordingTelemetry $telemetry;

    protected function setUp(): void
    {
        parent::setUp();

        Functions\when( 'get_option' )->justReturn( array() );
        Functions\when( 'get_current_user_id' )->justReturn( 5 );
        Functions\when( 'current_time' )->justReturn( '2026-09-29 12:00:00' );
        AbilitySettings::get_instance()->clear_cache();

        $this->telemetry = new RecordingTelemetry();
        Tracker::set_telemetry( $this->telemetry );
    }

    /**
     * Build an executor whose single registered ability returns $raw.
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
        $event_bus->shouldIgnoreMissing();

        return new AbilityExecutor( $repository, $event_bus );
    }

    public function test_a_direct_run_reports_success_and_how_many_issues_it_raised(): void
    {
        $executor = $this->executor_returning(
            array(
                'status' => 'fail',
                'issues' => array(
                    array( 'check_key' => 'min_words', 'message' => 'Too short', 'severity' => 'error' ),
                    array( 'check_key' => 'title', 'message' => 'No title' ),
                ),
            )
        );

        $executor->execute( 'someone/private-check' );

        $events = $this->telemetry->of( 'tool_run_finished' );
        $this->assertCount( 1, $events );

        $properties = $events[0]['properties'];
        $duration   = $properties['duration_ms'] ?? null;
        unset( $properties['duration_ms'] );

        // Counts and flags only: not the ability's id, not an issue's text, and no
        // hard/soft split, which is decided at a gate this run is not passing.
        $this->assertSame(
            array(
                'success'     => true,
                'unavailable' => false,
                'issue_count' => 2,
                'initiator'   => 'user',
            ),
            $properties
        );
        $this->assertIsInt( $duration );
    }

    public function test_a_direct_run_that_failed_is_reported_as_unsuccessful(): void
    {
        $executor = $this->executor_returning( new \WP_Error( 'boom', 'Something broke.' ) );

        $executor->execute( 'someone/private-check' );

        $properties = $this->telemetry->of( 'tool_run_finished' )[0]['properties'];
        $this->assertFalse( $properties['success'] );
        $this->assertSame( 0, $properties['issue_count'] );
    }

    public function test_a_tool_that_reports_no_issues_key_counts_zero(): void
    {
        $executor = $this->executor_returning( array( 'status' => 'pass' ) );

        $executor->execute( 'someone/private-check' );

        $this->assertSame( 0, $this->telemetry->of( 'tool_run_finished' )[0]['properties']['issue_count'] );
    }

    /**
     * @return array<string, array{string}>
     */
    public function provide_surfaces_other_than_a_direct_run(): array
    {
        return array(
            'a transition gate' => array( 'transition' ),
            'a stage agent'     => array( 'agent' ),
            'an ideation gate'  => array( 'ideation' ),
        );
    }

    /**
     * @dataProvider provide_surfaces_other_than_a_direct_run
     * @param string $context The surface the run came from.
     */
    public function test_only_a_direct_run_is_reported( string $context ): void
    {
        $executor = $this->executor_returning( array( 'status' => 'pass', 'issues' => array() ) );

        $executor->execute( 'someone/private-check', array(), $context );

        $this->assertSame( array(), $this->telemetry->events );
    }
}
