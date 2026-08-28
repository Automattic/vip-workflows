<?php
/**
 * Regression coverage for the markup a note run is allowed to touch.
 *
 * An agent that only annotates a post must not rewrite the post's own HTML.
 * Running the block-notes write through wp_kses_post() did exactly that: kses
 * rewrote `height="1024"/>` as `height="1024" />`, core/image's saved markup
 * stopped matching what its save() produces, and the editor offered block
 * recovery on a post nothing had edited.
 *
 * Block validity itself is decided in JavaScript, so it cannot be asserted from
 * PHP. Byte-identity of the block's inner HTML is the check that stands in for
 * it: save() output is compared byte for byte in the editor, so markup that
 * comes back unchanged is markup that still validates.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Abilities\Agents\StageAgent;

require_once dirname( __DIR__, 3 ) . '/includes/abilities/agents/class-stage-agent.php';

/**
 * Tests that write_block_notes() changes anchors and nothing else.
 */
class AgentNotesMarkupFidelityTest extends TestCase
{
    private const MARKER = '_vip_factcheck_agent';
    private const LABEL  = 'Fact Check';

    public function set_up(): void
    {
        parent::set_up();

        wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
    }

    /**
     * A core/image block as the editor saves it — note the `/>` with no space.
     */
    private function image_markup(): string
    {
        return "<!-- wp:image {\"id\":42,\"sizeSlug\":\"large\",\"linkDestination\":\"none\"} -->\n"
            . '<figure class="wp-block-image size-large"><img src="https://example.com/wp-content/uploads/2026/08/harbor.jpg" alt="The harbor at dawn" class="wp-image-42" width="1024" height="1024"/></figure>' . "\n"
            . '<!-- /wp:image -->';
    }

    /**
     * A paragraph followed by an image block. Block 1 is the paragraph, block 2
     * the image (number_blocks() numbers every named block).
     */
    private function create_post_with_image(): int
    {
        return self::factory()->post->create(
            array(
                'post_content' => "<!-- wp:paragraph -->\n<p>The harbor reopened in 2019.</p>\n<!-- /wp:paragraph -->\n\n" . $this->image_markup(),
            )
        );
    }

    /**
     * The serialized inner HTML of the nth top-level named block (0-based).
     */
    private function block_inner_html( int $post_id, int $index ): string
    {
        $blocks = array_values(
            array_filter(
                parse_blocks( (string) get_post_field( 'post_content', $post_id ) ),
                static fn( $block ) => ! empty( $block['blockName'] )
            )
        );

        return (string) ( $blocks[ $index ]['innerHTML'] ?? '' );
    }

    /**
     * The note ids anchored on top-level blocks, in document order.
     *
     * @return array<int, int>
     */
    private function anchored_note_ids( int $post_id ): array
    {
        $ids = array();

        foreach ( parse_blocks( (string) get_post_field( 'post_content', $post_id ) ) as $block ) {
            if ( isset( $block['attrs']['metadata']['noteId'] ) ) {
                $ids[] = (int) $block['attrs']['metadata']['noteId'];
            }
        }

        return $ids;
    }

    public function test_note_on_another_block_leaves_image_markup_untouched(): void
    {
        $post_id = $this->create_post_with_image();
        $before  = $this->block_inner_html( $post_id, 1 );

        $result = StageAgent::write_block_notes(
            $post_id,
            array( 1 => array( 'The reopening date is unsourced.' ) ),
            null,
            null,
            self::MARKER,
            self::LABEL
        );

        $this->assertTrue( $result );
        // The run did happen: the paragraph carries an anchor.
        $this->assertCount( 1, $this->anchored_note_ids( $post_id ) );

        $this->assertSame( $before, $this->block_inner_html( $post_id, 1 ), 'The image block must come back byte for byte.' );

        $saved = (string) get_post_field( 'post_content', $post_id );
        $this->assertStringContainsString( 'height="1024"/>', $saved );
        $this->assertStringNotContainsString( 'height="1024" />', $saved, 'kses inserted a space here; that is what broke block validity.' );
    }

    public function test_note_on_the_image_block_changes_only_its_delimiter(): void
    {
        $post_id = $this->create_post_with_image();
        $before  = $this->block_inner_html( $post_id, 1 );

        $result = StageAgent::write_block_notes(
            $post_id,
            array( 2 => array( 'The caption does not match the photo.' ) ),
            null,
            null,
            self::MARKER,
            self::LABEL
        );

        $this->assertTrue( $result );

        // The anchor lands on the image block's attributes...
        $blocks = parse_blocks( (string) get_post_field( 'post_content', $post_id ) );
        $image  = null;
        foreach ( $blocks as $block ) {
            if ( 'core/image' === ( $block['blockName'] ?? '' ) ) {
                $image = $block;
            }
        }

        $this->assertNotNull( $image );
        $this->assertArrayHasKey( 'noteId', $image['attrs']['metadata'] ?? array() );
        $this->assertSame( 42, $image['attrs']['id'] ?? null, 'The block\'s own attributes must survive the anchor write.' );

        // ...and its HTML is unchanged.
        $this->assertSame( $before, $this->block_inner_html( $post_id, 1 ) );
    }

    public function test_clearing_notes_restores_the_original_content_byte_for_byte(): void
    {
        $post_id  = $this->create_post_with_image();
        $original = (string) get_post_field( 'post_content', $post_id );

        StageAgent::write_block_notes(
            $post_id,
            array( 2 => array( 'The caption does not match the photo.' ) ),
            null,
            null,
            self::MARKER,
            self::LABEL
        );
        $this->assertNotSame( $original, (string) get_post_field( 'post_content', $post_id ), 'The annotated run should have written an anchor.' );

        // A clean run: no findings, no summary — every anchor is stripped.
        StageAgent::write_block_notes( $post_id, array(), null, null, self::MARKER, self::LABEL );

        $this->assertSame( array(), $this->anchored_note_ids( $post_id ) );
        $this->assertSame(
            $original,
            (string) get_post_field( 'post_content', $post_id ),
            'Annotating and then clearing must leave the post exactly as it was found.'
        );
    }

    public function test_markup_kses_would_strip_survives_a_note_run(): void
    {
        $embed   = "<!-- wp:html -->\n" . '<iframe src="https://example.com/player" width="560" height="315"></iframe>' . "\n<!-- /wp:html -->";
        $post_id = self::factory()->post->create(
            array(
                'post_content' => "<!-- wp:paragraph -->\n<p>The harbor reopened in 2019.</p>\n<!-- /wp:paragraph -->\n\n" . $embed,
            )
        );

        StageAgent::write_block_notes(
            $post_id,
            array( 1 => array( 'The reopening date is unsourced.' ) ),
            null,
            null,
            self::MARKER,
            self::LABEL
        );

        $this->assertStringContainsString(
            '<iframe src="https://example.com/player" width="560" height="315"></iframe>',
            (string) get_post_field( 'post_content', $post_id ),
            'Post-owned markup that kses would remove must survive a run that only annotates.'
        );
    }
}
