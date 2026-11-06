<?php
/**
 * The SEO check's minimum paragraph count is evaluated.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;

use function VIPWorkflows\Abilities\Tools\count_paragraphs;
use function VIPWorkflows\Abilities\Tools\execute_seo_check;

/**
 * The setting used to persist and do nothing: no issue was ever emitted for
 * it, so its Soft/Hard control had nothing to classify either. The issue now
 * carries `check_key` `min_paragraphs`, the key StatusManager matches against
 * the setting's check mode.
 */
class SeoCheckParagraphCountTest extends TestCase
{
    protected function set_up(): void
    {
        parent::set_up();

        require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/seo-check.php';

        Functions\when( 'home_url' )->justReturn( 'https://example.com' );
        Functions\when( '_n' )->alias(
            static fn( $single, $plural, $number ) => 1 === $number ? $single : $plural
        );
    }

    /**
     * @param array<string, mixed> $options Stored SEO check options.
     */
    private function with_options( array $options ): void
    {
        Functions\when( 'get_option' )->justReturn(
            array( 'vip-workflows/seo-check' => array( 'options' => $options ) )
        );
    }

    /**
     * @return array<string, array{string, int}>
     */
    public static function content_shapes(): array
    {
        return array(
            'block editor paragraphs'            => array(
                "<!-- wp:paragraph -->\n<p>One.</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:paragraph -->\n<p>Two.</p>\n<!-- /wp:paragraph -->",
                2,
            ),
            'empty paragraph blocks are ignored' => array( '<p>One.</p><p></p><p>&nbsp;</p><p> </p>', 1 ),
            'headings and lists are not counted' => array( '<h2>Heading</h2><p>One.</p><ul><li>Item</li></ul>', 1 ),
            'classic content split on blank lines' => array( "First paragraph.\n\nSecond paragraph.\r\n\r\nThird.", 3 ),
            'classic headings are not paragraphs' => array( "<h2>Heading</h2>\n\nOnly paragraph.\n\n<ul><li>Item</li></ul>", 1 ),
            'single line breaks stay one paragraph' => array( "Line one.\nLine two.", 1 ),
            'mixed classic and block content'    => array( "Classic one.\n\nClassic two.\n\n<p>Block one.</p>", 3 ),
            'Gutenberg list only'                => array( "<!-- wp:list -->\n<ul><li>One</li></ul>\n<!-- /wp:list -->", 0 ),
            'Gutenberg heading only'             => array( "<!-- wp:heading -->\n<h2>Heading</h2>\n<!-- /wp:heading -->", 0 ),
            'paragraph only inside a comment'    => array( '<!-- <p>Not shown.</p> -->', 0 ),
            'quoted > in an empty paragraph'     => array( '<p data-note=">">&nbsp;</p>', 0 ),
            'quoted > in a paragraph with text'  => array( '<p data-note=">">Text</p>', 1 ),
            'single-quoted > attribute'          => array( "<p data-note='>'>Text</p>", 1 ),
            'paragraph inside a group'           => array( '<!-- wp:group --><div class="wp-block-group"><!-- wp:paragraph --><p>Inside.</p><!-- /wp:paragraph --></div><!-- /wp:group -->', 1 ),
            'paragraphs inside columns'          => array( '<div class="wp-block-columns"><div class="wp-block-column"><p>Left.</p></div><div class="wp-block-column"><p>Right.</p></div></div>', 2 ),
            'uppercase tags'                     => array( '<P>One.</P><P CLASS="x">Two.</P>', 2 ),
            'text either side of a paragraph'    => array( 'Before.<p>Middle.</p>After.', 3 ),
            'image on its own line'              => array( "<img src=\"a.jpg\" alt=\"\">\n\nOnly paragraph.", 1 ),
        );
    }

    /**
     * @dataProvider content_shapes
     */
    public function test_counts_paragraphs_a_reader_sees( string $content, int $expected ): void
    {
        $this->assertSame( $expected, count_paragraphs( $content ) );
    }

    /**
     * The patterns stay linear: a long post with many paragraphs, a quoted
     * attribute and block delimiters on each is counted quickly and right.
     */
    public function test_large_content_is_counted_quickly(): void
    {
        $content = str_repeat( "<!-- wp:paragraph -->\n<p class=\"note\" data-x=\"a>b\">" . str_repeat( 'word ', 30 ) . "</p>\n<!-- /wp:paragraph -->\n\n", 1000 );
        $this->assertGreaterThan( 200000, strlen( $content ) );

        $started = microtime( true );
        $count   = count_paragraphs( $content );

        $this->assertSame( 1000, $count );
        $this->assertLessThan( 1.0, microtime( true ) - $started );
    }

    public function test_too_few_paragraphs_emits_an_issue_keyed_to_the_setting(): void
    {
        $this->with_options( array( 'min_paragraphs' => 3 ) );

        $result = execute_seo_check(
            array(
                'title'   => 'A title long enough to pass the title length check',
                'content' => '<p>One.</p><p>Two.</p>',
            )
        );

        $issue = $this->find_issue( $result['issues'], 'min_paragraphs' );
        $this->assertNotNull( $issue, 'No issue was emitted for the minimum paragraph count.' );
        $this->assertSame( 'Content has 2 prose blocks. Aim for at least 3.', $issue['message'] );
        $this->assertSame( 2, $result['analysis']['paragraph_count'] );
    }

    public function test_enough_paragraphs_emits_no_issue(): void
    {
        $this->with_options( array( 'min_paragraphs' => 2 ) );

        $result = execute_seo_check(
            array(
                'title'   => 'A title long enough to pass the title length check',
                'content' => '<p>One.</p><p>Two.</p>',
            )
        );

        $this->assertNull( $this->find_issue( $result['issues'], 'min_paragraphs' ) );
    }

    public function test_unset_setting_uses_the_default_the_settings_screen_shows(): void
    {
        $this->with_options( array() );

        $result = execute_seo_check(
            array(
                'title'   => 'A title long enough to pass the title length check',
                'content' => '<p>One.</p><p>Two.</p>',
            )
        );

        $this->assertNotNull( $this->find_issue( $result['issues'], 'min_paragraphs' ) );
    }

    /**
     * @param array<int, array<string, mixed>> $issues Issues from the check.
     * @return array<string, mixed>|null
     */
    private function find_issue( array $issues, string $check_key ): ?array
    {
        foreach ( $issues as $issue ) {
            if ( ( $issue['check_key'] ?? null ) === $check_key ) {
                return $issue;
            }
        }

        return null;
    }
}
