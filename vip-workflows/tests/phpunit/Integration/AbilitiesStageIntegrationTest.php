<?php
/**
 * Integration coverage that the migrated AI-tool queries resolve by stage meta
 * (not the removed prefixed post_status) for both pre- and post-publish stages.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Workflow\StatusManager;

use function VIPWorkflows\Abilities\Tools\execute_get_posts_by_status;
use function VIPWorkflows\Abilities\Tools\execute_get_stale_posts;

require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/get-posts-by-status.php';
require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/get-stale-posts.php';

/**
 * Real-WordPress tests for the get-posts-by-status ability under the decoupled model.
 */
class AbilitiesStageIntegrationTest extends TestCase
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

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		$this->sequence_id = (int) ( new SequenceRepository() )->create(
			'Tool Flow',
			'tool-flow',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array( 'key' => 'draft', 'label' => 'Draft', 'status' => 'draft' ),
					array( 'key' => 'promote', 'label' => 'Promote', 'status' => 'publish' ),
				),
			),
			get_current_user_id()
		);
	}

	private function make_post( string $stage, string $post_status ): int
	{
		$post_id = self::factory()->post->create( array( 'post_status' => $post_status ) );
		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $this->sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, $stage );
		return $post_id;
	}

	public function test_get_posts_by_status_returns_pre_publish_stage(): void
	{
		$draft = $this->make_post( 'draft', 'draft' );
		$live  = $this->make_post( 'promote', 'publish' );

		$result = execute_get_posts_by_status( array( 'status' => 'draft', 'post_type' => 'post' ) );

		$ids = array_column( $result['posts'], 'post_id' );
		$this->assertContains( $draft, $ids );
		$this->assertNotContains( $live, $ids );
	}

	public function test_get_posts_by_status_returns_post_publish_stage_even_when_live(): void
	{
		$draft = $this->make_post( 'draft', 'draft' );
		$live  = $this->make_post( 'promote', 'publish' );

		// The core capability Codex flagged: a publish-region stage shares
		// post_status=publish with every other stage in that region, so the
		// tool must resolve it by stage meta.
		$result = execute_get_posts_by_status( array( 'status' => 'promote', 'post_type' => 'post' ) );

		$ids = array_column( $result['posts'], 'post_id' );
		$this->assertContains( $live, $ids );
		$this->assertNotContains( $draft, $ids );
	}

	/**
	 * get-stale-posts no-status mode uses ACTIVE stage semantics: a post sitting in
	 * a terminal stage (which, with no publish gate, also stays post_status=draft)
	 * is NOT reported as stale active work.
	 */
	public function test_get_stale_posts_no_status_excludes_terminal_stages(): void
	{
		$sequence_id = (int) ( new SequenceRepository() )->create(
			'Stale Flow',
			'stale-flow',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array( 'key' => 'active', 'label' => 'Active' ),
					array( 'key' => 'done', 'label' => 'Done', 'is_terminal' => true ),
				),
			),
			get_current_user_id()
		);

		$stuck = $this->stale_post( $sequence_id, 'active' );
		$done  = $this->stale_post( $sequence_id, 'done' );

		$result = execute_get_stale_posts( array( 'threshold_days' => 3 ) );
		$ids    = array_column( $result['posts'], 'post_id' );

		$this->assertContains( $stuck, $ids, 'A post stuck in an active stage is stale.' );
		$this->assertNotContains( $done, $ids, 'A terminal-stage post is not stale active work.' );
	}

	/**
	 * "Active" is sequence-scoped: a stage key that is active in sequence A but
	 * terminal in sequence B must only be stale for A, never for B.
	 */
	public function test_get_stale_posts_active_is_sequence_scoped(): void
	{
		$repo = new SequenceRepository();

		// 'shared' is a normal (active) stage here.
		$bp_active = (int) $repo->create(
			'Active Shared',
			'active-shared',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array( array( 'key' => 'shared', 'label' => 'Shared' ) ),
			),
			get_current_user_id()
		);

		// 'shared' is terminal here.
		$bp_terminal = (int) $repo->create(
			'Terminal Shared',
			'terminal-shared',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array( array( 'key' => 'shared', 'label' => 'Shared', 'is_terminal' => true ) ),
			),
			get_current_user_id()
		);

		$active_post   = $this->stale_post( $bp_active, 'shared' );
		$terminal_post = $this->stale_post( $bp_terminal, 'shared' );

		$result = execute_get_stale_posts( array( 'threshold_days' => 3 ) );
		$ids    = array_column( $result['posts'], 'post_id' );

		$this->assertContains( $active_post, $ids, 'shared is active in sequence A.' );
		$this->assertNotContains( $terminal_post, $ids, 'shared is terminal in sequence B — not stale there.' );
	}

	/**
	 * Create a workflow post backdated past the stale threshold.
	 *
	 * @param int    $sequence_id Sequence.
	 * @param string $stage        Stage key.
	 * @return int
	 */
	private function stale_post( int $sequence_id, string $stage ): int
	{
		global $wpdb;

		$post_id = self::factory()->post->create( array( 'post_status' => 'draft' ) );
		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, $stage );

		$old = gmdate( 'Y-m-d H:i:s', strtotime( '-10 days' ) );
		$wpdb->update( // phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$wpdb->posts,
			array( 'post_modified' => $old, 'post_modified_gmt' => $old ),
			array( 'ID' => $post_id )
		);
		clean_post_cache( $post_id );

		return $post_id;
	}
}
