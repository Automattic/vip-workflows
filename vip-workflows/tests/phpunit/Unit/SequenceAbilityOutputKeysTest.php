<?php
/**
 * Execute-path output-key tests for the Sequence rename.
 *
 * Complements SequenceAbilityRegistrationTest (which locks the *registered*
 * schema) by actually executing the four tool functions and asserting the
 * *returned* data uses sequence_* keys and never sequence_*. The execute_*
 * functions read the global $wpdb / WP_Query, so a WP_Query double plus a
 * mocked $wpdb let these run without a database.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace {
	if ( ! class_exists( 'WP_Query' ) ) {
		/**
		 * Minimal WP_Query double; returns whatever WP_Query::$next_posts holds.
		 */
		class WP_Query {
			/** @var array */
			public static array $next_posts = array();

			/** @var array */
			public array $posts;

			/** @var int */
			public int $found_posts;

			/**
			 * @param array $args Query args (ignored).
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
	use WP_Error;

	require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/get-sequences.php';
	require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/get-workflow-summary.php';
	require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/get-my-assignments.php';
	require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/get-posts-by-status.php';

	/**
	 * Asserts the executed tool output carries sequence_* keys, not sequence_*.
	 */
	class SequenceAbilityOutputKeysTest extends TestCase
	{
		protected function setUp(): void
		{
			parent::setUp();

			if ( ! defined( 'DAY_IN_SECONDS' ) ) {
				define( 'DAY_IN_SECONDS', 86400 );
			}

			\WP_Query::$next_posts = array();
		}

		/**
		 * Mock $wpdb so repository reads succeed with the given rows.
		 *
		 * @param array       $results Rows for get_results().
		 * @param object|null $row     Row for get_row().
		 */
		private function mock_wpdb( array $results = array(), ?object $row = null ): void
		{
			global $wpdb;

			$wpdb           = Mockery::mock( 'wpdb' );
			$wpdb->prefix   = 'wp_';
			$wpdb->posts    = 'wp_posts';
			$wpdb->postmeta = 'wp_postmeta';
			$wpdb->shouldReceive( 'prepare' )->andReturn( 'prepared_query' );
			$wpdb->shouldReceive( 'get_results' )->andReturn( $results );
			$wpdb->shouldReceive( 'get_row' )->andReturn( $row );
		}

		// --- get-sequences ---------------------------------------------------

		public function test_get_sequences_returns_sequences_key_not_blueprints(): void
		{
			$this->mock_wpdb();

			$result = \VIPWorkflows\Abilities\Tools\execute_get_sequences();

			$this->assertArrayHasKey( 'sequences', $result );
			$this->assertArrayNotHasKey( 'blueprints', $result );
			$this->assertSame( 0, $result['count'] );
			$this->assertSame( array(), $result['sequences'] );
		}

		public function test_get_sequences_workflow_filter_also_returns_sequences_key(): void
		{
			$this->mock_wpdb();

			$result = \VIPWorkflows\Abilities\Tools\execute_get_sequences( array( 'type' => 'workflow' ) );

			$this->assertArrayHasKey( 'sequences', $result );
			$this->assertArrayNotHasKey( 'blueprints', $result );
		}

		// --- get-workflow-summary --------------------------------------------

		public function test_get_workflow_summary_returns_sequences_key_not_blueprints(): void
		{
			$this->mock_wpdb();

			$result = \VIPWorkflows\Abilities\Tools\execute_get_workflow_summary();

			$this->assertArrayHasKey( 'sequences', $result );
			$this->assertArrayNotHasKey( 'blueprints', $result );
		}

		public function test_get_workflow_summary_item_uses_sequence_id_and_sequence_name(): void
		{
			// One active sequence with no statuses -> the per-item keys are built
			// without the inner status loop touching WP_Query.
			$this->mock_wpdb( array( $this->make_sequence_row( 7, 'My Sequence' ) ) );

			$result = \VIPWorkflows\Abilities\Tools\execute_get_workflow_summary();

			$this->assertCount( 1, $result['sequences'] );
			$item = $result['sequences'][0];
			$this->assertArrayHasKey( 'sequence_id', $item );
			$this->assertArrayHasKey( 'sequence_name', $item );
			$this->assertArrayNotHasKey( 'blueprint_id', $item );
			$this->assertArrayNotHasKey( 'blueprint_name', $item );
			$this->assertSame( 7, $item['sequence_id'] );
			$this->assertSame( 'My Sequence', $item['sequence_name'] );
		}

		public function test_get_workflow_summary_unknown_sequence_returns_not_found_error(): void
		{
			// get_row() => null means find() returns null -> WP_Error.
			$this->mock_wpdb( array(), null );

			$result = \VIPWorkflows\Abilities\Tools\execute_get_workflow_summary(
				array( 'sequence_id' => 999 )
			);

			$this->assertInstanceOf( WP_Error::class, $result );
			// Error CODE is a protected identifier and must not change.
			$this->assertSame( 'not_found', $result->get_error_code() );
			// Error MESSAGE is agent-facing and must read "Sequence".
			$this->assertStringContainsStringIgnoringCase( 'sequence', $result->get_error_message() );
			$this->assertStringNotContainsStringIgnoringCase( 'blueprint', $result->get_error_message() );
		}

		// --- get-my-assignments (nested output key) --------------------------

		public function test_get_my_assignments_post_uses_sequence_id_not_blueprint_id(): void
		{
			\WP_Query::$next_posts = array( $this->make_post( 101 ) );

			Functions\stubs(
				array(
					'get_current_user_id' => 77,
					'get_edit_post_link'  => '',
					'get_post_stati'      => array( 'draft' => 'draft' ),
				)
			);
			Functions\when( 'get_post_meta' )->alias(
				fn( $id, $key ) => '_vip_workflows_sequence_id' === $key ? 42 : ''
			);
			Functions\when( 'current_user_can' )->justReturn( true );

			$result = \VIPWorkflows\Abilities\Tools\execute_get_my_assignments();

			$this->assertSame( 1, $result['count'] );
			$post = $result['posts'][0];
			$this->assertArrayHasKey( 'sequence_id', $post );
			$this->assertArrayNotHasKey( 'blueprint_id', $post );
			$this->assertSame( 42, $post['sequence_id'] );
		}

		// --- get-posts-by-status (nested output key) -------------------------

		public function test_get_posts_by_status_post_uses_sequence_id_not_blueprint_id(): void
		{
			\WP_Query::$next_posts = array( $this->make_post( 101 ) );
			$this->mock_wpdb();

			Functions\stubs(
				array(
					'get_edit_post_link' => '',
					'get_userdata'       => false,
					'get_post_stati'     => array( 'draft' => 'draft' ),
				)
			);
			Functions\when( 'get_post_meta' )->alias(
				fn( $id, $key ) => '_vip_workflows_sequence_id' === $key ? 42 : ''
			);
			Functions\when( 'current_user_can' )->justReturn( true );

			$result = \VIPWorkflows\Abilities\Tools\execute_get_posts_by_status(
				array( 'status' => 'draft' )
			);

			$post = $result['posts'][0];
			$this->assertArrayHasKey( 'sequence_id', $post );
			$this->assertArrayNotHasKey( 'blueprint_id', $post );
			$this->assertSame( 42, $post['sequence_id'] );
		}

		// --- fixtures --------------------------------------------------------

		private function make_post( int $post_id ): object
		{
			return (object) array(
				'ID'            => $post_id,
				'post_author'   => 1,
				'post_modified' => '2026-06-01 00:00:00',
				'post_status'   => 'draft',
				'post_title'    => 'Post ' . $post_id,
				'post_type'     => 'post',
			);
		}

		private function make_sequence_row( int $id, string $name ): object
		{
			return (object) array(
				'id'          => $id,
				'uuid'        => 'uuid-' . $id,
				'type'        => 'workflow',
				'name'        => $name,
				'slug'        => 'seq-' . $id,
				'description' => '',
				'version'     => 1,
				'status'      => 'active',
				'config'      => wp_json_encode( array( 'statuses' => array() ) ),
				'created_by'  => 1,
				'created_at'  => '2026-06-01 00:00:00',
				'updated_at'  => '2026-06-01 00:00:00',
			);
		}
	}
}
