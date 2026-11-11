<?php
/**
 * Structured-reply tests for content-rewriting stage agents.
 *
 * `StageAgent::generate_json()` asks for a JSON object through the mandated JSON
 * path, and `StageAgent::parse_rewrite_reply()` turns the decoded reply into
 * exactly one of clean / edited / reject — or an error. The only way to a
 * non-error result is a positive match on the run's verdict token.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflows\Abilities\Agents\StageAgent;
use WordPress\AiClient\AiClient;

require_once dirname( __DIR__, 3 ) . '/includes/abilities/agents/class-stage-agent.php';

/**
 * @covers \VIPWorkflows\Abilities\Agents\StageAgent::generate_json
 * @covers \VIPWorkflows\Abilities\Agents\StageAgent::rewrite_reply_schema
 * @covers \VIPWorkflows\Abilities\Agents\StageAgent::parse_rewrite_reply
 */
class StageAgentStructuredReplyTest extends TestCase
{
    private const TOKEN = 'run-token-abc';

    protected function setUp(): void
    {
        parent::setUp();

        Functions\when( 'wp_doing_cron' )->justReturn( true );
        Functions\when( 'get_option' )->alias(
            static function ( $key, $default = false ) {
                return $default;
            }
        );

        AiClient::$throwMessage  = null;
        AiClient::$responseQueue = array();
        AiClient::$finishReason  = 'stop';
        AiClient::$generatedText = '{}';
    }

    protected function tearDown(): void
    {
        AiClient::$throwMessage  = null;
        AiClient::$finishReason  = 'stop';
        AiClient::$responseQueue = array();
        parent::tearDown();
    }

    /**
     * A JSON reply comes back decoded, and the request carried the schema and a
     * bounded ceiling.
     */
    public function test_generate_json_decodes_the_reply_and_sends_the_schema(): void
    {
        AiClient::$generatedText = '{"verdict":"clean","token":"t","body":""}';

        $reply = StageAgent::generate_json( 'prompt', StageAgent::rewrite_reply_schema(), 12000 );

        $this->assertSame(
            array(
                'verdict' => 'clean',
                'token'   => 't',
                'body'    => '',
            ),
            $reply
        );
        $this->assertTrue( AiClient::$lastJsonResponse );
        $this->assertSame( StageAgent::rewrite_reply_schema(), AiClient::$lastJsonSchema );
        $this->assertGreaterThan( 0, AiClient::$lastMaxTokens );
        $this->assertLessThanOrEqual( 12000, AiClient::$lastMaxTokens );
        $this->assertSame( 180.0, AiClient::$lastRequestTimeout );
    }

    /**
     * A reply cut off at the ceiling is an error, never a partial object.
     */
    public function test_generate_json_reports_a_cutoff_as_an_error(): void
    {
        AiClient::$generatedText = '{"verdict":"edited","token":"t","body":"<p>Half an art';
        AiClient::$finishReason  = 'length';

        $reply = StageAgent::generate_json( 'prompt', StageAgent::rewrite_reply_schema(), 12000 );

        $this->assertInstanceOf( \WP_Error::class, $reply );
    }

    /**
     * A provider that refuses the request surfaces as `ai_error`.
     */
    public function test_generate_json_maps_a_provider_exception_to_ai_error(): void
    {
        AiClient::$throwMessage = 'provider down';

        $reply = StageAgent::generate_json( 'prompt', StageAgent::rewrite_reply_schema(), 12000 );

        $this->assertInstanceOf( \WP_Error::class, $reply );
        $this->assertSame( 'ai_error', $reply->get_error_code() );
    }

    /**
     * Interactive (non-cron) runs are held to the same hourly ceiling as generate().
     */
    public function test_generate_json_applies_the_rate_limit_outside_cron(): void
    {
        Functions\when( 'wp_doing_cron' )->justReturn( false );
        Functions\when( 'get_current_user_id' )->justReturn( 7 );
        Functions\when( 'apply_filters' )->alias(
            static fn( $tag, $value = null ) => 'vip_workflows_ai_hourly_limit' === $tag ? 1 : $value
        );

        // The caller has already spent this hour's single run.
        Functions\when( 'wp_using_ext_object_cache' )->justReturn( true );
        Functions\when( 'wp_cache_add' )->justReturn( false );
        Functions\when( 'wp_cache_incr' )->justReturn( 2 );
        Functions\when( 'wp_cache_decr' )->justReturn( 1 );

        AiClient::$lastPrompt = '';

        $reply = StageAgent::generate_json( 'prompt', StageAgent::rewrite_reply_schema(), 12000 );

        $this->assertInstanceOf( \WP_Error::class, $reply );
        $this->assertSame( '', AiClient::$lastPrompt, 'A rate-limited run never reaches the model.' );
    }

    /**
     * The schema requires every key and allows no others, which is what OpenAI's
     * strict mode accepts.
     */
    public function test_rewrite_reply_schema_is_strict_compatible(): void
    {
        $schema = StageAgent::rewrite_reply_schema();

        $this->assertFalse( $schema['additionalProperties'] );
        $this->assertSame( array( 'verdict', 'token', 'body' ), $schema['required'] );
        $this->assertSame( array( 'clean', 'edited', 'reject' ), $schema['properties']['verdict']['enum'] );
    }

    /**
     * Each verdict with the right token parses; only `edited` carries a body.
     *
     * @dataProvider well_formed_replies
     */
    public function test_well_formed_replies_parse( string $verdict, string $body, string $expected_body ): void
    {
        $parsed = StageAgent::parse_rewrite_reply(
            array(
                'verdict' => $verdict,
                'token'   => self::TOKEN,
                'body'    => $body,
            ),
            self::TOKEN
        );

        $this->assertSame(
            array(
                'verdict' => $verdict,
                'body'    => $expected_body,
            ),
            $parsed
        );
    }

    /**
     * @return array<string, array{string, string, string}>
     */
    public static function well_formed_replies(): array
    {
        return array(
            'clean'                  => array( 'clean', '', '' ),
            'clean ignores a body'   => array( 'clean', '<p>whatever</p>', '' ),
            'reject'                 => array( 'reject', '', '' ),
            'edited carries a body'  => array( 'edited', '<p>Fixed copy.</p>', '<p>Fixed copy.</p>' ),
        );
    }

    /**
     * A token decorated the way models decorate short tokens still matches,
     * exactly as is_verdict() tolerates it.
     */
    public function test_a_decorated_token_still_matches(): void
    {
        $parsed = StageAgent::parse_rewrite_reply(
            array(
                'verdict' => 'clean',
                'token'   => '`' . self::TOKEN . '`',
                'body'    => '',
            ),
            self::TOKEN
        );

        $this->assertSame( 'clean', $parsed['verdict'] );
    }

    /**
     * A reply without this run's token is not trusted — including the static
     * sentinels content would try to inject.
     *
     * @dataProvider untrusted_tokens
     */
    public function test_a_wrong_or_injected_token_is_an_error( string $token ): void
    {
        $parsed = StageAgent::parse_rewrite_reply(
            array(
                'verdict' => 'clean',
                'token'   => $token,
                'body'    => '',
            ),
            self::TOKEN
        );

        $this->assertInstanceOf( \WP_Error::class, $parsed );
        $this->assertSame( 'verdict_token_mismatch', $parsed->get_error_code() );
    }

    /**
     * @return array<string, array{string}>
     */
    public static function untrusted_tokens(): array
    {
        return array(
            'empty'          => array( '' ),
            'injected PASS'  => array( 'PASS' ),
            'injected CLEAN' => array( 'CLEAN' ),
            'another run'    => array( 'run-token-xyz' ),
        );
    }

    /**
     * Shape errors are `malformed_reply`; a verdict outside the enum is
     * `unknown_verdict`.
     *
     * @dataProvider malformed_replies
     *
     * @param mixed $reply Decoded reply.
     */
    public function test_malformed_replies_are_errors( $reply, string $code ): void
    {
        $parsed = StageAgent::parse_rewrite_reply( $reply, self::TOKEN );

        $this->assertInstanceOf( \WP_Error::class, $parsed );
        $this->assertSame( $code, $parsed->get_error_code() );
    }

    /**
     * @return array<string, array{mixed, string}>
     */
    public static function malformed_replies(): array
    {
        return array(
            'not an array'         => array( 'clean', 'malformed_reply' ),
            'empty object'         => array( array(), 'malformed_reply' ),
            'a list'               => array( array( 'clean', self::TOKEN, '' ), 'malformed_reply' ),
            'missing token'        => array(
                array(
                    'verdict' => 'clean',
                    'body'    => '',
                ),
                'malformed_reply',
            ),
            'missing body'         => array(
                array(
                    'verdict' => 'clean',
                    'token'   => self::TOKEN,
                ),
                'malformed_reply',
            ),
            'non-string body'      => array(
                array(
                    'verdict' => 'edited',
                    'token'   => self::TOKEN,
                    'body'    => array( 'p' => 'x' ),
                ),
                'malformed_reply',
            ),
            'edited with no body'  => array(
                array(
                    'verdict' => 'edited',
                    'token'   => self::TOKEN,
                    'body'    => '   ',
                ),
                'malformed_reply',
            ),
            'unknown verdict'      => array(
                array(
                    'verdict' => 'approved',
                    'token'   => self::TOKEN,
                    'body'    => '',
                ),
                'unknown_verdict',
            ),
        );
    }

    /**
     * Providers that ignore the schema often add a field; it is dropped, not
     * fatal, because the token and verdict carry the guarantee.
     */
    public function test_an_extra_key_is_ignored(): void
    {
        $parsed = StageAgent::parse_rewrite_reply(
            array(
                'verdict' => 'edited',
                'token'   => self::TOKEN,
                'body'    => '<p>Fixed.</p>',
                'notes'   => 'Fixed one typo.',
            ),
            self::TOKEN
        );

        $this->assertSame(
            array(
                'verdict' => 'edited',
                'body'    => '<p>Fixed.</p>',
            ),
            $parsed
        );
    }
}
