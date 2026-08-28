<?php
/**
 * A metadata field is stored the way its declared type means it.
 *
 * `register_post_meta()` sanitizes on write, and every field that was not a
 * `user` got `sanitize_text_field` — which collapses newlines. So a `textarea`
 * field, whose entire difference from a `text` field is that it holds more than
 * one line, silently did not. A briefing note typed as three paragraphs came
 * back as one, for every writer: the editor's metadata panel, the REST meta
 * endpoint, an ability, or a plugin calling update_post_meta() directly.
 *
 * Integration because the thing under test is the registered sanitize_callback,
 * which only runs against a real WordPress.
 *
 * @package VIPWorkflow\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Integration;

use VIPWorkflow\Sequences\SequenceRepository;
use VIPWorkflow\Plugin;

/**
 * @covers \VIPWorkflow\Plugin::register_metadata_fields
 */
class MetadataFieldSanitizationTest extends TestCase
{
    public function set_up(): void
    {
        parent::set_up();

        wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
    }

    /**
     * A `textarea` field keeps its line breaks.
     *
     * The regression test. Written through `update_post_meta()` rather than a
     * REST route on purpose: the loss was in the registration, so it happened to
     * every writer, and the narrowest reproduction is the plainest one.
     */
    public function test_a_textarea_field_keeps_its_newlines(): void
    {
        $sequence = $this->sequence_with_field( 'briefing', 'textarea' );
        $post_id  = (int) self::factory()->post->create( array( 'post_type' => 'post' ) );

        update_post_meta( $post_id, 'wf_meta_' . $sequence . '_briefing', "Two sources.\nEmbargoed until the vote." );

        $this->assertSame(
            "Two sources.\nEmbargoed until the vote.",
            get_post_meta( $post_id, 'wf_meta_' . $sequence . '_briefing', true )
        );
    }

    /**
     * A `text` field still collapses them.
     *
     * The other half of the same rule, and the guard against fixing this by
     * loosening every field: a single-line field given a newline is a client
     * sending something the field is not, and flattening it is the right answer.
     */
    public function test_a_text_field_still_collapses_newlines(): void
    {
        $sequence = $this->sequence_with_field( 'sub_desk', 'text' );
        $post_id  = (int) self::factory()->post->create( array( 'post_type' => 'post' ) );

        update_post_meta( $post_id, 'wf_meta_' . $sequence . '_sub_desk', "Politics\nand Business" );

        $this->assertSame(
            'Politics and Business',
            get_post_meta( $post_id, 'wf_meta_' . $sequence . '_sub_desk', true )
        );
    }

    /**
     * A `user` field is still an integer.
     *
     * Unchanged by this, and asserted so a future edit to the `match` cannot
     * quietly drop the `absint` that makes the 0 sentinel work.
     */
    public function test_a_user_field_is_still_stored_as_an_integer(): void
    {
        $sequence = $this->sequence_with_field( 'commissioner', 'user' );
        $editor   = (int) self::factory()->user->create( array( 'role' => 'editor' ) );
        $post_id  = (int) self::factory()->post->create( array( 'post_type' => 'post' ) );

        update_post_meta( $post_id, 'wf_meta_' . $sequence . '_commissioner', (string) $editor );

        $this->assertSame( $editor, (int) get_post_meta( $post_id, 'wf_meta_' . $sequence . '_commissioner', true ) );
    }

    /**
     * A sequence carrying one metadata field, with its meta registered.
     *
     * Registration runs on `init`, which fired long before this test existed, so
     * it is re-run here — that registration is the thing under test.
     *
     * @param  string $key  Field key.
     * @param  string $type Field type.
     * @return int Sequence ID.
     */
    private function sequence_with_field( string $key, string $type ): int
    {
        $sequence_id = (int) ( new SequenceRepository() )->create(
            'Commissioning desk',
            'metadata-sanitization-' . $key,
            'Sequence for metadata sanitization tests.',
            array(
                'statuses'        => array(
                    array( 'key' => 'commissioned', 'label' => 'Commissioned' ),
                    array( 'key' => 'writing', 'label' => 'Writing' ),
                ),
                'metadata_fields' => array(
                    array( 'key' => $key, 'label' => ucfirst( $key ), 'type' => $type ),
                ),
            ),
            get_current_user_id()
        );

        Plugin::get_instance()->register_meta();

        return $sequence_id;
    }
}
