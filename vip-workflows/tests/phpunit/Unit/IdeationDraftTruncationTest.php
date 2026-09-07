<?php
/**
 * Draft-generation truncation reporting on the create-draft route.
 *
 * The route's ceiling is sized to cover the longest draft it accepts, but when a
 * reply is cut off anyway the caller used to receive `ai_parse_error` / 500 — the
 * same answer a model returning prose instead of JSON produces, and
 * indistinguishable from any other server error. These cover the terminal step
 * directly, because the finish reason has to be forced and the integration suite
 * deliberately runs against the real AI Client with no stub.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use ReflectionClass;
use ReflectionMethod;
use VIPWorkflows\API\IdeationController;
use VIPWorkflows\Integrations\LlmTextGenerator;
use WordPress\AiClient\AiClient;
use WP_Error;

/**
 * @covers \VIPWorkflows\API\IdeationController::create_draft
 */
class IdeationDraftTruncationTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        AiClient::$configured      = true;
        AiClient::$generatedText   = '{}';
        AiClient::$responseQueue   = array();
        AiClient::$throwMessage    = null;
        AiClient::$finishReason    = 'stop';
        AiClient::$emptyCandidates = false;

        Functions\when( 'get_option' )->alias(
            function ( string $option, $default = false ) {
                return 'vip_workflows_ai_model' === $option ? 'gpt-4o-mini' : $default;
            }
        );
        Functions\when( '_doing_it_wrong' )->justReturn( null );
    }

    protected function tearDown(): void
    {
        AiClient::$finishReason    = 'stop';
        AiClient::$emptyCandidates = false;
        AiClient::$throwMessage    = null;

        parent::tearDown();
    }

    /**
     * Invoke the route's private terminal generation step.
     *
     * @return array|WP_Error
     */
    private function generate()
    {
        $controller = ( new ReflectionClass( IdeationController::class ) )->newInstanceWithoutConstructor();
        $method     = new ReflectionMethod( $controller, 'generate_draft_payload' );

        return $method->invoke( $controller, 'You are an editor.', 'Write the draft article now.' );
    }

    public function test_complete_response_is_decoded(): void
    {
        AiClient::$generatedText = '{"title":"East end branch closes","body":"## Lede\n\nThe council voted."}';

        $parsed = $this->generate();

        $this->assertIsArray( $parsed );
        $this->assertSame( 'East end branch closes', $parsed['title'] );
        $this->assertStringContainsString( 'The council voted.', $parsed['body'] );
    }

    /**
     * The system instruction reaches the provider — the builder is configured by
     * the caller and only its terminal step was moved.
     */
    public function test_system_instruction_is_still_sent(): void
    {
        AiClient::$generatedText = '{"title":"t","body":"b"}';

        $this->generate();

        $this->assertSame( 'You are an editor.', AiClient::$lastSystemInstruction );

        /*
         * The ceiling is asserted as reaching the provider, not as a particular
         * number: this test is about the builder still being configured by the caller
         * after its terminal step moved, and the figure belongs to the call site's own
         * sizing. Pinning the literal 4000 turned a re-size into a failure here, in a
         * test that has nothing to say about how large the ceiling should be.
         */
        $this->assertGreaterThanOrEqual(
            LlmTextGenerator::THINKING_FLOOR,
            AiClient::$lastMaxTokens,
            'The draft route must request a ceiling that clears the reasoning cost billed against it.'
        );
    }

    /**
     * A cut-off draft answers with its own code, so "raise the ceiling" is
     * distinguishable from "the model returned the wrong thing".
     */
    public function test_length_finish_reason_reports_truncation_not_a_parse_error(): void
    {
        AiClient::$finishReason  = 'length';
        AiClient::$generatedText = '{"title":"East end branch closes","body":"## Lede\n\nThe council voted to close the';

        $error = $this->generate();

        $this->assertInstanceOf( WP_Error::class, $error );
        $this->assertSame( 'ai_truncated_response', $error->get_error_code() );
        $this->assertNotSame( 'ai_parse_error', $error->get_error_code() );
        $this->assertStringContainsString( 'token limit', $error->get_error_message() );
        $this->assertSame( 500, $error->get_error_data()['status'] );
    }

    public function test_malformed_response_that_stopped_normally_is_a_parse_error(): void
    {
        AiClient::$generatedText = 'I am sorry, I cannot write that draft.';

        $error = $this->generate();

        $this->assertInstanceOf( WP_Error::class, $error );
        $this->assertSame( 'ai_parse_error', $error->get_error_code() );
        $this->assertSame( 500, $error->get_error_data()['status'] );
    }

    public function test_result_without_candidates_is_reported(): void
    {
        AiClient::$emptyCandidates = true;

        $error = $this->generate();

        $this->assertInstanceOf( WP_Error::class, $error );
        $this->assertSame( 'ai_no_candidates', $error->get_error_code() );
        $this->assertSame( 500, $error->get_error_data()['status'] );
    }

    /**
     * A refused request keeps the code the route has always used for it, so the
     * existing integration coverage of that path still describes reality.
     */
    public function test_provider_refusal_is_still_reported_as_ai_error(): void
    {
        AiClient::$throwMessage = 'No model was resolved.';

        $error = $this->generate();

        $this->assertInstanceOf( WP_Error::class, $error );
        $this->assertSame( 'ai_error', $error->get_error_code() );
        $this->assertSame( 'No model was resolved.', $error->get_error_message() );
        $this->assertSame( 500, $error->get_error_data()['status'] );
    }
}
