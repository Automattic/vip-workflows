<?php
/**
 * Markup guard bypasses measured after real WordPress sanitization.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Abilities\Agents\StageAgent;

require_once dirname( __DIR__, 3 ) . '/includes/abilities/agents/class-stage-agent.php';

class StageAgentMarkupAdversarialIntegrationTest extends TestCase
{
    public function test_extending_an_existing_hidden_span_over_the_article_is_refused(): void
    {
        $original = '<p><span hidden>Internal note.</span> The board approved the proposal after reviewing the detailed report.</p>';
        $edited = '<p><span hidden>Internal note. The board approved the proposal after reviewing the detailed report.</span></p>';

        $this->assertSame( $edited, wp_kses_post( $edited ), 'This fixture must retain the hidden span under real kses.' );
        $report = StageAgent::measure_rewrite( $original, $edited );
        $this->assertFalse( $report['unpreservable_markup'] );
        // Tags unchanged; the text moved across the span's boundary, which the
        // run-by-run word comparison counts as changed words.
        $this->assertGreaterThan( 1.0, $report['share'] );
        $this->assertContains( 'share', StageAgent::copy_edit_violations( $report, 15 ) );
    }

    public function test_adding_hidden_cannot_collide_with_an_attribute_value(): void
    {
        $original = '<p><span class="x,hidden=">The board approved the proposal after reviewing the detailed report.</span></p>';
        $edited = '<p><span class="x" hidden>The board approved the proposal after reviewing the detailed report.</span></p>';

        $this->assertSame( $original, wp_kses_post( $original ), 'The class value is part of this fixture.' );
        $this->assertSame( $edited, wp_kses_post( $edited ), 'This fixture must retain the hidden attribute under real kses.' );
        $report = StageAgent::measure_rewrite( $original, $edited );
        $this->assertFalse( $report['unpreservable_markup'] );
        $this->assertSame( 0.0, $report['share'] );
        $this->assertContains( 'markup', StageAgent::copy_edit_violations( $report, 15 ) );
    }

    public function test_extending_hidden_strong_is_refused_after_real_kses(): void
    {
        $before = '<!-- wp:paragraph --><p><strong hidden>Internal note.</strong> The board approved the proposal after reviewing the detailed report.</p><!-- /wp:paragraph -->';
        $after  = '<!-- wp:paragraph --><p><strong hidden>Internal note. The board approved the proposal after reviewing the detailed report.</strong></p><!-- /wp:paragraph -->';

        $this->assertSame( $before, wp_kses_post( $before ), 'This fixture must retain the hidden strong under real kses.' );
        $this->assertSame( $after, wp_kses_post( $after ) );
        $this->assertNotSame( array(), StageAgent::copy_edit_violations( StageAgent::measure_rewrite( $before, $after ), 15 ) );
    }

    public function test_reordering_video_attributes_is_not_a_link_change_after_real_kses(): void
    {
        $before = '<!-- wp:html --><video src="https://example.com/a.mp4" poster="https://example.com/a.jpg"></video><!-- /wp:html -->';
        $after  = '<!-- wp:html --><video poster="https://example.com/a.jpg" src="https://example.com/a.mp4"></video><!-- /wp:html -->';

        $report = StageAgent::measure_rewrite( $before, $after );

        $this->assertFalse( $report['unpreservable_markup'], 'If kses strips video, this test no longer measures attribute order.' );
        $this->assertSame( array(), StageAgent::copy_edit_violations( $report, 15 ) );
    }
}
