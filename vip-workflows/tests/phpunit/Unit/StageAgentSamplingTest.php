<?php
/**
 * Sampling-option tests for stage-agent generation.
 *
 * `StageAgent::generate()` requests no sampling temperature and offers no seam to
 * pass one. Mechanical stages (reformatting, tag sanity) previously pinned it to 0
 * and promised stable output; newer Claude models refuse any request carrying the
 * option, and the AI Client's metadata advertises it as supported even on models
 * whose API rejects it, so it is no longer sent to anyone. These tests hold that
 * line: agent stages are not reproducible, and nothing may quietly start asking
 * for a temperature again.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use ReflectionMethod;
use VIPWorkflow\Abilities\Agents\StageAgent;
use WordPress\AiClient\AiClient;

require_once dirname( __DIR__, 3 ) . '/includes/abilities/agents/class-stage-agent.php';

/**
 * @covers \VIPWorkflow\Abilities\Agents\StageAgent::generate
 */
class StageAgentSamplingTest extends TestCase
{
    /**
     * Stand-in for the per-run verdict nonce.
     *
     * A constant rather than a repeated literal so the value the nonce is pinned
     * to and the value the stubbed model echoes cannot drift apart — that drift
     * is what made these tests fail.
     */
    private const VERDICT_TOKEN = 'stage-pass-token';

    protected function setUp(): void
    {
        parent::setUp();

        // Pin the per-run verdict nonce (StageAgent::verdict_token) so the stubbed
        // model can echo it as the pass verdict. These tests execute an agent end
        // to end, so they walk that path even though they assert on the sampling
        // options rather than on the verdict.
        Functions\when( 'wp_generate_password' )->justReturn( self::VERDICT_TOKEN );

        // AiInference/Credentials resolve provider/model via get_option; return
        // defaults so the stubbed AiClient drives generation.
        Functions\when( 'get_option' )->alias(
            static function ( $key, $default = false ) {
                return $default;
            }
        );

        AiClient::$throwMessage    = null;
        AiClient::$generatedText   = 'Generated text';
        AiClient::$lastTemperature = null;
        AiClient::$lastMaxTokens   = 0;
    }

    protected function tearDown(): void
    {
        AiClient::$throwMessage    = null;
        AiClient::$lastTemperature = null;
        parent::tearDown();
    }

    /**
     * Generation requests no temperature, so it cannot be refused by a model that
     * rejects the option.
     */
    public function test_generate_requests_no_temperature(): void
    {
        StageAgent::generate( 'reformat this', 2000 );

        $this->assertNull( AiClient::$lastTemperature );
    }

    /**
     * The token cap still reaches the client — removing the temperature seam left
     * the rest of the call intact.
     */
    public function test_generate_still_forwards_the_token_cap(): void
    {
        $result = StageAgent::generate( 'reason about this', 1500 );

        $this->assertSame( 1500, AiClient::$lastMaxTokens );
        $this->assertSame( 'Generated text', $result );
    }

    /**
     * There is no temperature parameter to pass. A parameter accepted and then
     * ignored would read as a working control, so the seam is gone rather than
     * neutered.
     */
    public function test_generate_exposes_no_temperature_parameter(): void
    {
        $parameters = array_map(
            static function ( \ReflectionParameter $parameter ): string {
                return $parameter->getName();
            },
            ( new ReflectionMethod( StageAgent::class, 'generate' ) )->getParameters()
        );

        $this->assertSame( array( 'prompt', 'max_tokens' ), $parameters );
    }

    /**
     * The mechanical stage that used to pin temperature 0 now requests none. This
     * runs the agent end to end, so it also covers the verdict-nonce path.
     */
    public function test_copy_edit_agent_requests_no_temperature(): void
    {
        require_once dirname( __DIR__, 4 ) . '/workflow-agent-copy-edit/workflow-agent-copy-edit.php';

        Functions\when( 'current_user_can' )->justReturn( true );
        Functions\when( 'get_post' )->justReturn(
            (object) array(
                'ID'           => 5,
                'post_title'   => 'A Story',
                'post_content' => '<p>Body.</p>',
            )
        );

        // Model reports the article already conforms — no write, but generation
        // still ran, so the options it requested are observable.
        //
        // That reply is this run's verdict nonce, not a static word: the verdict
        // became a per-run token so post content cannot force a pass by naming it,
        // and a static sentinel no longer counts. Echoing anything else takes the
        // write branch instead, which is not what this test is about.
        AiClient::$generatedText = self::VERDICT_TOKEN;

        \WorkflowAgentCopyEdit\execute( array( 'post_id' => 5 ) );

        $this->assertNull( AiClient::$lastTemperature );
    }
}
