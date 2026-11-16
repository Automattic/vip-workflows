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
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Abilities\Agents\StageAgent;

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

    /**
     * A code block with backslashes in its text, as a Windows path or a regex
     * would have, beside a paragraph a copy edit can fix.
     */
    private function backslash_markup(): string
    {
        return "<!-- wp:code -->\n"
            . '<pre class="wp-block-code"><code>C:\Users\tom\harbor.txt</code></pre>' . "\n"
            . "<!-- /wp:code -->\n\n"
            . "<!-- wp:paragraph -->\n"
            . '<p>The board approved the proposal after reviewing the detailed report from the harbor committee, and the plan takes effect next month.</p>' . "\n"
            . '<!-- /wp:paragraph -->';
    }

    /**
     * @return array<string, array{0: bool}>
     */
    public function provide_sanitize_modes(): array
    {
        return array(
            'sanitized' => array( true ),
            'verbatim'  => array( false ),
        );
    }

    /**
     * wp_update_post() unslashes its input, so an unslashed write drops every
     * backslash in the text: `C:\Users\tom` was stored as `C:Userstom`. What
     * is stored must be exactly what the write was handed (after kses, when
     * sanitizing).
     *
     * @dataProvider provide_sanitize_modes
     *
     * @param bool $sanitize Whether the write runs kses.
     */
    public function test_backslashes_survive_the_write( bool $sanitize ): void
    {
        $post_id = self::factory()->post->create( array( 'post_content' => 'Original.' ) );
        $markup  = $this->backslash_markup();

        $this->assertTrue( StageAgent::write_content( $post_id, $markup, null, $sanitize ) );

        $saved = (string) get_post_field( 'post_content', $post_id );
        $this->assertSame( $sanitize ? wp_kses_post( $markup ) : $markup, $saved );
        $this->assertStringContainsString( 'C:\Users\tom\harbor.txt', $saved );
    }

    /**
     * The copy-edit path end to end: a small edit to text beside a code
     * sample passes the guard, and what's stored is the edit, backslashes
     * intact.
     */
    public function test_a_measured_copy_edit_keeps_backslashes(): void
    {
        $before  = str_replace( 'approved the proposal', 'aproved the proposal', $this->backslash_markup() );
        $after   = $this->backslash_markup();
        $post_id = self::factory()->post->create( array( 'post_content' => wp_slash( $before ) ) );
        $this->assertSame( $before, (string) get_post_field( 'post_content', $post_id ), 'The fixture is stored as written.' );

        $report = StageAgent::measure_rewrite( $before, $after );
        $this->assertSame( array(), StageAgent::copy_edit_violations( $report, 15 ) );

        $this->assertTrue( StageAgent::write_content( $post_id, $report['content'], null, false ) );
        $this->assertSame( $after, (string) get_post_field( 'post_content', $post_id ) );
    }
}
