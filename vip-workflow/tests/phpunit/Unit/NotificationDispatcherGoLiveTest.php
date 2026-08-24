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
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflow\Sequences\Sequence;
use VIPWorkflow\Notifications\Notification;
use VIPWorkflow\Notifications\NotificationChannel;
use VIPWorkflow\Notifications\NotificationDispatcher;
use VIPWorkflow\Workflow\StatusManager;

/**
 * Tests for the two-path go-live design in NotificationDispatcher.
 */
class NotificationDispatcherGoLiveTest extends TestCase
{
    private NotificationDispatcher $dispatcher;

    protected function setUp(): void
    {
        parent::setUp();

        // register_channels() (triggered lazily by get_channel()) registers a
        // setting per built-in channel; SlackChannel reads a destinations option.
        Functions\when( 'register_setting' )->justReturn( true );
        Functions\when( 'get_option' )->justReturn( [] );
        Functions\when( 'get_transient' )->justReturn( false );
        Functions\when( 'set_transient' )->justReturn( true );

        $this->dispatcher = new NotificationDispatcher();
    }

    // -------------------------------------------------------------------------
    // Workflow-driven path (stage action)
    // -------------------------------------------------------------------------

    /**
     * A workflow transition whose crossing committed `publish` sends the
     * Published template to the transition's configured channels — with NO
     * global matrix routing configured (legacy parity).
     */
    public function test_workflow_publish_sends_published_template_to_transition_channels(): void
    {
        $this->stub_workflow_transition_environment( 'draft' );

        $sequence = $this->sequence_with_transition( array( 'to' => 'published-stage', 'notifications' => array( 'slack' ) ) );

        $received = null;
        $channel  = $this->make_channel( 'slack' );
        // No routing configured: a transition's own `notifications` list is what
        // sends this, not the event-routing table.
        $channel->shouldReceive( 'send' )
            ->once()
            ->andReturnUsing(
                function ( $notification ) use ( &$received ) {
                    $received = $notification;
                    return true;
                }
            );
        $this->dispatcher->register_channel( $channel );

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

        $this->assertInstanceOf( Notification::class, $received );
        $this->assertSame( 'published', $received->type );
        $this->assertSame( 'draft', $received->data['previous_status'] );
        $this->assertSame( 'publish', $received->data['committed_status'] );
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

        $received = null;
        $channel  = $this->make_channel( 'slack' );
        $channel->shouldReceive( 'send' )
            ->once()
            ->andReturnUsing(
                function ( $notification ) use ( &$received ) {
                    $received = $notification;
                    return true;
                }
            );
        $this->dispatcher->register_channel( $channel );

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

        $this->assertInstanceOf( Notification::class, $received );
        $this->assertSame( 'published', $received->type );
        // The workflow path's stage is the action's new stage, by definition.
        $this->assertSame( 'published-stage', $received->data['stage'] );
        $this->assertSame( 'pending', $received->data['previous_status'] );
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
        $channel  = $this->make_channel( 'slack' );
        $channel->shouldReceive( 'send' )
            ->twice()
            ->andReturnUsing(
                function ( $notification ) use ( &$received ) {
                    $received[] = $notification;
                    return true;
                }
            );
        $this->dispatcher->register_channel( $channel );

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

        $received = null;
        $channel  = $this->make_channel( 'slack' );
        $channel->shouldReceive( 'send' )
            ->once()
            ->andReturnUsing(
                function ( $notification ) use ( &$received ) {
                    $received = $notification;
                    return true;
                }
            );
        $this->dispatcher->register_channel( $channel );

        $this->dispatcher->handle_status_transition( 42, 'review', 'draft', $sequence );

        $this->assertInstanceOf( Notification::class, $received );
        $this->assertSame( 'transition', $received->type );
        $this->assertSame( 'workflow', $received->data['cause'] );
        $this->assertSame( 'draft', $received->data['committed_status'] );
        $this->assertSame( 'draft', $received->data['previous_status'] );
    }

    // -------------------------------------------------------------------------
    // Core-driven path (transition_post_status)
    // -------------------------------------------------------------------------

    public function test_core_go_live_dispatches_published_for_workflow_post(): void
    {
        Functions\when( 'get_post_meta' )->alias(
            fn( $post_id, $key ) => StatusManager::SEQUENCE_META_KEY === $key ? '7' : 'live-stage'
        );
        Functions\when( 'get_userdata' )->justReturn( (object) array( 'display_name' => 'Jane' ) );
        Functions\when( 'get_edit_post_link' )->justReturn( 'https://example.com/edit' );
        Functions\when( 'get_permalink' )->justReturn( 'https://example.com/view' );
        $this->stub_matrix_routing( array( 'published' => array( 'slack' ) ) );

        $received = null;
        $channel  = $this->make_channel( 'slack' );
        $channel->shouldReceive( 'send' )
            ->once()
            ->andReturnUsing(
                function ( $notification ) use ( &$received ) {
                    $received = $notification;
                    return true;
                }
            );
        $this->dispatcher->register_channel( $channel );

        $post = $this->create_mock_post( array( 'ID' => 42, 'post_title' => 'Live Post' ) );
        $this->dispatcher->handle_go_live( 'publish', 'draft', $post );

        $this->assertInstanceOf( Notification::class, $received );
        $this->assertSame( 'published', $received->type );
        $this->assertSame( 42, $received->post_id );
        $this->assertSame( 'draft', $received->data['previous_status'] );
        $this->assertSame( 'live-stage', $received->data['stage'] );
    }

    /**
     * While a workflow transition is mid-commit (its stage meta not yet
     * written), the core hook fire is suppressed — the workflow path owns that
     * go-live.
     */
    public function test_core_go_live_suppressed_while_workflow_transition_in_progress(): void
    {
        Functions\expect( 'get_post_meta' )->never();

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
     * Stub the WP functions the workflow transition handler reads.
     *
     * @param string $post_status The post's committed status at handler time.
     */
    private function stub_workflow_transition_environment( string $post_status ): void
    {
        Functions\when( 'get_post' )->justReturn(
            $this->create_mock_post(
                array(
                    'ID'          => 42,
                    'post_title'  => 'Test Post',
                    'post_status' => $post_status,
                )
            )
        );
        Functions\when( 'get_userdata' )->justReturn( (object) array( 'display_name' => 'Jane' ) );
        Functions\when( 'get_edit_post_link' )->justReturn( 'https://example.com/edit' );
        Functions\when( 'get_permalink' )->justReturn( 'https://example.com/view' );
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
                if ( 'vip_workflow_notification_routing' === $option ) {
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

    private function make_channel( string $id, bool $configured = true ): NotificationChannel&Mockery\MockInterface
    {
        $channel = Mockery::mock( NotificationChannel::class );
        $channel->shouldReceive( 'get_id' )->andReturn( $id );
        $channel->shouldReceive( 'is_configured' )->andReturn( $configured )->byDefault();
        $channel->shouldReceive( 'register_option' )->byDefault();
        return $channel;
    }
}
