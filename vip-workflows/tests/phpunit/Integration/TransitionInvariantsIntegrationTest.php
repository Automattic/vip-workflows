<?php
/**
 * Integration coverage for the transition invariants the suite described but
 * did not pin — the gaps called out in the #152 review.
 *
 * Each of these is an invariant the design depends on and that nothing would
 * have caught breaking: the compare-and-swap that makes two concurrent
 * transitions safe, the `private` reconcile region, cron's `future` -> `publish`
 * emitting go-live exactly once, and the per-stage entered_/exited_ hooks firing
 * for a same-region move (which produces no core status transition at all, so
 * the core hook cannot carry them).
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Workflow\StatusManager;

/**
 * Real-WordPress tests for transition invariants.
 */
class TransitionInvariantsIntegrationTest extends TestCase
{
	/**
	 * Sequence ID.
	 *
	 * @var int
	 */
	private int $sequence_id;

	/**
	 * Admin user ID.
	 *
	 * @var int
	 */
	private int $admin_id;

	public function set_up(): void
	{
		parent::set_up();

		$this->admin_id = (int) self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $this->admin_id );

		// Four stages spanning four regions, so the reconcile tests have a
		// modelled entry stage for each and the same-region test has two stages
		// inside one region.
		$this->sequence_id = (int) ( new SequenceRepository() )->create(
			'Transition Invariants',
			'transition-invariants',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'         => 'draft',
						'label'       => 'Draft',
						'status'      => 'draft',
						'transitions' => array(
							array( 'to' => 'second_draft', 'label' => 'Second Draft' ),
							array( 'to' => 'review', 'label' => 'Review' ),
							array( 'to' => 'live', 'label' => 'Publish' ),
						),
					),
					// Same region as `draft` on purpose: moving between them
					// writes no post_status, so core's transition_post_status
					// never fires and only the stage actions can carry the move.
					array(
						'key'         => 'second_draft',
						'label'       => 'Second Draft',
						'status'      => 'draft',
						'transitions' => array(
							array( 'to' => 'review', 'label' => 'Review' ),
						),
					),
					array(
						'key'         => 'review',
						'label'       => 'Review',
						'status'      => 'pending',
						'transitions' => array(
							array( 'to' => 'live', 'label' => 'Publish' ),
						),
					),
					array(
						'key'         => 'vault',
						'label'       => 'Vault',
						'status'      => 'private',
						'transitions' => array(),
					),
					array(
						'key'         => 'live',
						'label'       => 'Live',
						'status'      => 'publish',
						'transitions' => array(),
					),
				),
			),
			get_current_user_id()
		);
	}

	/**
	 * A workflow post seated at the given stage with the matching core status.
	 *
	 * @param string $stage       Stage key.
	 * @param string $post_status Core status.
	 * @param array  $extra       Extra wp_insert_post args.
	 * @return int Post ID.
	 */
	private function make_post( string $stage, string $post_status, array $extra = array() ): int
	{
		$post_id = (int) self::factory()->post->create(
			array_merge(
				array(
					'post_status' => $post_status,
					'post_author' => $this->admin_id,
				),
				$extra
			)
		);

		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $this->sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, $stage );

		return $post_id;
	}

	/**
	 * Two concurrent transitions from the same stage: the second is REFUSED, not
	 * silently applied over the first.
	 *
	 * Both requests read the stage, both validate an edge that starts there, and
	 * both write. The stage-meta write is a compare-and-swap against the stage
	 * the transition validated against, so the loser changes nothing. Simulated
	 * by performing the winning move and then replaying the losing one, which is
	 * exactly the state the loser's write would meet.
	 */
	public function test_a_transition_whose_stage_moved_underneath_it_is_refused(): void
	{
		$post_id = $this->make_post( 'draft', 'draft' );

		$manager = new StatusManager();

		// Request A wins the race.
		$this->assertTrue( $manager->transition( $post_id, 'second_draft' ) );
		$this->assertSame( 'second_draft', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );

		// Request B validated against `draft` and now tries to write. Replayed by
		// putting the stage back to what B read, performing B, and asserting it
		// cannot land on a post that has since moved: B's edge draft -> review is
		// valid FROM draft, but the post is at second_draft.
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'second_draft' );

		$result = $manager->transition( $post_id, 'live' );

		// second_draft has no `live` edge — the point is that B's validation is
		// re-run against the CURRENT stage rather than the one it read.
		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'invalid_transition', $result->get_error_code() );
		$this->assertSame( 'second_draft', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
	}

	/**
	 * The compare-and-swap itself: when the stage meta no longer holds what the
	 * transition validated against, the write is refused with a 409 conflict and
	 * the post does not move.
	 */
	public function test_stage_swap_refuses_when_the_stage_changed_mid_transition(): void
	{
		$post_id = $this->make_post( 'draft', 'draft' );

		// Move the stage out from under the transition at the moment the region
		// status is committed — the window between validation and the stage write.
		$hijack = function () use ( $post_id ) {
			update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'review' );
		};
		add_action( 'vip_workflows_hijack_probe', $hijack );

		// commit_post_status() runs wp_update_post, so hooking save_post gives a
		// deterministic point inside the transition, after validation.
		$fired = false;
		$probe = function () use ( &$fired, $hijack ) {
			if ( $fired ) {
				return;
			}
			$fired = true;
			$hijack();
		};
		add_action( 'save_post', $probe, 1 );

		$result = ( new StatusManager() )->transition( $post_id, 'live' );

		remove_action( 'save_post', $probe, 1 );
		remove_action( 'vip_workflows_hijack_probe', $hijack );

		$this->assertInstanceOf( 'WP_Error', $result );
		$this->assertSame( 'transition_conflict', $result->get_error_code() );
		$this->assertSame( 409, $result->get_error_data()['status'] );

		// The stage is the hijacker's, not the transition's target.
		$this->assertSame( 'review', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );

		// And the status write that already landed was rolled back, so the post
		// is not left published at a pending-region stage.
		$this->assertSame( 'draft', get_post_status( $post_id ) );
	}

	/**
	 * A core-driven move to `private` re-seats the post at the private region's
	 * entry stage — the reconcile region the suite never covered.
	 */
	public function test_core_private_reseats_at_the_private_entry_stage(): void
	{
		$post_id = $this->make_post( 'draft', 'draft' );

		wp_update_post(
			array(
				'ID'          => $post_id,
				'post_status' => 'private',
			)
		);

		$this->assertSame( 'private', get_post_status( $post_id ) );
		$this->assertSame( 'vault', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );
	}

	/**
	 * Cron's `future` -> `publish` emits go-live EXACTLY once.
	 *
	 * `future` is an overlay: scheduling reseats nothing, and the stage moves
	 * when the post actually goes live. Double-emitting here means a duplicate
	 * notification for every scheduled post on the site.
	 */
	public function test_cron_future_to_publish_emits_go_live_once(): void
	{
		$post_id = $this->make_post(
			'draft',
			'future',
			array( 'post_date' => gmdate( 'Y-m-d H:i:s', time() + 3600 ) )
		);

		$emitted  = array();
		$listener = function ( $event_type, $event_data = array() ) use ( &$emitted, $post_id ) {
			if ( 'post.published' === $event_type && (int) ( $event_data['post_id'] ?? 0 ) === $post_id ) {
				$emitted[] = $event_data;
			}
		};
		add_action( 'vip_workflows_event_emitted', $listener, 10, 2 );

		// What wp-cron's publish_future_post does.
		wp_publish_post( $post_id );

		remove_action( 'vip_workflows_event_emitted', $listener, 10 );

		$this->assertSame( 'publish', get_post_status( $post_id ) );
		$this->assertCount( 1, $emitted, 'Going live must emit post.published exactly once.' );
	}

	/**
	 * Core-publishing into a region the sequence does not model leaves the stage
	 * where it is — and the boundary follows the LIVE post, not the stranded
	 * stage.
	 *
	 * The reseat not happening is deliberate: resolve_reseat_stage() has nowhere
	 * to seat the post, and a region the sequence does not use is left untouched.
	 * What used to follow from that was not: the post was live while its stage
	 * said `draft`, so crosses_publish_boundary() compared draft to draft and a
	 * non-bypass user could unpublish a live post with no veto.
	 *
	 * boundary_region() now takes whichever side is publish.
	 */
	public function test_core_publish_into_an_unmodelled_region_keeps_the_post_on_the_publish_side(): void
	{
		// A sequence with NO publish-region stage at all.
		$sequence_id = (int) ( new SequenceRepository() )->create(
			'Never Publishes',
			'never-publishes',
			'',
			array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array(
						'key'         => 'draft',
						'label'       => 'Draft',
						'status'      => 'draft',
						'transitions' => array(),
					),
				),
			),
			get_current_user_id()
		);

		$post_id = (int) self::factory()->post->create(
			array(
				'post_status' => 'draft',
				'post_author' => $this->admin_id,
			)
		);
		update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $sequence_id );
		update_post_meta( $post_id, StatusManager::STAGE_META_KEY, 'draft' );

		wp_update_post(
			array(
				'ID'          => $post_id,
				'post_status' => 'publish',
			)
		);

		// The post is live and the stage did not move — there was nowhere to move it.
		$this->assertSame( 'publish', get_post_status( $post_id ) );
		$this->assertSame( 'draft', get_post_meta( $post_id, StatusManager::STAGE_META_KEY, true ) );

		$manager = new StatusManager();

		// Going back to draft un-publishes a live post, so it crosses — even
		// though the stage it is stranded at is draft-region.
		$this->assertTrue(
			$manager->crosses_publish_boundary( $post_id, 'draft' ),
			'A live post must be publish-side whatever its stage says.'
		);

		// It is already publish-side, so re-publishing crosses nothing, and
		// scheduling it stays on the same side.
		$this->assertFalse( $manager->crosses_publish_boundary( $post_id, 'publish' ) );
		$this->assertFalse( $manager->crosses_publish_boundary( $post_id, 'future' ) );

		// Trash remains an overlay in both directions.
		$this->assertFalse( $manager->crosses_publish_boundary( $post_id, 'trash' ) );
	}

	/**
	 * A same-region stage move fires the per-stage entered_/exited_ hooks.
	 *
	 * It writes no post_status, so core's transition_post_status never fires —
	 * these hooks are the ONLY signal such a move produces, and nothing pinned
	 * that they fire at all.
	 */
	public function test_same_region_move_fires_entered_and_exited_hooks(): void
	{
		$post_id = $this->make_post( 'draft', 'draft' );

		$entered = array();
		$exited  = array();

		add_action(
			'vip_workflows_entered_second_draft',
			function ( $id, $old_stage ) use ( &$entered ) {
				$entered[] = array( $id, $old_stage );
			},
			10,
			2
		);
		add_action(
			'vip_workflows_exited_draft',
			function ( $id, $new_stage ) use ( &$exited ) {
				$exited[] = array( $id, $new_stage );
			},
			10,
			2
		);

		$this->assertTrue( ( new StatusManager() )->transition( $post_id, 'second_draft' ) );

		// No status was written — the move stayed inside the draft region.
		$this->assertSame( 'draft', get_post_status( $post_id ) );

		$this->assertSame( array( array( $post_id, 'draft' ) ), $entered );
		$this->assertSame( array( array( $post_id, 'second_draft' ) ), $exited );
	}
}
