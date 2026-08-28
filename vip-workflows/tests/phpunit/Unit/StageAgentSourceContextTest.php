<?php
/**
 * StageAgent source-context formatting unit tests.
 *
 * Locks the prompt block produced from gathered ground-truth sources (ideation
 * research or a web search). The gather_source_context() side (DB / provider
 * reads) is exercised in the integration suite; here we pin the pure formatting.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use VIPWorkflows\Abilities\Agents\StageAgent;

/**
 * Tests for StageAgent::format_source_context().
 */
class StageAgentSourceContextTest extends TestCase
{
    public function test_web_search_context_is_empty_without_a_booted_wordpress(): void
    {
        // The unit suite never boots WordPress, so there is no HTTP API or search
        // registry to run a web search against. That must resolve to an empty
        // (un-grounded) context, NOT a provider failure — otherwise execute()
        // would bail with a WP_Error on every un-grounded post.
        $this->assertSame(
            array(
                'origin'  => '',
                'summary' => '',
                'sources' => array(),
            ),
            StageAgent::web_search_context( 'any query' )
        );
    }

    public function test_empty_context_renders_nothing(): void
    {
        $this->assertSame( '', StageAgent::format_source_context( array(
            'origin'  => '',
            'summary' => '',
            'sources' => array(),
        ) ) );
    }

    public function test_ideation_context_frames_sources_as_ground_truth(): void
    {
        $block = StageAgent::format_source_context( array(
            'origin'  => 'ideation',
            'summary' => 'The match ended 2-1.',
            'sources' => array(
                array(
                    'title'   => 'Match report',
                    'url'     => 'https://example.com/report',
                    'excerpt' => 'Egypt lost to Argentina.',
                ),
            ),
        ) );

        $this->assertStringContainsString( 'ground truth', $block );
        $this->assertStringContainsString( 'Research summary:', $block );
        $this->assertStringContainsString( 'The match ended 2-1.', $block );
        $this->assertStringContainsString( 'Source 1 — Match report (https://example.com/report)', $block );
        $this->assertStringContainsString( 'Egypt lost to Argentina.', $block );
    }

    public function test_web_context_frames_sources_as_incomplete_reference(): void
    {
        $block = StageAgent::format_source_context( array(
            'origin'  => 'web',
            'summary' => '',
            'sources' => array(
                array(
                    'title'   => 'A result',
                    'url'     => 'https://example.com/a',
                    'excerpt' => 'Some snippet.',
                ),
            ),
        ) );

        $this->assertStringContainsString( 'web search', $block );
        $this->assertStringContainsString( 'may be incomplete', $block );
        // No project summary on the web path.
        $this->assertStringNotContainsString( 'Research summary:', $block );
        $this->assertStringContainsString( 'Source 1 — A result', $block );
    }

    public function test_source_without_title_falls_back_to_url(): void
    {
        $block = StageAgent::format_source_context( array(
            'origin'  => 'web',
            'summary' => '',
            'sources' => array(
                array(
                    'title'   => '',
                    'url'     => 'https://example.com/only-url',
                    'excerpt' => 'Body.',
                ),
            ),
        ) );

        $this->assertStringContainsString( 'Source 1 — https://example.com/only-url', $block );
    }
}
