<?php
/**
 * Editorial Mentor truncation-reporting tests.
 *
 * The mentor asks for a JSON object containing free prose plus an array of
 * suggestions. When the model stops at the token ceiling the partial payload
 * still reaches the parser, so these guard that the provider's finish reason is
 * read first and reported as truncation rather than as a parse failure — and
 * that the ceiling itself is large enough for the payload the prompt requests.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use ReflectionMethod;
use VIPWorkflow\AI\CorePrompts;
use VIPWorkflow\AI\PromptRegistry;
use VIPWorkflow\AI\PromptSettings;
use VIPWorkflow\Ideation\Assistants\EditorialMentor;
use WordPress\AiClient\AiClient;
use WP_Error;

require_once __DIR__ . '/../../../includes/ideation/assistants/class-editorial-mentor.php';

/**
 * @covers \VIPWorkflow\Ideation\Assistants\EditorialMentor
 */
class EditorialMentorTruncationTest extends TestCase
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
                if ( 'vip_workflow_ai_model' === $option ) {
                    return 'gpt-4o-mini';
                }
                if ( 'vip_workflow_prompts' === $option ) {
                    return array();
                }
                return $default;
            }
        );
        Functions\when( '_doing_it_wrong' )->justReturn( null );
        Functions\when( 'wp_get_abilities' )->justReturn( array() );

        PromptRegistry::get_instance()->reset();
        PromptSettings::get_instance()->clear_cache();
        CorePrompts::register( PromptRegistry::get_instance() );
    }

    protected function tearDown(): void
    {
        AiClient::$finishReason    = 'stop';
        AiClient::$emptyCandidates = false;

        parent::tearDown();
    }

    /**
     * Invoke the private evaluation with a minimal ideation state.
     *
     * @return array|WP_Error
     */
    private function evaluate()
    {
        $mentor = new EditorialMentor();
        $method = new ReflectionMethod( $mentor, 'evaluate' );

        return $method->invoke( $mentor, 'Council cuts library hours', array(), array(), 0, 3 );
    }

    public function test_full_response_is_decoded(): void
    {
        AiClient::$generatedText = json_encode(
            array(
                'guidance'    => 'Three sources is a start. Pin the ones that support your angle next.',
                'readiness'   => 'developing',
                'suggestions' => array(
                    array(
                        'label'     => 'Find expert reactions',
                        'assistant' => 'vip-workflow/assistant-hackernews',
                        'query'     => 'library funding cuts reaction',
                    ),
                ),
            )
        );

        $result = $this->evaluate();

        $this->assertIsArray( $result );
        $this->assertSame( 'developing', $result['readiness'] );
        $this->assertCount( 1, $result['suggestions'] );
        $this->assertSame( 'Find expert reactions', $result['suggestions'][0]['label'] );
    }

    /**
     * The ceiling must clear the payload the prompt asks for: prose guidance plus
     * up to three suggestion objects, which models at roughly 340 tokens.
     */
    public function test_ceiling_clears_the_requested_payload(): void
    {
        AiClient::$generatedText = '{"guidance":"ok","readiness":"developing","suggestions":[]}';

        $this->evaluate();

        $this->assertGreaterThanOrEqual( 1000, AiClient::$lastMaxTokens );
    }

    /**
     * A `length` finish reason is an observed fact from the provider, so it is
     * reported as truncation instead of being inferred from the broken payload.
     */
    public function test_length_finish_reason_is_reported_as_truncation(): void
    {
        AiClient::$finishReason  = 'length';
        AiClient::$generatedText = '{"guidance":"You have a nice tension building here between the two lists of best tac';

        $result = $this->evaluate();

        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'truncated_response', $result->get_error_code() );
        $this->assertStringContainsString( 'token limit', $result->get_error_message() );
        $this->assertStringNotContainsString( 'Failed to parse', $result->get_error_message() );
    }

    /**
     * A model that stopped on its own but emitted the wrong thing is still a
     * parse failure — truncation reporting must not swallow that case.
     */
    public function test_malformed_response_that_stopped_normally_is_still_a_parse_failure(): void
    {
        AiClient::$finishReason  = 'stop';
        AiClient::$generatedText = 'I am sorry, I cannot evaluate this ideation.';

        $result = $this->evaluate();

        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'parse_error', $result->get_error_code() );
    }

    public function test_result_without_candidates_is_reported(): void
    {
        AiClient::$emptyCandidates = true;

        $result = $this->evaluate();

        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'no_candidates', $result->get_error_code() );
    }
}
