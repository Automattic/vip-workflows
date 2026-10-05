<?php
/**
 * Stored site-local times are compared against a real UTC "now".
 *
 * Three stored values are site-local wall time with no offset attached: a
 * stage agent's `queued_at` and an audit event's `created_at`, both stamped
 * with `current_time( 'mysql' )`, and a post's `post_modified`. Each used to be
 * read back with `strtotime()`, which parses it as UTC, and compared against
 * `current_time( 'timestamp' )`, which is "now" shifted by the same offset.
 * The two errors cancelled outside a DST change, but neither side was a real
 * timestamp, and the pairing is deprecated
 * (WordPress.DateTime.CurrentTimeTimestamp).
 *
 * Each site now converts the stored value with the site's own timezone and
 * compares it against `time()`. Under UTC the old and new arithmetic agree, so
 * every check here also runs under America/New_York. There, a half-fix that
 * swapped in `time()` without converting the stored value would misread a
 * minute-old job as hours old, and a post edited an hour ago as waiting
 * several. The display checks also capture the pair of timestamps handed to
 * `human_time_diff()`, which is what tells the old offset-shifted pair from
 * two real ones: the wording alone cannot.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Database\Schema;
use VIPWorkflows\Plugin;
use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Workflow\StageAgentRunner;
use VIPWorkflows\Workflow\StatusManager;
use WP_REST_Request;

/**
 * Real-WordPress tests for timezone-correct timestamp comparisons.
 */
class SiteTimezoneTimestampsIntegrationTest extends TestCase
{
	/**
	 * Sequence ID.
	 *
	 * @var int
	 */
	private int $sequence_id;

	/**
	 * Every ( from, to ) pair human_time_diff() was asked to word.
	 *
	 * @var array<int, array{int, int}>
	 */
	private array $worded = array();

	public function set_up(): void
	{
		parent::set_up();

		// Both routes only register when their experiment is on.
		Plugin::get_instance()->get_experiment_registry()->enable( 'my_queue' );
		Plugin::get_instance()->get_experiment_registry()->enable( 'kanban' );

		// The wording alone cannot tell a correct pair of timestamps from two
		// that are both shifted by the site's offset; the pair itself can.
		$this->worded = array();
		add_filter(
			'human_time_diff',
			function ( $since, $diff, $from, $to ) {
				$this->worded[] = array( (int) $from, (int) $to );
				return $since;
			},
			10,
			4
		);

		wp_set_current_user( (int) self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		$this->sequence_id = (int) ( new SequenceRepository() )->create(
			'Timezone Flow',
			'timezone-flow',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'           => 'ai_desk',
						'label'         => 'AI Desk',
						'status'        => 'draft',
						'show_in_queue' => true,
						'agent'         => array(
							'ability_id' => 'test/desk-agent',
							'routing'    => array(
								'pass'  => 'review',
								'error' => 'review',
							),
						),
						'transitions'   => array(
							array(
								'to'    => 'review',
								'label' => 'Review',
							),
						),
					),
					array(
						'key'           => 'review',
						'label'         => 'Review',
						'status'        => 'draft',
						'show_in_queue' => true,
						'transitions'   => array(
							array(
								'to'            => 'done',
								'label'         => 'Approve',
								'show_in_queue' => true,
							),
						),
					),
					array(
						'key'    => 'done',
						'label'  => 'Done',
						'status' => 'draft',
					),
				),
			),
			get_current_user_id()
		);
	}

	/**
	 * The site timezones every check runs under.
	 *
	 * @return array<string, array{string}>
	 */
	public static function data_site_timezones(): array
	{
		return array(
			'New York' => array( 'America/New_York' ),
			'UTC'      => array( 'UTC' ),
		);
	}

	/**
	 * Set the site timezone the way the General Settings screen does.
	 *
	 * @param string $timezone A timezone_string value.
	 */
	private function use_site_timezone( string $timezone ): void
	{
		update_option( 'timezone_string', $timezone );
		update_option( 'gmt_offset', '' );

		$this->assertSame( $timezone, wp_timezone_string() );
	}

	/**
	 * A post sitting at the given stage of the test sequence.
	 *
	 * @param  string $stage Stage key.
	 * @return int Post ID.
	 */
	private function post_at_stage( string $stage ): int
	{
		$post_id = (int) self::factory()->post->create(
			array(
				'post_status' => 'draft',
				'post_title'  => 'Timezone post',
				// Somebody else's: My Queue leaves out the caller's own posts
				// unless self-review is allowed.
				'post_author' => (int) self::factory()->user->create( array( 'role' => 'author' ) ),
			)
		);
		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $this->sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, $stage );

		return $post_id;
	}

	/**
	 * Backdate a post's last edit, as wp_update_post() would have stamped it.
	 *
	 * @param int $post_id Post ID.
	 * @param int $seconds How long ago, in seconds.
	 */
	private function modified_ago( int $post_id, int $seconds ): void
	{
		global $wpdb;

		$then = time() - $seconds;
		$wpdb->update(
			$wpdb->posts,
			array(
				'post_modified'     => wp_date( 'Y-m-d H:i:s', $then ),
				'post_modified_gmt' => gmdate( 'Y-m-d H:i:s', $then ),
			),
			array( 'ID' => $post_id )
		);
		clean_post_cache( $post_id );
	}

	/**
	 * Assert human_time_diff() was asked about real UTC timestamps an hour apart.
	 *
	 * @param string $phrase The wording the route returned.
	 */
	private function assert_worded_one_hour_ago( string $phrase ): void
	{
		$this->assertSame( '1 hour', $phrase, 'an hour-old edit must read as an hour, not the site offset plus one' );

		$this->assertNotEmpty( $this->worded );
		[ $from, $to ] = end( $this->worded );
		$this->assertEqualsWithDelta( time(), $to, 5, '"now" must be a real UTC timestamp, not shifted by the site offset' );
		$this->assertEqualsWithDelta( time() - HOUR_IN_SECONDS, $from, 5, 'the stored time must be converted from site-local to UTC' );
	}

	/**
	 * Write a pending agent job marker the way StageAgentRunner does.
	 *
	 * @param int    $post_id   Post ID.
	 * @param string $queued_at Site-local MySQL datetime.
	 */
	private function queue_pending_job( int $post_id, string $queued_at ): void
	{
		update_post_meta(
			$post_id,
			StageAgentRunner::JOB_META,
			array(
				'stage_key'  => 'ai_desk',
				'ability_id' => 'test/desk-agent',
				'status'     => 'pending',
				'queued_at'  => $queued_at,
				'cause'      => 'workflow',
				'from_stage' => 'review',
			)
		);
	}

	/**
	 * A job queued a minute ago is still running, and still gates the stage.
	 *
	 * @dataProvider data_site_timezones
	 *
	 * @param string $timezone Site timezone.
	 */
	public function test_fresh_pending_job_gates_the_transition( string $timezone ): void
	{
		$this->use_site_timezone( $timezone );
		$post_id = $this->post_at_stage( 'ai_desk' );

		// What current_time( 'mysql' ) returned a minute ago: site-local.
		$this->queue_pending_job( $post_id, wp_date( 'Y-m-d H:i:s', time() - 60 ) );

		$status_manager = new StatusManager();
		$this->assertTrue( $status_manager->has_pending_agent_job( $post_id, 'ai_desk' ) );

		$result = $status_manager->transition( $post_id, 'review' );
		$this->assertIsArray( $result );
		$this->assertTrue( $result['warnings_pending'] ?? false, 'a running agent must still gate the move' );
		$this->assertSame( 'agent_in_progress', $result['soft_warnings'][0]['type'] ?? null );
		$this->assertSame( 'pending', get_post_meta( $post_id, StageAgentRunner::JOB_META, true )['status'] );
	}

	/**
	 * A job stamped this instant by current_time( 'mysql' ) gates too.
	 *
	 * @dataProvider data_site_timezones
	 *
	 * @param string $timezone Site timezone.
	 */
	public function test_job_stamped_now_is_pending( string $timezone ): void
	{
		$this->use_site_timezone( $timezone );
		$post_id = $this->post_at_stage( 'ai_desk' );

		$this->queue_pending_job( $post_id, current_time( 'mysql' ) );

		$this->assertTrue( ( new StatusManager() )->has_pending_agent_job( $post_id, 'ai_desk' ) );
	}

	/**
	 * A job queued PENDING_TTL + 60 seconds ago is stale: it stops gating and
	 * is converted to a timed-out failure.
	 *
	 * @dataProvider data_site_timezones
	 *
	 * @param string $timezone Site timezone.
	 */
	public function test_job_older_than_the_ttl_is_stale( string $timezone ): void
	{
		$this->use_site_timezone( $timezone );
		$post_id = $this->post_at_stage( 'ai_desk' );

		$this->queue_pending_job(
			$post_id,
			wp_date( 'Y-m-d H:i:s', time() - StageAgentRunner::PENDING_TTL - 60 )
		);

		$this->assertFalse( ( new StatusManager() )->has_pending_agent_job( $post_id, 'ai_desk' ) );

		$job = get_post_meta( $post_id, StageAgentRunner::JOB_META, true );
		$this->assertSame( 'failed', $job['status'] );
		$this->assertSame( 'Agent run timed out.', $job['error'] );
	}

	/**
	 * My Queue words a post edited an hour ago as an hour's wait.
	 *
	 * @dataProvider data_site_timezones
	 *
	 * @param string $timezone Site timezone.
	 */
	public function test_my_queue_waiting_time_for_a_post_edited_an_hour_ago( string $timezone ): void
	{
		$this->use_site_timezone( $timezone );
		$post_id = $this->post_at_stage( 'review' );
		$this->modified_ago( $post_id, HOUR_IN_SECONDS );

		$response = rest_do_request( new WP_REST_Request( 'GET', '/vip-workflows/v1/workflow/my-queue' ) );
		$this->assertSame( 200, $response->get_status() );

		$items = wp_list_filter( (array) $response->get_data(), array( 'post_id' => $post_id ) );
		$this->assertCount( 1, $items );
		$this->assert_worded_one_hour_ago( reset( $items )['waiting'] );
	}

	/**
	 * A Kanban card in a workflow column does too.
	 *
	 * @dataProvider data_site_timezones
	 *
	 * @param string $timezone Site timezone.
	 */
	public function test_kanban_workflow_card_waiting_time( string $timezone ): void
	{
		$this->use_site_timezone( $timezone );
		$post_id = $this->post_at_stage( 'review' );
		$this->modified_ago( $post_id, HOUR_IN_SECONDS );

		$request = new WP_REST_Request( 'GET', '/vip-workflows/v1/workflow/kanban' );
		$request->set_param( 'sequence_id', (string) $this->sequence_id );
		$response = rest_do_request( $request );
		$this->assertSame( 200, $response->get_status() );

		$this->assert_worded_one_hour_ago( $this->kanban_card( $response->get_data(), $post_id )['waiting_time'] );
	}

	/**
	 * And so does a card in the board's no-workflow view.
	 *
	 * @dataProvider data_site_timezones
	 *
	 * @param string $timezone Site timezone.
	 */
	public function test_kanban_no_workflow_card_waiting_time( string $timezone ): void
	{
		$this->use_site_timezone( $timezone );
		$post_id = (int) self::factory()->post->create( array( 'post_status' => 'draft' ) );
		$this->modified_ago( $post_id, HOUR_IN_SECONDS );

		$request = new WP_REST_Request( 'GET', '/vip-workflows/v1/workflow/kanban' );
		$request->set_param( 'sequence_id', 'none' );
		$response = rest_do_request( $request );
		$this->assertSame( 200, $response->get_status() );

		$this->assert_worded_one_hour_ago( $this->kanban_card( $response->get_data(), $post_id )['waiting_time'] );
	}

	/**
	 * An audit event logged an hour ago reads "1 hour ago".
	 *
	 * @dataProvider data_site_timezones
	 *
	 * @param string $timezone Site timezone.
	 */
	public function test_audit_event_logged_an_hour_ago( string $timezone ): void
	{
		global $wpdb;

		$this->use_site_timezone( $timezone );

		// Stamped the way every events-table writer stamps it.
		$wpdb->insert(
			Schema::get_table_name( 'workflows_events' ),
			array(
				'post_id'    => null,
				'event_type' => 'status_transition',
				'event_data' => wp_json_encode( array() ),
				'actor_id'   => get_current_user_id(),
				'actor_type' => 'user',
				'created_at' => wp_date( 'Y-m-d H:i:s', time() - HOUR_IN_SECONDS ),
			)
		);
		$event_id = (int) $wpdb->insert_id;

		$response = rest_do_request( new WP_REST_Request( 'GET', '/vip-workflows/v1/audit-log' ) );
		$this->assertSame( 200, $response->get_status() );

		$events = wp_list_filter( $response->get_data()['events'], array( 'id' => $event_id ) );
		$this->assertCount( 1, $events );

		$this->assertSame( '1 hour ago', reset( $events )['created_at_human'] );
		$this->assert_worded_one_hour_ago( '1 hour' );
	}

	/**
	 * Find a post's card anywhere on the board.
	 *
	 * @param  array $board   The kanban route's payload.
	 * @param  int   $post_id Post ID.
	 * @return array The card.
	 */
	private function kanban_card( array $board, int $post_id ): array
	{
		foreach ( $board['columns'] as $column ) {
			foreach ( $column['cards'] as $card ) {
				if ( $post_id === $card['id'] ) {
					return $card;
				}
			}
		}

		$this->fail( "post {$post_id} is not on the board" );
	}
}
