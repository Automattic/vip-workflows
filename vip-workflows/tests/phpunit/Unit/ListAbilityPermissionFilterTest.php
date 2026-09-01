<?php
/**
 * List ability permission filtering tests.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace {
	if ( ! class_exists( 'WP_Query' ) ) {
		/**
		 * Minimal WP_Query double for ability list tests.
		 */
		class WP_Query {
			/**
			 * Posts returned by the next query instance.
			 *
			 * @var array
			 */
			public static array $next_posts = array();

			/**
			 * Queried posts.
			 *
			 * @var array
			 */
			public array $posts;

			/**
			 * Found post count.
			 */
			public int $found_posts;

			/**
			 * Constructor.
			 *
			 * @param array $args Query args.
			 */
			public function __construct( array $args ) {
				unset( $args );

				$this->posts       = self::$next_posts;
				$this->found_posts = count( $this->posts );
			}
		}
	}
}

namespace VIPWorkflows\Tests\Unit {

	use Brain\Monkey\Functions;
	use Mockery;

	require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/get-my-assignments.php';
	require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/get-posts-by-status.php';
	require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/get-recent-activity.php';
	require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/get-stale-posts.php';

	/**
	 * Tests for post-level filtering in list abilities.
	 */
	class ListAbilityPermissionFilterTest extends TestCase
	{
		protected function setUp(): void
		{
			parent::setUp();

			if ( ! defined( 'DAY_IN_SECONDS' ) ) {
				define( 'DAY_IN_SECONDS', 86400 );
			}

			\WP_Query::$next_posts = array(
				$this->make_post( 101 ),
				$this->make_post( 202 ),
			);

			Functions\stubs(
				array(
					'get_current_user_id'  => 77,
					'get_post_meta'        => '',
					'get_edit_post_link'   => '',
					'get_userdata'         => false,
					'get_post_stati'       => array(
						'draft'   => 'draft',
						'pending' => 'pending',
						'publish' => 'publish',
					),
				)
			);

			Functions\when( 'current_user_can' )->alias(
				fn( $capability, $post_id = null ) => 'edit_post' === $capability && 101 === $post_id
			);
		}

		public function test_get_my_assignments_filters_posts_without_edit_post_capability(): void
		{
			$result = \VIPWorkflows\Abilities\Tools\execute_get_my_assignments();

			$this->assertSame( 1, $result['count'] );
			$this->assertSame( 101, $result['posts'][0]['post_id'] );
		}

		public function test_get_stale_posts_filters_posts_without_edit_post_capability(): void
		{
			// Pass a status so the query builds via StageQuery::by_stage_key (no DB);
			// the no-status "all active stages" path needs the sequence repository
			// and is covered in the integration suite.
			$result = \VIPWorkflows\Abilities\Tools\execute_get_stale_posts(
				array(
					'status' => 'review',
				)
			);

			$this->assertSame( 1, $result['count'] );
			$this->assertSame( 101, $result['posts'][0]['post_id'] );
		}

		public function test_get_posts_by_status_filters_posts_without_edit_post_capability(): void
		{
			$this->mock_empty_sequence_repository();

			$result = \VIPWorkflows\Abilities\Tools\execute_get_posts_by_status(
				array(
					'status' => 'draft',
				)
			);

			$this->assertSame( 1, $result['total_found'] );
			$this->assertSame( 1, $result['count'] );
			$this->assertSame( 101, $result['posts'][0]['post_id'] );
		}

		public function test_get_recent_activity_skips_non_editable_and_deleted_posts(): void
		{
			global $wpdb;

			$wpdb         = Mockery::mock( 'wpdb' );
			$wpdb->prefix = 'wp_';
			$wpdb->shouldReceive( 'prepare' )->once()->andReturn( 'prepared_recent_activity_query' );
			$wpdb->shouldReceive( 'get_results' )
				->once()
				->with( 'prepared_recent_activity_query' )
				->andReturn(
					array(
						$this->make_event_row( 101 ),
						$this->make_event_row( 202 ),
						$this->make_event_row( 303 ),
					)
				);

			Functions\when( 'get_post' )->alias(
				function ( int $post_id ) {
					if ( 303 === $post_id ) {
						return null;
					}

					return $this->make_post( $post_id );
				}
			);

			$result = \VIPWorkflows\Abilities\Tools\execute_get_recent_activity();

			$this->assertSame( 1, $result['count'] );
			$this->assertSame( 101, $result['events'][0]['post_id'] );
		}

		private function make_post( int $post_id ): object
		{
			return (object) array(
				'ID'                => $post_id,
				'post_author'       => 1,
				'post_modified'     => '2026-06-01 00:00:00',
				'post_modified_gmt' => '2026-06-01 00:00:00',
				'post_status'       => 'draft',
				'post_title'        => 'Post ' . $post_id,
				'post_type'         => 'post',
			);
		}

		private function make_event_row( int $post_id ): object
		{
			return (object) array(
				'actor_id'   => 1,
				'created_at' => '2026-06-01 00:00:00',
				'event_data' => wp_json_encode( array( 'note' => 'event for ' . $post_id ) ),
				'event_type' => 'status_transition',
				'post_id'    => $post_id,
			);
		}

		private function mock_empty_sequence_repository(): void
		{
			global $wpdb;

			$wpdb         = Mockery::mock( 'wpdb' );
			$wpdb->prefix = 'wp_';
			$wpdb->shouldReceive( 'prepare' )->andReturn( 'prepared_sequences_query' );
			$wpdb->shouldReceive( 'get_results' )->andReturn( array() );
		}
	}
}
