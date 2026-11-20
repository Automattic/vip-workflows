<?php
/**
 * Edge cases for the copy-edit guard's shortcode scan: unusual syntax,
 * placement, escaping across registered and unregistered tags, nesting,
 * kses entity encoding and very long attributes, measured after real
 * WordPress sanitization and with core's shortcodes registered.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Abilities\Agents\StageAgent;

require_once dirname( __DIR__, 3 ) . '/includes/abilities/agents/class-stage-agent.php';

class StageAgentShortcodeEdgeCasesIntegrationTest extends TestCase
{
    private const BODY = '<p>The board aproved the proposal after reviewing the detailed report from the committee.</p>';

    /**
     * @return array<int, array{offset: int, label: string}>
     */
    private static function controls( string $content ): array
    {
        return ( new \ReflectionMethod( StageAgent::class, 'controls' ) )->invoke( null, $content );
    }

    /**
     * @return array<string, array{0: string, 1: string}>
     */
    public function provide_detected_edits(): array
    {
        return array(
            'single-quoted attribute'      => array( "[promo id='7']", "[promo id='8']" ),
            'unquoted attribute'           => array( '[promo id=7]', '[promo id=8]' ),
            'URL attribute'                => array( '[promo url="https://example.org/a/b"]', '[promo url="https://example.org/a/c"]' ),
            'uppercase, digits, newline'   => array( "[Promo2\nid=7]", "[Promo2\nid=8]" ),
            'self-closing with no space'   => array( '[divider/]', '' ),
            'closer in a later paragraph'  => array( '[box]<p>Text</p>[/box]', '<p>Text</p>' ),
            'order beside a registered'    => array( '[promo_box][gallery]', '[gallery][promo_box]' ),
            'moved between paragraphs'     => array( '<p>[promo_box] Text one</p><p>Text two</p>', '<p>Text one</p><p>[promo_box] Text two</p>' ),
            'added between paragraphs'     => array( '<p>Text one</p><p>Text two</p>', '<p>Text one</p>[promo_box]<p>Text two</p>' ),
            'moved past a More tag'        => array( '<p>[promo_box] Text one</p><!--more--><p>Text two</p>', '<p>Text one</p><!--more--><p>[promo_box] Text two</p>' ),
            'moved between blocks'         => array( '<!-- wp:paragraph --><p>[promo_box] Text one</p><!-- /wp:paragraph --><!-- wp:paragraph --><p>Text two</p><!-- /wp:paragraph -->', '<!-- wp:paragraph --><p>Text one</p><!-- /wp:paragraph --><!-- wp:paragraph --><p>[promo_box] Text two</p><!-- /wp:paragraph -->' ),
            'inside an HTML attribute'     => array( '<span title="[promo id=7]">Text</span>', '<span title="[promo id=8]">Text</span>' ),
            'block markup in an attribute' => array( '[promo title="<!-- wp:paragraph -->"]', '[promo title="<!-- wp:heading -->"]' ),
            'inside block JSON'            => array( '<!-- wp:paragraph {"title":"[promo id=7]"} --><p>Text</p><!-- /wp:paragraph -->', '<!-- wp:paragraph {"title":"[promo id=8]"} --><p>Text</p><!-- /wp:paragraph -->' ),
            'incomplete escape'            => array( '[[promo_box]', '[[other_box]' ),
            'extra closing bracket'        => array( '[promo_box]]', '[other_box]]' ),
            'nested outer closer removed'  => array( '[box][box]Text[/box][/box]', '[box][box]Text[/box]' ),
        );
    }

    /**
     * @dataProvider provide_detected_edits
     */
    public function test_an_edge_case_edit_is_detected( string $before, string $after ): void
    {
        $this->assertTrue( StageAgent::measure_rewrite( self::BODY . $before, self::BODY . $after )['controls_changed'] );
    }

    /**
     * @return array<string, array{0: string}>
     */
    public function provide_literal_text(): array
    {
        return array(
            'markdown links'           => array( '[text](url) [text][ref]' ),
            'transcript notes'         => array( '[Laughter] [inaudible] [Updated]' ),
            'editorial brackets'       => array( '[sic] [1] [Ed.] [citation needed] [Update: 3pm]' ),
            'scores, ranges, formulas' => array( '[3-1] [2020-2024] [x = y]' ),
            'escaped self-closing'     => array( '[[promo_box /]]' ),
            'escaped bare'             => array( '[[promo_box]]' ),
            'escaped pair with inside' => array( '[[box] [promo_box] [/box]]' ),
        );
    }

    /**
     * @dataProvider provide_literal_text
     */
    public function test_edge_case_text_stays_text( string $text ): void
    {
        $this->assertFalse( StageAgent::measure_rewrite( self::BODY, self::BODY . $text )['controls_changed'] );
    }

    public function test_an_escaped_registered_pair_hides_the_unregistered_tokens_inside(): void
    {
        $this->assertTrue( shortcode_exists( 'gallery' ) );
        $this->assertSame( array(), self::controls( '[[gallery] [promo_box id=7] [/gallery]]' ) );

        $before = self::BODY . '[[gallery] [promo_box id=7] [/gallery]]';
        $this->assertFalse( StageAgent::measure_rewrite( $before, str_replace( 'id=7', 'id=8', $before ) )['controls_changed'] );
    }

    public function test_a_registered_shortcode_inside_an_escaped_unregistered_pair_counts(): void
    {
        $this->assertTrue( shortcode_exists( 'gallery' ) );
        $this->assertFalse( shortcode_exists( 'foo' ) );
        $this->assertSame(
            array(
                array(
                    'offset' => 12,
                    'label'  => 'shortcode:[gallery ids="1"]',
                ),
            ),
            self::controls( 'Text [[foo] [gallery ids="1"] [/foo]] more' )
        );

        $before = self::BODY . '<p>Text [[foo] [gallery ids="1"] [/foo]] more</p>';
        $report = StageAgent::measure_rewrite( $before, str_replace( 'ids="1"', 'ids="2"', $before ) );

        $this->assertTrue( $report['controls_changed'] );
        $this->assertContains( 'controls', StageAgent::copy_edit_violations( $report, 15 ) );
    }

    public function test_an_escaped_registered_shortcode_is_text(): void
    {
        $this->assertSame( array(), self::controls( 'Text [[gallery ids="1"]] more' ) );

        $before = self::BODY . '<p>Text [[gallery ids="1"]] more</p>';
        $this->assertFalse( StageAgent::measure_rewrite( $before, str_replace( 'ids="1"', 'ids="2"', $before ) )['controls_changed'] );
    }

    public function test_a_long_slash_attribute_does_not_hide_other_shortcodes(): void
    {
        $this->assertCount( 2, self::controls( '[promo id=7][promo title="' . str_repeat( '/', 1048500 ) . '"]' ) );
    }

    public function test_an_edit_beside_a_long_slash_attribute_is_refused(): void
    {
        $before = '<p>The board approved the proposal after reviewing the detailed report from the committee. '
            . '[promo id=7][promo title="' . str_repeat( '/', 10000 ) . '"]</p>';

        $this->assertSame( $before, wp_kses_post( $before ) );
        $report = StageAgent::measure_rewrite( $before, str_replace( 'id=7', 'id=8', $before ) );

        $this->assertFalse( $report['unpreservable_markup'] );
        $this->assertContains( 'controls', StageAgent::copy_edit_violations( $report, 15 ) );
    }

    /**
     * @return array<string, array{0: string}>
     */
    public function provide_kses_attributes(): array
    {
        return array(
            'a bare ampersand' => array( '[promo title="A & B"]' ),
            'inline markup'    => array( '[promo title="<b>x</b>"]' ),
        );
    }

    /**
     * @dataProvider provide_kses_attributes
     */
    public function test_an_unchanged_attribute_kses_encodes_allows_a_copy_edit( string $token ): void
    {
        $before = self::BODY . $token;
        $report = StageAgent::measure_rewrite( $before, str_replace( 'aproved', 'approved', $before ) );

        $this->assertSame( array(), StageAgent::copy_edit_violations( $report, 15 ) );
    }

    /**
     * @return array<string, array{0: string, 1: string[]}>
     */
    public function provide_token_boundaries(): array
    {
        return array(
            'quoted closing bracket'      => array( '[promo title="a]b"]', array( 'shortcode:[promo title="a]' ) ),
            'opening bracket in a value'  => array( '[promo title="[other_box"]', array( 'shortcode:[promo title="[other_box"]' ) ),
            'slash before the bracket'    => array( '[promo url=/a/]', array( 'shortcode:[promo url=/a /]' ) ),
            'multibyte neighbors'         => array( '前[promo_box]後', array( 'shortcode:[promo_box]' ) ),
            'multibyte attribute'         => array( '[promo title="前後"]', array( 'shortcode:[promo title="前後"]' ) ),
            'multibyte name stays text'   => array( '[前_box] [box前] [é_box]', array() ),
            'interleaved pairs'           => array( '[a][b][/a][/b]', array( 'shortcode:[a]', 'shortcode:[b]', 'shortcode:[/a]', 'shortcode:[/b]' ) ),
            'self-closing inside a pair'  => array( '[a][b/][/a]', array( 'shortcode:[a]', 'shortcode:[b /]', 'shortcode:[/a]' ) ),
        );
    }

    /**
     * @dataProvider provide_token_boundaries
     *
     * @param string[] $labels Expected labels, in order.
     */
    public function test_token_boundaries_follow_the_shortcode_grammar( string $content, array $labels ): void
    {
        $controls = self::controls( $content );

        $this->assertSame( $labels, array_column( $controls, 'label' ) );
        foreach ( $controls as $control ) {
            $this->assertSame( '[', $content[ $control['offset'] ] );
        }
    }

    public function test_removing_an_interleaved_closer_is_refused(): void
    {
        $before = self::BODY . '[a][b][/a][/b]';
        $report = StageAgent::measure_rewrite( $before, str_replace( '[/a]', '', $before ) );

        $this->assertContains( 'controls', StageAgent::copy_edit_violations( $report, 15 ) );
    }

    /**
     * @return array<string, array{0: bool}>
     */
    public function provide_registration(): array
    {
        return array(
            'registered'   => array( true ),
            'unregistered' => array( false ),
        );
    }

    /**
     * kses decodes `&copy;`, and a shortcode's callback receives its
     * attributes literally, so the save would change what the callback gets.
     *
     * @dataProvider provide_registration
     */
    public function test_kses_changing_a_shortcode_attribute_entity_is_unpreservable( bool $registered ): void
    {
        $tag    = 'preservation_promo';
        $before = self::BODY . '[' . $tag . ' id="&copy;"]';
        $after  = str_replace( 'aproved', 'approved', $before );
        add_shortcode( $tag, static fn( $attributes ) => 'id:' . $attributes['id'] );

        try {
            $this->assertStringEndsWith( 'id:&copy;', do_shortcode( $before ) );
            $this->assertStringEndsWith( 'id:©', do_shortcode( wp_kses_post( $before ) ) );
            if ( ! $registered ) {
                remove_shortcode( $tag );
            }

            $report = StageAgent::measure_rewrite( $before, $after );

            $this->assertStringEndsWith( '[' . $tag . ' id="©"]', $report['content'] );
            $this->assertContains( 'unpreservable_markup', StageAgent::copy_edit_violations( $report, 15 ) );
        } finally {
            remove_shortcode( $tag );
        }
    }

    /**
     * Fragments mixing escapes with registered and unregistered tags. Each row
     * gives what WordPress renders (with `gallery` printing `rendered:<ids>`),
     * the control labels the guard should count, and whether editing `ids`
     * is refused. WordPress honors an escape only for a registered tag.
     *
     * @return array<string, array{0: string, 1: string, 2: string[], 3: bool}>
     */
    public function provide_mixed_escapes(): array
    {
        return array(
            'registered single inside an unregistered escape' => array(
                '[[foo] [gallery ids="1"] [/foo]]',
                '[[foo] rendered:1 [/foo]]',
                array( 'shortcode:[gallery ids="1"]' ),
                true,
            ),
            'registered pair inside an unregistered escape' => array(
                '[[foo] [gallery ids="1"] inner [/gallery] [/foo]]',
                '[[foo] rendered:1 [/foo]]',
                array( 'shortcode:[gallery ids="1"]', 'shortcode:[/gallery]' ),
                true,
            ),
            'registered self-closing inside an unregistered escape' => array(
                '[[foo] [gallery ids="1" /] [/foo]]',
                '[[foo] rendered:1 [/foo]]',
                array( 'shortcode:[gallery ids="1" /]' ),
                true,
            ),
            'registered escape inside an unregistered pair' => array(
                '[foo][[gallery ids="1"]][/foo]',
                '[foo][gallery ids="1"][/foo]',
                array( 'shortcode:[foo]', 'shortcode:[/foo]' ),
                false,
            ),
            'unregistered tokens inside a registered escape' => array(
                '[[gallery ids="1"] [foo x=1] [/gallery]]',
                '[gallery ids="1"] [foo x=1] [/gallery]',
                array(),
                false,
            ),
            'registered escape nested inside an unregistered escape' => array(
                '[[foo] [[gallery ids="1"] [promo_box] [/gallery]] [/foo]]',
                '[[foo] [gallery ids="1"] [promo_box] [/gallery] [/foo]]',
                array(),
                false,
            ),
            'unregistered same-prefix escape' => array(
                '[[gallery_box] [gallery ids="1"] [/gallery_box]]',
                '[[gallery_box] rendered:1 [/gallery_box]]',
                array( 'shortcode:[gallery ids="1"]' ),
                true,
            ),
            'registered and unregistered same-prefix siblings' => array(
                '[gallery_box x=1][gallery ids="1"][/gallery_box]',
                '[gallery_box x=1]rendered:1[/gallery_box]',
                array( 'shortcode:[gallery_box x=1]', 'shortcode:[gallery ids="1"]', 'shortcode:[/gallery_box]' ),
                true,
            ),
            'unregistered escape hides only its own tokens' => array(
                '[[foo] [promo_box x=1] [gallery ids="1"] [/foo]]',
                '[[foo] [promo_box x=1] rendered:1 [/foo]]',
                array( 'shortcode:[gallery ids="1"]' ),
                true,
            ),
            'real registered escape beside an active registered tag' => array(
                '[[gallery ids="1"]] [gallery ids="1"]',
                '[gallery ids="1"] rendered:1',
                array( 'shortcode:[gallery ids="1"]' ),
                true,
            ),
        );
    }

    /**
     * @dataProvider provide_mixed_escapes
     *
     * @param string[] $labels Expected control labels in document order.
     */
    public function test_mixed_escapes_match_wordpress_rendering_and_refusals( string $fragment, string $rendered, array $labels, bool $refuse ): void
    {
        $registered = $GLOBALS['shortcode_tags'];
        add_shortcode( 'gallery', static fn( $attributes ) => 'rendered:' . $attributes['ids'] );

        try {
            foreach ( array( 'foo', 'promo_box', 'gallery_box' ) as $name ) {
                $this->assertFalse( shortcode_exists( $name ) );
            }
            $this->assertSame( $rendered, do_shortcode( $fragment ) );
            $controls = ( new \ReflectionMethod( StageAgent::class, 'controls' ) )->invoke( null, $fragment );
            $this->assertSame( $labels, array_column( $controls, 'label' ) );
            $offsets = array_column( $controls, 'offset' );
            $this->assertSame( $offsets, array_values( array_unique( $offsets ) ), 'Each token must be emitted once.' );
            foreach ( $controls as $control ) {
                $this->assertSame( '[', $fragment[ $control['offset'] ] );
            }

            $before = '<p>The board aproved the proposal after reviewing the detailed report from the committee.</p><p>' . $fragment . '</p>';
            $this->assertSame( $before, wp_kses_post( $before ) );
            $report = StageAgent::measure_rewrite( $before, str_replace( 'ids="1"', 'ids="2"', $before ) );
            $this->assertSame( $refuse, $report['controls_changed'] );
            $violations = StageAgent::copy_edit_violations( $report, 15 );
            if ( $refuse ) {
                $this->assertContains( 'controls', $violations );
            } else {
                $this->assertSame( array(), $violations );
            }

            $prose_report = StageAgent::measure_rewrite( $before, str_replace( 'aproved', 'approved', $before ) );
            $this->assertSame( array(), StageAgent::copy_edit_violations( $prose_report, 15 ) );
        } finally {
            $GLOBALS['shortcode_tags'] = $registered;
        }
    }
}
