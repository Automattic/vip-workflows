<?php
/**
 * Integration coverage for StageAgent::write_content()'s $sanitize flag.
 *
 * Runs against a booted WordPress so the real wp_update_post/kses path is
 * exercised: the default write sanitizes (agent-generated markup must never
 * ride the impersonated user's unfiltered_html), and the opt-out write stores
 * the bytes it was handed.
 *
 * The opt-out exists because kses normalizes HTML. It rewrites `/>` as ` />`,
 * among other things, and one byte of difference is enough for a block's saved
 * markup to stop matching what its save() produces — which is what puts the
 * editor into block recovery. See AgentNotesMarkupFidelityTest for the path
 * that depends on it.
 *
 * @package VIPWorkflow\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Integration;

use VIPWorkflow\Abilities\Agents\StageAgent;

require_once dirname( __DIR__, 3 ) . '/includes/abilities/agents/class-stage-agent.php';

/**
 * Tests the sanitize/verbatim contract of the content write.
 */
class StageAgentWriteContentSanitizeTest extends TestCase
{
    public function set_up(): void
    {
        parent::set_up();

        // An administrator on single site holds unfiltered_html, so kses is not
        // re-applied by the save filters — write_content()'s own call is the
        // only sanitizing step, which is what these tests are pinning.
        wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
    }

    /**
     * A core/image block as the editor saves it: `/>` with no space before it.
     */
    private function image_markup(): string
    {
        return "<!-- wp:image {\"id\":42,\"sizeSlug\":\"large\",\"linkDestination\":\"none\"} -->\n"
            . '<figure class="wp-block-image size-large"><img src="https://example.com/wp-content/uploads/2026/08/harbor.jpg" alt="The harbor at dawn" class="wp-image-42" width="1024" height="1024"/></figure>' . "\n"
            . '<!-- /wp:image -->';
    }

    public function test_default_write_sanitizes_generated_markup(): void
    {
        $post_id = self::factory()->post->create( array( 'post_content' => 'Original.' ) );

        $this->assertTrue( StageAgent::write_content( $post_id, '<p>Kept.</p><script>alert(1)</script>' ) );

        $saved = (string) get_post_field( 'post_content', $post_id );
        $this->assertStringContainsString( '<p>Kept.</p>', $saved );
        $this->assertStringNotContainsString( '<script', $saved, 'Agent-generated markup must be sanitized by default.' );
    }

    public function test_default_write_does_not_preserve_block_markup_byte_for_byte(): void
    {
        $post_id = self::factory()->post->create( array( 'post_content' => 'Original.' ) );
        $markup  = $this->image_markup();

        $this->assertTrue( StageAgent::write_content( $post_id, $markup ) );

        $this->assertNotSame(
            $markup,
            (string) get_post_field( 'post_content', $post_id ),
            'Sanitizing rewrites block markup — today by inserting a space before the self-closing slash — which is why a path that only annotates the post must opt out.'
        );
    }

    public function test_opted_out_write_stores_the_bytes_it_was_given(): void
    {
        $post_id = self::factory()->post->create( array( 'post_content' => 'Original.' ) );
        $markup  = $this->image_markup();

        $this->assertTrue( StageAgent::write_content( $post_id, $markup, null, false ) );

        $saved = (string) get_post_field( 'post_content', $post_id );
        $this->assertSame( $markup, $saved );
        $this->assertStringContainsString( 'height="1024"/>', $saved );
        $this->assertStringNotContainsString( 'height="1024" />', $saved );
    }
}
