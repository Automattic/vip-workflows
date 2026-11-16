<?php
/**
 * Ordinary post markup under real kses: the copy-edit guard must not refuse it.
 *
 * The guard refuses any post whose markup kses would change, because an
 * agent's write would silently strip it. kses also rewrites markup it keeps
 * (it encodes `&`, drops a trailing semicolon from a style), so these check
 * that common block and classic markup is never mistaken for unpreservable.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Abilities\Agents\StageAgent;

require_once dirname( __DIR__, 3 ) . '/includes/abilities/agents/class-stage-agent.php';

class StageAgentOrdinaryMarkupIntegrationTest extends TestCase
{
    /**
     * @dataProvider ordinary_markup
     */
    public function test_ordinary_markup_is_preservable_and_unchanged( string $html ): void
    {
        $report = StageAgent::measure_rewrite( $html, $html );

        $this->assertFalse( $report['unpreservable_markup'] );
        $this->assertSame( array(), StageAgent::copy_edit_violations( $report, 15 ) );
    }

    /**
     * @return array<string, array{string}>
     */
    public static function ordinary_markup(): array
    {
        return array(
            'image block'      => array( '<!-- wp:image {"id":12,"width":"640px","sizeSlug":"large","linkDestination":"none"} --><figure class="wp-block-image size-large is-resized"><img src="https://example.com/a.jpg" alt="Harbor" class="wp-image-12" style="width:640px" width="640" height="480"/><figcaption class="wp-element-caption">The harbor.</figcaption></figure><!-- /wp:image -->' ),
            'colored para'     => array( '<!-- wp:paragraph {"style":{"color":{"text":"#cf2e2e"}}} --><p class="has-text-color" style="color:#cf2e2e">Red text here.</p><!-- /wp:paragraph -->' ),
            'heading anchor'   => array( '<!-- wp:heading {"level":3} --><h3 class="wp-block-heading" id="section-two">Section two</h3><!-- /wp:heading -->' ),
            'list'             => array( '<!-- wp:list --><ul class="wp-block-list"><!-- wp:list-item --><li>One</li><!-- /wp:list-item --></ul><!-- /wp:list -->' ),
            'quote'            => array( '<!-- wp:quote --><blockquote class="wp-block-quote"><!-- wp:paragraph --><p>Quoted.</p><!-- /wp:paragraph --><cite>Someone</cite></blockquote><!-- /wp:quote -->' ),
            'table'            => array( '<!-- wp:table --><figure class="wp-block-table"><table class="has-fixed-layout"><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table></figure><!-- /wp:table -->' ),
            'button'           => array( '<!-- wp:buttons --><div class="wp-block-buttons"><!-- wp:button --><div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="https://example.com/?a=1&amp;b=2" target="_blank" rel="noreferrer noopener">Go</a></div><!-- /wp:button --></div><!-- /wp:buttons -->' ),
            'classic br+span'  => array( "<p>Line one<br>line two <span style=\"font-weight: bold;\">bold</span> &amp; more.</p>\n\n<p>Second <a href=\"https://example.com/x?y=1&z=2\">link</a>.</p>" ),
            'embed'            => array( '<!-- wp:embed {"url":"https://www.youtube.com/watch?v=abc","type":"video","providerNameSlug":"youtube"} --><figure class="wp-block-embed is-type-video is-provider-youtube wp-block-embed-youtube"><div class="wp-block-embed__wrapper">https://www.youtube.com/watch?v=abc</div></figure><!-- /wp:embed -->' ),
        );
    }

    public function test_an_inline_script_kses_strips_is_unpreservable(): void
    {
        $original = '<!-- wp:paragraph --><p>The board approved the proposal after reviewing the report. <script>trackReader()</script></p><!-- /wp:paragraph -->';

        $report = StageAgent::measure_rewrite( $original, $original );

        $this->assertSame( array( 'unpreservable_markup' ), StageAgent::copy_edit_violations( $report, 15 ) );
    }
}
