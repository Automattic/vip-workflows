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
     * The patterns stay within PCRE's limits on a long post: many blocks, a
     * quoted attribute and block delimiters on each, counted right with no
     * PCRE error. Checked by error, not by wall clock, so it holds under
     * coverage instrumentation too.
     */
    public function test_large_content_is_counted_without_hitting_a_pcre_limit(): void
    {
        $content = str_repeat( "<!-- wp:paragraph -->\n<p class=\"note\" data-x=\"a>b\">" . str_repeat( 'word ', 30 ) . "</p>\n<!-- /wp:paragraph -->\n\n", 1000 );
        $this->assertGreaterThan( 200000, strlen( $content ) );

        $this->assertSame( 1000, count_paragraphs( $content ) );
        $this->assertSame( PREG_NO_ERROR, preg_last_error() );
    }

    /**
     * Run a callback with PCRE's JIT off and its backtrack limit at 1, so the
     * counting patterns fail the way a pathological post would make them.
     *
     * @param callable $callback Work to run.
     * @return mixed What the callback returned.
     */
    private function with_pcre_exhausted( callable $callback )
    {
        $jit       = ini_get( 'pcre.jit' );
        $backtrack = ini_get( 'pcre.backtrack_limit' );
        $log       = ini_get( 'error_log' );
        ini_set( 'pcre.jit', '0' );
        ini_set( 'pcre.backtrack_limit', '1' );
        ini_set( 'error_log', '/dev/null' );

        try {
            return $callback();
        } finally {
            ini_set( 'pcre.jit', (string) $jit );
            ini_set( 'pcre.backtrack_limit', (string) $backtrack );
            ini_set( 'error_log', (string) $log );
        }
    }

    /**
     * A count PCRE could not finish is unknown, not zero.
     */
    public function test_a_pcre_failure_leaves_the_count_unknown(): void
    {
        $count = $this->with_pcre_exhausted(
            fn() => count_paragraphs( '<!-- wp:paragraph --><p>One.</p><!-- /wp:paragraph -->' )
        );

        $this->assertNull( $count );
    }

    /**
     * An unknown count is reported as the check failing to run, with error
     * severity so the gate cannot read it as a pass, and never as "0 prose
     * blocks".
     */
    public function test_a_pcre_failure_emits_an_error_issue_rather_than_a_false_zero(): void
    {
        $this->with_options( array( 'min_paragraphs' => 3 ) );
        // The test double for wp_strip_all_tags() uses PCRE itself; with PCRE
        // exhausted it would hand strip_tags() a null. Core's does not matter
        // here, so a PCRE-free stand-in keeps the rest of the check quiet.
        Functions\when( 'wp_strip_all_tags' )->alias( static fn( $text ) => strip_tags( (string) $text ) );

        $result = $this->with_pcre_exhausted(
            fn() => execute_seo_check(
                array(
                    'title'   => 'A title long enough to pass the title length check',
                    'content' => '<!-- wp:paragraph --><p>One.</p><!-- /wp:paragraph -->',
                )
            )
        );

        $issue = $this->find_issue( $result['issues'], 'min_paragraphs' );
        $this->assertNotNull( $issue );
        $this->assertSame( 'error', $issue['severity'] );
        $this->assertSame( 'Prose blocks could not be counted for this post.', $issue['message'] );
        $this->assertNull( $result['analysis']['paragraph_count'] );
    }

    /**
     * The singular form of the message, with its arguments in the right order.
     */
    public function test_one_prose_block_reads_in_the_singular(): void
    {
        $this->with_options( array( 'min_paragraphs' => 2 ) );

        $result = execute_seo_check(
            array(
                'title'   => 'A title long enough to pass the title length check',
                'content' => '<p>Only one.</p>',
            )
        );

        $this->assertSame( 'Content has 1 prose block. Aim for at least 2.', $this->find_issue( $result['issues'], 'min_paragraphs' )['message'] );
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
