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
 * @package WorkflowParsely\Tests
 */

declare( strict_types=1 );

namespace WorkflowParsely\Tests;

use ReflectionProperty;
use VIPWorkflow\Discovery\DiscoveryProviderRegistry;
use WorkflowParsely\Discovery\DiscoveryPoller;
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
	}

	public function tear_down(): void {
		if ( null !== $this->saved_providers ) {
			$this->set_providers( $this->saved_providers );
			$this->saved_providers = null;
		}

		DiscoveryPoller::unschedule();

		remove_all_filters( 'workflow_parsely_poll_interval' );
		delete_option( self::QUEUE_OPTION );
		delete_option( 'vip_discovery_provider_settings' );
		delete_option( 'parsely' );

		parent::tear_down();
	}

	// ── Helpers ──────────────────────────────────────────────────────

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
