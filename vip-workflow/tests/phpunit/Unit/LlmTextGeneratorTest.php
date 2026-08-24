<?php
/**
 * LlmTextGenerator unit tests.
 *
 * The shared terminal step for free-text AI calls. The case that matters most is
 * the one that shipped broken: a thinking model bills its reasoning against the
 * same ceiling as its reply, so a budget sized against the answer alone can be
 * spent before a single word of the answer is written. The candidate then carries
 * no content-channel part and the library's own toText() throws, which is what an
 * editor used to be shown. The finish reason is the only signal that names the
 * real condition, so it is read before the text is ever fetched.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use VIPWorkflow\Integrations\LlmTextGenerator;
use WordPress\AiClient\AiClient;
use WP_Error;

require_once __DIR__ . '/../../../includes/integrations/class-llm-text-generator.php';

/**
 * @covers \VIPWorkflow\Integrations\LlmTextGenerator
 */
class LlmTextGeneratorTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        AiClient::$generatedText      = 'Generated text';
        AiClient::$responseQueue      = array();
        AiClient::$throwMessage       = null;
        AiClient::$finishReason       = 'stop';
        AiClient::$emptyCandidates    = false;
        AiClient::$contentPartMissing = false;
    }

    /**
     * A builder configured the way a stage agent configures one.
     *
     * @return object
     */
    private function builder(): object
    {
        return AiClient::prompt( 'Check this article.' )
            ->usingModel( 'claude-sonnet-5' )
            ->usingMaxTokens( 1500 );
    }

    public function test_normal_response_returns_its_text(): void
    {
        AiClient::$generatedText = 'BLOCK 3: the date is wrong.';

        $text = LlmTextGenerator::generate( $this->builder(), 'AI agent', 1500 );

        $this->assertSame( 'BLOCK 3: the date is wrong.', $text );
    }

    /**
     * The reported failure, reproduced: reasoning consumed the whole ceiling, so the
     * candidate came back with a `length` finish reason and no content part at all.
     * The old code let the library's exception reach the editor; this must name the
     * ceiling instead.
     */
    public function test_length_finish_reason_without_content_reports_a_cutoff(): void
    {
        AiClient::$finishReason       = 'length';
        AiClient::$contentPartMissing = true;

        $error = LlmTextGenerator::generate( $this->builder(), 'AI agent', 1500 );

        $this->assertInstanceOf( WP_Error::class, $error );
        $this->assertSame( 'truncated_response', $error->get_error_code() );
        $this->assertStringContainsString( '1500-token limit', $error->get_error_message() );
        $this->assertStringContainsString( 'AI agent', $error->get_error_message() );
        $this->assertStringNotContainsString(
            'No text content found',
            $error->get_error_message(),
            'The library exception must not reach the editor.'
        );
    }

    /**
     * Partial free text is not a cheaper version of the answer: a truncated report
     * silently drops findings and a truncated rewrite is a body with its end
     * missing, and neither is distinguishable from a complete reply once returned.
     */
    public function test_length_finish_reason_with_partial_text_still_reports_a_cutoff(): void
    {
        AiClient::$finishReason  = 'length';
        AiClient::$generatedText = 'BLOCK 3: the date is wr';

        $error = LlmTextGenerator::generate( $this->builder(), 'AI agent', 1500 );

        $this->assertInstanceOf( WP_Error::class, $error );
        $this->assertSame( 'truncated_response', $error->get_error_code() );
    }

    /**
     * JSON callers do not pass a ceiling, so the cutoff is still reported — just
     * without a figure it cannot know.
     */
    public function test_cutoff_without_a_known_ceiling_omits_the_figure(): void
    {
        AiClient::$finishReason       = 'length';
        AiClient::$contentPartMissing = true;

        $error = LlmTextGenerator::generate( $this->builder(), 'AI agent' );

        $this->assertInstanceOf( WP_Error::class, $error );
        $this->assertSame( 'truncated_response', $error->get_error_code() );
        $this->assertStringContainsString( 'token limit', $error->get_error_message() );
        $this->assertStringNotContainsString( '-token limit', $error->get_error_message() );
    }

    public function test_result_without_candidates_is_reported(): void
    {
        AiClient::$emptyCandidates = true;

        $error = LlmTextGenerator::generate( $this->builder(), 'AI agent', 1500 );

        $this->assertInstanceOf( WP_Error::class, $error );
        $this->assertSame( 'no_candidates', $error->get_error_code() );
        $this->assertStringContainsString( 'AI agent', $error->get_error_message() );
    }

    /**
     * No candidates is not a ceiling problem, so it must not borrow the ceiling's
     * message — the two need different responses from whoever reads them.
     */
    public function test_no_candidates_is_distinguished_from_a_cutoff(): void
    {
        AiClient::$emptyCandidates = true;

        $error = LlmTextGenerator::generate( $this->builder(), 'AI agent', 1500 );

        $this->assertInstanceOf( WP_Error::class, $error );
        $this->assertStringNotContainsString( 'token limit', $error->get_error_message() );
    }

    public function test_content_filter_finish_reason_is_reported_as_filtered(): void
    {
        AiClient::$finishReason       = 'content_filter';
        AiClient::$contentPartMissing = true;

        $error = LlmTextGenerator::generate( $this->builder(), 'AI agent', 1500 );

        $this->assertInstanceOf( WP_Error::class, $error );
        $this->assertSame( 'content_filtered', $error->get_error_code() );
        $this->assertStringNotContainsString( 'token limit', $error->get_error_message() );
    }

    /**
     * A model that stopped of its own accord and still returned no text is neither a
     * ceiling problem nor an empty result, and must not be reported as either.
     */
    public function test_missing_content_after_a_normal_stop_is_its_own_condition(): void
    {
        AiClient::$contentPartMissing = true;

        $error = LlmTextGenerator::generate( $this->builder(), 'AI agent', 1500 );

        $this->assertInstanceOf( WP_Error::class, $error );
        $this->assertSame( 'no_text_content', $error->get_error_code() );
        $this->assertStringNotContainsString( 'token limit', $error->get_error_message() );
    }

    /**
     * Provider refusals stay with the caller, which is the only layer that knows
     * what identity to give them.
     */
    public function test_provider_exceptions_are_not_swallowed(): void
    {
        AiClient::$throwMessage = 'Model not found.';

        $this->expectException( \Exception::class );
        $this->expectExceptionMessage( 'Model not found.' );

        LlmTextGenerator::generate( $this->builder(), 'AI agent', 1500 );
    }
}
