<?php
/**
 * Required-tools gate telemetry unit tests.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflows\Abilities\AbilitySettings;
use VIPWorkflows\Automation\EventBus;
use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Telemetry\Tracker;
use VIPWorkflows\Workflow\PostTypeManager;
use VIPWorkflows\Workflow\StatusManager;

/**
 * What a required-tools gate reports to product telemetry.
 *
 * The gate already sorts every issue into hard failures and soft warnings. The
 * event is those two arrays counted — nothing per tool, since customers can
 * create many tools whose names mean nothing in aggregate — plus how many tools
 * produced no verdict at all. The bypass branch is covered beside the metadata
 * gate's, in RequiredMetadataTransitionTest, because it needs a whole transition.
 */
class ToolGateTelemetryTest extends TestCase
{
    /**
     * Simulated current user id.
     *
     * @var int
     */
    private int $current_user = 0;

    /**
     * Recording double for the VIP Telemetry library.
     *
     * @var RecordingTelemetry
     */
    private RecordingTelemetry $telemetry;

    /**
     * Per-tool behavior, keyed by ability id: either an output array the tool
     * returns, or a Throwable it throws.
     *
     * @var array<string, array|\Throwable>
     */
    private array $tools = array();

    /**
     * Ability settings, as stored.
     *
     * @var array
     */
    private array $ability_settings = array();

    protected function setUp(): void
    {
        parent::setUp();

        $this->current_user     = 5;
        $this->tools            = array();
        $this->ability_settings = array();
        $this->telemetry        = new RecordingTelemetry();
        Tracker::set_telemetry( $this->telemetry );

        Functions\when( 'get_current_user_id' )->alias( fn() => $this->current_user );
        Functions\when( 'wp_set_current_user' )->alias(
            function ( int $id ) {
                $this->current_user = $id;
            }
        );
        Functions\when( 'current_time' )->justReturn( '2026-09-29 12:00:00' );
        // Acknowledged warnings write an audit row, which looks the post's sequence up.
        Functions\when( 'get_post' )->justReturn( null );
        Functions\when( 'get_post_meta' )->justReturn( '' );
        Functions\when( 'get_option' )->alias(
            fn( string $key, $default = false ) => 'vip_workflows_ability_settings' === $key ? $this->ability_settings : $default
        );
        Functions\when( 'wp_get_ability' )->alias(
            function ( string $id ) {
                $behavior = $this->tools[ $id ] ?? null;
                $ability  = Mockery::mock( 'WP_Ability' );
                $ability->shouldReceive( 'execute' )->andReturnUsing(
                    function () use ( $behavior ) {
                        if ( $behavior instanceof \Throwable ) {
                            throw $behavior;
                        }
                        return $behavior;
                    }
                );
                return $ability;
            }
        );

        global $wpdb;
        $wpdb            = Mockery::mock( 'wpdb' );
        $wpdb->prefix    = 'wp_';
        $wpdb->insert_id = 1;
        $wpdb->shouldReceive( 'insert' )->andReturn( true );

        $plugin = ( new \ReflectionClass( \VIPWorkflows\Plugin::class ) )->newInstanceWithoutConstructor();
        $bus    = Mockery::mock( EventBus::class );
        $bus->shouldIgnoreMissing();
        ( new \ReflectionProperty( \VIPWorkflows\Plugin::class, 'event_bus' ) )->setValue( $plugin, $bus );
        ( new \ReflectionProperty( \VIPWorkflows\Plugin::class, 'instance' ) )->setValue( null, $plugin );

        AbilitySettings::get_instance()->clear_cache();
    }

    /**
     * Run the gate for the given tools.
     *
     * @param  array  $tool_ids             Required tool ids, in order.
     * @param  bool   $acknowledge_warnings Whether the person confirmed the warnings.
     * @param  string $initiator            'user' or 'agent'.
     * @param  int    $as_user              User an unattended run's telemetry belongs to.
     * @return mixed What run_transition_tools() returned.
     */
    private function run_gate( array $tool_ids, bool $acknowledge_warnings = false, string $initiator = 'user', int $as_user = 0 )
    {
        $manager = new StatusManager( Mockery::mock( SequenceRepository::class ), Mockery::mock( PostTypeManager::class ) );
        $method  = new \ReflectionMethod( StatusManager::class, 'run_transition_tools' );

        return $method->invoke(
            $manager,
            42,
            array(
                'to'             => 'review',
                'required_tools' => $tool_ids,
            ),
            $acknowledge_warnings,
            $initiator,
            $as_user
        );
    }

    /**
     * The one gate event a run produced.
     *
     * @return array
     */
    private function gate_event(): array
    {
        $events = $this->telemetry->of( 'transition_gate_finished' );
        $this->assertCount( 1, $events, 'A gate is one event, however many tools it runs.' );

        return $events[0];
    }

    public function test_a_blocked_gate_counts_hard_soft_and_broken_tools_across_all_tools(): void
    {
        $this->ability_settings = array(
            'test/strict'   => array( 'check_modes' => array( 'must_have' => 'hard' ) ),
            'test/disabled' => array( 'enabled' => false ),
        );
        $this->tools = array(
            // One hard by its configured mode, one hard by its own severity.
            'test/strict'  => array(
                'issues' => array(
                    array( 'check_key' => 'must_have', 'message' => 'Missing the thing' ),
                    array( 'check_key' => 'other', 'severity' => 'error', 'message' => 'Broken' ),
                ),
            ),
            // Two soft warnings.
            'test/soft'    => array(
                'issues' => array(
                    array( 'check_key' => 'a', 'message' => 'Consider this' ),
                    array( 'check_key' => 'b', 'message' => 'And this' ),
                ),
            ),
            'test/clean'   => array( 'issues' => array() ),
            // Never produces a verdict, and so is neither hard nor soft.
            'test/broken'  => new \RuntimeException( 'service down' ),
            'test/disabled' => array( 'issues' => array() ),
        );

        $result = $this->run_gate( array( 'test/strict', 'test/soft', 'test/clean', 'test/broken', 'test/disabled' ) );

        $this->assertInstanceOf( \WP_Error::class, $result );

        $event      = $this->gate_event();
        $properties = $event['properties'];
        $duration   = $properties['duration_ms'] ?? null;
        unset( $properties['duration_ms'] );

        $this->assertSame(
            array(
                'gate'           => 'tools',
                'result'         => 'blocked',
                'hard_count'     => 2,
                'soft_count'     => 2,
                'tools_required' => 5,
                'tools_errored'  => 2,
                'initiator'      => 'user',
            ),
            $properties,
            'Counts only: no tool id, no issue text, no check key.'
        );
        $this->assertIsInt( $duration );
        $this->assertSame( 5, $event['user'] );
    }

    public function test_a_tools_own_issue_is_counted_as_a_finding_whatever_its_key(): void
    {
        // A tool may name its own check `execution_error`. It still ran and
        // reached a verdict, so it is a hard finding, not a broken tool.
        $this->tools = array(
            'test/strict' => array(
                'issues' => array(
                    array( 'check_key' => 'execution_error', 'severity' => 'error', 'message' => 'Embed failed to load' ),
                ),
            ),
        );

        $this->assertInstanceOf( \WP_Error::class, $this->run_gate( array( 'test/strict' ) ) );

        $properties = $this->gate_event()['properties'];
        $this->assertSame( 1, $properties['hard_count'] );
        $this->assertSame( 0, $properties['tools_errored'] );
    }

    public function test_a_stored_required_tools_value_that_is_not_a_list_does_not_throw(): void
    {
        $manager = new StatusManager( Mockery::mock( SequenceRepository::class ), Mockery::mock( PostTypeManager::class ) );
        $method  = new \ReflectionMethod( StatusManager::class, 'run_transition_tools' );

        // What main does with it, warning included: no tool runs. Telemetry must
        // not turn that into a TypeError on every move along the edge.
        $result = @$method->invoke( $manager, 42, array( 'to' => 'review', 'required_tools' => 'test/one' ) );

        $this->assertTrue( $result );
        $this->assertSame( 0, $this->gate_event()['properties']['tools_required'] );
    }

    public function test_a_gate_that_finds_nothing_passes(): void
    {
        $this->tools = array(
            'test/one' => array( 'issues' => array() ),
            'test/two' => array( 'issues' => array() ),
        );

        $this->assertTrue( $this->run_gate( array( 'test/one', 'test/two' ) ) );

        $properties = $this->gate_event()['properties'];
        $this->assertSame( 'passed', $properties['result'] );
        $this->assertSame( 0, $properties['hard_count'] );
        $this->assertSame( 0, $properties['soft_count'] );
        $this->assertSame( 2, $properties['tools_required'] );
        $this->assertSame( 0, $properties['tools_errored'] );
    }

    public function test_warnings_awaiting_confirmation_are_reported_as_pending(): void
    {
        $this->tools = array(
            'test/soft' => array( 'issues' => array( array( 'check_key' => 'a', 'message' => 'Consider this' ) ) ),
        );

        $result = $this->run_gate( array( 'test/soft' ) );

        $this->assertIsArray( $result );
        $this->assertTrue( $result['warnings_pending'] );
        $this->assertSame( 'warnings_pending', $this->gate_event()['properties']['result'] );
        $this->assertSame( 1, $this->gate_event()['properties']['soft_count'] );
    }

    public function test_confirmed_warnings_are_reported_as_acknowledged(): void
    {
        $this->tools = array(
            'test/soft' => array( 'issues' => array( array( 'check_key' => 'a', 'message' => 'Consider this' ) ) ),
        );

        $this->assertTrue( $this->run_gate( array( 'test/soft' ), true ) );

        $properties = $this->gate_event()['properties'];
        $this->assertSame( 'warnings_acknowledged', $properties['result'] );
        $this->assertSame( 1, $properties['soft_count'] );
    }

    public function test_an_unattended_gate_is_recorded_as_the_agents_user_and_the_user_is_restored(): void
    {
        $this->current_user = 0; // Cron.
        $this->tools        = array( 'test/one' => array( 'issues' => array() ) );

        $this->assertTrue( $this->run_gate( array( 'test/one' ), false, 'agent', 9 ) );

        $event = $this->gate_event();
        $this->assertSame( 'agent', $event['properties']['initiator'] );
        $this->assertSame( 9, $event['user'] );
        $this->assertSame( 0, $this->current_user );
    }

    public function test_a_transition_with_no_required_tools_reports_nothing(): void
    {
        $manager = new StatusManager( Mockery::mock( SequenceRepository::class ), Mockery::mock( PostTypeManager::class ) );
        $method  = new \ReflectionMethod( StatusManager::class, 'run_transition_tools' );

        $this->assertTrue( $method->invoke( $manager, 42, array( 'to' => 'review' ) ) );
        $this->assertTrue( $method->invoke( $manager, 42, null ) );
        $this->assertSame( array(), $this->telemetry->events );
    }
}
