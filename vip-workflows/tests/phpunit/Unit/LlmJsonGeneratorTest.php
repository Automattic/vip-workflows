<?php
/**
 * LlmJsonGenerator unit tests.
 *
 * The shared terminal step for JSON-producing AI calls, exercised directly: the
 * provider's finish reason is read before the text is parsed, so a reply the
 * model abandoned at the token ceiling is reported as truncation and not as the
 * malformed JSON it also happens to be.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use VIPWorkflows\Integrations\LlmJsonGenerator;
use WordPress\AiClient\AiClient;
use WP_Error;

require_once __DIR__ . '/../../../includes/integrations/class-llm-json-parser.php';
require_once __DIR__ . '/../../../includes/integrations/class-llm-json-generator.php';

/**
 * @covers \VIPWorkflows\Integrations\LlmJsonGenerator
 */
class LlmJsonGeneratorTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        AiClient::$generatedText   = '{}';
        AiClient::$responseQueue   = array();
        AiClient::$throwMessage    = null;
        AiClient::$finishReason    = 'stop';
        AiClient::$emptyCandidates = false;
    }

    protected function tearDown(): void
    {
        AiClient::$finishReason    = 'stop';
        AiClient::$emptyCandidates = false;
        AiClient::$throwMessage    = null;

        parent::tearDown();
    }

    /**
     * A builder configured the way a caller would configure one.
     *
     * @return object
     */
    private function builder(): object
    {
        return AiClient::prompt( 'Say something structured.' )
            ->usingModel( 'gpt-4o-mini' )
            ->usingMaxTokens( 500 )
            ->asJsonResponse();
    }

    public function test_complete_response_is_decoded(): void
    {
        AiClient::$generatedText = '{"verdict":"ok","notes":["one","two"]}';

        $decoded = LlmJsonGenerator::generate( $this->builder(), 'test payload' );

        $this->assertSame( array( 'verdict' => 'ok', 'notes' => array( 'one', 'two' ) ), $decoded );
    }

    public function test_length_finish_reason_is_reported_as_truncation(): void
    {
        AiClient::$finishReason  = 'length';
        AiClient::$generatedText = '{"verdict":"ok","notes":["one","tw';

        $error = LlmJsonGenerator::generate( $this->builder(), 'test payload' );

        $this->assertInstanceOf( WP_Error::class, $error );
        $this->assertSame( 'truncated_response', $error->get_error_code() );
        $this->assertStringContainsString( 'test payload', $error->get_error_message() );
        $this->assertStringContainsString( 'token limit', $error->get_error_message() );
        $this->assertStringNotContainsString( 'Failed to parse', $error->get_error_message() );
    }

    /**
     * A truncated reply that happens to be balanced JSON would decode without
     * complaint. The finish reason is the only thing that catches it, which is why
     * it is read before the parser ever sees the text.
     */
    public function test_length_finish_reason_wins_over_decodable_text(): void
    {
        AiClient::$finishReason  = 'length';
        AiClient::$generatedText = '{"verdict":"ok"}';

        $error = LlmJsonGenerator::generate( $this->builder(), 'test payload' );

        $this->assertInstanceOf( WP_Error::class, $error );
        $this->assertSame( 'truncated_response', $error->get_error_code() );
    }

    /**
     * Truncation reporting must not swallow a model that finished on its own and
     * still emitted the wrong thing — that is a prompt problem, not a ceiling one.
     */
    public function test_malformed_response_that_stopped_normally_is_a_parse_error(): void
    {
        AiClient::$generatedText = 'I would rather not answer that.';

        $error = LlmJsonGenerator::generate( $this->builder(), 'test payload' );

        $this->assertInstanceOf( WP_Error::class, $error );
        $this->assertSame( 'parse_error', $error->get_error_code() );
    }

    /**
     * An unterminated container with a non-length finish reason keeps the parser's
     * own diagnosis, which reports shape without claiming a cause.
     */
    public function test_unclosed_container_without_a_length_reason_stays_incomplete(): void
    {
        AiClient::$generatedText = '{"verdict":"ok","notes":["one",';

        $error = LlmJsonGenerator::generate( $this->builder(), 'test payload' );

        $this->assertInstanceOf( WP_Error::class, $error );
        $this->assertSame( 'incomplete_response', $error->get_error_code() );
    }

    public function test_result_without_candidates_is_reported(): void
    {
        AiClient::$emptyCandidates = true;

        $error = LlmJsonGenerator::generate( $this->builder(), 'test payload' );

        $this->assertInstanceOf( WP_Error::class, $error );
        $this->assertSame( 'no_candidates', $error->get_error_code() );
        $this->assertStringContainsString( 'test payload', $error->get_error_message() );
    }

    /**
     * Provider refusals stay with the caller, which is the only layer that knows
     * what identity to give them — a REST status, or a per-rule result row.
     */
    public function test_provider_exceptions_are_not_swallowed(): void
    {
        AiClient::$throwMessage = 'Model not found.';

        $this->expectException( \Exception::class );
        $this->expectExceptionMessage( 'Model not found.' );

        LlmJsonGenerator::generate( $this->builder(), 'test payload' );
    }
}
