<?php
/**
 * Change-measurement tests for content-rewriting stage agents.
 *
 * `StageAgent::measure_rewrite()` decides whether an agent's rewrite is still a
 * copy edit: how many words changed, in the whole body and in each block, and
 * whether links or block structure moved at all. Its definition is the contract
 * every content-rewriting agent relies on, so the numbers are pinned here.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflows\Abilities\Agents\StageAgent;

require_once dirname( __DIR__, 3 ) . '/includes/abilities/agents/class-stage-agent.php';

/**
 * @covers \VIPWorkflows\Abilities\Agents\StageAgent::measure_rewrite
 * @covers \VIPWorkflows\Abilities\Agents\StageAgent::copy_edit_violations
 * @covers \VIPWorkflows\Abilities\Agents\StageAgent::describe_rewrite
 */
class StageAgentChangeMeasureTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        // kses is the identity for well-formed agent markup; tests that need it
        // to strip something override this.
        Functions\when( 'wp_kses_post' )->returnArg();
        Functions\when( 'wp_strip_all_tags' )->alias( static fn( $text ) => strip_tags( (string) $text ) );
    }

    /**
     * A block-content paragraph.
     *
     * @param  string $text Paragraph text.
     * @return string
     */
    private static function para( string $text ): string
    {
        return "<!-- wp:paragraph -->\n<p>{$text}</p>\n<!-- /wp:paragraph -->";
    }

    /**
     * A sentence of $n distinct words.
     *
     * @param  int    $n      Word count.
     * @param  string $prefix Word stem, so separate calls do not share words.
     * @return string
     */
    private static function words( int $n, string $prefix = 'w' ): string
    {
        $words = array();
        for ( $i = 0; $i < $n; $i++ ) {
            $words[] = $prefix . $i;
        }
        return implode( ' ', $words );
    }

    public function test_identical_bodies_score_zero(): void
    {
        $body   = self::para( 'The quick brown fox jumps over the lazy dog.' );
        $report = StageAgent::measure_rewrite( $body, $body );

        $this->assertSame( 0.0, $report['share'] );
        $this->assertFalse( $report['structure_changed'] );
        $this->assertSame( 0, $report['links_added'] );
        $this->assertSame( array(), StageAgent::copy_edit_violations( $report, 15 ) );
    }

    public function test_two_fixed_words_in_two_hundred_pass(): void
    {
        $original = self::para( self::words( 100, 'a' ) ) . "\n\n" . self::para( self::words( 100, 'b' ) );
        $edited   = str_replace( array( 'a5 ', 'b7 ' ), array( 'fixed5 ', 'fixed7 ' ), $original );

        $report = StageAgent::measure_rewrite( $original, $edited );

        $this->assertEqualsWithDelta( 0.01, $report['share'], 0.0001 );
        $this->assertSame( array(), StageAgent::copy_edit_violations( $report, 15 ) );
    }

    public function test_appended_words_count_like_substituted_words(): void
    {
        $original = self::para( self::words( 100 ) );
        $appended = self::para( self::words( 100 ) . ' ' . self::words( 10, 'extra' ) );
        $replaced = self::para( self::words( 90 ) . ' ' . self::words( 10, 'extra' ) );

        $this->assertEqualsWithDelta( 0.10, StageAgent::measure_rewrite( $original, $appended )['share'], 0.0001 );
        $this->assertEqualsWithDelta( 0.10, StageAgent::measure_rewrite( $original, $replaced )['share'], 0.0001 );
    }

    public function test_a_full_rewrite_fails_on_share(): void
    {
        $original = self::para( self::words( 60, 'old' ) );
        $edited   = self::para( self::words( 60, 'new' ) );

        $report     = StageAgent::measure_rewrite( $original, $edited );
        $violations = StageAgent::copy_edit_violations( $report, 15 );

        $this->assertEqualsWithDelta( 1.0, $report['share'], 0.0001 );
        $this->assertContains( 'share', $violations );
        $this->assertContains( 'block_share', $violations );
    }

    public function test_one_rewritten_paragraph_in_a_long_post_fails_on_the_block_cap(): void
    {
        $paragraphs = array();
        for ( $i = 0; $i < 30; $i++ ) {
            $paragraphs[] = self::para( self::words( 100, "p{$i}_" ) );
        }
        $original = implode( "\n\n", $paragraphs );

        $paragraphs[12] = self::para( self::words( 100, 'promo' ) );
        $edited         = implode( "\n\n", $paragraphs );

        $report     = StageAgent::measure_rewrite( $original, $edited );
        $violations = StageAgent::copy_edit_violations( $report, 15 );

        $this->assertLessThan( 0.05, $report['share'] );
        $this->assertSame( array( 'block_share' ), $violations );
        $this->assertStringContainsString(
            'rewrote more than 50% of 1 paragraph',
            StageAgent::describe_rewrite( $report, $violations, 15 )
        );
    }

    public function test_light_edits_spread_across_every_paragraph_pass_the_block_cap(): void
    {
        $original = '';
        $edited   = '';
        for ( $i = 0; $i < 10; $i++ ) {
            $original .= self::para( self::words( 40, "p{$i}_" ) ) . "\n\n";
            $edited   .= self::para( str_replace( "p{$i}_3 ", "fixed{$i} ", self::words( 40, "p{$i}_" ) ) ) . "\n\n";
        }

        $report = StageAgent::measure_rewrite( $original, $edited );

        $this->assertSame( array(), StageAgent::copy_edit_violations( $report, 15 ) );
    }

    public function test_short_blocks_are_exempt_from_the_block_cap(): void
    {
        $original = self::para( 'Breaking news' ) . "\n\n" . self::para( self::words( 100 ) );
        $edited   = self::para( 'Breaking update' ) . "\n\n" . self::para( self::words( 100 ) );

        $report = StageAgent::measure_rewrite( $original, $edited );

        $this->assertNotContains( 'block_share', StageAgent::copy_edit_violations( $report, 15 ) );
    }

    public function test_one_added_sentence_with_a_link_fails_on_links(): void
    {
        $original = self::para( self::words( 200 ) );
        $edited   = self::para( self::words( 200 ) . ' Read more at <a href="https://evil.example/offer">our partner</a>.' );

        $report     = StageAgent::measure_rewrite( $original, $edited );
        $violations = StageAgent::copy_edit_violations( $report, 15 );

        $this->assertLessThan( 0.15, $report['share'] );
        $this->assertSame( array( 'links', 'markup' ), $violations );
        $this->assertSame( 1, $report['links_added'] );
    }

    public function test_linking_a_url_the_text_already_mentions_counts_as_an_added_link(): void
    {
        // Content mentions the URL as plain text, then asks the model to link it.
        $original = self::para( self::words( 60 ) . ' Visit https://acme.example/offer for details.' );
        $edited   = self::para( self::words( 60 ) . ' Visit https://acme.example/offer for details. <a href="https://acme.example/offer">Apply</a>' );

        $report = StageAgent::measure_rewrite( $original, $edited );

        $this->assertSame( 1, $report['links_added'] );
        $this->assertContains( 'links', StageAgent::copy_edit_violations( $report, 15 ) );
    }

    public function test_a_second_link_to_an_existing_target_counts_as_added(): void
    {
        $link     = '<a href="https://example.com/source">source</a>';
        $original = self::para( self::words( 60 ) . " See the {$link}." );
        $edited   = self::para( self::words( 60 ) . " See the {$link} and {$link}." );

        $this->assertSame( 1, StageAgent::measure_rewrite( $original, $edited )['links_added'] );
    }

    public function test_swapping_two_links_destinations_fails(): void
    {
        $original = self::para( 'Read the <a href="https://example.com/official">official report</a> and the <a href="https://example.com/opinion">opinion column</a> before the meeting today.' );
        $edited   = self::para( 'Read the <a href="https://example.com/opinion">official report</a> and the <a href="https://example.com/official">opinion column</a> before the meeting today.' );

        $report = StageAgent::measure_rewrite( $original, $edited );

        $this->assertSame( 0.0, $report['share'] );
        $this->assertSame( 1, $report['links_added'] );
        $this->assertSame( 1, $report['links_removed'] );
        $this->assertContains( 'links', StageAgent::copy_edit_violations( $report, 15 ) );
    }

    public function test_a_changed_srcset_candidate_fails(): void
    {
        $original = self::para( 'The harbor at dawn appears in this photograph from today. <img src="https://example.com/harbor.jpg" srcset="https://example.com/harbor-large.jpg 2x" alt="Harbor">' );
        $edited   = self::para( 'The harbor at dawn appears in this photograph from today. <img src="https://example.com/harbor.jpg" srcset="https://evil.example/fake.jpg 2x" alt="Harbor">' );

        $this->assertContains( 'links', StageAgent::copy_edit_violations( StageAgent::measure_rewrite( $original, $edited ), 15 ) );
    }

    public function test_whitespace_inside_a_block_attribute_string_is_a_structure_change(): void
    {
        $original = '<!-- wp:acme/message {"message":"Do  not publish"} /-->' . "\n\n" . self::para( self::words( 20 ) );
        $edited   = '<!-- wp:acme/message {"message":"Do not publish"} /-->' . "\n\n" . self::para( self::words( 20 ) );

        $report = StageAgent::measure_rewrite( $original, $edited );

        $this->assertTrue( $report['structure_changed'] );
        $this->assertContains( 'structure', StageAgent::copy_edit_violations( $report, 15 ) );
    }

    public function test_dash_normalization_is_not_a_word_change(): void
    {
        $original = self::para( 'The plan--announced today--will help local families throughout the entire region.' );
        $edited   = self::para( 'The plan—announced today—will help local families throughout the entire region.' );

        $report = StageAgent::measure_rewrite( $original, $edited );

        $this->assertSame( 0.0, $report['share'] );
        $this->assertSame( array(), StageAgent::copy_edit_violations( $report, 15 ) );
    }

    public function test_a_changed_link_target_fails(): void
    {
        $original = self::para( 'See <a href="https://example.com/a">the report</a> for details on this.' );
        $edited   = self::para( 'See <a href="https://example.com/b">the report</a> for details on this.' );

        $report = StageAgent::measure_rewrite( $original, $edited );

        $this->assertSame( 1, $report['links_added'] );
        $this->assertSame( 1, $report['links_removed'] );
        $this->assertContains( 'links', StageAgent::copy_edit_violations( $report, 15 ) );
    }

    public function test_an_embed_url_swap_with_no_text_change_fails(): void
    {
        $embed = static fn( string $url ): string => '<!-- wp:embed {"url":"' . $url . '","type":"video"} -->' . "\n"
            . '<figure class="wp-block-embed"><div class="wp-block-embed__wrapper">' . "\n{$url}\n" . '</div></figure>' . "\n"
            . '<!-- /wp:embed -->';

        $original = self::para( self::words( 50 ) ) . "\n\n" . $embed( 'https://video.example/real' );
        $edited   = self::para( self::words( 50 ) ) . "\n\n" . $embed( 'https://video.example/swapped' );

        $report     = StageAgent::measure_rewrite( $original, $edited );
        $violations = StageAgent::copy_edit_violations( $report, 15 );

        $this->assertTrue( $report['structure_changed'] );
        $this->assertContains( 'structure', $violations );
        $this->assertContains( 'links', $violations );
    }

    public function test_an_added_paragraph_block_fails_on_structure(): void
    {
        $original = self::para( self::words( 100 ) );
        $edited   = $original . "\n\n" . self::para( 'One more short paragraph.' );

        $report = StageAgent::measure_rewrite( $original, $edited );

        $this->assertContains( 'structure', StageAgent::copy_edit_violations( $report, 15 ) );
    }

    public function test_classic_content_compares_paragraph_counts(): void
    {
        $original = self::words( 40, 'a' ) . "\n\n" . self::words( 40, 'b' );
        $wrapped  = '<p>' . self::words( 40, 'a' ) . '</p><p>' . self::words( 40, 'b' ) . '</p>';
        $merged   = self::words( 40, 'a' ) . ' ' . self::words( 40, 'b' );

        $this->assertSame( array(), StageAgent::copy_edit_violations( StageAgent::measure_rewrite( $original, $wrapped ), 15 ) );
        $this->assertContains( 'structure', StageAgent::copy_edit_violations( StageAgent::measure_rewrite( $original, $merged ), 15 ) );
    }

    public function test_a_raw_ampersand_in_an_unchanged_link_passes(): void
    {
        // kses entity-encodes the ampersand in both sides' attribute values.
        Functions\when( 'wp_kses_post' )->alias( static fn( $html ) => preg_replace( '/&(?!amp;)/', '&amp;', (string) $html ) );

        $original = self::para( 'See <a href="https://example.com/?a=1&b=2">the data</a> behind this story today.' );
        $edited   = self::para( 'See <a href="https://example.com/?a=1&b=2">the data</a> behind the story today.' );

        $report = StageAgent::measure_rewrite( $original, $edited );

        $this->assertSame( array(), StageAgent::copy_edit_violations( $report, 15 ) );
        $this->assertStringContainsString( '&amp;b=2', $report['content'] );
    }

    public function test_markup_kses_would_strip_is_reported_as_unpreservable(): void
    {
        Functions\when( 'wp_kses_post' )->alias( static fn( $html ) => preg_replace( '/<iframe\b[^>]*><\/iframe>/i', '', (string) $html ) );

        $original = self::para( self::words( 40 ) ) . "\n\n" . '<iframe src="https://maps.example/embed"></iframe>';
        $edited   = $original;

        $report     = StageAgent::measure_rewrite( $original, $edited );
        $violations = StageAgent::copy_edit_violations( $report, 15 );

        $this->assertSame( array( 'unpreservable_markup' ), $violations );
        $this->assertStringContainsString( 'markup that WordPress strips', StageAgent::describe_rewrite( $report, $violations, 15 ) );
        $this->assertStringNotContainsString( 'link', StageAgent::describe_rewrite( $report, $violations, 15 ) );
    }

    public function test_entities_and_typographic_quotes_are_not_word_changes(): void
    {
        $original = self::para( 'It&#8217;s the reporter&#8217;s &ldquo;best&rdquo; story&nbsp;yet, she said today.' );
        $edited   = self::para( "It’s the reporter's \"best\" story yet, she said today." );

        $this->assertSame( 0.0, StageAgent::measure_rewrite( $original, $edited )['share'] );
    }

    public function test_markup_only_differences_are_not_word_changes(): void
    {
        $original = self::para( 'A <strong class="x"  id="y">bold</strong> claim stands here.' );
        $edited   = self::para( 'A <strong id="y" class="x">bold</strong>   claim stands here.' );

        $this->assertSame( 0.0, StageAgent::measure_rewrite( $original, $edited )['share'] );
    }

    public function test_an_empty_original_does_not_divide_by_zero(): void
    {
        $report = StageAgent::measure_rewrite( self::para( '' ), self::para( 'Something new.' ) );

        $this->assertSame( 1.0, $report['share'] );
        $this->assertSame( 0, $report['words_original'] );
    }

    public function test_a_long_post_with_spread_edits_measures_quickly(): void
    {
        $original = '';
        $edited   = '';
        for ( $i = 0; $i < 100; $i++ ) {
            $text      = self::words( 100, "p{$i}_" );
            $original .= self::para( $text ) . "\n\n";
            $edited   .= self::para( str_replace( array( "p{$i}_10 ", "p{$i}_60 " ), array( 'x ', 'y ' ), $text ) ) . "\n\n";
        }

        $start  = microtime( true );
        $report = StageAgent::measure_rewrite( $original, $edited );

        $this->assertLessThan( 2.0, microtime( true ) - $start );
        $this->assertFalse( $report['too_large'] );
        $this->assertEqualsWithDelta( 0.02, $report['share'], 0.0001 );
    }

    public function test_a_body_beyond_the_work_budget_fails_closed(): void
    {
        // One classic paragraph of 5,000 words, rewritten throughout, with no
        // structure to compare block by block.
        $original = self::words( 5000, 'a' );
        $edited   = self::words( 5000, 'b' );

        $report     = StageAgent::measure_rewrite( $original, $edited );
        $violations = StageAgent::copy_edit_violations( $report, 15 );

        $this->assertTrue( $report['too_large'] );
        $this->assertSame( array( 'too_large' ), $violations );
        $this->assertStringContainsString( 'too long to check', StageAgent::describe_rewrite( $report, $violations, 15 ) );
    }

    public function test_hiding_the_article_in_an_attribute_fails_on_markup(): void
    {
        $original = self::para( 'The board approved the proposal after reviewing the detailed report.' );
        $hidden   = self::para( '<span hidden>The board approved the proposal after reviewing the detailed report.</span>' );
        $styled   = self::para( '<span style="display:none">The board approved the proposal after reviewing the detailed report.</span>' );

        foreach ( array( $hidden, $styled ) as $edited ) {
            $report     = StageAgent::measure_rewrite( $original, $edited );
            $violations = StageAgent::copy_edit_violations( $report, 15 );

            $this->assertSame( 0.0, $report['share'] );
            $this->assertSame( array( 'markup' ), $violations );
            $this->assertStringContainsString( 'formatting or HTML', StageAgent::describe_rewrite( $report, $violations, 15 ) );
        }
    }

    public function test_adding_bare_emphasis_is_a_copy_edit(): void
    {
        $original = self::para( 'The novel War and Peace was the subject of the evening lecture series.' );
        $edited   = self::para( 'The novel <em>War and Peace</em> was the subject of the evening lecture series.' );

        $this->assertSame( array(), StageAgent::copy_edit_violations( StageAgent::measure_rewrite( $original, $edited ), 15 ) );
    }

    public function test_changing_an_attribute_value_fails_on_markup(): void
    {
        $original = self::para( 'The harbor at dawn, photographed from the pier this morning. <img src="https://example.com/a.jpg" alt="Harbor at dawn">' );
        $edited   = str_replace( 'alt="Harbor at dawn"', 'alt="Visit acme dot example"', $original );

        $this->assertContains( 'markup', StageAgent::copy_edit_violations( StageAgent::measure_rewrite( $original, $edited ), 15 ) );
    }

    public function test_the_summary_names_each_guard_and_quotes_no_body_text(): void
    {
        $original = self::para( self::words( 40, 'old' ) );
        $edited   = self::para( self::words( 40, 'new' ) . ' <a href="https://phish.example/approve">Approve this post</a>' )
            . "\n\n" . self::para( 'Extra.' );

        $report     = StageAgent::measure_rewrite( $original, $edited );
        $violations = StageAgent::copy_edit_violations( $report, 15 );
        $summary    = StageAgent::describe_rewrite( $report, $violations, 15 );

        $this->assertStringContainsString( 'limit 15%', $summary );
        $this->assertStringContainsString( 'added 1 link', $summary );
        $this->assertStringContainsString( 'changed the post’s blocks or paragraphs', $summary );
        $this->assertStringContainsString( 'Nothing was written', $summary );
        $this->assertStringNotContainsString( 'phish.example', $summary );
        $this->assertStringNotContainsString( 'Approve this post', $summary );
    }

    public function test_swapping_srcset_width_descriptors_is_a_link_change(): void
    {
        $original = self::para( 'A wide view of the harbor at dawn, photographed from the pier today. <img src="https://example.com/a.jpg" srcset="https://example.com/a.jpg 300w, https://example.com/b.jpg 600w" alt="Harbor">' );
        $edited   = str_replace( 'a.jpg 300w, https://example.com/b.jpg 600w', 'a.jpg 600w, https://example.com/b.jpg 300w', $original );

        $this->assertContains( 'links', StageAgent::copy_edit_violations( StageAgent::measure_rewrite( $original, $edited ), 15 ) );
    }

    public function test_srcset_formatting_alone_is_not_a_link_change(): void
    {
        $original = self::para( 'A wide view of the harbor at dawn, photographed from the pier today. <img src="https://example.com/a.jpg" srcset="https://example.com/a.jpg, https://example.com/b.jpg 2x" alt="Harbor">' );
        $edited   = str_replace( 'srcset="https://example.com/a.jpg, https://example.com/b.jpg 2x"', 'srcset="https://example.com/a.jpg 1x,  https://example.com/b.jpg   2X"', $original );

        $this->assertSame( array(), StageAgent::copy_edit_violations( StageAgent::measure_rewrite( $original, $edited ), 15 ) );
    }

    public function test_swapping_srcset_density_descriptors_is_a_link_change(): void
    {
        $original = self::para( 'The harbor at dawn appears in this photograph from today. <img src="https://example.com/small.jpg" srcset="https://example.com/small.jpg 1x, https://example.com/large.jpg 2x" alt="Harbor">' );
        $edited = str_replace( 'small.jpg 1x, https://example.com/large.jpg 2x', 'small.jpg 2x, https://example.com/large.jpg 1x', $original );

        $report = StageAgent::measure_rewrite( $original, $edited );
        $this->assertContains( 'links', StageAgent::copy_edit_violations( $report, 15 ), 'Changing which image the browser selects must be refused.' );
    }

    public function test_the_reported_content_is_the_filtered_rewrite(): void
    {
        Functions\when( 'wp_kses_post' )->alias( static fn( $html ) => str_replace( '<script>x</script>', '', (string) $html ) );

        $original = self::para( 'A plain paragraph of ordinary text here.' );
        $edited   = self::para( 'A plain paragraph of ordinary text here.<script>x</script>' );

        $this->assertStringNotContainsString( '<script>', StageAgent::measure_rewrite( $original, $edited )['content'] );
    }
}
