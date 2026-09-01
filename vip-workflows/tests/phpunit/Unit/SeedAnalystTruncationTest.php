<?php
/**
 * Seed Analyst truncation-reporting tests.
 *
 * The seed analysis prompt asks for tags, entity groups, search queries, a news
 * angle and a suggested title in one object, and the call site used to discard
 * the provider's finish reason — so a reply cut off at the 500-token ceiling
 * arrived as a parse failure. These guard that it now reports truncation, and
 * that a genuinely malformed reply still reports a parse failure.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use ReflectionMethod;
use VIPWorkflows\AI\CorePrompts;
use VIPWorkflows\AI\PromptRegistry;
use VIPWorkflows\AI\PromptSettings;
use VIPWorkflows\Ideation\Assistants\SeedAnalyst;
use WordPress\AiClient\AiClient;
use WP_Error;

require_once __DIR__ . '/../../../includes/ideation/assistants/class-seed-analyst.php';

/**
 * @covers \VIPWorkflows\Ideation\Assistants\SeedAnalyst
 */
class SeedAnalystTruncationTest extends TestCase
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
                if ( 'vip_workflows_ai_model' === $option ) {
                    return 'gpt-4o-mini';
                }
                if ( 'vip_workflows_prompts' === $option ) {
                    return array();
                }
                return $default;
            }
        );
        Functions\when( '_doing_it_wrong' )->justReturn( null );

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
     * Invoke the private analysis with a minimal seed.
     *
     * @return array|WP_Error
     */
    private function analyze()
    {
        $analyst = new SeedAnalyst();
        $method  = new ReflectionMethod( $analyst, 'analyze_seed' );

        return $method->invoke( $analyst, 'Council cuts library hours', array() );
    }

    public function test_full_response_is_decoded(): void
    {
        AiClient::$generatedText = json_encode(
            array(
                'tags'            => array( 'libraries', 'budget' ),
                'entities'        => array( 'people' => array( 'Mayor Diaz' ) ),
                'search_queries'  => array( 'library funding cuts' ),
                'news_angle'      => 'Branch closures land hardest in the east end.',
                'suggested_title' => 'The quiet closing of the east end branch',
            )
        );

        $result = $this->analyze();

        $this->assertIsArray( $result );
        $this->assertSame( array( 'libraries', 'budget' ), $result['tags'] );
        $this->assertSame( array( 'Mayor Diaz' ), $result['entities']['people'] );
        $this->assertSame( 'The quiet closing of the east end branch', $result['suggested_title'] );
    }

    public function test_length_finish_reason_is_reported_as_truncation(): void
    {
        AiClient::$finishReason  = 'length';
        AiClient::$generatedText = '{"tags":["libraries","budget"],"entities":{"people":["Mayor Di';

        $result = $this->analyze();

        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'truncated_response', $result->get_error_code() );
        $this->assertStringContainsString( 'token limit', $result->get_error_message() );
        $this->assertStringNotContainsString( 'Failed to parse', $result->get_error_message() );
    }

    public function test_malformed_response_that_stopped_normally_is_still_a_parse_failure(): void
    {
        AiClient::$generatedText = 'I cannot analyze that seed.';

        $result = $this->analyze();

        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'parse_error', $result->get_error_code() );
    }

    public function test_result_without_candidates_is_reported(): void
    {
        AiClient::$emptyCandidates = true;

        $result = $this->analyze();

        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'no_candidates', $result->get_error_code() );
    }

    /**
     * `run()` surfaces the truncation message to its caller rather than replacing
     * it with a generic failure.
     */
    public function test_run_surfaces_the_truncation_message(): void
    {
        AiClient::$finishReason  = 'length';
        AiClient::$generatedText = '{"tags":["libraries"';

        Functions\when( 'get_transient' )->justReturn( false );
        Functions\when( 'set_transient' )->justReturn( true );

        $result = ( new SeedAnalyst() )->run( array( 'seed' => 'Council cuts library hours' ) );

        $this->assertSame( 'failed', $result['status'] );
        $this->assertStringContainsString( 'token limit', $result['error'] );
    }
}
