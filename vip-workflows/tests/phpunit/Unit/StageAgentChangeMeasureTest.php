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

    public function test_the_minimum_block_length_is_a_parameter(): void
    {
        $original = self::para( 'One two three four five six seven eight nine ten.' ) . "\n\n" . self::para( self::words( 300 ) );
        $edited   = self::para( 'Alpha beta gamma delta epsilon zeta eta theta iota kappa.' ) . "\n\n" . self::para( self::words( 300 ) );

        $report = StageAgent::measure_rewrite( $original, $edited );

        $this->assertContains( 'block_share', StageAgent::copy_edit_violations( $report, 15 ) );
        $this->assertNotContains( 'block_share', StageAgent::copy_edit_violations( $report, 15, 50, 12 ) );
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

    public function test_a_short_block_that_grows_is_measured(): void
    {
        $original = self::para( 'Breaking news' ) . "\n\n" . self::para( self::words( 300 ) );
        $edited   = self::para( 'Breaking news. ' . self::words( 30, 'promo' ) ) . "\n\n" . self::para( self::words( 300 ) );

        $report     = StageAgent::measure_rewrite( $original, $edited );
        $violations = StageAgent::copy_edit_violations( $report, 15 );

        $this->assertLessThan( 0.15, $report['share'], 'The whole-body share alone would let this through.' );
        $this->assertContains( 'block_share', $violations );
    }

    public function test_the_printed_share_is_never_at_or_below_the_printed_limit(): void
    {
        // 154 of 1,000 words changed: 15.4% against a 15% limit.
        $original = self::para( self::words( 1000 ) );
        $edited   = self::para( self::words( 846 ) . ' ' . self::words( 154, 'new' ) );

        $report     = StageAgent::measure_rewrite( $original, $edited );
        $violations = StageAgent::copy_edit_violations( $report, 15 );

        $this->assertEqualsWithDelta( 0.154, $report['share'], 0.0001 );
        $this->assertStringContainsString( 'changed 16% of the words (limit 15%)', StageAgent::describe_rewrite( $report, $violations, 15 ) );
    }

    public function test_markup_kses_strips_from_the_original_is_unpreservable(): void
    {
        // kses drops <script> elements and leaves their text behind.
        Functions\when( 'wp_kses_post' )->alias( static fn( $html ) => preg_replace( '/<\/?script\b[^>]*>/i', '', (string) $html ) );

        $original = self::para( self::words( 40 ) . ' <script>trackReader()</script>' );
        $report   = StageAgent::measure_rewrite( $original, $original );

        $this->assertSame( array( 'unpreservable_markup' ), StageAgent::copy_edit_violations( $report, 15 ) );
    }

    /**
     * @dataProvider free_tag_names
     */
    public function test_extending_an_attributed_free_tag_over_the_article_fails( string $tag ): void
    {
        $original = "<!-- wp:paragraph --><p><{$tag} hidden>Internal note.</{$tag}> The board approved the proposal after reviewing the detailed report.</p><!-- /wp:paragraph -->";
        $edited   = "<!-- wp:paragraph --><p><{$tag} hidden>Internal note. The board approved the proposal after reviewing the detailed report.</{$tag}></p><!-- /wp:paragraph -->";

        $report = StageAgent::measure_rewrite( $original, $edited );

        $this->assertNotSame( array(), StageAgent::copy_edit_violations( $report, 15 ), (string) wp_json_encode( $report ) );
        $this->assertGreaterThan( 1.0, $report['share'] );
    }

    /**
     * @return array<string, array{string}>
     */
    public static function free_tag_names(): array
    {
        return array(
            'strong' => array( 'strong' ),
            'em'     => array( 'em' ),
            'i'      => array( 'i' ),
            'b'      => array( 'b' ),
            'p'      => array( 'p' ),
        );
    }

    public function test_a_bare_tag_nested_in_an_attributed_one_does_not_hide_the_move(): void
    {
        $original = '<!-- wp:paragraph --><p><strong hidden><em>Internal</em> note.</strong> The board approved the proposal after reviewing the detailed report.</p><!-- /wp:paragraph -->';
        $edited   = '<!-- wp:paragraph --><p><strong hidden><em>Internal</em> note. The board approved the proposal after reviewing the detailed report.</strong></p><!-- /wp:paragraph -->';

        $this->assertNotSame( array(), StageAgent::copy_edit_violations( StageAgent::measure_rewrite( $original, $edited ), 15 ) );
    }

    public function test_an_edit_exactly_at_the_limit_passes_and_one_word_over_fails(): void
    {
        $words  = array_map( static fn( int $i ): string => 'word' . $i, range( 1, 100 ) );
        $before = '<p>' . implode( ' ', $words ) . '</p>';
        for ( $i = 0; $i < 7; $i++ ) {
            $words[ $i ] = 'replacement' . $i;
        }
        $at_limit = '<p>' . implode( ' ', $words ) . '</p>';
        $words[7] = 'replacement7';
        $over     = '<p>' . implode( ' ', $words ) . '</p>';

        $this->assertSame( array(), StageAgent::copy_edit_violations( StageAgent::measure_rewrite( $before, $at_limit ), 7 ) );

        $report     = StageAgent::measure_rewrite( $before, $over );
        $violations = StageAgent::copy_edit_violations( $report, 7 );
        $this->assertSame( array( 'share' ), $violations );
        $this->assertStringContainsString( 'changed 8% of the words (limit 7%)', StageAgent::describe_rewrite( $report, $violations, 7 ) );
    }

    public function test_reordering_url_attributes_inside_one_tag_is_not_a_link_change(): void
    {
        $original = '<!-- wp:html --><video src="https://example.com/a.mp4" poster="https://example.com/a.jpg"></video><!-- /wp:html -->';
        $edited   = '<!-- wp:html --><video poster="https://example.com/a.jpg" src="https://example.com/a.mp4"></video><!-- /wp:html -->';

        $report = StageAgent::measure_rewrite( $original, $edited );

        $this->assertSame( 0, $report['links_added'] );
        $this->assertSame( array(), StageAgent::copy_edit_violations( $report, 15 ) );
    }

    public function test_a_url_inside_an_ordinary_attribute_is_not_a_link(): void
    {
        $body = '<!-- wp:paragraph --><p><span title="example href=&quot;https://example.com/a&quot;">The board approved the detailed proposal at the meeting today.</span></p><!-- /wp:paragraph -->';

        $this->assertSame( array(), StageAgent::copy_edit_violations( StageAgent::measure_rewrite( $body, $body ), 15 ) );
    }

    public function test_a_long_identical_run_is_trimmed_in_linear_time(): void
    {
        $body = str_repeat( 'word ', 100000 );

        $start  = microtime( true );
        $report = StageAgent::measure_rewrite( $body, $body );

        // The quadratic trim this guards against took minutes; 10 seconds still
        // catches it without failing on a loaded CI runner.
        $this->assertLessThan( 10.0, microtime( true ) - $start, 'A common prefix must be trimmed in linear time.' );
        $this->assertSame( 0.0, $report['share'] );
        $this->assertSame( 100000, $report['words_original'] );
        $this->assertSame( array(), StageAgent::copy_edit_violations( $report, 15 ) );
    }

    public function test_the_summary_names_each_guard_and_quotes_no_body_text(): void
    {
        $original = self::para( self::words( 40, 'old' ) );
        $edited   = self::para( self::words( 40, 'new' ) . ' <a href="https://phish.example/approve">Approve this post</a>' )
            . "\n\n" . self::para( 'Extra.' );

        $report     = StageAgent::measure_rewrite( $original, $edited );
        $violations = StageAgent::copy_edit_violations( $report, 15 );
        $summary    = StageAgent::describe_rewrite( $report, $violations, 15 );

        // The structure changed, so the edit is refused without computing a share.
        $this->assertNull( $report['share'] );
        $this->assertStringNotContainsString( 'limit 15%', $summary );
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

    public function test_extending_an_existing_hidden_span_over_the_article_fails(): void
    {
        $original = self::para( '<span hidden>Internal note.</span> The board approved the proposal after reviewing the detailed report.' );
        $edited = self::para( '<span hidden>Internal note. The board approved the proposal after reviewing the detailed report.</span>' );

        // The tags are identical; the text moved across a tag boundary. Words
        // are compared run by run, so every moved word counts as changed.
        $report     = StageAgent::measure_rewrite( $original, $edited );
        $violations = StageAgent::copy_edit_violations( $report, 15 );
        $this->assertGreaterThan( 1.0, $report['share'] );
        $this->assertContains( 'share', $violations, 'Moving a closing tag must not let an existing hidden element swallow the article.' );
    }

    public function test_attribute_value_cannot_impersonate_a_hidden_attribute_in_the_skeleton(): void
    {
        $original = self::para( '<span class="x,hidden=">The board approved the proposal after reviewing the detailed report.</span>' );
        $edited = self::para( '<span class="x" hidden>The board approved the proposal after reviewing the detailed report.</span>' );

        $report = StageAgent::measure_rewrite( $original, $edited );
        $this->assertSame( 0.0, $report['share'] );
        $this->assertContains( 'markup', StageAgent::copy_edit_violations( $report, 15 ), 'Attribute values and separate attributes must have distinct representations.' );
    }

    public function test_the_reported_content_is_the_filtered_rewrite(): void
    {
        Functions\when( 'wp_kses_post' )->alias( static fn( $html ) => str_replace( '<script>x</script>', '', (string) $html ) );

        $original = self::para( 'A plain paragraph of ordinary text here.' );
        $edited   = self::para( 'A plain paragraph of ordinary text here.<script>x</script>' );

        $this->assertStringNotContainsString( '<script>', StageAgent::measure_rewrite( $original, $edited )['content'] );
    }

    /**
     * Edits to shortcode-shaped tokens whose tags aren't registered, which is
     * every tag here: the unit environment registers none, as on a cron run
     * before a theme's front-end hooks.
     *
     * @return array<string, array{0: string, 1: string}>
     */
    public function provide_unregistered_shortcode_changes(): array
    {
        $first  = 'The board approved the proposal after reviewing the detailed report.';
        $second = 'The vote was unanimous and the plan takes effect next month.';
        $third  = 'Members will meet again in the spring to review progress.';

        return array(
            'an attribute edited'                => array(
                self::para( $first ) . self::para( '[promo_box id="7"] ' . $second ),
                self::para( $first ) . self::para( '[promo_box id="8"] ' . $second ),
            ),
            'a hyphenated name added'            => array(
                self::para( $first ) . self::para( $second ),
                self::para( $first ) . self::para( $second . ' [newsletter-signup]' ),
            ),
            'an underscored name added'          => array(
                self::para( $first ) . self::para( $second ),
                self::para( $first ) . self::para( $second . ' [my_widget]' ),
            ),
            'an enclosing pair removed'          => array(
                self::para( $first ) . self::para( '[pullquote]' . $second . '[/pullquote]' ),
                self::para( $first ) . self::para( $second ),
            ),
            'a token moved to another paragraph' => array(
                self::para( $first ) . self::para( '[promo_box id="7"] ' . $second ) . self::para( $third ),
                self::para( $first ) . self::para( $second ) . self::para( '[promo_box id="7"] ' . $third ),
            ),
            'a self-closing token added'         => array(
                self::para( $first ) . self::para( $second ),
                self::para( $first ) . self::para( $second . ' [divider /]' ),
            ),
            'a shortcode nested in a pair added' => array(
                self::para( '[pullquote]' . $first . '[/pullquote]' ),
                self::para( '[pullquote]' . $first . ' [promo_box id="7"][/pullquote]' ),
            ),
            'a hyphenated pair removed'          => array(
                self::para( $first ) . self::para( '[pull-quote]' . $second . '[/pull-quote]' ),
                self::para( $first ) . self::para( $second ),
            ),
            'an underscored pair removed'        => array(
                self::para( $first ) . self::para( '[my_box]' . $second . '[/my_box]' ),
                self::para( $first ) . self::para( $second ),
            ),
            'an attributed pair removed'         => array(
                self::para( $first ) . self::para( '[promo_box id="7"]' . $second . '[/promo_box]' ),
                self::para( $first ) . self::para( $second ),
            ),
            'a hyphenated pair\'s closer removed' => array(
                self::para( $first ) . self::para( '[pull-quote]' . $second . '[/pull-quote]' ),
                self::para( $first ) . self::para( '[pull-quote]' . $second ),
            ),
            'a stray hyphenated closer added'    => array(
                self::para( $first ) . self::para( $second ),
                self::para( $first ) . self::para( $second . ' [/pull-quote]' ),
            ),
            'a stray underscored closer added'   => array(
                self::para( $first ) . self::para( $second ),
                self::para( $first ) . self::para( $second . ' [/my_box]' ),
            ),
        );
    }

    /**
     * @dataProvider provide_unregistered_shortcode_changes
     *
     * @param string $before Original content.
     * @param string $after  Edited content.
     */
    public function test_an_unregistered_shortcode_change_is_refused( string $before, string $after ): void
    {
        $this->assertEmpty( $GLOBALS['shortcode_tags'] ?? array(), 'No tag may be registered here.' );

        $report     = StageAgent::measure_rewrite( $before, $after );
        $violations = StageAgent::copy_edit_violations( $report, 15 );

        $this->assertTrue( $report['controls_changed'] );
        $this->assertContains( 'controls', $violations );
        $this->assertStringContainsString( 'page break, More tag or shortcode', StageAgent::describe_rewrite( $report, $violations, 15 ) );
    }

    /**
     * Bracketed text that doesn't look like a shortcode.
     *
     * @return array<string, array{0: string, 1: string}>
     */
    public function provide_bracketed_prose(): array
    {
        return array(
            '[sic] removed'               => array(
                self::para( 'The mayor said the budget was "to large [sic] to pass" this year.' ),
                self::para( 'The mayor said the budget was "to large to pass" this year.' ),
            ),
            '[1] added'                   => array(
                self::para( 'Turnout was the highest the county has recorded in a decade.' ),
                self::para( 'Turnout was the highest the county has recorded in a decade.[1]' ),
            ),
            '[Ed.] kept, sentence edited' => array(
                self::para( 'The council [Ed.] voted to aprove the new library on Tuesday night.' ),
                self::para( 'The council [Ed.] voted to approve the new library on Tuesday evening.' ),
            ),
            '[citation needed] added'     => array(
                self::para( 'Most residents support the new library plan in the survey.' ),
                self::para( 'Most residents support the new library plan [citation needed] in the survey.' ),
            ),
            '[Update: 3pm] added'         => array(
                self::para( 'The road reopened after crews cleared the fallen tree this afternoon.' ),
                self::para( '[Update: 3pm] The road reopened after crews cleared the fallen tree this afternoon.' ),
            ),
            'a stray [/sic] added'        => array(
                self::para( 'The mayor said the budget was too large to pass this year.' ),
                self::para( 'The mayor said the budget was too large to pass [/sic] this year.' ),
            ),
            'an escaped shortcode added'  => array(
                self::para( 'Type the tag below to add a promotion box to any post.' ),
                self::para( 'Type the tag [[promo_box id="7"]] to add a promotion box to any post.' ),
            ),
            'an escaped pair added'       => array(
                self::para( 'Wrap a quote in the tags to set it apart from the text.' ),
                self::para( 'Wrap a quote in [[pullquote]a [my_widget] quote[/pullquote]] to set it apart.' ),
            ),
        );
    }

    /**
     * @dataProvider provide_bracketed_prose
     *
     * @param string $before Original content.
     * @param string $after  Edited content.
     */
    public function test_bracketed_prose_is_text( string $before, string $after ): void
    {
        $report = StageAgent::measure_rewrite( $before, $after );

        $this->assertFalse( $report['controls_changed'] );
        $this->assertNotContains( 'controls', StageAgent::copy_edit_violations( $report, 15 ) );
    }

    public function test_a_copy_edit_beside_an_unchanged_unregistered_shortcode_passes(): void
    {
        $before = self::para( 'The board aproved the proposal after reviewing the detailed report from the committee.' ) . self::para( '[promo_box id="7"]' );
        $after  = self::para( 'The board approved the proposal after reviewing the detailed report from the committee.' ) . self::para( '[promo_box id="7"]' );

        $report = StageAgent::measure_rewrite( $before, $after );

        $this->assertFalse( $report['controls_changed'] );
        $this->assertSame( array(), StageAgent::copy_edit_violations( $report, 15 ) );
    }

    public function test_each_nested_same_name_pair_keeps_its_own_closer(): void
    {
        $body = self::para( 'The board approved the proposal after reviewing the detailed report from the committee.' );

        $report = StageAgent::measure_rewrite( $body . '[box][box]Text[/box][/box]', $body . '[box][box]Text[/box]' );

        $this->assertTrue( $report['controls_changed'] );
    }

    /**
     * @return array<string, array{0: string}>
     */
    public function provide_hyphenated_and_underscored_names(): array
    {
        return array(
            'hyphenated'  => array( 'pull-quote' ),
            'underscored' => array( 'my_box' ),
        );
    }

    /**
     * An opener whose name has `_` or `-` is counted as soon as it is seen,
     * unlike a bare name, which waits for its closer. Pairing it must still
     * record each opener once, in document order, and give each nested
     * opener its own closer.
     *
     * @dataProvider provide_hyphenated_and_underscored_names
     */
    public function test_a_counted_opener_pairs_with_its_closer_once( string $name ): void
    {
        $controls = new \ReflectionMethod( StageAgent::class, 'controls' );
        $open     = '[' . $name . ']';
        $close    = '[/' . $name . ']';
        $content  = $open . $open . 'Text' . $close . $close;

        $found = $controls->invoke( null, $content );

        $this->assertSame(
            array( 0, strlen( $open ), 2 * strlen( $open ) + 4, 2 * strlen( $open ) + 4 + strlen( $close ) ),
            array_column( $found, 'offset' )
        );
        $this->assertSame( array( 'shortcode:' . $open, 'shortcode:' . $open, 'shortcode:' . $close, 'shortcode:' . $close ), array_column( $found, 'label' ) );

        $body = self::para( 'The board approved the proposal after reviewing the detailed report from the committee.' );
        $this->assertTrue( StageAgent::measure_rewrite( $body . $content, $body . $open . $open . 'Text' . $close )['controls_changed'] );
    }

    /**
     * @dataProvider provide_hyphenated_and_underscored_names
     */
    public function test_a_copy_edit_inside_an_unchanged_counted_pair_passes( string $name ): void
    {
        $before = self::para( '[' . $name . ']The board aproved the proposal after reviewing the detailed report from the committee.[/' . $name . ']' );
        $after  = str_replace( 'aproved', 'approved', $before );

        $report = StageAgent::measure_rewrite( $before, $after );

        $this->assertFalse( $report['controls_changed'] );
        $this->assertSame( array(), StageAgent::copy_edit_violations( $report, 15 ) );
    }

    public function test_tokens_inside_an_escaped_pair_are_text(): void
    {
        $body   = self::para( 'The board approved the proposal after reviewing the detailed report from the committee.' );
        $before = $body . self::para( '[[box] [promo_box id=7] [/box]]' );

        $this->assertFalse( StageAgent::measure_rewrite( $before, str_replace( 'id=7', 'id=8', $before ) )['controls_changed'] );
    }

    public function test_a_bare_ampersand_kses_encodes_in_an_unchanged_shortcode_passes(): void
    {
        Functions\when( 'wp_kses_post' )->alias( static fn( $html ) => preg_replace( '/&(?!amp;)/', '&amp;', (string) $html ) );

        $before = self::para( 'The board aproved the proposal after reviewing the detailed report from the committee.' ) . self::para( '[promo title="A & B"]' );
        $after  = str_replace( 'aproved', 'approved', $before );

        $this->assertSame( array(), StageAgent::copy_edit_violations( StageAgent::measure_rewrite( $before, $after ), 15 ) );
    }

    public function test_kses_decoding_a_named_entity_in_a_shortcode_is_unpreservable(): void
    {
        Functions\when( 'wp_kses_post' )->alias( static fn( $html ) => str_replace( '&copy;', '©', (string) $html ) );

        $before = self::para( 'The board aproved the proposal after reviewing the detailed report from the committee.' ) . self::para( '[promo id="&copy;"]' );

        $this->assertTrue( StageAgent::measure_rewrite( $before, str_replace( 'aproved', 'approved', $before ) )['unpreservable_markup'] );
    }

    /**
     * A megabyte of bracket text, escaped pairs or slashes is scanned in
     * linear time and never makes the scan give up. The bound is loose; a
     * per-opener search for a closer took minutes on the same input.
     *
     * @return array<string, array{0: string, 1: int}>
     */
    public function provide_pathological_fragments(): array
    {
        $fill = static fn( string $unit ): string => substr( str_repeat( $unit, (int) ceil( 1048576 / strlen( $unit ) ) ), 0, 1048576 );

        return array(
            'bare openers'      => array( $fill( '[box]' ), 0 ),
            'escaped pairs'     => array( $fill( '[[box]x[/box]]' ), 0 ),
            'unclosed openers'  => array( $fill( '[box a=' ), 0 ),
            'a slash attribute' => array( '[promo id=7][promo title="' . str_repeat( '/', 1048500 ) . '"]', 2 ),
        );
    }

    /**
     * @dataProvider provide_pathological_fragments
     */
    public function test_a_pathological_fragment_is_scanned_quickly( string $content, int $expected ): void
    {
        $controls = new \ReflectionMethod( StageAgent::class, 'controls' );

        $start = microtime( true );
        $found = $controls->invoke( null, $content );

        $this->assertLessThan( 5.0, microtime( true ) - $start );
        $this->assertCount( $expected, $found );
    }
}
