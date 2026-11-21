<?php
/**
 * Shortcode attribute preservation through real WordPress sanitization.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Abilities\Agents\StageAgent;

require_once dirname( __DIR__, 3 ) . '/includes/abilities/agents/class-stage-agent.php';

class StageAgentShortcodeEdgeCasesNormalizationIntegrationTest extends TestCase
{
    /**
     * @return array<string, array{0: string, 1: string, 2: bool, 3: bool}>
     */
    public function provide_attribute_normalization(): array
    {
        $values = array(
            'bare ampersand'       => array( 'A & B', 'A &amp; B', false ),
            'encoded ampersand'    => array( 'A &amp; B', 'A &amp; B', false ),
            'nonbreaking space'    => array( 'A &nbsp; B', "A \u{00A0} B", true ),
            'double quote entity'  => array( '&quot;hello&quot;', '"hello"', true ),
            'apostrophe entity'    => array( '&apos;hello&apos;', "'hello'", true ),
            'decimal entity'       => array( '&#39;hello&#39;', "'hello'", true ),
            'hexadecimal entity'   => array( '&#x27;hello&#x27;', "'hello'", true ),
            'literal Unicode'      => array( '©', '©', false ),
            'less than comparison' => array( '2 < 3', '2 &lt; 3', true ),
            'greater comparison'   => array( '3 > 2', '3 &gt; 2', true ),
            'URL query'            => array( 'https://example.org/?a=1&b=2', 'https://example.org/?a=1&amp;b=2', false ),
            'encoded URL query'    => array( 'https://example.org/?a=1&amp;b=2', 'https://example.org/?a=1&amp;b=2', false ),
            'inline emphasis'      => array( '<em>hello</em>', '<em>hello</em>', false ),
            'inline link'          => array( '<a href="https://example.org">hello</a>', '<a href="https://example.org">hello</a>', false ),
            'newline'              => array( "line one\nline two", "line one\nline two", false ),
            'unknown entity'       => array( 'A &unknown; B', 'A &amp;unknown; B', false ),
            'nested ampersand'     => array( 'A &amp;amp; B', 'A &amp;amp; B', false ),
        );

        $cases = array();
        foreach ( $values as $name => $value ) {
            $cases[ $name . ' registered' ]   = array_merge( $value, array( true ) );
            $cases[ $name . ' unregistered' ] = array_merge( $value, array( false ) );
        }
        return $cases;
    }

    /**
     * Entity spellings reach shortcode callbacks literally. Apart from the
     * accepted ampersand equivalence, sanitization must not change them.
     *
     * @dataProvider provide_attribute_normalization
     */
    public function test_attribute_normalization_preserves_the_guard(
        string $value,
        string $filtered_value,
        bool $unpreservable,
        bool $registered
    ): void {
        $tag    = 'normalization_promo';
        $token  = "[" . $tag . " title='" . $value . "']";
        $before = '<p>The board aproved the proposal after reviewing the detailed report from the committee.</p>' . $token;
        $this->assertFalse( shortcode_exists( $tag ) );
        $this->assertSame( "[" . $tag . " title='" . $filtered_value . "']", wp_kses_post( $token ) );

        add_shortcode( $tag, static fn( $attributes ) => wp_json_encode( $attributes ) );
        try {
            if ( $unpreservable ) {
                $this->assertNotSame( do_shortcode( $token ), do_shortcode( wp_kses_post( $token ) ), 'Refusal must protect a real change to callback input.' );
            }
            if ( ! $registered ) {
                remove_shortcode( $tag );
            }

            $report = StageAgent::measure_rewrite( $before, str_replace( 'aproved', 'approved', $before ) );

            $this->assertSame( $unpreservable, $report['unpreservable_markup'] );
            $this->assertFalse( $report['controls_changed'], 'The model only corrected the prose.' );
            $this->assertSame( $unpreservable ? array( 'unpreservable_markup' ) : array(), StageAgent::copy_edit_violations( $report, 15 ) );
            $this->assertSame( wp_kses_post( str_replace( 'aproved', 'approved', $before ) ), $report['content'] );
        } finally {
            remove_shortcode( $tag );
        }
    }
}
