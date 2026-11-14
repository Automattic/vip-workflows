<?php
/**
 * Rewrite measurement against WordPress sanitization and the real AI builder.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Abilities\Agents\StageAgent;
use WordPress\AiClient\AiClient;

require_once dirname( __DIR__, 3 ) . '/includes/abilities/agents/class-stage-agent.php';

class StageAgentRewriteGuardIntegrationTest extends TestCase
{
    public function test_block_json_attributes_survive_real_kses(): void
    {
        $original = '<!-- wp:paragraph {"align":"center","metadata":{"name":"Council report"}} -->'
            . '<p>The team are ready to publish the report this morning.</p><!-- /wp:paragraph -->';
        $edited = str_replace( 'team are', 'team is', $original );

        $this->assertSame( $original, wp_kses_post( $original ) );
        $report = StageAgent::measure_rewrite( $original, $edited );
        $this->assertFalse( $report['unpreservable_markup'] );
        $this->assertSame( array(), StageAgent::copy_edit_violations( $report, 15 ) );
    }

    public function test_raw_ampersand_does_not_change_a_link(): void
    {
        $original = '<p>Please read <a href="https://example.com/?a=1&b=2">the report</a> before the public meeting begins today.</p>';
        $edited = str_replace( 'public meeting', 'scheduled meeting', $original );

        $report = StageAgent::measure_rewrite( $original, $edited );
        $this->assertFalse( $report['unpreservable_markup'] );
        $this->assertSame( 0, $report['links_added'] );
        $this->assertSame( 0, $report['links_removed'] );
        $this->assertSame( array(), StageAgent::copy_edit_violations( $report, 15 ) );
    }

    public function test_iframe_is_unpreservable_rather_than_an_edit_violation(): void
    {
        $original = '<p>The board reviewed the detailed report during its meeting today.</p>'
            . '<iframe src="https://example.com/embed"></iframe>';

        $report = StageAgent::measure_rewrite( $original, $original );
        $violations = StageAgent::copy_edit_violations( $report, 15 );
        $this->assertSame( array( 'unpreservable_markup' ), $violations );
        $this->assertStringContainsString( 'markup that WordPress strips', StageAgent::describe_rewrite( $report, $violations, 15 ) );
    }

    public function test_swapped_link_destinations_fail_after_real_kses(): void
    {
        $original = '<p>Read the <a href="https://example.com/official">official report</a> and the <a href="https://example.com/opinion">opinion column</a> before the meeting today.</p>';
        $edited = '<p>Read the <a href="https://example.com/opinion">official report</a> and the <a href="https://example.com/official">opinion column</a> before the meeting today.</p>';

        $report = StageAgent::measure_rewrite( $original, $edited );
        $this->assertFalse( $report['unpreservable_markup'] );
        $this->assertContains( 'links', StageAgent::copy_edit_violations( $report, 15 ) );
    }

    /**
     * Real kses strips `srcset`, so a post carrying one can't be written back
     * intact by any agent: the edit is refused as unpreservable. The URL-plus-
     * descriptor comparison only matters where a filter lets `srcset` through.
     */
    public function test_changed_srcset_fails_after_real_kses(): void
    {
        $original = '<p>The harbor at dawn appears in this photograph from today. <img src="https://example.com/harbor.jpg" srcset="https://example.com/harbor-large.jpg 2x" alt="Harbor"></p>';
        $edited = str_replace( 'https://example.com/harbor-large.jpg', 'https://evil.example/fake.jpg', $original );

        $report = StageAgent::measure_rewrite( $original, $edited );
        $this->assertTrue( $report['unpreservable_markup'] );
        $this->assertSame( array( 'unpreservable_markup' ), StageAgent::copy_edit_violations( $report, 15 ) );
    }

    public function test_hidden_body_is_refused_or_its_hidden_attribute_is_stripped(): void
    {
        $original = '<p>The board approved the proposal after reviewing the detailed report.</p>';
        $edited = '<p><span hidden>The board approved the proposal after reviewing the detailed report.</span></p>';

        $report = StageAgent::measure_rewrite( $original, $edited );
        $has_hidden_attribute = false;
        $processor = new \WP_HTML_Tag_Processor( $report['content'] );
        while ( $processor->next_tag() ) {
            if ( null !== $processor->get_attribute( 'hidden' ) ) {
                $has_hidden_attribute = true;
            }
        }
        $this->assertTrue(
            array() !== StageAgent::copy_edit_violations( $report, 15 ) || ! $has_hidden_attribute,
            'An edit that hides the article must be refused or sanitized before it can be accepted.'
        );
    }

    public function test_changed_srcset_descriptors_fail_after_real_kses(): void
    {
        $original = '<p>The harbor at dawn appears in this photograph from today. <img src="https://example.com/small.jpg" srcset="https://example.com/small.jpg 1x, https://example.com/large.jpg 2x" alt="Harbor"></p>';
        $edited = str_replace( 'small.jpg 1x, https://example.com/large.jpg 2x', 'small.jpg 2x, https://example.com/large.jpg 1x', $original );

        // As above: real kses strips srcset, so the edit is refused as unpreservable.
        $report = StageAgent::measure_rewrite( $original, $edited );
        $this->assertTrue( $report['unpreservable_markup'] );
        $this->assertSame( array( 'unpreservable_markup' ), StageAgent::copy_edit_violations( $report, 15 ) );
    }

    public function test_real_ai_client_builder_accepts_the_schema_without_http(): void
    {
        $client = new \ReflectionClass( AiClient::class );
        $this->assertStringNotContainsString( 'tests/phpunit/stubs', (string) $client->getFileName() );

        // No terminal generation call: this tests the real method signature
        // without provider credentials or any network request.
        $builder = AiClient::prompt( 'Return the requested JSON object.' );
        $this->assertIsObject( $builder->asJsonResponse( StageAgent::rewrite_reply_schema() ) );
    }
}
