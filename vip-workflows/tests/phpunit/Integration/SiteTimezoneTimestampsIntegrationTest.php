<?php
/**
 * Stored site-local times are compared against a real UTC "now".
 *
 * Several values are stamped with `current_time( 'mysql' )` — site-local wall
 * time with no offset attached: a stage agent's `queued_at`. `post_modified`
 * is site-local too. Each used to be read back with `strtotime()`, which
 * parses it as UTC, and compared against `current_time( 'timestamp' )`, which
 * is "now" shifted by the same offset. The two errors cancelled, but neither
 * side was a real timestamp, and the pairing is deprecated
 * (WordPress.DateTime.CurrentTimeTimestamp).
 *
 * Each site now converts the stored value with the site's own timezone and
 * compares it against `time()`. Under UTC the old and new arithmetic agree, so
 * every check here runs under a non-UTC site timezone as well: a half-fix that
 * swapped in `time()` without converting the stored value would misread a
 * minute-old job as hours old in New York, and a post edited an hour ago as
 * waiting four or five.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Workflow\StageAgentRunner;
use VIPWorkflows\Workflow\StatusManager;

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

	public function set_up(): void
	{
		parent::set_up();

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
			)
		);
		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $this->sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, $stage );

		return $post_id;
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
}
