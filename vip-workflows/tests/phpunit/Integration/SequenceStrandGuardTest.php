<?php
/**
 * A sequence write that would strand posts is refused.
 *
 * A post's place in a workflow is its sequence ID and stage key. Removing (or
 * re-keying) a stage posts sit at, or deleting a sequence posts hold, leaves
 * them pointing at nothing, and the publish boundary then refuses every status
 * change for them. These tests run the real REST -> controller -> repository
 * chain, the update-sequence ability, and the repository directly, since the
 * refusal has to hold for every writer.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Database\Schema;
use VIPWorkflows\Sequences\Sequence;
use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Sequences\StrandedPostsException;
use VIPWorkflows\Workflow\StatusManager;

require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/helpers.php';
require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/update-sequence.php';

/**
 * Covers the strand refusal on update and delete.
 */
class SequenceStrandGuardTest extends TestCase
{
    private int $admin_id = 0;

    private SequenceRepository $repository;

    public function set_up(): void
    {
        parent::set_up();

        $this->admin_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
        wp_set_current_user( $this->admin_id );

        $this->repository = new SequenceRepository();
    }

    /**
     * Three stages: writing (draft), legal (pending), live (publish).
     *
     * @return array<int, array<string, string>>
     */
    private function statuses(): array
    {
        return array(
            array( 'key' => 'writing', 'label' => 'Writing', 'status' => 'draft' ),
            array( 'key' => 'legal', 'label' => 'Legal', 'status' => 'pending' ),
            array( 'key' => 'live', 'label' => 'Live', 'status' => 'publish' ),
        );
    }

    /**
     * The same stages without legal.
     *
     * @return array<int, array<string, string>>
     */
    private function statuses_without_legal(): array
    {
        return array(
            array( 'key' => 'writing', 'label' => 'Writing', 'status' => 'draft' ),
            array( 'key' => 'live', 'label' => 'Live', 'status' => 'publish' ),
        );
    }

    private function create_sequence(): Sequence
    {
        $id = $this->repository->create(
            'Strand Flow',
            'strand-flow-' . wp_generate_password( 6, false ),
            '',
            array(
                'post_types' => array( 'post' ),
                'statuses'   => $this->statuses(),
            ),
            $this->admin_id
        );

        $this->assertIsInt( $id );

        return $this->repository->find( $id );
    }

    /**
     * A post seated at a stage.
     *
     * @param Sequence $sequence    Sequence.
     * @param string   $stage       Stage key.
     * @param string   $post_status Post status.
     * @return int Post ID.
     */
    private function seat_post( Sequence $sequence, string $stage, string $post_status = 'draft' ): int
    {
        $post_id = self::factory()->post->create( array( 'post_status' => $post_status ) );
        update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $sequence->id );
        update_post_meta( $post_id, StatusManager::STAGE_META_KEY, $stage );
        return $post_id;
    }

    /**
     * PUT the sequence over REST with the given stages.
     *
     * @param Sequence $sequence Sequence.
     * @param array    $statuses Stages to save.
     * @return \WP_REST_Response
     */
    private function rest_update( Sequence $sequence, array $statuses ): \WP_REST_Response
    {
        $request = new \WP_REST_Request( 'PUT', '/vip-workflows/v1/sequences/' . $sequence->id );
        $request->set_param( 'name', $sequence->name );
        $request->set_param( 'post_types', array( 'post' ) );
        $request->set_param( 'statuses', $statuses );

        return rest_do_request( $request );
    }

    private function stored_keys( Sequence $sequence ): array
    {
        return array_column( $this->repository->find( $sequence->id )->get_statuses(), 'key' );
    }

    // -------------------------------------------------------------------------
    // Update
    // -------------------------------------------------------------------------

    public function test_rest_update_removing_an_occupied_stage_is_refused_and_writes_nothing(): void
    {
        $sequence = $this->create_sequence();
        $first    = $this->seat_post( $sequence, 'legal' );
        $second   = $this->seat_post( $sequence, 'legal', 'pending' );
        $this->seat_post( $sequence, 'writing' );

        $response = $this->rest_update( $sequence, $this->statuses_without_legal() );

        $this->assertSame( 409, $response->get_status() );
        $data = $response->get_data();
        $this->assertSame( 'rest_sequence_would_strand_posts', $data['code'] );
        $this->assertStringContainsString( '“Legal”', $data['message'] );
        $this->assertStringContainsString( '2 posts', $data['message'] );
        $this->assertSame( 2, $data['data']['total'] );
        $this->assertSame( array( array( 'key' => 'legal', 'label' => 'Legal' ) ), $data['data']['stages'] );
        $this->assertEqualsCanonicalizing( array( $first, $second ), array_column( $data['data']['posts'], 'id' ) );
        $this->assertNotEmpty( $data['data']['posts'][0]['edit_link'] );

        $this->assertSame( array( 'writing', 'legal', 'live' ), $this->stored_keys( $sequence ) );
    }

    public function test_ability_update_gets_the_same_refusal(): void
    {
        $sequence = $this->create_sequence();
        $this->seat_post( $sequence, 'legal' );

        $result = \VIPWorkflows\Abilities\Tools\execute_update_sequence(
            array(
                'sequence_id' => $sequence->id,
                'name'        => 'Strand Flow',
                'post_types'  => array( 'post' ),
                'statuses'    => $this->statuses_without_legal(),
            )
        );

        $this->assertWPError( $result );
        $this->assertSame( 'rest_sequence_would_strand_posts', $result->get_error_code() );
        $this->assertSame( 409, $result->get_error_data()['status'] );
        $this->assertSame( 1, $result->get_error_data()['total'] );
        $this->assertSame( array( 'writing', 'legal', 'live' ), $this->stored_keys( $sequence ) );
    }

    public function test_direct_repository_update_throws_and_writes_nothing(): void
    {
        $sequence = $this->create_sequence();
        $this->seat_post( $sequence, 'legal' );

        try {
            $this->repository->update(
                $sequence->id,
                array(
                    'config' => array(
                        'post_types' => array( 'post' ),
                        'statuses'   => $this->statuses_without_legal(),
                    ),
                )
            );
            $this->fail( 'Expected StrandedPostsException.' );
        } catch ( StrandedPostsException $e ) {
            $this->assertSame( array( 'legal' => 'Legal' ), $e->stages );
            $this->assertSame( 1, $e->total );
        }

        $this->assertSame( array( 'writing', 'legal', 'live' ), $this->stored_keys( $sequence ) );
    }

    public function test_renaming_an_occupied_stage_key_is_refused(): void
    {
        $sequence = $this->create_sequence();
        $this->seat_post( $sequence, 'legal' );

        $renamed             = $this->statuses();
        $renamed[1]['key']   = 'legal-review';
        $renamed[1]['label'] = 'Legal review';

        $response = $this->rest_update( $sequence, $renamed );

        $this->assertSame( 409, $response->get_status() );
        $this->assertSame( array( 'writing', 'legal', 'live' ), $this->stored_keys( $sequence ) );
    }

    public function test_a_trashed_post_alone_blocks_the_save(): void
    {
        $sequence = $this->create_sequence();
        $post_id  = $this->seat_post( $sequence, 'legal' );
        wp_trash_post( $post_id );

        $response = $this->rest_update( $sequence, $this->statuses_without_legal() );

        $this->assertSame( 409, $response->get_status() );
        $this->assertSame( 'trash', $response->get_data()['data']['posts'][0]['status'] );
    }

    public function test_an_auto_draft_alone_blocks_the_save(): void
    {
        $sequence = $this->create_sequence();
        $this->seat_post( $sequence, 'legal', 'auto-draft' );

        $response = $this->rest_update( $sequence, $this->statuses_without_legal() );

        $this->assertSame( 409, $response->get_status() );
    }

    public function test_removing_an_empty_stage_saves_as_before(): void
    {
        $sequence = $this->create_sequence();
        $this->seat_post( $sequence, 'writing' );
        $this->seat_post( $sequence, 'live', 'publish' );

        $response = $this->rest_update( $sequence, $this->statuses_without_legal() );

        $this->assertSame( 200, $response->get_status() );
        $this->assertSame( array( 'writing', 'live' ), $this->stored_keys( $sequence ) );
    }

    public function test_editing_without_removing_keys_saves_with_posts_in_every_stage(): void
    {
        $sequence = $this->create_sequence();
        $this->seat_post( $sequence, 'writing' );
        $this->seat_post( $sequence, 'legal' );
        $this->seat_post( $sequence, 'live', 'publish' );

        $relabelled             = $this->statuses();
        $relabelled[1]['label'] = 'Legal sign-off';

        $response = $this->rest_update( $sequence, $relabelled );

        $this->assertSame( 200, $response->get_status() );
        $this->assertSame( 'Legal sign-off', $this->repository->find( $sequence->id )->get_status( 'legal' )['label'] );
    }

    public function test_status_only_update_skips_the_check(): void
    {
        $sequence = $this->create_sequence();
        $this->seat_post( $sequence, 'legal' );

        $this->assertSame( $sequence->id, $this->repository->update( $sequence->id, array( 'status' => 'draft' ) ) );
    }

    public function test_a_pre_existing_strand_does_not_block_an_unrelated_save(): void
    {
        $sequence = $this->create_sequence();
        // Already pointing at a stage the stored config doesn't define.
        $this->seat_post( $sequence, 'long-gone' );

        $relabelled             = $this->statuses();
        $relabelled[0]['label'] = 'Drafting';

        $response = $this->rest_update( $sequence, $relabelled );

        $this->assertSame( 200, $response->get_status() );
    }

    public function test_posts_on_another_sequence_at_the_same_key_do_not_block(): void
    {
        $sequence = $this->create_sequence();
        $other    = $this->create_sequence();
        $this->seat_post( $other, 'legal' );

        $response = $this->rest_update( $sequence, $this->statuses_without_legal() );

        $this->assertSame( 200, $response->get_status() );
    }

    public function test_the_post_list_is_capped_but_the_total_is_exact(): void
    {
        $sequence = $this->create_sequence();
        $over     = SequenceRepository::STRANDED_POSTS_LIMIT + 3;
        for ( $i = 0; $i < $over; $i++ ) {
            $this->seat_post( $sequence, 'legal' );
        }

        $data = $this->rest_update( $sequence, $this->statuses_without_legal() )->get_data()['data'];

        $this->assertSame( $over, $data['total'] );
        $this->assertCount( SequenceRepository::STRANDED_POSTS_LIMIT, $data['posts'] );
    }

    public function test_every_occupied_removed_stage_is_named_even_past_the_cap(): void
    {
        $sequence = $this->create_sequence();
        // The capped list fills with Legal posts; the Writing post sorts after it.
        for ( $i = 0; $i < SequenceRepository::STRANDED_POSTS_LIMIT; $i++ ) {
            $this->seat_post( $sequence, 'legal' );
        }
        $this->seat_post( $sequence, 'writing' );

        $only_live = array( array( 'key' => 'live', 'label' => 'Live', 'status' => 'publish' ) );
        $response  = $this->rest_update( $sequence, $only_live );

        $this->assertSame( 409, $response->get_status() );
        $data = $response->get_data();
        $this->assertSame( SequenceRepository::STRANDED_POSTS_LIMIT + 1, $data['data']['total'] );
        $this->assertEqualsCanonicalizing( array( 'writing', 'legal' ), array_column( $data['data']['stages'], 'key' ) );
        $this->assertStringContainsString( '“Writing”', $data['message'] );
        $this->assertStringContainsString( '“Legal”', $data['message'] );
    }

    public function test_an_empty_removed_stage_is_not_named(): void
    {
        $sequence = $this->create_sequence();
        $this->seat_post( $sequence, 'legal' );

        $only_live = array( array( 'key' => 'live', 'label' => 'Live', 'status' => 'publish' ) );
        $data      = $this->rest_update( $sequence, $only_live )->get_data();

        $this->assertSame( array( 'legal' ), array_column( $data['data']['stages'], 'key' ) );
    }

    public function test_repair_route_refuses_to_re_key_a_legacy_stage_posts_sit_at(): void
    {
        global $wpdb;

        // A row stored before regions and key normalization: an uppercase key the
        // write gate would sanitize to "legal", and no regions at all.
        $now = current_time( 'mysql' );
        $wpdb->insert(
            Schema::get_table_name( 'sequences' ),
            array(
                'uuid'        => wp_generate_uuid4(),
                'type'        => Sequence::TYPE_WORKFLOW,
                'name'        => 'Legacy Flow',
                'slug'        => 'legacy-flow-' . wp_generate_password( 6, false ),
                'description' => '',
                'version'     => 1,
                'status'      => 'active',
                'config'      => wp_json_encode(
                    array(
                        'post_types' => array( 'post' ),
                        'statuses'   => array(
                            array( 'key' => 'writing', 'label' => 'Writing' ),
                            array( 'key' => 'Legal', 'label' => 'Legal' ),
                        ),
                    )
                ),
                'created_by'  => $this->admin_id,
                'created_at'  => $now,
                'updated_at'  => $now,
            )
        );
        $legacy = $this->repository->find( (int) $wpdb->insert_id );
        $this->seat_post( $legacy, 'Legal' );

        $result = $this->repository->repair_stage_regions( $legacy->id );

        $this->assertWPError( $result );
        $this->assertSame( 'rest_sequence_would_strand_posts', $result->get_error_code() );
        $this->assertSame( array( 'writing', 'Legal' ), $this->stored_keys( $legacy ) );
    }

    // -------------------------------------------------------------------------
    // Delete
    // -------------------------------------------------------------------------

    public function test_rest_delete_of_a_used_sequence_is_refused(): void
    {
        $sequence = $this->create_sequence();
        $this->seat_post( $sequence, 'writing' );
        $this->seat_post( $sequence, 'legal', 'pending' );

        $response = rest_do_request( new \WP_REST_Request( 'DELETE', '/vip-workflows/v1/sequences/' . $sequence->id ) );

        $this->assertSame( 409, $response->get_status() );
        $data = $response->get_data();
        $this->assertSame( 'rest_sequence_would_strand_posts', $data['code'] );
        $this->assertSame( 2, $data['data']['total'] );
        $this->assertSame( array(), $data['data']['stages'] );
        $this->assertNotNull( $this->repository->find( $sequence->id ) );
    }

    public function test_a_sequence_whose_only_post_is_in_trash_cannot_be_deleted(): void
    {
        $sequence = $this->create_sequence();
        wp_trash_post( $this->seat_post( $sequence, 'writing' ) );

        $response = rest_do_request( new \WP_REST_Request( 'DELETE', '/vip-workflows/v1/sequences/' . $sequence->id ) );

        $this->assertSame( 409, $response->get_status() );
    }

    public function test_an_auto_draft_in_the_sequence_blocks_the_delete(): void
    {
        // The workflow-required modal seats a brand-new post before its first
        // save, while it is still an auto-draft.
        $sequence = $this->create_sequence();
        $this->seat_post( $sequence, 'writing', 'auto-draft' );

        $this->expectException( StrandedPostsException::class );
        $this->repository->delete( $sequence->id );
    }

    public function test_a_post_with_only_sequence_meta_still_blocks_the_delete(): void
    {
        $sequence = $this->create_sequence();
        $post_id  = self::factory()->post->create();
        update_post_meta( $post_id, StatusManager::SEQUENCE_META_KEY, $sequence->id );

        $this->expectException( StrandedPostsException::class );
        $this->repository->delete( $sequence->id );
    }

    public function test_delete_succeeds_once_the_last_post_is_removed_from_the_workflow(): void
    {
        $sequence = $this->create_sequence();
        $post_id  = $this->seat_post( $sequence, 'writing' );

        ( new StatusManager() )->remove_sequence( $post_id );

        $response = rest_do_request( new \WP_REST_Request( 'DELETE', '/vip-workflows/v1/sequences/' . $sequence->id ) );

        $this->assertSame( 200, $response->get_status() );
        $this->assertSame( array( 'deleted' => true, 'id' => $sequence->id ), $response->get_data() );
    }

    public function test_deleting_an_unused_sequence_behaves_as_before(): void
    {
        $sequence = $this->create_sequence();

        $response = rest_do_request( new \WP_REST_Request( 'DELETE', '/vip-workflows/v1/sequences/' . $sequence->id ) );

        $this->assertSame( 200, $response->get_status() );
        $this->assertNull( $this->repository->find( $sequence->id ) );
    }
}
