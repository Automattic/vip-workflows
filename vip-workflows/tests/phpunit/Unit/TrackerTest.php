<?php
/**
 * Tracker unit tests.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflows\Telemetry\Tracker;

/**
 * Tests for the guards around the VIP Telemetry library.
 *
 * The library only exists in the VIP mu-plugins, so a double stands in for it.
 */
class TrackerTest extends TestCase
{
    /**
     * Simulated current user id.
     *
     * @var int
     */
    private int $current_user = 0;

    /**
     * User ids that exist.
     *
     * @var list<int>
     */
    private array $known_users = array( 7 );

    /**
     * Whether either user function was called.
     *
     * @var bool
     */
    private bool $touched_users = false;

    protected function setUp(): void
    {
        parent::setUp();

        $this->current_user  = 0;
        $this->touched_users = false;

        Functions\when( 'get_current_user_id' )->alias(
            function () {
                $this->touched_users = true;
                return $this->current_user;
            }
        );

        // Core leaves the current user at 0 for an id that resolves to nobody.
        Functions\when( 'wp_set_current_user' )->alias(
            function ( int $id ) {
                $this->touched_users = true;
                $this->current_user  = in_array( $id, $this->known_users, true ) ? $id : 0;
            }
        );
    }

    /**
     * A Telemetry double that returns, or throws, what it is given.
     *
     * @param mixed $return What record_event() returns, or a Throwable to throw.
     * @return object
     */
    private function telemetry( $return = true ): object
    {
        return new class( $this, $return ) {
            /** @var array<int, array{event: string, properties: array, user: int}> */
            public array $calls = array();

            public function __construct( private TrackerTest $test, private $return )
            {
            }

            public function record_event( string $event, array $properties = array() )
            {
                $this->calls[] = array(
                    'event'      => $event,
                    'properties' => $properties,
                    'user'       => $this->test->current_user(),
                );

                if ( $this->return instanceof \Throwable ) {
                    throw $this->return;
                }

                return $this->return;
            }
        };
    }

    /**
     * Current simulated user, for the double.
     */
    public function current_user(): int
    {
        return $this->current_user;
    }

    public function test_an_event_is_passed_to_the_library_as_given(): void
    {
        $this->current_user = 7;
        $telemetry          = $this->telemetry();
        Tracker::set_telemetry( $telemetry );

        $recorded = Tracker::record( 'tool_run_finished', array( 'success' => true, 'issue_count' => 3 ) );

        $this->assertTrue( $recorded );
        $this->assertCount( 1, $telemetry->calls );
        $this->assertSame( 'tool_run_finished', $telemetry->calls[0]['event'] );
        $this->assertSame( array( 'success' => true, 'issue_count' => 3 ), $telemetry->calls[0]['properties'] );
    }

    public function test_null_properties_are_omitted(): void
    {
        $this->current_user = 7;
        $telemetry          = $this->telemetry();
        Tracker::set_telemetry( $telemetry );

        Tracker::record( 'agent_run_finished', array( 'outcome' => null, 'chain_length' => 0, 'success' => false ) );

        // Falsy values are real values; only null means "not applicable".
        $this->assertSame( array( 'chain_length' => 0, 'success' => false ), $telemetry->calls[0]['properties'] );
    }

    public function test_with_no_user_nothing_is_sent(): void
    {
        $telemetry = $this->telemetry();
        Tracker::set_telemetry( $telemetry );

        $this->assertFalse( Tracker::record( 'tool_run_finished' ) );
        $this->assertSame( array(), $telemetry->calls );
    }

    public function test_an_event_can_be_recorded_as_a_named_user_and_the_user_is_restored(): void
    {
        $telemetry = $this->telemetry();
        Tracker::set_telemetry( $telemetry );

        $this->assertTrue( Tracker::record( 'agent_run_finished', array(), 7 ) );

        $this->assertSame( 7, $telemetry->calls[0]['user'] );
        $this->assertSame( 0, $this->current_user );
    }

    public function test_a_named_user_who_does_not_exist_sends_nothing_and_the_user_is_restored(): void
    {
        $telemetry = $this->telemetry();
        Tracker::set_telemetry( $telemetry );

        $this->assertFalse( Tracker::record( 'agent_run_finished', array(), 999 ) );

        $this->assertSame( array(), $telemetry->calls );
        $this->assertSame( 0, $this->current_user );
    }

    public function test_a_throwing_library_is_contained_and_the_user_is_restored(): void
    {
        Tracker::set_telemetry( $this->telemetry( new \RuntimeException( 'boom' ) ) );

        $this->assertFalse( Tracker::record( 'agent_run_finished', array(), 7 ) );
        $this->assertSame( 0, $this->current_user );
    }

    public function test_an_event_the_library_refuses_is_reported_as_not_recorded(): void
    {
        $this->current_user = 7;

        Tracker::set_telemetry( $this->telemetry( false ) );
        $this->assertFalse( Tracker::record( 'tool_run_finished' ) );

        Tracker::set_telemetry( $this->telemetry( new \WP_Error( 'invalid_event', 'nope' ) ) );
        $this->assertFalse( Tracker::record( 'tool_run_finished' ) );
    }

    public function test_without_the_library_recording_does_nothing_and_touches_no_wordpress_function(): void
    {
        $this->assertFalse( class_exists( '\\Automattic\\VIP\\Telemetry\\Telemetry' ), 'This test assumes the mu-plugin library is not loaded.' );

        // Brain Monkey ignores expect()->never() on a function setUp() already
        // stubbed, so the stubs record whether they were reached instead.
        $this->assertFalse( Tracker::is_available() );
        $this->assertFalse( Tracker::record( 'tool_run_finished', array(), 7 ) );
        $this->assertFalse( $this->touched_users, 'the user was neither read nor switched' );
    }

    public function test_it_is_available_when_there_is_a_telemetry_instance(): void
    {
        Tracker::set_telemetry( $this->telemetry() );

        $this->assertTrue( Tracker::is_available() );
    }
}
