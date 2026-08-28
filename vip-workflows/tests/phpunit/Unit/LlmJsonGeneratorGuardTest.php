<?php
/**
 * Source guard keeping the finish-reason check on the only path to parsed JSON.
 *
 * `AiClient::prompt( … )->generateText()` is sugar for
 * `generateTextResult()->toText()` and therefore throws away the finish reason.
 * Three separate call sites reached for it and reported a reply cut off at the
 * token ceiling as a parse failure — not because anyone decided to skip the
 * check, but because the convenient method was there and the check was a
 * convention. A convention that has already been skipped three times is not a
 * guarantee, so this makes it one: the finish-reason-bearing terminal call has
 * exactly one owner and the parser has exactly one caller, so a new caller that
 * goes around them turns the suite red rather than shipping.
 *
 * The two owners are different files because the check is not JSON-specific.
 * Free-text callers hit the same ceiling — reasoning is billed against the same
 * budget as the reply, so an exhausted budget yields a candidate with no content
 * part — so LlmTextGenerator owns the terminal call and the finish reason, and
 * LlmJsonGenerator adds parsing on top of it.
 *
 * These are assertions about source text, so they hold for every plugin in the
 * repo, including the extension plugins that reach into core's Integrations.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use PHPUnit\Framework\TestCase;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;

class LlmJsonGeneratorGuardTest extends TestCase
{
    private const REPO_ROOT = __DIR__ . '/../../../../';

    /**
     * The one file allowed to own the finish-reason-bearing terminal call.
     *
     * Free-text callers need the same check JSON callers do — a reply spent entirely
     * on model reasoning comes back with no content part at all — so the reading of
     * the finish reason lives here and the JSON generator is layered on top of it.
     * One owner, one implementation, whatever shape the caller wants back.
     */
    private const TEXT_GENERATOR = 'vip-workflows/includes/integrations/class-llm-text-generator.php';

    /**
     * The one file allowed to reach the JSON parser.
     */
    private const JSON_GENERATOR = 'vip-workflows/includes/integrations/class-llm-json-generator.php';

    /**
     * Chains that decode JSON purely as an enhancement, where a cut-off reply is
     * discarded and the feature degrades instead of failing.
     *
     * LLM re-ranking of WordPress search results falls back to the order the query
     * already returned, so a truncated reply costs result quality and nothing else.
     * There is no user-visible error for a finish reason to improve. Anything whose
     * failure does reach a user belongs behind the generator, and adding a file here
     * is a deliberate edit to a test, visible in review — which is the point.
     *
     * @var string[]
     */
    private const OPTIONAL_JSON_CHAINS = array(
        'vip-workflows/includes/ideation/assistants/class-llm-assisted-wp-search.php',
    );

    /**
     * Every PHP source file under any plugin's includes/ directory.
     *
     * @return array<string, string> Repo-relative path => contents.
     */
    private function plugin_sources(): array
    {
        $roots = glob( self::REPO_ROOT . '*/includes', GLOB_ONLYDIR );
        $this->assertNotEmpty( $roots, 'No plugin includes/ directories found.' );

        $repo_root = realpath( self::REPO_ROOT );
        $sources   = array();

        foreach ( $roots as $root ) {
            $iterator = new RecursiveIteratorIterator(
                new RecursiveDirectoryIterator( $root, RecursiveDirectoryIterator::SKIP_DOTS )
            );

            foreach ( $iterator as $file ) {
                if ( ! $file->isFile() || 'php' !== $file->getExtension() ) {
                    continue;
                }

                $relative = str_replace(
                    array( $repo_root . DIRECTORY_SEPARATOR, DIRECTORY_SEPARATOR ),
                    array( '', '/' ),
                    (string) $file->getRealPath()
                );

                $sources[ $relative ] = (string) file_get_contents( $file->getRealPath() );
            }
        }

        return $sources;
    }

    /**
     * Statements starting at an `AiClient::prompt(` call, one per builder chain.
     *
     * @param string $contents File contents.
     * @return string[]
     */
    private function ai_client_chains( string $contents ): array
    {
        $segments = explode( 'AiClient::prompt(', $contents );
        array_shift( $segments );

        return array_map(
            function ( string $segment ): string {
                $end = strpos( $segment, ';' );
                return false === $end ? $segment : substr( $segment, 0, $end );
            },
            $segments
        );
    }

    public function test_the_generator_files_exist_where_the_guard_expects_them(): void
    {
        foreach ( array( self::TEXT_GENERATOR, self::JSON_GENERATOR ) as $generator ) {
            $this->assertFileExists(
                self::REPO_ROOT . $generator,
                'The guards below are vacuous if a generator has moved.'
            );
        }
    }

    /**
     * `generateTextResult()` is the only terminal call that carries a finish
     * reason. Confining it to one file means no other file can read the reason and
     * then decide not to act on it.
     */
    public function test_only_the_text_generator_makes_the_finish_reason_bearing_call(): void
    {
        $offenders = array();

        foreach ( $this->plugin_sources() as $path => $contents ) {
            if ( self::TEXT_GENERATOR === $path ) {
                continue;
            }
            if ( str_contains( $contents, 'generateTextResult(' ) ) {
                $offenders[] = $path;
            }
        }

        $this->assertSame(
            array(),
            $offenders,
            'These files call generateTextResult() directly. Pass the configured builder to '
                . 'VIPWorkflow\Integrations\LlmTextGenerator::generate() (or ::LlmJsonGenerator::generate() '
                . 'for JSON) instead, so the finish reason is read before the text is used.'
        );
    }

    /**
     * The parser is reachable only through the generator, so the finish-reason
     * check cannot be bypassed by parsing raw text somewhere else.
     */
    public function test_only_the_generator_reaches_the_json_parser(): void
    {
        $offenders = array();

        foreach ( $this->plugin_sources() as $path => $contents ) {
            if ( self::JSON_GENERATOR === $path ) {
                continue;
            }
            if ( str_contains( $contents, 'LlmJsonParser::' ) ) {
                $offenders[] = $path;
            }
        }

        $this->assertSame(
            array(),
            $offenders,
            'These files use LlmJsonParser directly, which skips the finish-reason check. '
                . 'Call VIPWorkflow\Integrations\LlmJsonGenerator::generate() with the configured builder.'
        );
    }

    /**
     * A chain that asks for JSON must not end in `generateText()`, the call whose
     * whole problem is that it discards the reason the model stopped.
     */
    public function test_no_json_chain_ends_in_the_reason_discarding_call(): void
    {
        $offenders = array();

        foreach ( $this->plugin_sources() as $path => $contents ) {
            if ( in_array( $path, self::OPTIONAL_JSON_CHAINS, true ) ) {
                continue;
            }

            foreach ( $this->ai_client_chains( $contents ) as $chain ) {
                if ( str_contains( $chain, 'asJsonResponse(' ) && str_contains( $chain, 'generateText(' ) ) {
                    $offenders[] = $path;
                    break;
                }
            }
        }

        $this->assertSame(
            array(),
            $offenders,
            'These files request JSON and then call generateText(), which discards the finish '
                . 'reason and turns a reply cut off at the token ceiling into a parse error. '
                . 'Hand the builder to VIPWorkflow\Integrations\LlmJsonGenerator::generate().'
        );
    }

    /**
     * The allowlist is only defensible while every entry in it is real; a stale
     * path would silently exempt nothing and hide the next offender behind a name
     * nobody rechecks.
     */
    public function test_every_allowlisted_chain_still_exists(): void
    {
        foreach ( self::OPTIONAL_JSON_CHAINS as $path ) {
            $this->assertFileExists( self::REPO_ROOT . $path );

            $chains = $this->ai_client_chains( (string) file_get_contents( self::REPO_ROOT . $path ) );
            $found  = false;
            foreach ( $chains as $chain ) {
                if ( str_contains( $chain, 'asJsonResponse(' ) && str_contains( $chain, 'generateText(' ) ) {
                    $found = true;
                    break;
                }
            }

            $this->assertTrue(
                $found,
                sprintf( '%s no longer needs its allowlist entry; remove it.', $path )
            );
        }
    }
}
