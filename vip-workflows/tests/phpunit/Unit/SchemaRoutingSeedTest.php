<?php
/**
 * The two migrations that put event routing onto the ids the dispatcher fires.
 *
 * 2.20.0 seeds routing from the per-channel event lists; 2.21.0 re-keys what the
 * old Routing screen stored. Both exist because the screen offered `sla_breach`
 * while dispatch() emitted `sla.breached`, and should_notify_channel() matches
 * with isset() — so those rows were unreachable and SLA and goal notifications
 * could not fire at all. They share an option store, so they share a harness.
 *
 * Two places used to answer "does this event go to this channel", and the
 * dispatcher read the per-channel list as a fallback. That fallback is gone, so
 * a site configured entirely through the old System Events matrix depends on
 * this migration to keep notifying — which makes its edges worth pinning: two
 * channels sharing one event, an event routing already answers for, and a
 * re-run that must change nothing.
 *
 * SLA and `goal.at_risk` were removed in 2.24.0. Both migrations still name
 * them, and so does this file: an upgrading site really can hold those rows,
 * and 2.20/2.21 have to carry them correctly before 2.24 deletes them. The last
 * group below covers that deletion.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflow\Database\Schema;

class SchemaRoutingSeedTest extends TestCase
{
    /**
     * Options the stubbed get_option/update_option read and write.
     *
     * @var array<string, mixed>
     */
    private array $options = [];

    /**
     * Channel option names the stubbed lookup returns.
     *
     * @var array<int, string>
     */
    private array $channel_option_names = [];

    protected function setUp(): void
    {
        parent::setUp();

        global $wpdb;
        $wpdb          = Mockery::mock( 'wpdb' );
        $wpdb->options = 'wp_options';
        $wpdb->shouldReceive( 'esc_like' )->andReturnUsing( fn( $text ) => $text );
        $wpdb->shouldReceive( 'prepare' )->andReturnUsing( fn( $query ) => $query );
        $wpdb->shouldReceive( 'get_col' )->andReturnUsing( fn() => $this->channel_option_names );

        Functions\when( 'get_option' )->alias(
            fn( $name, $default = false ) => $this->options[ $name ] ?? $default
        );
        Functions\when( 'update_option' )->alias(
            function ( $name, $value ) {
                $this->options[ $name ] = $value;
                return true;
            }
        );
    }

    /**
     * Seed the stubbed option store with a channel's stored settings.
     *
     * @param string             $channel_id Channel ID.
     * @param array<int, string> $events     Enabled event types.
     */
    private function given_channel( string $channel_id, array $events ): void
    {
        $option_name                  = 'vip_workflow_channel_' . $channel_id;
        $this->options[ $option_name ] = [ 'events' => $events ];
        $this->channel_option_names[]  = $option_name;
    }

    /**
     * Run the migration.
     */
    private function seed(): void
    {
        $method = new \ReflectionMethod( Schema::class, 'seed_routing_from_channel_events' );
        $method->invoke( null );
    }

    /**
     * Run the re-key migration.
     */
    private function rekey(): void
    {
        $method = new \ReflectionMethod( Schema::class, 'rekey_routing_to_dispatched_event_ids' );
        $method->invoke( null );
    }

    /**
     * Run the 2.24.0 cleanup of retired events.
     */
    private function drop_retired(): void
    {
        $method = new \ReflectionMethod( Schema::class, 'drop_retired_event_routing' );
        $method->invoke( null );
    }

    /**
     * The routing option after the migration ran.
     *
     * @return array<string, array<int, string>>
     */
    private function routing(): array
    {
        return $this->options['vip_workflow_notification_routing'] ?? [];
    }

    public function test_it_carries_a_channels_events_into_routing(): void
    {
        $this->given_channel( 'email', [ 'sla.warning', 'goal.at_risk' ] );

        $this->seed();

        $this->assertSame(
            [
                'sla.warning'  => [ 'email' ],
                'goal.at_risk' => [ 'email' ],
            ],
            $this->routing()
        );
    }

    public function test_two_channels_sharing_an_event_both_reach_it(): void
    {
        // Collect-then-write exists for this case: writing per channel would let
        // the first one's entry make the second look already-routed.
        $this->given_channel( 'email', [ 'sla.warning' ] );
        $this->given_channel( 'webhook', [ 'sla.warning' ] );

        $this->seed();

        $this->assertSame( [ 'email', 'webhook' ], $this->routing()['sla.warning'] );
    }

    public function test_it_leaves_an_event_routing_already_answers_for(): void
    {
        // Routing is the authority wherever it has an entry — including an entry
        // that deliberately routes an event nowhere.
        $this->options['vip_workflow_notification_routing'] = [
            'sla.warning'  => [ 'slack' ],
            'goal.at_risk' => [],
        ];
        $this->given_channel( 'email', [ 'sla.warning', 'goal.at_risk', 'published' ] );

        $this->seed();

        $this->assertSame( [ 'slack' ], $this->routing()['sla.warning'] );
        $this->assertSame( [], $this->routing()['goal.at_risk'] );
        $this->assertSame( [ 'email' ], $this->routing()['published'] );
    }

    public function test_a_second_run_changes_nothing(): void
    {
        // A failed migration re-runs on the next request, and a fresh install runs
        // every migration, so this has to be a no-op the second time.
        $this->given_channel( 'email', [ 'sla.warning' ] );

        $this->seed();
        $after_first = $this->routing();
        $this->seed();

        $this->assertSame( $after_first, $this->routing() );
    }

    public function test_a_channel_that_stored_no_events_contributes_nothing(): void
    {
        // Slack and ntfy never persisted `events` at all.
        $this->options['vip_workflow_channel_slack'] = [ 'webhook_url' => 'https://example.test' ];
        $this->channel_option_names[]                = 'vip_workflow_channel_slack';

        $this->seed();

        $this->assertSame( [], $this->routing() );
    }

    public function test_it_writes_nothing_when_there_is_nothing_to_carry(): void
    {
        $this->seed();

        $this->assertArrayNotHasKey( 'vip_workflow_notification_routing', $this->options );
    }

    public function test_it_seeds_the_id_the_dispatcher_fires_not_the_one_stored(): void
    {
        // The old matrix wrote `sla_breach`; nothing ever dispatches that, so
        // carrying it across verbatim would seed a row as dead as its source.
        $this->given_channel( 'email', [ 'sla_breach', 'sla_warning', 'goal_at_risk' ] );

        $this->seed();

        $this->assertSame(
            [
                'sla.breached' => [ 'email' ],
                'sla.warning'  => [ 'email' ],
                'goal.at_risk' => [ 'email' ],
            ],
            $this->routing()
        );
    }

    public function test_rekey_moves_stored_rows_onto_the_dispatched_ids(): void
    {
        $this->options['vip_workflow_notification_routing'] = [
            'sla_breach'   => [ 'email' ],
            'sla_warning'  => [ 'slack' ],
            'goal_at_risk' => [ 'email', 'slack' ],
            'published'    => [ 'email' ],
        ];

        $this->rekey();

        $this->assertSame(
            [
                'published'    => [ 'email' ],
                'sla.breached' => [ 'email' ],
                'sla.warning'  => [ 'slack' ],
                'goal.at_risk' => [ 'email', 'slack' ],
            ],
            $this->routing()
        );
    }

    public function test_rekey_merges_rather_than_overwrites_when_both_spellings_exist(): void
    {
        // The seed writes the canonical id, so a site can hold both: the stale row
        // the old screen wrote and the one the seed added. A channel chosen under
        // either spelling is a channel the admin asked for.
        $this->options['vip_workflow_notification_routing'] = [
            'sla.breached' => [ 'slack' ],
            'sla_breach'   => [ 'email', 'slack' ],
        ];

        $this->rekey();

        $this->assertSame( [ 'slack', 'email' ], $this->routing()['sla.breached'] );
        $this->assertArrayNotHasKey( 'sla_breach', $this->routing() );
    }

    public function test_rekey_leaves_an_already_migrated_site_alone(): void
    {
        // Every migration runs on a fresh install, and a failed one re-runs.
        $this->options['vip_workflow_notification_routing'] = [
            'sla.breached' => [ 'email' ],
            'published'    => [ 'slack' ],
        ];

        $this->rekey();
        $after_first = $this->routing();
        $this->rekey();

        $this->assertSame( $after_first, $this->routing() );
        $this->assertSame(
            [
                'sla.breached' => [ 'email' ],
                'published'    => [ 'slack' ],
            ],
            $this->routing()
        );
    }

    public function test_rekey_preserves_a_deliberate_route_to_nowhere(): void
    {
        // An empty list is a decision — the event is routed at no channel — and
        // isset() tells it apart from an event routing has never heard of.
        $this->options['vip_workflow_notification_routing'] = [ 'sla_breach' => [] ];

        $this->rekey();

        $this->assertSame( [], $this->routing()['sla.breached'] );
        $this->assertArrayNotHasKey( 'sla_breach', $this->routing() );
    }

    // -------------------------------------------------------------------------
    // 2.24.0 — forgetting the events that were removed
    // -------------------------------------------------------------------------

    /**
     * SLA and goal routing goes; everything else is left alone.
     *
     * Both spellings are dropped. 2.21.0 re-keys the underscored ids onto the
     * dotted ones and runs first, but a site can arrive having skipped it.
     */
    public function test_it_forgets_routing_for_the_retired_events(): void
    {
        $this->options['vip_workflow_notification_routing'] = [
            'sla.warning'  => [ 'email' ],
            'sla.breached' => [ 'email', 'slack' ],
            'sla_breach'   => [ 'slack' ],
            'goal.at_risk' => [ 'email' ],
            'goal_at_risk' => [ 'slack' ],
            'published'    => [ 'email' ],
        ];

        $this->drop_retired();

        $this->assertSame( [ 'published' => [ 'email' ] ], $this->routing() );
    }

    /**
     * A site that never ticked any of them is not written to at all.
     */
    public function test_it_leaves_an_untouched_option_alone(): void
    {
        $this->options['vip_workflow_notification_routing'] = [ 'published' => [ 'email' ] ];

        $this->drop_retired();

        $this->assertSame( [ 'published' => [ 'email' ] ], $this->routing() );
    }

    /**
     * Re-running changes nothing, which is what makes the migration safe to
     * replay on a fresh install alongside every other entry.
     */
    public function test_it_is_re_runnable(): void
    {
        $this->options['vip_workflow_notification_routing'] = [
            'goal.at_risk' => [ 'email' ],
            'published'    => [ 'email' ],
        ];

        $this->drop_retired();
        $before = $this->routing();
        $this->drop_retired();

        $this->assertSame( $before, $this->routing() );
    }
}
