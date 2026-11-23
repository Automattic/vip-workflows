<?php
/**
 * Transition notifications are queued in Action Scheduler, not sent in the request.
 *
 * Driven end to end: a real sequence, a real post, StatusManager::transition(),
 * the dispatcher the plugin registered, and the bundled Action Scheduler's store
 * and runner. The channels are fixtures registered on that dispatcher, so no
 * test depends on DNS or a webhook.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Notifications\Notification;
use VIPWorkflows\Notifications\NotificationChannel;
use VIPWorkflows\Notifications\NotificationDispatcher;
use VIPWorkflows\Plugin;
use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Workflow\StatusManager;

/**
 * A configured channel that hands each notification to a callback.
 */
class QueueFixtureChannel extends NotificationChannel {

	/**
	 * Channel ID.
	 *
	 * @var string
	 */
	private string $id;

	/**
	 * Receives each notification sent.
	 *
	 * @var callable
	 */
	private $on_send;

	/**
	 * Constructor.
	 *
	 * @param string   $id      Channel ID.
	 * @param callable $on_send Receives each notification; its return value is send()'s.
	 */
	public function __construct( string $id, callable $on_send ) {
		$this->id      = $id;
		$this->on_send = $on_send;
	}

	/**
	 * {@inheritdoc}
	 */
	public function get_id(): string {
		return $this->id;
	}

	/**
	 * {@inheritdoc}
	 */
	public function get_name(): string {
		return 'Queue fixture';
	}

	/**
	 * {@inheritdoc}
	 */
	public function get_description(): string {
		return 'Test fixture.';
	}

	/**
	 * {@inheritdoc}
	 */
	public function get_icon(): string {
		return 'admin-generic';
	}

	/**
	 * {@inheritdoc}
	 */
	public function is_configured(): bool {
		return true;
	}

	/**
	 * {@inheritdoc}
	 *
	 * @param Notification $notification Notification to send.
	 */
	public function send( Notification $notification ): bool {
		return (bool) call_user_func( $this->on_send, $notification );
	}

	/**
	 * {@inheritdoc}
	 */
	public function test_connection() {
		return true;
	}

	/**
	 * {@inheritdoc}
	 *
	 * @param array $input Input.
	 */
	public function sanitize_settings( array $input ): array {
		return $input;
	}

	/**
	 * {@inheritdoc}
	 */
	public function register_option(): void {
	}
}

/**
 * @covers \VIPWorkflows\Notifications\NotificationDispatcher
 */
class NotificationQueueIntegrationTest extends TestCase {

	/**
	 * Records what it is sent.
	 */
	private const RECORDING_CHANNEL = 'queue-fixture-recording';

	/**
	 * Throws from send().
	 */
	private const THROWING_CHANNEL = 'queue-fixture-throwing';

	/**
	 * Returns false from send(), as a channel does when it fails to deliver.
	 */
	private const REJECTING_CHANNEL = 'queue-fixture-rejecting';

	/**
	 * Notifications the recording channel was sent, in order.
	 *
	 * @var array<int, Notification>
	 */
	private static array $sent = array();

	/**
	 * Outbound HTTP requests made during the test.
	 *
	 * @var array<int, string>
	 */
	private array $http_requests = array();

	/**
	 * Post under test.
	 *
	 * @var int
	 */
	private int $post_id = 0;

	/**
	 * Register the fixture channels once, and record any outbound HTTP.
	 */
	public function set_up(): void {
		parent::set_up();

		self::$sent          = array();
		$this->http_requests = array();

		$dispatcher = Plugin::get_instance()->get_module( 'notifications' );
		$this->assertInstanceOf( NotificationDispatcher::class, $dispatcher );

		// Channels live on the plugin's dispatcher for the whole process, so
		// register them once.
		if ( ! $dispatcher->get_channel( self::RECORDING_CHANNEL ) ) {
			$dispatcher->register_channel(
				new QueueFixtureChannel(
					self::RECORDING_CHANNEL,
					static function ( Notification $notification ): bool {
						self::$sent[] = $notification;
						return true;
					}
				)
			);
		}
		if ( ! $dispatcher->get_channel( self::THROWING_CHANNEL ) ) {
			$dispatcher->register_channel(
				new QueueFixtureChannel(
					self::THROWING_CHANNEL,
					static function (): bool {
						throw new \RuntimeException( 'The fixture channel exploded.' );
					}
				)
			);
		}

		if ( ! $dispatcher->get_channel( self::REJECTING_CHANNEL ) ) {
			$dispatcher->register_channel(
				new QueueFixtureChannel(
					self::REJECTING_CHANNEL,
					static function (): bool {
						return false;
					}
				)
			);
		}

		add_filter(
			'pre_http_request',
			function ( $preempt, $args, $url ) {
				$this->http_requests[] = $url;
				return $preempt;
			},
			10,
			3
		);

		wp_set_current_user( (int) self::factory()->user->create( array( 'role' => 'administrator' ) ) );
	}

	/**
	 * Seat a post in a draft stage whose one transition, into a pending stage,
	 * notifies the given channel.
	 *
	 * @param string $channel_id Channel the transition lists.
	 */
	private function seed( string $channel_id ): void {
		$sequence_id = (int) ( new SequenceRepository() )->create(
			'Queued Notifications Flow',
			'queued-notifications-flow',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'         => 'writing',
						'label'       => 'Writing',
						'status'      => 'draft',
						'transitions' => array(
							array(
								'to'            => 'copy_desk',
								'notifications' => array( $channel_id ),
							),
						),
					),
					array(
						'key'         => 'copy_desk',
						'label'       => 'Copy desk',
						'status'      => 'pending',
						'transitions' => array(),
					),
				),
			),
			get_current_user_id()
		);

		$this->post_id = (int) self::factory()->post->create(
			array(
				'post_status' => 'draft',
				'post_title'  => 'Headline when moved',
			)
		);

		update_post_meta( $this->post_id, StatusManager::SEQUENCE_META_KEY, $sequence_id );
		update_post_meta( $this->post_id, StatusManager::STAGE_META_KEY, 'writing' );
	}

	/**
	 * Pending notification jobs for the post under test.
	 *
	 * @return array<int, \ActionScheduler_Action> Keyed by action ID.
	 */
	private function pending_jobs(): array {
		$actions = as_get_scheduled_actions(
			array(
				'hook'     => NotificationDispatcher::SEND_HOOK,
				'group'    => NotificationDispatcher::SEND_GROUP,
				'status'   => \ActionScheduler_Store::STATUS_PENDING,
				'per_page' => -1,
			),
			OBJECT
		);

		return array_filter(
			$actions,
			fn( \ActionScheduler_Action $action ): bool => (int) ( $action->get_args()['data']['post_id'] ?? 0 ) === $this->post_id
		);
	}

	public function test_a_transition_queues_its_notification_and_sends_nothing_in_the_request(): void {
		$this->seed( self::RECORDING_CHANNEL );

		$this->assertTrue( ( new StatusManager() )->transition( $this->post_id, 'copy_desk' ) );

		$this->assertSame( array(), self::$sent, 'Nothing is sent during the transition.' );
		$this->assertSame( array(), $this->http_requests, 'No HTTP request is made during the transition.' );

		$jobs = $this->pending_jobs();
		$this->assertCount( 1, $jobs );

		$args = reset( $jobs )->get_args();
		$this->assertSame( self::RECORDING_CHANNEL, $args['channel_id'] );
		$this->assertSame( 'transition', $args['event_type'] );
		$this->assertSame( 'Writing', $args['data']['from_label'] );
		$this->assertSame( 'Copy desk', $args['data']['to_label'] );
		$this->assertStringNotContainsString( 'Headline when moved', (string) wp_json_encode( $args ), 'The job stores no post content.' );
	}

	public function test_the_job_renders_the_live_title_and_edit_link_when_it_runs_with_no_user(): void {
		$this->seed( self::RECORDING_CHANNEL );
		$this->assertTrue( ( new StatusManager() )->transition( $this->post_id, 'copy_desk' ) );

		$jobs = $this->pending_jobs();
		$this->assertCount( 1, $jobs );

		wp_update_post(
			wp_slash(
				array(
					'ID'         => $this->post_id,
					'post_title' => 'Headline after a rename',
				)
			)
		);

		// The queue runner has no logged-in user.
		wp_set_current_user( 0 );
		\ActionScheduler::runner()->process_action( (int) key( $jobs ) );

		$this->assertSame( \ActionScheduler_Store::STATUS_COMPLETE, \ActionScheduler::store()->get_status( (string) key( $jobs ) ) );
		$this->assertCount( 1, self::$sent );
		$this->assertSame( '“Headline after a rename” moved from Writing to Copy desk', self::$sent[0]->message );
		$this->assertSame(
			admin_url( 'post.php?post=' . $this->post_id . '&action=edit' ),
			self::$sent[0]->get_post_url( 'edit' )
		);
	}

	public function test_a_job_for_a_post_in_the_trash_sends_nothing(): void {
		global $wpdb;

		$this->seed( self::RECORDING_CHANNEL );
		$this->assertTrue( ( new StatusManager() )->transition( $this->post_id, 'copy_desk' ) );

		$jobs = $this->pending_jobs();
		$this->assertCount( 1, $jobs );

		// Only the status the job reads matters here, not the route into the Trash.
		$wpdb->update( $wpdb->posts, array( 'post_status' => 'trash' ), array( 'ID' => $this->post_id ) );
		clean_post_cache( $this->post_id );

		\ActionScheduler::runner()->process_action( (int) key( $jobs ) );

		// Completed, not failed: the job returned without sending.
		$this->assertSame( \ActionScheduler_Store::STATUS_COMPLETE, \ActionScheduler::store()->get_status( (string) key( $jobs ) ) );
		$this->assertSame( array(), self::$sent );
	}

	public function test_a_channel_that_throws_fails_its_job_and_not_the_transition(): void {
		$this->seed( self::THROWING_CHANNEL );

		$this->assertTrue( ( new StatusManager() )->transition( $this->post_id, 'copy_desk' ) );

		$jobs = $this->pending_jobs();
		$this->assertCount( 1, $jobs );

		\ActionScheduler::runner()->process_action( (int) key( $jobs ) );

		$this->assertSame( \ActionScheduler_Store::STATUS_FAILED, \ActionScheduler::store()->get_status( (string) key( $jobs ) ) );
		$this->assertSame( 'copy_desk', get_post_meta( $this->post_id, StatusManager::STAGE_META_KEY, true ) );
	}

	/**
	 * A send that returns false fails its job, so Tools → Scheduled Actions shows
	 * it. The logged reason names the channel and the post, never the content.
	 */
	public function test_a_send_that_returns_false_fails_its_job_and_not_the_transition(): void {
		$this->seed( self::REJECTING_CHANNEL );

		$this->assertTrue( ( new StatusManager() )->transition( $this->post_id, 'copy_desk' ) );

		$jobs = $this->pending_jobs();
		$this->assertCount( 1, $jobs );
		$action_id = (int) key( $jobs );

		\ActionScheduler::runner()->process_action( $action_id );

		$this->assertSame( \ActionScheduler_Store::STATUS_FAILED, \ActionScheduler::store()->get_status( (string) $action_id ) );
		$this->assertSame( 'copy_desk', get_post_meta( $this->post_id, StatusManager::STAGE_META_KEY, true ) );

		$log = implode(
			"\n",
			array_map(
				static fn( \ActionScheduler_LogEntry $entry ): string => $entry->get_message(),
				\ActionScheduler_Logger::instance()->get_logs( $action_id )
			)
		);
		$this->assertStringContainsString( self::REJECTING_CHANNEL, $log );
		$this->assertStringContainsString( (string) $this->post_id, $log );
		$this->assertStringNotContainsString( 'Headline when moved', $log, 'The log holds no post content.' );
	}

	/**
	 * Every queued job carries a post ID, so one without is malformed data, and
	 * get_post( 0 ) would describe an unrelated post.
	 */
	public function test_a_job_without_a_post_id_fails_and_sends_nothing(): void {
		$action_id = (int) as_enqueue_async_action(
			NotificationDispatcher::SEND_HOOK,
			array(
				'channel_id' => self::RECORDING_CHANNEL,
				'event_type' => 'transition',
				'data'       => array( 'from_label' => 'Writing' ),
			),
			NotificationDispatcher::SEND_GROUP
		);
		$this->assertGreaterThan( 0, $action_id );

		\ActionScheduler::runner()->process_action( $action_id );

		$this->assertSame( \ActionScheduler_Store::STATUS_FAILED, \ActionScheduler::store()->get_status( (string) $action_id ) );
		$this->assertSame( array(), self::$sent );
	}

	/**
	 * Scheduled Actions also runs jobs inside an administrator's request.
	 * Observe the template's locale without requiring a language pack on disk.
	 */
	public function test_a_manual_admin_run_uses_the_site_language_for_the_template(): void {
		$this->seed( self::RECORDING_CHANNEL );
		$this->assertTrue( ( new StatusManager() )->transition( $this->post_id, 'copy_desk' ) );
		$jobs = $this->pending_jobs();
		$this->assertCount( 1, $jobs );

		$site_locale  = get_locale();
		$user_locale  = 'de_DE' === $site_locale ? 'fr_FR' : 'de_DE';
		$user_id      = get_current_user_id();
		$prior_screen = $GLOBALS['current_screen'] ?? null;
		update_user_meta( $user_id, 'locale', $user_locale );
		wp_set_current_user( 0 );
		wp_set_current_user( $user_id );
		set_current_screen( 'tools_page_action-scheduler' );

		$template_locales = array();
		$record_locale    = static function ( $translation, $text, $domain ) use ( &$template_locales ) {
			if ( 'vip-workflows' === $domain && 'Stage changed' === $text ) {
				$template_locales[] = determine_locale();
			}
			return $translation;
		};
		add_filter( 'gettext', $record_locale, 10, 3 );
		try {
			$this->assertSame( $user_locale, determine_locale(), 'The manual runner starts in the operator locale.' );
			\ActionScheduler::runner()->process_action( (int) key( $jobs ), 'Admin List Table' );
			$this->assertCount( 1, self::$sent );
			$this->assertSame( array( $site_locale ), $template_locales, 'The shared notification template uses the site language.' );
		} finally {
			remove_filter( 'gettext', $record_locale, 10 );
			$GLOBALS['current_screen'] = $prior_screen;
		}
	}

	/**
	 * A queued job can't be recalled, so the stage-change event has to fire only
	 * after every point where transition() can still roll back. Here the stage
	 * write loses after the status write landed: transition() restores the status
	 * and returns an error, and nothing is queued.
	 */
	public function test_a_transition_rolled_back_after_its_status_write_queues_nothing(): void {
		$this->seed( self::RECORDING_CHANNEL );

		$post_id = $this->post_id;
		add_filter(
			'update_post_metadata',
			static function ( $check, $object_id, $meta_key ) use ( $post_id ) {
				return ( $object_id === $post_id && StatusManager::STAGE_META_KEY === $meta_key ) ? false : $check;
			},
			10,
			3
		);

		$fired  = did_action( 'vip_workflows_status_transition' );
		$result = ( new StatusManager() )->transition( $this->post_id, 'copy_desk' );

		$this->assertWPError( $result );
		$this->assertSame( 'draft', get_post_status( $this->post_id ), 'The status write was rolled back.' );
		$this->assertSame( $fired, did_action( 'vip_workflows_status_transition' ), 'The stage-change event did not fire.' );
		$this->assertSame( array(), $this->pending_jobs() );
	}
}
