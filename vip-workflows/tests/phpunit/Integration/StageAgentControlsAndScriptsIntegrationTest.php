<?php
/**
 * The copy-edit guard against page breaks, More tags and shortcodes, and on
 * text written without spaces between words, measured after real WordPress
 * sanitization and with core's shortcodes registered.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Abilities\Agents\StageAgent;

require_once dirname( __DIR__, 3 ) . '/includes/abilities/agents/class-stage-agent.php';

class StageAgentControlsAndScriptsIntegrationTest extends TestCase
{
    private const BODY = '<p>The board approved the proposal after reviewing the detailed report from the committee.</p>';

    /**
     * @return array<string, array{0: string, 1: string}>
     */
    public function provide_control_changes(): array
    {
        $second = '<p>The vote was unanimous and the plan takes effect at the start of next month.</p>';

        return array(
            'a page break added'           => array( self::BODY . $second, self::BODY . '<!--nextpage-->' . $second ),
            'a More tag added'             => array( self::BODY . $second, self::BODY . '<!--more-->' . $second ),
            'a More tag moved'             => array( self::BODY . '<!--more-->' . $second, self::BODY . $second . '<!--more-->' ),
            'a More tag removed'           => array( self::BODY . '<!--more-->' . $second, self::BODY . $second ),
            'a gallery added'              => array( self::BODY, self::BODY . '<p>[gallery ids="1,2"]</p>' ),
            'a shortcode attribute edited' => array( self::BODY . '<p>[gallery ids="1,2"]</p>', self::BODY . '<p>[gallery ids="1,3"]</p>' ),
            // Tags no one registered, as with a theme that registers them on a front-end hook.
            'an unregistered attribute edited'    => array( self::BODY . '<p>[promo_box id="7"]</p>', self::BODY . '<p>[promo_box id="8"]</p>' ),
            'an unregistered hyphenated added'    => array( self::BODY, self::BODY . '<p>[newsletter-signup]</p>' ),
            'an unregistered pair removed'        => array( self::BODY . '<p>[pullquote]The plan passed.[/pullquote]</p>', self::BODY . '<p>The plan passed.</p>' ),
            'an unregistered shortcode moved'     => array( self::BODY . '<p>[promo_box id="7"]</p>' . $second, self::BODY . $second . '<p>[promo_box id="7"]</p>' ),
            'an unregistered self-closing added'  => array( self::BODY, self::BODY . '<p>[divider /]</p>' ),
        );
    }

    /**
     * @dataProvider provide_control_changes
     *
     * @param string $before Original content.
     * @param string $after  Edited content.
     */
    public function test_a_control_change_is_refused( string $before, string $after ): void
    {
        $this->assertSame( $after, wp_kses_post( $after ), 'The fixture must survive real kses.' );

        $report     = StageAgent::measure_rewrite( $before, $after );
        $violations = StageAgent::copy_edit_violations( $report, 15 );

        $this->assertTrue( $report['controls_changed'] );
        $this->assertContains( 'controls', $violations );
        $this->assertStringContainsString( 'page break, More tag or shortcode', StageAgent::describe_rewrite( $report, $violations, 15 ) );
    }

    public function test_a_copy_edit_around_unchanged_controls_passes(): void
    {
        $before = '<p>The board aproved the proposal after reviewing the detailed report from the committee.</p><!--more--><p>[gallery ids="1,2"]</p><p>[promo_box id="7"]</p>';
        $after  = '<p>The board approved the proposal after reviewing the detailed report from the committee.</p><!--more--><p>[gallery ids="1,2"]</p><p>[promo_box id="7"]</p>';

        $report = StageAgent::measure_rewrite( $before, $after );

        $this->assertFalse( $report['controls_changed'] );
        $this->assertSame( array(), StageAgent::copy_edit_violations( $report, 15 ) );
    }

    public function test_an_escaped_shortcode_is_text(): void
    {
        $report = StageAgent::measure_rewrite( self::BODY, self::BODY . '<p>Type [[gallery]] to add one.</p>' );

        $this->assertFalse( $report['controls_changed'] );
    }

    /**
     * @return array<string, array{0: string, 1: string}>
     */
    public function provide_bracketed_prose(): array
    {
        return array(
            '[sic] removed'               => array( '<p>The mayor said it was "to large [sic] to pass" this year.</p>', '<p>The mayor said it was "to large to pass" this year.</p>' ),
            '[1] added'                   => array( self::BODY, '<p>The board approved the proposal after reviewing the detailed report from the committee.[1]</p>' ),
            '[Ed.] kept, sentence edited' => array( '<p>The council [Ed.] voted to aprove the library on Tuesday night.</p>', '<p>The council [Ed.] voted to approve the library on Tuesday evening.</p>' ),
            '[citation needed] added'     => array( self::BODY, '<p>The board approved the proposal [citation needed] after reviewing the detailed report from the committee.</p>' ),
            'escaped unregistered added'  => array( self::BODY, '<p>The board approved the proposal [[promo_box id="7"]] after reviewing the detailed report from the committee.</p>' ),
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
        $this->assertSame( $after, wp_kses_post( $after ), 'The fixture must survive real kses.' );

        $report = StageAgent::measure_rewrite( $before, $after );

        $this->assertFalse( $report['controls_changed'] );
        $this->assertNotContains( 'controls', StageAgent::copy_edit_violations( $report, 15 ) );
    }

    public function test_a_registered_shortcode_is_counted_once(): void
    {
        $this->assertTrue( shortcode_exists( 'gallery' ) );
        $this->assertFalse( shortcode_exists( 'promo_box' ) );

        $shape = new \ReflectionMethod( StageAgent::class, 'content_shape' );

        $controls = $shape->invoke( null, '<p>[gallery ids="1,2"]</p><p>[promo_box id="7"][caption]Photo[/caption]</p>' )['controls'];

        $this->assertSame(
            array( '0:shortcode:[gallery ids="1,2"]', '1:shortcode:[promo_box id="7"]', '1:shortcode:[caption]', '1:shortcode:[/caption]' ),
            $controls
        );
    }

    public function test_a_one_character_fix_in_chinese_is_small(): void
    {
        $paragraph = '<p>董事会在审阅委员会提交的详细报告后批准了这项提案并决定下月起实施。</p>';
        $before    = str_repeat( $paragraph, 3 ) . '<p>董事会在审阅委员会提交的详细报高后批准了这项提案并决定下月起实施。</p>';
        $after     = str_repeat( $paragraph, 4 );

        $report = StageAgent::measure_rewrite( $before, $after );

        // One character of about 130.
        $this->assertLessThan( 0.03, $report['share'] );
        $this->assertSame( array(), StageAgent::copy_edit_violations( $report, 15 ) );
    }

    public function test_rewriting_a_chinese_paragraph_trips_the_paragraph_limit(): void
    {
        $paragraph = '<p>董事会在审阅委员会提交的详细报告后批准了这项提案并决定下月起实施。</p>';
        $before    = str_repeat( $paragraph, 10 );
        $after     = str_repeat( $paragraph, 9 ) . '<p>天气预报说明天会下雨所以比赛可能会推迟到下周末再举行请大家注意。</p>';

        $report = StageAgent::measure_rewrite( $before, $after );

        $this->assertContains( 'block_share', StageAgent::copy_edit_violations( $report, 15 ) );
    }
}
