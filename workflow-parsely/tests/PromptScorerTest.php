<?php
/**
 * The prompt-score warm-up stops while Ideation is off.
 *
 * Scores are only shown in Ideation, so with it off the warm-up must not call
 * Parse.ly, reschedule itself or queue anything new. Turning Ideation off drops
 * the queue rather than pausing it, so turning it back on doesn't leave stale
 * entries that block the same items from being queued again.
 *
 * Every test stubs outbound HTTP, so nothing here reaches Parse.ly.
 *
 * @package WorkflowParsely\Tests
 */

declare( strict_types=1 );

namespace WorkflowParsely\Tests;

use VIPWorkflows\Experiments\ExperimentRegistry;
use VIPWorkflows\Plugin;
use WorkflowParsely\Discovery\DiscoveryPoller;
use WorkflowParsely\Discovery\PromptScorer;
use Yoast\WPTestUtils\WPIntegration\TestCase;

class PromptScorerTest extends TestCase {

	private const QUEUE_OPTION = 'workflow_parsely_prompt_warm_queue';

	/** @var int Outbound HTTP requests made during the test. */
	private int $requests = 0;

	public function set_up(): void {
		parent::set_up();

		update_option(
			'parsely',
			array(
				'apikey'     => 'example.com',
				'api_secret' => 'a-secret',
			)
		);

		$this->requests = 0;
		add_filter( 'pre_http_request', array( $this, 'stub_http' ), 10, 3 );

		$this->experiments()->enable( 'ideation' );

		DiscoveryPoller::unschedule();
		wp_clear_scheduled_hook( PromptScorer::WARM_HOOK );
	}

	public function tear_down(): void {
		remove_all_filters( ExperimentRegistry::FILTER_NAME );
		$this->experiments()->disable( 'ideation' );

		remove_filter( 'pre_http_request', array( $this, 'stub_http' ), 10 );

		DiscoveryPoller::unschedule();
		wp_clear_scheduled_hook( PromptScorer::WARM_HOOK );
		delete_option( self::QUEUE_OPTION );
		delete_option( 'parsely' );

		parent::tear_down();
	}

	// ── Helpers ──────────────────────────────────────────────────────

	/**
	 * Count every outbound request and answer it with an empty result.
	 *
	 * @param false|array $preempt Short-circuit value.
	 * @param array       $args    Request arguments.
	 * @param string      $url     Request URL.
	 * @return array
	 */
	public function stub_http( $preempt, $args, $url ): array {
		++$this->requests;

		return array(
			'headers'  => array(),
			'body'     => '{"data":[]}',
			'response' => array(
				'code'    => 200,
				'message' => 'OK',
			),
			'cookies'  => array(),
			'filename' => null,
		);
	}

	private function experiments(): ExperimentRegistry {
		return Plugin::get_instance()->get_experiment_registry();
	}

	/**
	 * Write a queue of candidates straight to the option.
	 *
	 * @param int $count Number of candidates.
	 */
	private function seed_queue( int $count ): void {
		$queue = array();

		for ( $i = 1; $i <= $count; $i++ ) {
			$queue[ 'wf_parsely_prompt_test_' . $i ] = array(
				'title' => 'Queued Story ' . $i,
				'tags'  => array(),
			);
		}

		update_option( self::QUEUE_OPTION, $queue, false );
	}

	/**
	 * @param string[] $titles Prompt titles.
	 * @return array[]
	 */
	private function prompts( array $titles ): array {
		return array_map(
			static fn( string $title ): array => array(
				'title' => $title,
				'tags'  => array(),
			),
			$titles
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

	// ── Ideation off ─────────────────────────────────────────────────

	public function test_warm_drops_the_queue_and_scores_nothing_while_ideation_is_off(): void {
		$this->experiments()->disable( 'ideation' );
		$this->seed_queue( 6 );

		PromptScorer::warm();

		$this->assertSame( 0, $this->requests );
		$this->assertFalse( get_option( self::QUEUE_OPTION ) );
		$this->assertFalse( wp_next_scheduled( PromptScorer::WARM_HOOK ) );
	}

	public function test_nothing_is_queued_while_ideation_is_off(): void {
		$this->experiments()->disable( 'ideation' );

		PromptScorer::queue_prompts( $this->prompts( array( 'Harvest Falters', 'Rates Held' ) ) );

		$this->assertFalse( get_option( self::QUEUE_OPTION ) );
		$this->assertFalse( wp_next_scheduled( PromptScorer::WARM_HOOK ) );
	}

	public function test_turning_ideation_off_stops_the_warm_up(): void {
		PromptScorer::queue_prompts( $this->prompts( array( 'Harvest Falters', 'Rates Held' ) ) );
		$this->assertNotFalse( wp_next_scheduled( PromptScorer::WARM_HOOK ) );
		$this->assertNotFalse( get_option( self::QUEUE_OPTION ) );

		$this->experiments()->disable( 'ideation' );

		$this->assertFalse( wp_next_scheduled( PromptScorer::WARM_HOOK ) );
		$this->assertFalse( get_option( self::QUEUE_OPTION ) );
	}

	/**
	 * `disable()` fires its action even when the filter keeps Ideation on, and
	 * then the warm-up carries on.
	 */
	public function test_the_warm_up_continues_when_a_filter_keeps_ideation_on(): void {
		PromptScorer::queue_prompts( $this->prompts( array( 'Harvest Falters', 'Rates Held' ) ) );
		add_filter(
			ExperimentRegistry::FILTER_NAME,
			static fn( array $enabled ): array => array_values( array_unique( array_merge( $enabled, array( 'ideation' ) ) ) )
		);

		$this->experiments()->disable( 'ideation' );

		$this->assertNotFalse( wp_next_scheduled( PromptScorer::WARM_HOOK ) );
		$this->assertSame( array( 'Harvest Falters', 'Rates Held' ), $this->queued_titles() );
	}

	/**
	 * A request that dies partway through turning Ideation off must not leave a
	 * queue with no drain event: the same item queued again after Ideation comes
	 * back would be skipped as already queued, and never scored.
	 */
	public function test_an_interrupted_stop_leaves_nothing_that_blocks_the_warm_up(): void {
		$prompts = $this->prompts( array( 'Harvest Falters' ) );
		PromptScorer::queue_prompts( $prompts );

		$interrupt = static function ( string $option ): void {
			if ( self::QUEUE_OPTION === $option ) {
				throw new \RuntimeException( 'Request died.' );
			}
		};
		add_action( 'delete_option', $interrupt );

		try {
			$this->experiments()->disable( 'ideation' );
			$this->fail( 'Deleting the queue should have been interrupted.' );
		} catch ( \RuntimeException $exception ) {
			$this->assertSame( 'Request died.', $exception->getMessage() );
		} finally {
			remove_action( 'delete_option', $interrupt );
		}

		DiscoveryPoller::ensure_scheduled();
		$this->experiments()->enable( 'ideation' );
		PromptScorer::queue_prompts( $prompts );

		$this->assertSame( array( 'Harvest Falters' ), $this->queued_titles() );
		$this->assertNotFalse( wp_next_scheduled( PromptScorer::WARM_HOOK ) );
	}

	// ── Ideation on ──────────────────────────────────────────────────

	public function test_warm_scores_a_batch_and_reschedules_for_the_rest(): void {
		$this->seed_queue( 6 );

		PromptScorer::warm();

		$this->assertGreaterThan( 0, $this->requests, 'Scoring should reach the HTTP stub.' );
		$this->assertSame( array( 'Queued Story 5', 'Queued Story 6' ), $this->queued_titles() );
		$this->assertNotFalse( wp_next_scheduled( PromptScorer::WARM_HOOK ) );

		for ( $i = 1; $i <= 4; $i++ ) {
			$this->assertNotFalse( get_transient( 'wf_parsely_prompt_test_' . $i ), "Candidate {$i} should be cached." );
		}
	}

	/**
	 * A paused queue would still hold this title after Ideation came back, so
	 * queueing it again would be skipped and nothing would drain it.
	 */
	public function test_an_item_queued_before_ideation_was_turned_off_can_be_queued_again(): void {
		PromptScorer::queue_prompts( $this->prompts( array( 'Harvest Falters' ) ) );

		$this->experiments()->disable( 'ideation' );
		$this->experiments()->enable( 'ideation' );
		$this->assertFalse( wp_next_scheduled( PromptScorer::WARM_HOOK ) );

		PromptScorer::queue_prompts( $this->prompts( array( 'Harvest Falters' ) ) );

		$this->assertSame( array( 'Harvest Falters' ), $this->queued_titles() );
		$this->assertNotFalse( wp_next_scheduled( PromptScorer::WARM_HOOK ) );
	}
}
