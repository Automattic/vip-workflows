<?php
/**
 * Unit tests for copy-edit and tag-sanity-check stage agent plugins.
 *
 * Originally covered Fact Check too, alongside its own note-annotation
 * scaffolding (block-comment notes: writing, resolving, re-anchoring,
 * reply threads). That extension now lives outside this repository, and its
 * note-annotation mechanism is entirely its own —
 * not something copy-edit or tag-sanity-check share — so there was nothing
 * generic left here to preserve coverage of; the fact-check-specific tests and
 * their supporting stubs were removed rather than adapted.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use WordPress\AiClient\AiClient;

require_once dirname( __DIR__, 3 ) . '/includes/abilities/agents/class-stage-agent.php';

/**
 * Covers WorkflowAgentCopyEdit\execute() and WorkflowAgentTagSanityCheck\execute().
 */
class StageAgentsBatchTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        require_once dirname( __DIR__, 4 ) . '/workflow-agent-copy-edit/workflow-agent-copy-edit.php';
        require_once dirname( __DIR__, 4 ) . '/workflow-agent-tag-sanity-check/workflow-agent-tag-sanity-check.php';

        Functions\when( 'current_user_can' )->justReturn( true );
        Functions\when( 'current_time' )->justReturn( 'July 7, 2026' );
        // Pin the per-run verdict nonce (StageAgent::verdict_token) so the
        // stubbed model can echo it as the pass verdict; the pass cases below
        // set AiClient::$generatedText to this same token.
        Functions\when( 'wp_generate_password' )->justReturn( 'stage-pass-token' );
        // No ideation origin in the unit suite, so grounding stays empty and the
        // agents run against the un-grounded prompt.
        Functions\when( 'get_post_meta' )->justReturn( '' );
        Functions\when( 'get_option' )->alias(
            static function ( $key, $default = false ) {
                return $default;
            }
        );
        Functions\when( '_n' )->alias(
            static function ( $single, $plural, $number ) {
                return 1 === (int) $number ? $single : $plural;
            }
        );
        Functions\when( 'get_post' )->justReturn(
            (object) array(
                'ID'           => 5,
                'post_title'   => 'A Story',
                'post_content' => '<p>Some body content.</p>',
            )
        );

        AiClient::$throwMessage  = null;
        AiClient::$generatedText = 'Generated text';
    }

    protected function tearDown(): void
    {
        AiClient::$throwMessage = null;
        parent::tearDown();
    }

    // --- copy-edit -----------------------------------------------------------

    public function test_copy_edit_clean_passes_without_write(): void
    {
        AiClient::$generatedText = 'stage-pass-token';
        Functions\expect( 'wp_update_post' )->never();

        $result = \WorkflowAgentCopyEdit\execute( array( 'post_id' => 5 ) );

        $this->assertSame( 'pass', $result['status'] );
    }

    public function test_copy_edit_writes_edited_body(): void
    {
        AiClient::$generatedText = '<p>Edited body.</p>';
        $captured = null;
        Functions\expect( 'wp_update_post' )
            ->once()
            ->andReturnUsing(
                function ( $postarr ) use ( &$captured ) {
                    $captured = $postarr;
                    return 5;
                }
            );

        $result = \WorkflowAgentCopyEdit\execute( array( 'post_id' => 5 ) );

        $this->assertSame( 'pass', $result['status'] );
        $this->assertSame( '<p>Edited body.</p>', $captured['post_content'] );
    }

    public function test_copy_edit_reject_fails(): void
    {
        AiClient::$generatedText = 'REJECT';
        Functions\expect( 'wp_update_post' )->never();

        $result = \WorkflowAgentCopyEdit\execute( array( 'post_id' => 5 ) );

        $this->assertSame( 'fail', $result['status'] );
    }

    public function test_copy_edit_decorated_clean_sentinel_passes_without_write(): void
    {
        AiClient::$generatedText = 'stage-pass-token.';
        Functions\expect( 'wp_update_post' )->never();

        $result = \WorkflowAgentCopyEdit\execute( array( 'post_id' => 5 ) );

        $this->assertSame( 'pass', $result['status'] );
    }

    public function test_copy_edit_implausibly_short_rewrite_errors_without_write(): void
    {
        Functions\when( 'get_post' )->justReturn(
            (object) array(
                'ID'           => 5,
                'post_title'   => 'A Story',
                'post_content' => '<p>' . str_repeat( 'A long substantial paragraph. ', 40 ) . '</p>',
            )
        );
        AiClient::$generatedText = '<p>Nearly the whole article was truncated away.</p>';
        Functions\expect( 'wp_update_post' )->never();

        $result = \WorkflowAgentCopyEdit\execute( array( 'post_id' => 5 ) );

        $this->assertInstanceOf( 'WP_Error', $result );
        $this->assertSame( 'implausible_rewrite', $result->get_error_code() );
    }

    // --- tag sanity check --------------------------------------------------

    public function test_tag_check_fails_when_no_tags(): void
    {
        Functions\when( 'wp_get_post_terms' )->justReturn( array() );

        $result = \WorkflowAgentTagSanityCheck\execute( array( 'post_id' => 5 ) );

        $this->assertSame( 'fail', $result['status'] );
        $this->assertStringContainsString( 'No tags', $result['summary'] );
    }

    public function test_tag_check_pass(): void
    {
        Functions\when( 'wp_get_post_terms' )->justReturn( array( 'politics', 'election' ) );
        AiClient::$generatedText = 'stage-pass-token';

        $result = \WorkflowAgentTagSanityCheck\execute( array( 'post_id' => 5 ) );

        $this->assertSame( 'pass', $result['status'] );
    }

    public function test_tag_check_flags_questionable_tags(): void
    {
        Functions\when( 'wp_get_post_terms' )->justReturn( array( 'politics', 'recipes' ) );
        AiClient::$generatedText = '- recipes: unrelated to a political story';

        $result = \WorkflowAgentTagSanityCheck\execute( array( 'post_id' => 5 ) );

        $this->assertSame( 'fail', $result['status'] );
        $this->assertCount( 1, $result['issues'] );
    }

    public function test_tag_check_missing_post_id_errors(): void
    {
        $result = \WorkflowAgentTagSanityCheck\execute( array() );

        $this->assertInstanceOf( 'WP_Error', $result );
        $this->assertSame( 'missing_post_id', $result->get_error_code() );
    }
}
