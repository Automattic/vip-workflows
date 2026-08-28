<?php
/**
 * Integration coverage for StageAgent::write_block_notes() (Fact Check notes).
 *
 * Runs against a booted WordPress so the real parse_blocks/serialize_blocks/
 * wp_insert_comment round-trip is exercised end to end: notes are created as
 * `note` comments, anchored to blocks via `metadata.noteId`, and re-runs replace
 * the agent's own notes without stacking or orphaning human replies.
 *
 * @package VIPWorkflow\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Integration;

use VIPWorkflow\Abilities\Agents\StageAgent;

require_once dirname( __DIR__, 3 ) . '/includes/abilities/agents/class-stage-agent.php';

/**
 * Tests the block-note write path against real WordPress.
 */
class FactCheckAgentNotesTest extends TestCase
{
    private const MARKER = '_vip_factcheck_agent';
    private const LABEL  = 'Fact Check';

    public function set_up(): void
    {
        parent::set_up();

        wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
    }

    /**
     * Create a two-paragraph block post and return its id.
     */
    private function create_block_post(): int
    {
        return self::factory()->post->create(
            array(
                'post_content' => "<!-- wp:paragraph -->\n<p>The population reached ten billion in 2019.</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:paragraph -->\n<p>The event happened last Tuesday.</p>\n<!-- /wp:paragraph -->",
            )
        );
    }

    /**
     * The note ids currently anchored on each parsed block.
     *
     * @return array<int, int>
     */
    private function anchored_note_ids( int $post_id ): array
    {
        $blocks = parse_blocks( (string) get_post_field( 'post_content', $post_id ) );
        $ids    = array();

        foreach ( $blocks as $block ) {
            if ( isset( $block['attrs']['metadata']['noteId'] ) ) {
                $ids[] = (int) $block['attrs']['metadata']['noteId'];
            }
        }

        return $ids;
    }

    /**
     * Agent-authored note comments on a post.
     *
     * @return \WP_Comment[]
     */
    private function agent_notes( int $post_id ): array
    {
        return get_comments(
            array(
                'post_id'  => $post_id,
                'type'     => 'note',
                'meta_key' => self::MARKER, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
                'status'   => 'all',
                'number'   => 0,
            )
        );
    }

    public function test_issues_write_one_anchored_note_per_block(): void
    {
        $post_id = $this->create_block_post();

        $result = StageAgent::write_block_notes(
            $post_id,
            array(
                1 => array( 'The population figure is unsourced.' ),
                2 => array( 'The date is vague.' ),
            ),
            null,
            null,
            self::MARKER,
            self::LABEL
        );

        $this->assertTrue( $result );

        $notes = $this->agent_notes( $post_id );
        $this->assertCount( 2, $notes );

        foreach ( $notes as $note ) {
            $this->assertSame( 'note', $note->comment_type );
            $this->assertSame( '0', $note->comment_approved );
            $this->assertSame( '1', get_comment_meta( (int) $note->comment_ID, self::MARKER, true ) );
            $this->assertStringStartsWith( 'Fact Check:', $note->comment_content );
        }

        // Both blocks carry a real noteId pointing at the created comments.
        $anchored = $this->anchored_note_ids( $post_id );
        $this->assertCount( 2, $anchored );

        $note_ids = array_map( static fn( $n ) => (int) $n->comment_ID, $notes );
        sort( $note_ids );
        sort( $anchored );
        $this->assertSame( $note_ids, $anchored );
    }

    public function test_identical_rerun_is_a_noop(): void
    {
        $post_id = $this->create_block_post();
        $map     = array(
            1 => array( 'The population figure is unsourced.' ),
            2 => array( 'The date is vague.' ),
        );

        StageAgent::write_block_notes( $post_id, $map, null, null, self::MARKER, self::LABEL );
        $first_ids = $this->anchored_note_ids( $post_id );
        sort( $first_ids );

        // Same findings again — no clear, no insert, no new revision.
        StageAgent::write_block_notes( $post_id, $map, null, null, self::MARKER, self::LABEL );

        $this->assertCount( 2, $this->agent_notes( $post_id ) );
        $second_ids = $this->anchored_note_ids( $post_id );
        sort( $second_ids );
        $this->assertSame( $first_ids, $second_ids, 'An unchanged re-run should keep the same note ids.' );
    }

    public function test_changed_rerun_replaces_notes(): void
    {
        $post_id = $this->create_block_post();

        StageAgent::write_block_notes(
            $post_id,
            array( 1 => array( 'The population figure is unsourced.' ) ),
            null,
            null,
            self::MARKER,
            self::LABEL
        );
        $old_ids = wp_list_pluck( $this->agent_notes( $post_id ), 'comment_ID' );

        // Different findings — the prior note is deleted and replaced.
        StageAgent::write_block_notes(
            $post_id,
            array( 2 => array( 'The date is vague.' ) ),
            null,
            null,
            self::MARKER,
            self::LABEL
        );

        $new_notes = $this->agent_notes( $post_id );
        $this->assertCount( 1, $new_notes );

        $new_ids = wp_list_pluck( $new_notes, 'comment_ID' );
        $this->assertEmpty( array_intersect( $old_ids, $new_ids ), 'Replaced notes should have fresh ids.' );
    }

    public function test_pass_writes_one_summary_note_on_first_block(): void
    {
        $post_id = $this->create_block_post();

        StageAgent::write_block_notes(
            $post_id,
            array(),
            'No problematic factual claims found.',
            null,
            self::MARKER,
            self::LABEL
        );

        $notes = $this->agent_notes( $post_id );
        $this->assertCount( 1, $notes );

        $anchored = $this->anchored_note_ids( $post_id );
        $this->assertSame( array( (int) $notes[0]->comment_ID ), $anchored );
    }

    public function test_human_reply_is_preserved_on_replace(): void
    {
        $post_id = $this->create_block_post();

        StageAgent::write_block_notes(
            $post_id,
            array( 1 => array( 'The population figure is unsourced.' ) ),
            null,
            null,
            self::MARKER,
            self::LABEL
        );
        $anchor_id = (int) $this->agent_notes( $post_id )[0]->comment_ID;

        // A human replies to the agent note (unmarked child comment).
        $reply_id = wp_insert_comment(
            array(
                'comment_post_ID' => $post_id,
                'comment_type'    => 'note',
                'comment_parent'  => $anchor_id,
                'comment_content' => 'Actually the source is the 2019 census.',
                'comment_approved' => '0',
            )
        );

        // A changed run would normally clear the anchor — but it has a human reply.
        StageAgent::write_block_notes(
            $post_id,
            array( 2 => array( 'The date is vague.' ) ),
            null,
            null,
            self::MARKER,
            self::LABEL
        );

        $this->assertNotNull( get_comment( $anchor_id ), 'Anchor with a human reply must not be deleted.' );
        $this->assertNotNull( get_comment( $reply_id ), 'Human reply must survive.' );
    }

    public function test_classic_content_writes_a_post_level_note(): void
    {
        $post_id = self::factory()->post->create(
            array( 'post_content' => 'Just plain classic content with no blocks at all.' )
        );
        $before  = (string) get_post_field( 'post_content', $post_id );

        StageAgent::write_block_notes(
            $post_id,
            array( 1 => array( 'This claim is unsupported.' ) ),
            null,
            null,
            self::MARKER,
            self::LABEL
        );

        $notes = $this->agent_notes( $post_id );
        $this->assertCount( 1, $notes );
        // Post-level note carries no block anchor and does not touch content.
        $this->assertSame( array(), $this->anchored_note_ids( $post_id ) );
        $this->assertSame( $before, (string) get_post_field( 'post_content', $post_id ) );
    }

    public function test_fresh_finding_on_a_replied_block_becomes_an_agent_reply(): void
    {
        $post_id = $this->create_block_post();

        // Agent flags the first block; a human replies to that anchor note.
        StageAgent::write_block_notes(
            $post_id,
            array( 1 => array( 'The population figure is unsourced.' ) ),
            null,
            null,
            self::MARKER,
            self::LABEL
        );
        $anchor_id = (int) $this->agent_notes( $post_id )[0]->comment_ID;
        wp_insert_comment(
            array(
                'comment_post_ID'  => $post_id,
                'comment_type'     => 'note',
                'comment_parent'   => $anchor_id,
                'comment_content'  => 'I have a source for this.',
                'comment_approved' => '0',
            )
        );

        // A new run flags a different problem on the SAME block.
        StageAgent::write_block_notes(
            $post_id,
            array( 1 => array( 'The date is also wrong.' ) ),
            null,
            null,
            self::MARKER,
            self::LABEL
        );

        // The preserved note survives and the fresh finding is surfaced as a
        // marked agent reply rather than dropped.
        $this->assertNotNull( get_comment( $anchor_id ) );
        $this->assertSame( 1, $this->agent_reply_count( $anchor_id ) );

        // Idempotent: the same finding again adds no second reply.
        StageAgent::write_block_notes(
            $post_id,
            array( 1 => array( 'The date is also wrong.' ) ),
            null,
            null,
            self::MARKER,
            self::LABEL
        );
        $this->assertSame( 1, $this->agent_reply_count( $anchor_id ) );
    }

    /**
     * Count agent-authored (marked) replies under a note.
     */
    private function agent_reply_count( int $parent_id ): int
    {
        $replies = get_comments(
            array(
                'parent' => $parent_id,
                'type'   => 'note',
                'status' => 'all',
                'number' => 0,
            )
        );

        $count = 0;
        foreach ( $replies as $reply ) {
            if ( '1' === (string) get_comment_meta( (int) $reply->comment_ID, self::MARKER, true ) ) {
                ++$count;
            }
        }

        return $count;
    }
}
