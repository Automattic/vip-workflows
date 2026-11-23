<?php
/**
 * NotificationDispatcher go-live split unit tests (stage × status matrix).
 *
 * Go-live notifies via two complementary paths, exactly-once by construction:
 *
 *  - Workflow-driven: the workflow stage action notifies when the crossing
 *    committed `publish` from a non-publish status (cause 'workflow') — through
 *    the global event matrix AND, with the Published template, through the
 *    transition's own configured channels (legacy parity, no admin routing
 *    needed). A committed status of `future` (scheduled gate publish) is not a
 *    go-live.
 *  - Core-driven: transition_post_status notifies for cron future→publish,
 *    quick edit, etc. — suppressed while a workflow transition is mid-commit.
 *
 * Both paths queue a job; nothing is sent during the hook. Each test runs the
 * queued jobs to check what the channel finally receives.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflows\Sequences\Sequence;
use VIPWorkflows\Notifications\Notification;
use VIPWorkflows\Notifications\NotificationChannel;
use VIPWorkflows\Notifications\NotificationDispatcher;
use VIPWorkflows\Workflow\StatusManager;

/**
 * Tests for the two-path go-live design in NotificationDispatcher.
 */
class NotificationDispatcherGoLiveTest extends TestCase
{
    use QueuedNotifications;

    private NotificationDispatcher $dispatcher;

    protected function setUp(): void
    {
        parent::setUp();

        // register_channels() (triggered lazily by get_channel()) registers a
        // setting per built-in channel; SlackChannel reads a destinations option.
        Functions\when( 'register_setting' )->justReturn( true );
        Functions\when( 'get_option' )->justReturn( [] );
        $this->stub_transients();
        $this->capture_enqueues();

        $this->dispatcher = new NotificationDispatcher();
    }

    // -------------------------------------------------------------------------
    // Workflow-driven path (stage action)
    // -------------------------------------------------------------------------

    /**
     * A workflow transition whose crossing committed `publish` queues the
     * Published template for the transition's configured channels — with NO
     * global matrix routing configured (legacy parity).
     */
    public function test_workflow_publish_queues_published_template_for_transition_channels(): void
    {
        $this->stub_workflow_transition_environment( 'draft' );

        $sequence = $this->sequence_with_transition( array( 'to' => 'published-stage', 'notifications' => array( 'slack' ) ) );

        $received = array();
        // No routing configured: a transition's own `notifications` list is what
        // sends this, not the event-routing table.
        $this->dispatcher->register_channel( $this->recording_channel( 'slack', $received ) );

        $this->dispatcher->handle_status_transition(
            42,
            'published-stage',
            'review',
            $sequence,
            array(
                'cause'            => 'workflow',
                'committed_status' => 'publish',
                'previous_status'  => 'draft',
            )
        );

        $this->assertSame( array(), $received, 'Nothing is sent during the transition.' );
        $this->assertCount( 1, $this->enqueued );
        $this->assertSame( NotificationDispatcher::SEND_HOOK, $this->enqueued[0]['hook'] );
        $this->assertSame( NotificationDispatcher::SEND_GROUP, $this->enqueued[0]['group'] );
        $this->assertSame( 'published', $this->enqueued[0]['args']['event_type'] );
        $this->assert_event_facts_only( $this->enqueued[0]['args']['data'] );

        $this->run_enqueued( $this->dispatcher );

        $this->assertCount( 1, $received );
        $this->assertSame( 'published', $received[0]->type );
        $this->assertSame( 'draft', $received[0]->data['previous_status'] );
        $this->assertSame( 'publish', $received[0]->data['committed_status'] );
        $this->assertSame( '“Test Post” published by Jane', $received[0]->message );
    }

    /**
     * The workflow-driven go-live also routes through the global event matrix,
     * even when the transition itself has no configured channels (assignment
     * seats and unconfigured gate edges still count as go-lives).
     */
    public function test_workflow_publish_dispatches_matrix_without_transition_channels(): void
    {
        $this->stub_workflow_transition_environment( 'draft' );
        $this->stub_matrix_routing( array( 'published' => array( 'slack' ) ) );

        $sequence = Mockery::mock( Sequence::class );
        // No transition config at all (e.g. an assignment seat).
        $sequence->shouldReceive( 'get_transition' )->andReturn( null );

        $received = array();
        $this->dispatcher->register_channel( $this->recording_channel( 'slack', $received ) );

        $this->dispatcher->handle_status_transition(
            42,
            'published-stage',
            'review',
            $sequence,
            array(
                'cause'            => 'workflow',
                'committed_status' => 'publish',
                'previous_status'  => 'pending',
            )
        );

        $this->assertCount( 1, $this->enqueued );
        $this->assert_event_facts_only( $this->enqueued[0]['args']['data'] );

        $this->run_enqueued( $this->dispatcher );

        $this->assertCount( 1, $received );
        $this->assertSame( 'published', $received[0]->type );
        // The workflow path's stage is the action's new stage, by definition.
        $this->assertSame( 'published-stage', $received[0]->data['stage'] );
        $this->assertSame( 'pending', $received[0]->data['previous_status'] );
    }

    /**
     * A channel that gets the matrix `published` job is not queued again by the
     * transition's own list: one go-live, one message per channel.
     */
    public function test_workflow_publish_queues_once_when_matrix_and_transition_both_list_a_channel(): void
    {
        $this->stub_workflow_transition_environment( 'draft' );
        $this->stub_matrix_routing( array( 'published' => array( 'slack' ) ) );

        $sequence = $this->sequence_with_transition( array( 'to' => 'published-stage', 'notifications' => array( 'slack' ) ) );

        $received = array();
        $this->dispatcher->register_channel( $this->recording_channel( 'slack', $received ) );

        $this->dispatcher->handle_status_transition(
            42,
            'published-stage',
            'review',
            $sequence,
            array(
                'cause'            => 'workflow',
                'committed_status' => 'publish',
                'previous_status'  => 'draft',
            )
        );

        $this->assertCount( 1, $this->enqueued );
        $this->assertSame( 'slack', $this->enqueued[0]['args']['channel_id'] );
        $this->assertSame( 'published', $this->enqueued[0]['args']['event_type'] );
    }

    /**
     * A scheduled gate publish (committed `future`) is NOT a go-live: the
     * transition channels get a plain stage change. When cron later commits
     * publish, the core path delivers the Published notification with the
     * correct (post-reseat) stage and previous_status = 'future'.
     */
    public function test_scheduled_gate_publish_notifies_transition_then_core_path_at_cron_time(): void
    {
        $this->stub_workflow_transition_environment( 'future' );
        $this->stub_matrix_routing( array( 'published' => array( 'slack' ) ) );

        $sequence = $this->sequence_with_transition( array( 'to' => 'published-stage', 'notifications' => array( 'slack' ) ) );

        $received = array();
        $this->dispatcher->register_channel( $this->recording_channel( 'slack', $received ) );

        // 1. The workflow gate transition: committed as `future` — no go-live.
        $this->dispatcher->handle_status_transition(
            42,
            'published-stage',
            'review',
            $sequence,
            array(
                'cause'            => 'workflow',
                'committed_status' => 'future',
                'previous_status'  => 'draft',
            )
        );

        // 2. Cron flips future → publish: the core path notifies.
        Functions\when( 'get_post_meta' )->alias(
            fn( $post_id, $key ) => StatusManager::SEQUENCE_META_KEY === $key ? '7' : 'published-stage'
        );
        $post = $this->create_mock_post( array( 'ID' => 42, 'post_title' => 'Scheduled Post' ) );
        $this->dispatcher->handle_go_live( 'publish', 'future', $post );

        $this->run_enqueued( $this->dispatcher );

        $this->assertCount( 2, $received );
        $this->assertSame( 'transition', $received[0]->type );
        $this->assertSame( 'future', $received[0]->data['committed_status'] );
        $this->assertSame( 'published', $received[1]->type );
        $this->assertSame( 'future', $received[1]->data['previous_status'] );
        $this->assertSame( 'published-stage', $received[1]->data['stage'] );
        $this->assertSame( 'core', $received[1]->data['cause'] );
    }

    /**
     * Legacy 4-arg emitters (no $context) still work: previous_status defaults
     * to the committed status, so an ordinary stage move never reads as a
     * go-live.
     */
    public function test_handle_status_transition_accepts_four_args(): void
    {
        $this->stub_workflow_transition_environment( 'draft' );

        $sequence = $this->sequence_with_transition( array( 'to' => 'review', 'notifications' => array( 'slack' ) ) );

        $received = array();
        $this->dispatcher->register_channel( $this->recording_channel( 'slack', $received ) );

        $this->dispatcher->handle_status_transition( 42, 'review', 'draft', $sequence );

        $this->assertCount( 1, $this->enqueued );
        $this->assertSame( 'transition', $this->enqueued[0]['args']['event_type'] );
        $data = $this->enqueued[0]['args']['data'];
        $this->assertSame( 'workflow', $data['cause'] );
        $this->assertSame( 'draft', $data['committed_status'] );
        $this->assertSame( 'draft', $data['previous_status'] );
    }

    // -------------------------------------------------------------------------
    // Core-driven path (transition_post_status)
    // -------------------------------------------------------------------------

    public function test_core_go_live_dispatches_published_for_workflow_post(): void
    {
        Functions\when( 'get_post_meta' )->alias(
            fn( $post_id, $key ) => StatusManager::SEQUENCE_META_KEY === $key ? '7' : 'live-stage'
        );
        $this->stub_matrix_routing( array( 'published' => array( 'slack' ) ) );

        $received = array();
        $this->dispatcher->register_channel( $this->recording_channel( 'slack', $received ) );

        $post = $this->create_mock_post( array( 'ID' => 42, 'post_title' => 'Live Post', 'post_status' => 'publish' ) );
        $this->dispatcher->handle_go_live( 'publish', 'draft', $post );

        $this->assertSame( array(), $received, 'Nothing is sent during the status change.' );
        $this->assertCount( 1, $this->enqueued );
        $this->assert_event_facts_only( $this->enqueued[0]['args']['data'] );

        // A scheduled publish runs on cron, where no user is logged in: the
        // link is built without a capability check.
        $this->stub_send_time_reads( $post );
        Functions\expect( 'get_edit_post_link' )->never();
        $this->run_enqueued( $this->dispatcher );

        $this->assertCount( 1, $received );
        $this->assertSame( 'published', $received[0]->type );
        $this->assertSame( 42, $received[0]->post_id );
        $this->assertSame( 'draft', $received[0]->data['previous_status'] );
        $this->assertSame( 'live-stage', $received[0]->data['stage'] );
        $this->assertSame( '“Live Post” published by Jane', $received[0]->message );
        $this->assertSame( 'https://example.com/wp-admin/post.php?post=42&action=edit', $received[0]->data['edit_url'] );
    }

    /**
     * While a workflow transition is mid-commit (its stage meta not yet
     * written), the core hook fire is suppressed — the workflow path owns that
     * go-live.
     */
    public function test_core_go_live_suppressed_while_workflow_transition_in_progress(): void
    {
        Functions\expect( 'get_post_meta' )->never();
        Functions\expect( 'as_enqueue_async_action' )->never();

        $channel = $this->make_channel( 'slack' );
        $channel->shouldNotReceive( 'send' );
        $this->dispatcher->register_channel( $channel );

        $previous = $this->set_transitions_in_progress( array( 42 => true ) );
        try {
            $post = $this->create_mock_post( array( 'ID' => 42 ) );
            $this->dispatcher->handle_go_live( 'publish', 'draft', $post );
        } finally {
            $this->set_transitions_in_progress( $previous );
        }

        $this->addToAssertionCount( 1 );
    }

    public function test_core_go_live_ignores_posts_without_a_workflow(): void
    {
        // No sequence meta → not workflow-managed → no dispatch.
        Functions\when( 'get_post_meta' )->justReturn( '' );
        Functions\expect( 'as_enqueue_async_action' )->never();

        $channel = $this->make_channel( 'slack' );
        $channel->shouldNotReceive( 'send' );
        $this->dispatcher->register_channel( $channel );

        $post = $this->create_mock_post( array( 'ID' => 42 ) );
        $this->dispatcher->handle_go_live( 'publish', 'draft', $post );

        $this->addToAssertionCount( 1 );
    }

    public function test_core_go_live_ignores_non_go_live_transitions(): void
    {
        // Neither a publish→publish update nor an unpublish is a go-live.
        Functions\expect( 'get_post_meta' )->never();
        Functions\expect( 'as_enqueue_async_action' )->never();

        $channel = $this->make_channel( 'slack' );
        $channel->shouldNotReceive( 'send' );
        $this->dispatcher->register_channel( $channel );

        $post = $this->create_mock_post( array( 'ID' => 42 ) );
        $this->dispatcher->handle_go_live( 'publish', 'publish', $post );
        $this->dispatcher->handle_go_live( 'draft', 'publish', $post );

        $this->addToAssertionCount( 1 );
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /**
     * Stub the WP functions the workflow transition handler and the job read.
     *
     * @param string $post_status The post's committed status at handler time.
     */
    private function stub_workflow_transition_environment( string $post_status ): void
    {
        $this->stub_send_time_reads(
            $this->create_mock_post(
                array(
                    'ID'          => 42,
                    'post_title'  => 'Test Post',
                    'post_status' => $post_status,
                )
            )
        );
    }

    /**
     * Configure the global event-matrix routing option.
     *
     * @param array $routing Event type => channel IDs.
     */
    private function stub_matrix_routing( array $routing ): void
    {
        Functions\when( 'get_option' )->alias(
            function ( $option, $default = [] ) use ( $routing ) {
                if ( 'vip_workflows_notification_routing' === $option ) {
                    return $routing;
                }
                return $default;
            }
        );
    }

    /**
     * Build a Sequence mock exposing the given transition config and generic
     * stage labels.
     *
     * @param array $transition Transition config get_transition() returns.
     * @return Sequence&Mockery\MockInterface
     */
    private function sequence_with_transition( array $transition ): Sequence&Mockery\MockInterface
    {
        $sequence = Mockery::mock( Sequence::class );
        $sequence->shouldReceive( 'get_transition' )->andReturn( $transition );
        $sequence->shouldReceive( 'get_status' )->andReturnUsing(
            fn( $key ) => array( 'key' => $key, 'label' => ucfirst( $key ) )
        );
        return $sequence;
    }

    /**
     * Swap StatusManager's private static transition-in-progress guard state,
     * returning the previous value so callers can restore it.
     *
     * @param array $value New guard state (post ID => true).
     * @return array Previous guard state.
     */
    private function set_transitions_in_progress( array $value ): array
    {
        $property = new \ReflectionProperty( StatusManager::class, 'transition_in_progress' );
        $previous = $property->getValue();
        $property->setValue( null, $value );
        return $previous;
    }

    /**
     * A configured channel that appends each notification it is sent to $received.
     *
     * @param string $id       Channel ID.
     * @param array  $received Notifications sent, in order.
     */
    private function recording_channel( string $id, array &$received ): NotificationChannel&Mockery\MockInterface
    {
        $channel = $this->make_channel( $id );
        $channel->shouldReceive( 'send' )->andReturnUsing(
            function ( Notification $notification ) use ( &$received ) {
                $received[] = $notification;
                return true;
            }
        );
        return $channel;
    }

    private function make_channel( string $id, bool $configured = true ): NotificationChannel&Mockery\MockInterface
    {
        $channel = Mockery::mock( NotificationChannel::class );
        $channel->shouldReceive( 'get_id' )->andReturn( $id );
        $channel->shouldReceive( 'is_configured' )->andReturn( $configured )->byDefault();
        $channel->shouldReceive( 'register_option' )->byDefault();
        return $channel;
    }
}
