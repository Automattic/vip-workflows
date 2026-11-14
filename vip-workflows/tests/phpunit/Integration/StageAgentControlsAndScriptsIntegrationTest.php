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
        $before = '<p>The board aproved the proposal after reviewing the detailed report from the committee.</p><!--more--><p>[gallery ids="1,2"]</p>';
        $after  = '<p>The board approved the proposal after reviewing the detailed report from the committee.</p><!--more--><p>[gallery ids="1,2"]</p>';

        $report = StageAgent::measure_rewrite( $before, $after );

        $this->assertFalse( $report['controls_changed'] );
        $this->assertSame( array(), StageAgent::copy_edit_violations( $report, 15 ) );
    }

    public function test_an_escaped_shortcode_is_text(): void
    {
        $report = StageAgent::measure_rewrite( self::BODY, self::BODY . '<p>Type [[gallery]] to add one.</p>' );

        $this->assertFalse( $report['controls_changed'] );
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
