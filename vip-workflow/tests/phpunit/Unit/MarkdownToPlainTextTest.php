<?php
/**
 * Deriving plain text from an AI summary.
 *
 * Summaries are stored as markdown because the admin UI renders them as
 * formatted text, but two consumers must not carry markup: a source's `excerpt`,
 * and the attachment `description` written into the user's media library. Both
 * read this.
 *
 * The failure directions are stripping too little — markup reaches a media
 * library record — and stripping too much, which quietly edits editorial copy.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use VIPWorkflow\Integrations\Markdown;

require_once __DIR__ . '/../../../includes/integrations/class-markdown.php';

class MarkdownToPlainTextTest extends TestCase
{
    public function test_it_strips_the_reported_summary_to_clean_prose(): void
    {
        $markdown = "## Summary: History of the National Park Service\n\n"
            . "This article traces the evolution of the system.\n\n"
            . "- **63 National Parks** – the flagship designation\n"
            . '- **National Monuments** – protecting historic sites';

        $plain = Markdown::to_plain_text( $markdown );

        $this->assertStringNotContainsString( '#', $plain );
        $this->assertStringNotContainsString( '**', $plain );
        $this->assertStringContainsString( 'Summary: History of the National Park Service', $plain );
        $this->assertStringContainsString( '63 National Parks', $plain );
    }

    /**
     * Bullets keep their hyphen. A list stripped of markers reads as one run-on
     * sentence, which was half of what the original bug looked like.
     */
    public function test_bullets_keep_their_marker_and_their_lines(): void
    {
        $plain = Markdown::to_plain_text( "- one\n- two" );

        $this->assertSame( "- one\n- two", $plain );
    }

    public function test_other_bullet_markers_normalise_to_hyphens(): void
    {
        $this->assertSame( "- one\n- two\n- three", Markdown::to_plain_text( "* one\n+ two\n• three" ) );
    }

    /**
     * Links keep their label and lose their target: the label is the readable
     * part, and a bare URL in an attachment description is noise.
     */
    public function test_links_reduce_to_their_label(): void
    {
        $this->assertSame(
            'See the trail guide for details.',
            Markdown::to_plain_text( 'See the [trail guide](https://example.test/guide) for details.' )
        );
        $this->assertSame( 'https://example.test/x', Markdown::to_plain_text( '<https://example.test/x>' ) );
    }

    /**
     * The ordering trap the Tavily provider fell into: run the link rule first
     * and an image leaves a stray `!` behind.
     */
    public function test_images_do_not_leave_a_stray_bang(): void
    {
        $this->assertSame( 'WildPathsAZ logo', Markdown::to_plain_text( '![WildPathsAZ logo](https://example.test/l.png)' ) );
        $this->assertStringNotContainsString( '!', Markdown::to_plain_text( '![logo](https://example.test/l.png)' ) );
        $this->assertSame( '', Markdown::to_plain_text( '![](https://example.test/l.png)' ) );
    }

    public function test_structural_lines_carrying_no_text_are_dropped(): void
    {
        $this->assertSame( "One.\n\nTwo.", Markdown::to_plain_text( "One.\n\n---\n\nTwo." ) );
    }

    public function test_block_quotes_keep_their_text(): void
    {
        $this->assertSame( 'A quoted claim.', Markdown::to_plain_text( '> A quoted claim.' ) );
    }

    public function test_tables_keep_their_cells_and_drop_the_divider(): void
    {
        $plain = Markdown::to_plain_text( "| Park | Year |\n| --- | --- |\n| Yosemite | 1890 |" );

        $this->assertSame( "Park | Year\nYosemite | 1890", $plain );
    }

    public function test_code_fences_keep_the_code(): void
    {
        $this->assertSame( 'echo 1;', Markdown::to_plain_text( "```php\necho 1;\n```" ) );
    }

    public function test_strikethrough_text_is_kept(): void
    {
        $this->assertSame( 'withdrawn claim', Markdown::to_plain_text( '~~withdrawn claim~~' ) );
    }

    public function test_numbered_lists_keep_their_numbers(): void
    {
        $this->assertSame( "1. one\n2. two", Markdown::to_plain_text( "1. one\n2. two" ) );
    }

    /**
     * The strip-too-much direction. Editorial copy legitimately contains these.
     */
    public function test_it_leaves_ordinary_punctuation_alone(): void
    {
        $cases = array(
            'Press * to continue.',
            '3 * 4 = 12',
            'The variable is called max_length in the config.',
            'Snake_case_identifiers_stay whole.',
            'A lone _ and a lone * survive.',
        );

        foreach ( $cases as $case ) {
            $this->assertSame( $case, Markdown::to_plain_text( $case ), $case );
        }
    }

    public function test_it_strips_emphasis_and_inline_code(): void
    {
        $this->assertSame( 'bold and italic and code', Markdown::to_plain_text( '**bold** and *italic* and `code`' ) );
        $this->assertSame( 'bold and italic', Markdown::to_plain_text( '__bold__ and _italic_' ) );
    }

    /**
     * A `#` that is not a heading marker — a hashtag, a number sign — is content.
     */
    public function test_a_mid_line_hash_is_not_a_heading(): void
    {
        $this->assertSame( 'Issue #42 and the #hashtag stay.', Markdown::to_plain_text( 'Issue #42 and the #hashtag stay.' ) );
    }

    public function test_paragraph_breaks_survive_and_extra_blank_lines_collapse(): void
    {
        $this->assertSame( "One.\n\nTwo.", Markdown::to_plain_text( "One.\n\n\n\nTwo." ) );
    }

    public function test_crlf_input_does_not_leave_carriage_returns(): void
    {
        $this->assertStringNotContainsString( "\r", Markdown::to_plain_text( "One.\r\n\r\nTwo.\r" ) );
    }

    public function test_blank_input_yields_an_empty_string(): void
    {
        $this->assertSame( '', Markdown::to_plain_text( '' ) );
        $this->assertSame( '', Markdown::to_plain_text( "  \n \n" ) );
    }

    /**
     * The collapsing variant, for one-line fields. Bullet markers go too: a list
     * flattened onto one line reads as stray hyphens rather than as a list.
     */
    public function test_to_single_line_collapses_structure_and_markers(): void
    {
        $this->assertSame(
            'Designations: 63 National Parks National Monuments',
            Markdown::to_single_line( "## Designations:\n\n- **63 National Parks**\n- National Monuments" )
        );
    }

    public function test_to_single_line_keeps_hyphens_that_are_not_markers(): void
    {
        // A dash inside a sentence is punctuation, not a list marker.
        $this->assertSame(
            'A well-known route - and a hard one.',
            Markdown::to_single_line( 'A well-known route - and a hard one.' )
        );
    }

    public function test_to_single_line_of_blank_input_is_empty(): void
    {
        $this->assertSame( '', Markdown::to_single_line( "  \n " ) );
    }
}
