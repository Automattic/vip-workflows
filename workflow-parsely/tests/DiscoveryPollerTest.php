<?php
/**
 * Polling discovery so new items are scored before anyone looks.
 *
 * The poller's job is entirely about what it *doesn't* do — it must not schedule
 * twice, must not poll a provider an administrator switched off, and must not
 * queue a merged feed's items a second time under the provider that restates
 * them. None of that is visible from the outside except through the warm queue
 * and the cron table, so that is what these assert on.
 *
 * The registry is a singleton with no unregister, so each test that needs
 * particular providers swaps the whole set out and puts the real one back
 * afterwards. Registering fakes alongside the real Parse.ly provider would leak
 * into every later test in the suite.
 *
 * The poll only runs while the Ideation experiment is on, so set_up() turns it
 * on and tear_down() turns it off again. The registry caches its resolved state
 * in memory, which the database rollback doesn't reach.
 *
 * @package WorkflowParsely\Tests
 */

declare( strict_types=1 );

namespace WorkflowParsely\Tests;

use ReflectionProperty;
use VIPWorkflows\Discovery\DiscoveryProviderRegistry;
use VIPWorkflows\Experiments\ExperimentRegistry;
use VIPWorkflows\Plugin;
use WorkflowParsely\Discovery\DiscoveryPoller;
use WorkflowParsely\Discovery\PromptScorer;
use Yoast\WPTestUtils\WPIntegration\TestCase;

class DiscoveryPollerTest extends TestCase {

	private const QUEUE_OPTION = 'workflow_parsely_prompt_warm_queue';

	/** @var array<string, array>|null Providers to restore in tear_down. */
	private ?array $saved_providers = null;

	public function set_up(): void {
		parent::set_up();

		update_option(
			'parsely',
			array(
				'apikey'     => 'example.com',
				'api_secret' => 'a-secret',
			)
		);

		$this->experiments()->enable( 'ideation' );

		// Enabling schedules the poll; each test starts from nothing scheduled.
		DiscoveryPoller::unschedule();
	}

	public function tear_down(): void {
		if ( null !== $this->saved_providers ) {
			$this->set_providers( $this->saved_providers );
			$this->saved_providers = null;
		}

		remove_all_filters( ExperimentRegistry::FILTER_NAME );
		$this->experiments()->disable( 'ideation' );
		$this->experiments()->disable( 'kanban' );

		DiscoveryPoller::unschedule();
		wp_clear_scheduled_hook( PromptScorer::WARM_HOOK );

		remove_all_filters( 'workflow_parsely_poll_interval' );
		delete_option( self::QUEUE_OPTION );
		delete_option( 'vip_discovery_provider_settings' );
		delete_option( 'parsely' );

		parent::tear_down();
	}

	// ── Helpers ──────────────────────────────────────────────────────

	private function experiments(): ExperimentRegistry {
		return Plugin::get_instance()->get_experiment_registry();
	}

	/**
	 * A provider that records each time its recommend callback is called.
	 *
	 * @param int $calls Incremented on every call.
	 * @return array
	 */
	private function counting_provider( int &$calls ): array {
		$provider = $this->fake_provider( 'fake-counted', array( 'Counted' ) );
		$inner    = $provider['callbacks']['recommend'];

		$provider['callbacks']['recommend'] = static function ( ...$args ) use ( &$calls, $inner ): array {
			++$calls;
			return $inner( ...$args );
		};

		return $provider;
	}

	private function providers_property(): ReflectionProperty {
		$property = new ReflectionProperty( DiscoveryProviderRegistry::class, 'providers' );
		$property->setAccessible( true );

		return $property;
	}

	/**
	 * @param array<string, array> $providers Registry contents.
	 */
	private function set_providers( array $providers ): void {
		$registry = DiscoveryProviderRegistry::get_instance();

		// Ensure the real registration has already run, or it will overwrite this.
		$registry->get_all();

		$this->providers_property()->setValue( $registry, $providers );
	}

	/**
	 * Replace the registry with fakes, remembering what was there.
	 *
	 * @param array<string, array> $providers Fakes keyed by slug.
	 */
	private function only_providers( array $providers ): void {
		if ( null === $this->saved_providers ) {
			$registry              = DiscoveryProviderRegistry::get_instance();
			$this->saved_providers = $registry->get_all();
		}

		$this->set_providers( $providers );
	}

	/**
	 * A registry entry whose recommend callback returns one prompt per title.
	 *
	 * @param string   $slug   Provider slug.
	 * @param string[] $titles Prompt titles, or an empty array to throw instead.
	 * @param bool     $throws Whether recommend should throw.
	 * @return array
	 */
	private function fake_provider( string $slug, array $titles, bool $throws = false ): array {
		return array(
			'slug'                  => $slug,
			'label'                 => $slug,
			'description'           => '',
			'icon'                  => '',
			'features'              => array( 'recommend' ),
			'callbacks'             => array(
				'recommend' => static function () use ( $slug, $titles, $throws ): array {
					if ( $throws ) {
						throw new \RuntimeException( 'provider ' . $slug . ' is down' );
					}

					return array_map(
						static fn( string $title ): array => array(
							'id'       => $slug . '-' . md5( $title ),
							'provider' => $slug,
							'title'    => $title,
							'tags'     => array(),
						),
						$titles
					);
				},
				'seed'      => static fn( array $prompt ): string => (string) $prompt['title'],
			),
			'availability_callback' => null,
		);
	}

	/**
	 * Titles currently sitting in the warm queue.
	 *
	 * @return string[]
	 */
	private function queued_titles(): array {
		$queue = get_option( self::QUEUE_OPTION, array() );

		if ( ! is_array( $queue ) ) {
			return array();
		}

		$titles = array_column( $queue, 'title' );
		sort( $titles );

		return $titles;
	}

	// ── Scheduling ───────────────────────────────────────────────────

	public function test_ensure_scheduled_schedules_the_poll(): void {
		DiscoveryPoller::ensure_scheduled();

		$this->assertNotFalse( wp_next_scheduled( DiscoveryPoller::POLL_HOOK ) );
	}

	/**
	 * `ensure_scheduled()` runs on `init`, so it fires on every request. Without
	 * the guard each one would add another recurring event and the feed would be
	 * polled once per page load forever after.
	 */
	public function test_ensure_scheduled_is_idempotent(): void {
		DiscoveryPoller::ensure_scheduled();
		$first = wp_next_scheduled( DiscoveryPoller::POLL_HOOK );

		DiscoveryPoller::ensure_scheduled();
		DiscoveryPoller::ensure_scheduled();

		$this->assertSame( $first, wp_next_scheduled( DiscoveryPoller::POLL_HOOK ) );
		$this->assertCount( 1, $this->scheduled_poll_events() );
	}

	public function test_nothing_is_scheduled_without_credentials(): void {
		delete_option( 'parsely' );

		DiscoveryPoller::ensure_scheduled();

		$this->assertFalse( wp_next_scheduled( DiscoveryPoller::POLL_HOOK ) );
	}

	public function test_disabling_parsely_unschedules_an_existing_poll(): void {
		DiscoveryPoller::ensure_scheduled();
		$this->assertNotFalse( wp_next_scheduled( DiscoveryPoller::POLL_HOOK ) );

		update_option(
			'vip_discovery_provider_settings',
			array( 'parsely-trending' => array( 'enabled' => false ) )
		);

		DiscoveryPoller::ensure_scheduled();

		$this->assertFalse( wp_next_scheduled( DiscoveryPoller::POLL_HOOK ) );
	}

	public function test_unschedule_clears_the_event(): void {
		DiscoveryPoller::ensure_scheduled();

		DiscoveryPoller::unschedule();

		$this->assertFalse( wp_next_scheduled( DiscoveryPoller::POLL_HOOK ) );
	}

	/**
	 * Every occurrence of the poll hook in the cron array.
	 *
	 * `wp_next_scheduled()` only reports the soonest one, so a duplicate
	 * scheduled at a different timestamp would be invisible to it.
	 *
	 * @return array
	 */
	private function scheduled_poll_events(): array {
		$found = array();

		foreach ( (array) _get_cron_array() as $timestamp => $hooks ) {
			if ( isset( $hooks[ DiscoveryPoller::POLL_HOOK ] ) ) {
				$found[ $timestamp ] = $hooks[ DiscoveryPoller::POLL_HOOK ];
			}
		}

		return $found;
	}

	// ── Ideation gate ────────────────────────────────────────────────

	public function test_nothing_is_scheduled_while_ideation_is_off(): void {
		$this->experiments()->disable( 'ideation' );

		DiscoveryPoller::ensure_scheduled();

		$this->assertFalse( wp_next_scheduled( DiscoveryPoller::POLL_HOOK ) );
	}

	/**
	 * A filter change or a direct option edit fires no action, so `init` is what
	 * removes an event left over from when Ideation was on.
	 */
	public function test_ensure_scheduled_removes_the_poll_while_ideation_is_off(): void {
		$this->experiments()->disable( 'ideation' );
		wp_schedule_event( time() + HOUR_IN_SECONDS, 'hourly', DiscoveryPoller::POLL_HOOK );
		$this->assertNotFalse( wp_next_scheduled( DiscoveryPoller::POLL_HOOK ) );

		DiscoveryPoller::ensure_scheduled();

		$this->assertFalse( wp_next_scheduled( DiscoveryPoller::POLL_HOOK ) );
	}

	public function test_poll_calls_no_provider_while_ideation_is_off(): void {
		$calls = 0;
		$this->only_providers( array( 'fake-counted' => $this->counting_provider( $calls ) ) );
		$this->experiments()->disable( 'ideation' );

		DiscoveryPoller::poll();

		$this->assertSame( 0, $calls );
		$this->assertFalse( get_option( self::QUEUE_OPTION ) );
	}

	public function test_turning_ideation_on_schedules_the_poll(): void {
		$this->experiments()->disable( 'ideation' );
		$this->assertFalse( wp_next_scheduled( DiscoveryPoller::POLL_HOOK ) );

		$this->experiments()->enable( 'ideation' );

		$this->assertNotFalse( wp_next_scheduled( DiscoveryPoller::POLL_HOOK ) );
	}

	public function test_turning_ideation_on_does_not_schedule_when_parsely_is_disabled(): void {
		$this->experiments()->disable( 'ideation' );
		update_option(
			'vip_discovery_provider_settings',
			array( 'parsely-trending' => array( 'enabled' => false ) )
		);

		$this->experiments()->enable( 'ideation' );

		$this->assertFalse( wp_next_scheduled( DiscoveryPoller::POLL_HOOK ) );
	}

	public function test_turning_ideation_off_unschedules_the_poll(): void {
		DiscoveryPoller::ensure_scheduled();
		$this->assertNotFalse( wp_next_scheduled( DiscoveryPoller::POLL_HOOK ) );

		$this->experiments()->disable( 'ideation' );

		$this->assertFalse( wp_next_scheduled( DiscoveryPoller::POLL_HOOK ) );
	}

	/**
	 * `disable()` fires its action even when the filter keeps Ideation on, so the
	 * listener has to read the effective state rather than trust the action.
	 */
	public function test_the_poll_stays_when_a_filter_keeps_ideation_on(): void {
		DiscoveryPoller::ensure_scheduled();
		add_filter(
			ExperimentRegistry::FILTER_NAME,
			static fn( array $enabled ): array => array_values( array_unique( array_merge( $enabled, array( 'ideation' ) ) ) )
		);

		$this->experiments()->disable( 'ideation' );

		$this->assertNotFalse( wp_next_scheduled( DiscoveryPoller::POLL_HOOK ) );
	}

	public function test_toggling_another_experiment_leaves_the_poll_alone(): void {
		// Ideation is on but the poll isn't scheduled, so a stray ensure_scheduled() would show.
		DiscoveryPoller::unschedule();

		$this->experiments()->enable( 'kanban' );
		$this->assertFalse( wp_next_scheduled( DiscoveryPoller::POLL_HOOK ) );

		$this->experiments()->disable( 'kanban' );
		$this->assertFalse( wp_next_scheduled( DiscoveryPoller::POLL_HOOK ) );
	}

	/**
	 * Without VIP Workflows' experiment registry there's no way to tell whether
	 * Ideation is on, so the background work stays off.
	 */
	public function test_nothing_runs_when_the_experiment_registry_is_missing(): void {
		DiscoveryPoller::ensure_scheduled();
		$calls = 0;
		$this->only_providers( array( 'fake-counted' => $this->counting_provider( $calls ) ) );

		$property = new ReflectionProperty( Plugin::class, 'experiment_registry' );
		$property->setAccessible( true );
		$registry = $property->getValue( Plugin::get_instance() );

		try {
			$property->setValue( Plugin::get_instance(), null );

			$this->assertFalse( \WorkflowParsely\ideation_enabled() );

			DiscoveryPoller::ensure_scheduled();
			DiscoveryPoller::poll();
		} finally {
			$property->setValue( Plugin::get_instance(), $registry );
		}

		$this->assertFalse( wp_next_scheduled( DiscoveryPoller::POLL_HOOK ) );
		$this->assertSame( 0, $calls );
	}

	// ── Interval ─────────────────────────────────────────────────────

	public function test_default_interval_is_fifteen_minutes(): void {
		$this->assertSame( 15 * MINUTE_IN_SECONDS, DiscoveryPoller::interval() );
	}

	public function test_interval_can_be_turned_down_by_filter(): void {
		add_filter( 'workflow_parsely_poll_interval', static fn(): int => 2 * MINUTE_IN_SECONDS );

		$this->assertSame( 2 * MINUTE_IN_SECONDS, DiscoveryPoller::interval() );
	}

	/**
	 * The filter exists so a newsroom watching a wire can poll faster, not so a
	 * site can poll every provider continuously.
	 */
	public function test_interval_is_clamped_to_a_minute(): void {
		add_filter( 'workflow_parsely_poll_interval', static fn(): int => 5 );

		$this->assertSame( MINUTE_IN_SECONDS, DiscoveryPoller::interval() );
	}

	public function test_the_schedule_reports_the_current_interval(): void {
		add_filter( 'workflow_parsely_poll_interval', static fn(): int => 20 * MINUTE_IN_SECONDS );

		$schedules = DiscoveryPoller::add_schedule( array() );

		$this->assertSame(
			20 * MINUTE_IN_SECONDS,
			$schedules['workflow_parsely_poll']['interval'] ?? null,
			'Cron reads the interval back out of cron_schedules on every reschedule, so the filter must reach it there.'
		);
	}

	// ── Polling ──────────────────────────────────────────────────────

	public function test_poll_queues_what_a_provider_returns(): void {
		$this->only_providers(
			array( 'fake-wire' => $this->fake_provider( 'fake-wire', array( 'Harvest Falters', 'Rates Held' ) ) )
		);

		DiscoveryPoller::poll();

		$this->assertSame( array( 'Harvest Falters', 'Rates Held' ), $this->queued_titles() );
	}

	public function test_poll_skips_a_provider_an_admin_switched_off(): void {
		$this->only_providers(
			array(
				'fake-on'  => $this->fake_provider( 'fake-on', array( 'Kept' ) ),
				'fake-off' => $this->fake_provider( 'fake-off', array( 'Dropped' ) ),
			)
		);

		update_option(
			'vip_discovery_provider_settings',
			array( 'fake-off' => array( 'enabled' => false ) )
		);

		DiscoveryPoller::poll();

		$this->assertSame( array( 'Kept' ), $this->queued_titles() );
	}

	public function test_poll_does_nothing_when_parsely_is_disabled(): void {
		$this->only_providers(
			array( 'fake-wire' => $this->fake_provider( 'fake-wire', array( 'Never Queued' ) ) )
		);

		update_option(
			'vip_discovery_provider_settings',
			array( 'parsely-trending' => array( 'enabled' => false ) )
		);

		DiscoveryPoller::poll();

		$this->assertSame( array(), $this->queued_titles() );
	}

	/**
	 * `parsely-trending` restates the site's own top stories, which the decorator
	 * already skips. Polling it would queue a merged feed's items a second time
	 * under a second provider name, and pay to score each of them twice.
	 */
	public function test_poll_skips_providers_that_restate_another_feed(): void {
		$skipped = \WorkflowParsely\Discovery\PromptScorer::SKIP_PROVIDERS[0];

		$this->only_providers(
			array(
				$skipped => $this->fake_provider( $skipped, array( 'Restated' ) ),
				'fake'   => $this->fake_provider( 'fake', array( 'Original' ) ),
			)
		);

		DiscoveryPoller::poll();

		$this->assertSame( array( 'Original' ), $this->queued_titles() );
	}

	public function test_a_provider_that_throws_does_not_stop_the_others(): void {
		$this->only_providers(
			array(
				'fake-down' => $this->fake_provider( 'fake-down', array(), true ),
				'fake-up'   => $this->fake_provider( 'fake-up', array( 'Still Queued' ) ),
			)
		);

		DiscoveryPoller::poll();

		$this->assertSame( array( 'Still Queued' ), $this->queued_titles() );
	}

	public function test_poll_does_nothing_without_credentials(): void {
		$this->only_providers(
			array( 'fake' => $this->fake_provider( 'fake', array( 'Never Queued' ) ) )
		);

		delete_option( 'parsely' );

		DiscoveryPoller::poll();

		$this->assertSame( array(), $this->queued_titles() );
	}
}
