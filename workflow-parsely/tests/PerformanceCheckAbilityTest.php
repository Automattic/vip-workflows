<?php
/**
 * The performance comparison as a transition check.
 *
 * The comparison is expensive — a search, a measurement call per comparable
 * article, and a census call per reference day. The command palette pays for it
 * because someone asked and is watching. A transition must not: it reads nothing
 * but `issues`, so a cold transition still answers immediately and leaves the
 * real computation for cron rather than stalling a save for tens of seconds.
 *
 * These pin that split, and the invariant underneath both halves of it: a
 * transition always carries the result as a soft warning — every branch, so an
 * editor moving a post sees the same comparison a direct caller would just read
 * off the screen — and nothing this check reports is ever a hard failure on its
 * own.
 *
 * @package WorkflowParsely\Tests
 */

declare( strict_types=1 );

namespace WorkflowParsely\Tests;

use VIPWorkflow\Abilities\AbilityExecutor;
use WorkflowParsely\Abilities\PerformanceCheck;
use Yoast\WPTestUtils\WPIntegration\TestCase;

/**
 * Stands in for wp-parsely's Content API service.
 *
 * Duck-typed, like the headline suite's double: the real service's constructor
 * wants a configured Parsely instance and would reach for the network. It
 * carries get_search_results() so ParselyClient::search() prefers it over the
 * local endpoint, which would otherwise make a real request.
 */
class FakeContentService {

	/** @var int Calls to get_search_results(). */
	public int $searches = 0;

	/** @var int Calls to get_post_details(). */
	public int $details = 0;

	/** @var int Calls to get_posts(). */
	public int $cohorts = 0;

	/** @var array[] Records /search will answer with. */
	public array $matches;

	/**
	 * @param array[] $matches Records /search will answer with.
	 */
	public function __construct( array $matches ) {
		$this->matches = $matches;
	}

	/**
	 * @param array $args Search arguments.
	 * @return array[]
	 */
	public function get_search_results( array $args ): array {
		++$this->searches;

		return $this->matches;
	}

	/**
	 * Every comparable article did the same thing, so the geometric mean of the
	 * measured set is exactly this value.
	 *
	 * @param string $url   Article URL.
	 * @param string $start Window start.
	 * @param string $end   Window end.
	 * @return array[]
	 */
	public function get_post_details( string $url, string $start = '', string $end = '' ): array {
		++$this->details;

		return array(
			array( 'metrics' => array( 'views' => 1000 ) ),
		);
	}

	/**
	 * A day's census, ten articles wide, whose median is 100 — so the multiplier
	 * the check reports is exactly 10.
	 *
	 * @param array $args Query arguments.
	 * @return array[]
	 */
	public function get_posts( array $args ): array {
		++$this->cohorts;

		return array_fill(
			0,
			10,
			array( 'metrics' => array( 'views' => 100 ) )
		);
	}
}

class PerformanceCheckAbilityTest extends TestCase {

	private const TITLE = 'Bank rate decision looms for mortgage holders';

	/** @var FakeContentService|null */
	private $service = null;

	/** @var int Times anything asked ParselyClient for the Content API. */
	private int $service_requests = 0;

	public function set_up(): void {
		parent::set_up();

		wp_set_current_user(
			self::factory()->user->create( array( 'role' => 'administrator' ) )
		);

		update_option(
			'parsely',
			array(
				'apikey'     => 'example.com',
				'api_secret' => 'a-secret',
			)
		);
	}

	public function tear_down(): void {
		remove_all_filters( 'workflow_parsely_content_service' );

		delete_option( 'parsely' );
		delete_option( 'workflow_parsely_performance_check_queue' );
		wp_clear_scheduled_hook( PerformanceCheck::WARM_HOOK );

		$this->service         = null;
		$this->service_requests = 0;

		parent::tear_down();
	}

	/**
	 * Install the double, and start counting every trip to the API.
	 *
	 * The counter is the sentinel these tests turn on: every path into Parse.ly
	 * goes through ParselyClient::content(), so a run that leaves it at zero
	 * cannot have computed anything.
	 */
	private function fake_service(): FakeContentService {
		$this->service = new FakeContentService( $this->comparable_articles() );

		add_filter(
			'workflow_parsely_content_service',
			function () {
				++$this->service_requests;
				return $this->service;
			}
		);

		return $this->service;
	}

	/**
	 * Six comparable articles, each sharing enough terms with the headline to
	 * clear the relevance floor and enough of them to earn a multiplier.
	 *
	 * Not named matches(): Assert::matches() is static, and a non-static
	 * override of it is a fatal at class-declaration time.
	 *
	 * @return array[]
	 */
	private function comparable_articles(): array {
		$pub_date = gmdate( 'Y-m-d', time() - ( 200 * DAY_IN_SECONDS ) );
		$matches  = array();

		for ( $index = 1; $index <= 6; $index++ ) {
			$matches[] = array(
				'title'    => 'Bank rate decision explained, part ' . $index,
				'url'      => 'https://example.com/money/bank-rate-' . $index,
				'pub_date' => $pub_date,
				'section'  => 'Money',
				'tags'     => array( 'mortgages' ),
			);
		}

		return $matches;
	}

	private function make_post( string $title = self::TITLE ): int {
		return self::factory()->post->create(
			array(
				'post_title'  => $title,
				'post_status' => 'draft',
			)
		);
	}

	/**
	 * Run the ability the way a surface does, through the executor.
	 *
	 * Not named run(): TestCase::run() is public, and a private override of it
	 * is a fatal at class-declaration time — which surfaces as PHPUnit exiting
	 * before it prints anything at all.
	 *
	 * @param int    $post_id Post to compare.
	 * @param string $context Executor context: '' for a direct run.
	 * @return array The ability output.
	 */
	private function run_check( int $post_id, string $context = '' ): array {
		$result = ( new AbilityExecutor() )->execute(
			PerformanceCheck::ABILITY_ID,
			array( 'post_id' => $post_id ),
			$context
		);

		$this->assertTrue( $result->success, 'The check must not fail: ' . (string) $result->error );

		return $result->output;
	}

	// ── The transition surface ───────────────────────────────────────

	/**
	 * The load-bearing case. Nothing is cached, so the transition gets an
	 * immediate answer and the comparison is left for cron.
	 */
	public function test_a_transition_never_waits_for_a_cold_comparison(): void {
		$this->fake_service();

		$output = $this->run_check( $this->make_post(), 'transition' );

		$this->assertSame( 'not_yet_computed', $output['detail'] );
		$this->assertTrue( $output['passed'] );
		$this->assertNull( $output['multiplier'] );
		$this->assertNotEmpty( $output['summary'], 'The editor is told the comparison is coming, not left with a blank.' );

		$this->assertSame(
			0,
			$this->service_requests,
			'A transition must not touch Parse.ly. This is the 20-40 second stall the split exists to remove.'
		);
	}

	public function test_a_cold_transition_queues_the_comparison_for_cron(): void {
		$this->fake_service();

		$post_id = $this->make_post();

		$this->run_check( $post_id, 'transition' );

		$this->assertSame(
			array( $post_id => $post_id ),
			get_option( 'workflow_parsely_performance_check_queue' ),
			'The post the transition could not answer for must be queued.'
		);
		$this->assertNotFalse(
			wp_next_scheduled( PerformanceCheck::WARM_HOOK ),
			'A queued post with nothing coming to drain it is never compared.'
		);
	}

	/**
	 * Once the comparison exists, the transition reports the real thing — that is
	 * the whole point of computing it in the background.
	 */
	public function test_a_transition_reports_a_cached_comparison(): void {
		$this->fake_service();

		$post_id = $this->make_post();

		// A direct run: someone opened the tool while writing, and paid for it.
		$computed = $this->run_check( $post_id );

		$this->assertSame( 'tier_1', $computed['detail'] );
		$this->assertSame( 10.0, $computed['multiplier'] );
		$this->assertSame( 6, $computed['count'] );
		$this->assertGreaterThan( 0, $this->service_requests, 'A direct run computes.' );

		$after_compute = $this->service_requests;

		$transition = $this->run_check( $post_id, 'transition' );

		$this->assertSame( 'tier_1', $transition['detail'] );
		$this->assertSame( 10.0, $transition['multiplier'] );
		$this->assertSame( 6, $transition['count'] );
		$this->assertSame(
			$after_compute,
			$this->service_requests,
			'The transition must read the cache the direct run left, not recompute it.'
		);
	}

	/**
	 * Editing the headline changes the answer, so it must not report the old one.
	 */
	public function test_editing_the_headline_invalidates_the_comparison(): void {
		$this->fake_service();

		$post_id = $this->make_post();

		$this->run_check( $post_id );

		wp_update_post(
			array(
				'ID'         => $post_id,
				'post_title' => 'Rail strike talks collapse again',
			)
		);

		$output = $this->run_check( $post_id, 'transition' );

		$this->assertSame(
			'not_yet_computed',
			$output['detail'],
			'A comparison of the old headline is not a comparison of this one.'
		);
	}

	// ── The invariant ────────────────────────────────────────────────

	/**
	 * `issues` is the only field a transition reads, so this is what makes a
	 * transition stop on the comparison while every other caller just reports
	 * it: on a transition, every branch that has anything to compare carries
	 * one soft warning naming it; a direct run and an untitled draft (nothing
	 * to compare) still emit none.
	 */
	public function test_a_transition_always_soft_gates_on_the_comparison(): void {
		$this->fake_service();

		$untitled = $this->make_post( '' );
		$post_id  = $this->make_post();

		$cold   = $this->run_check( $post_id, 'transition' );
		$direct = $this->run_check( $post_id );
		$warm   = $this->run_check( $post_id, 'transition' );

		$gated = array(
			'cold' => $cold,
			'warm' => $warm,
		);
		$this->assertSame( 'not_yet_computed', $cold['detail'] );
		$this->assertSame( 'tier_1', $warm['detail'] );

		$ungated = array(
			'untitled on a transition' => $this->run_check( $untitled, 'transition' ),
			'a direct run'             => $direct,
		);

		foreach ( $gated as $branch => $output ) {
			$this->assertCount( 1, $output['issues'], "The {$branch} transition must carry exactly one warning." );
			$this->assertSame( 'soft', $output['issues'][0]['severity'], "The {$branch} transition must never hard-block on its own." );
			$this->assertSame(
				$output['summary'],
				$output['issues'][0]['message'],
				"The {$branch} transition's warning must be the same thing a direct caller would read."
			);
			$this->assertTrue( $output['passed'], "The {$branch} branch must still pass — this never hard-fails on its own." );
			$this->assertSame( 'pass', $output['status'], "The {$branch} branch must still report a pass." );
		}

		foreach ( $ungated as $branch => $output ) {
			$this->assertSame( array(), $output['issues'], "{$branch} has nothing to gate on and must emit no issues." );
		}
	}

	/**
	 * An untitled draft is the normal state of a post a minute after it is
	 * created, and it costs nothing to answer for on any surface.
	 */
	public function test_a_post_with_no_headline_is_answered_without_asking_parsely(): void {
		$this->fake_service();

		$output = $this->run_check( $this->make_post( '' ), 'transition' );

		$this->assertSame( 'skipped', $output['detail'] );
		$this->assertSame( 0, $this->service_requests );
	}

	// ── The background warmer ────────────────────────────────────────

	/**
	 * Draining is what turns the deferred answer into a real one on the next
	 * transition.
	 */
	public function test_draining_the_queue_computes_what_the_transition_deferred(): void {
		$this->fake_service();

		$post_id = $this->make_post();

		$this->run_check( $post_id, 'transition' );

		PerformanceCheck::warm();

		$this->assertFalse(
			get_option( 'workflow_parsely_performance_check_queue' ),
			'A drained queue leaves no option behind.'
		);

		$output = $this->run_check( $post_id, 'transition' );

		$this->assertSame( 'tier_1', $output['detail'] );
		$this->assertSame( 10.0, $output['multiplier'] );
	}
}
