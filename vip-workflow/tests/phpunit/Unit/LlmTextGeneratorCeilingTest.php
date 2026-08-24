<?php
/**
 * Source guard keeping every AI token ceiling above the measured thinking cost.
 *
 * A thinking model's reasoning is billed against the same `max_tokens` as its
 * reply and the model is never told what the cap is, so a ceiling sized against
 * the expected answer alone can be spent entirely on reasoning — yielding a
 * candidate with a thought part, no content part, and a `length` finish reason.
 * That is a whole class of bug that does not look like one at the call site: the
 * number reads as generous for the payload, and it is, which is exactly why every
 * caller in the plugin was written under it.
 *
 * `LlmTextGenerator` reports the cutoff, and `LlmJsonGeneratorGuardTest` keeps
 * that reporting on the only path to usable output. Neither prevents the ceiling
 * being too low in the first place, and a caller cannot be relied on to remember
 * a cost that has nothing to do with the payload in front of them. So this asserts
 * the floor instead of documenting it: a ceiling below the measured reasoning cost
 * turns the suite red rather than shipping as a truncation an editor has to report.
 *
 * The specific numbers are deliberately not asserted. Sizing is a judgement about
 * a payload and belongs in the comment at each call site, where it can be reviewed
 * against the prompt; pinning it here would only make correct re-sizing fail. The
 * floor is the part that is not a judgement call.
 *
 * These are assertions about source text, so they hold for every plugin in the
 * repo — the extension plugins that reach into core's Integrations included.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use RecursiveCallbackFilterIterator;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use SplFileInfo;
use VIPWorkflow\Integrations\LlmTextGenerator;

class LlmTextGeneratorCeilingTest extends TestCase
{
    private const REPO_ROOT = __DIR__ . '/../../../../';

    /**
     * Directory names never scanned: dependencies, build output, and the tests
     * themselves, whose stub-driven ceilings assert generator behavior rather than
     * configure a real provider call.
     *
     * Pruned during traversal rather than filtered afterwards — `node_modules` alone
     * is large enough to dominate this test's runtime if walked.
     *
     * @var string[]
     */
    private const SKIP_DIRS = array( 'vendor', 'node_modules', 'build', 'tests' );

    /**
     * Ceiling arguments that name something this test cannot resolve from source,
     * each with why it is nonetheless covered.
     *
     * Both are indirections rather than exemptions — the value still has to clear
     * the floor, it just does so somewhere the regex cannot see. Adding an entry
     * here is a deliberate edit to a test, visible in review, which is the point.
     *
     * @var array<string, string>
     */
    private const RESOLVED_ELSEWHERE = array(
        // Defined from THINKING_FLOOR, asserted below.
        'self::DRAFT_MAX_TOKENS' => 'vip-workflow/includes/api/class-ideation-controller.php',
        // The stage agents' ceiling, bounded and held in a local before use; the
        // literals the agents pass and the parameter's own default are both asserted
        // below.
        '$bounded_max_tokens'    => 'vip-workflow/includes/abilities/agents/class-stage-agent.php',
    );

    /**
     * Every PHP source file in every plugin, keyed by repo-relative path.
     *
     * Scans whole plugin directories rather than just `includes/`, because the stage
     * agents are single-file plugins whose ceiling sits at the plugin root.
     *
     * @return array<string, string> Repo-relative path => contents.
     */
    private function plugin_sources(): array
    {
        $repo_root = realpath( self::REPO_ROOT );
        $this->assertNotFalse( $repo_root, 'Could not resolve the repo root.' );

        $sources = array();

        foreach ( glob( $repo_root . '/*', GLOB_ONLYDIR ) as $plugin ) {
            if ( in_array( basename( $plugin ), self::SKIP_DIRS, true ) ) {
                continue;
            }

            $iterator = new RecursiveIteratorIterator(
                new RecursiveCallbackFilterIterator(
                    new RecursiveDirectoryIterator( $plugin, RecursiveDirectoryIterator::SKIP_DOTS ),
                    static function ( SplFileInfo $file ): bool {
                        return $file->isDir()
                            ? ! in_array( $file->getFilename(), self::SKIP_DIRS, true )
                            : 'php' === $file->getExtension();
                    }
                )
            );

            foreach ( $iterator as $file ) {
                $relative = str_replace(
                    array( $repo_root . DIRECTORY_SEPARATOR, DIRECTORY_SEPARATOR ),
                    array( '', '/' ),
                    (string) $file->getRealPath()
                );

                $sources[ $relative ] = (string) file_get_contents( $file->getRealPath() );
            }
        }

        $this->assertNotEmpty( $sources, 'No plugin PHP sources found; the guards below would be vacuous.' );

        return $sources;
    }

    /**
     * Matches the `bounded_max_tokens()` wrapper around a ceiling argument.
     *
     * The class may be named bare or fully qualified depending on the call site's
     * imports, and both spellings are the same call.
     *
     * @var string
     */
    private const BOUNDED_WRAPPER = '/^(?:\\\\?[A-Za-z_\\\\]+::)?bounded_max_tokens\(\s*(.+)$/';

    /**
     * Every argument passed to `usingMaxTokens()`, as written.
     *
     * The regex is non-greedy, so on a wrapped ceiling it stops at the wrapper's
     * own closing paren and returns `bounded_max_tokens( <expression>`. Strip that
     * prefix so the floor guard below reads the expression the caller actually
     * sized, rather than a string that merely contains it.
     *
     * @param string $contents File contents.
     * @return string[] Trimmed argument expressions, unwrapped.
     */
    private function ceiling_arguments( string $contents ): array
    {
        return array_map(
            fn ( string $expression ): string => $this->unwrap( $expression ),
            $this->raw_ceiling_arguments( $contents )
        );
    }

    /**
     * Every argument passed to `usingMaxTokens()`, wrapper still attached.
     *
     * @param string $contents File contents.
     * @return string[] Trimmed argument expressions.
     */
    private function raw_ceiling_arguments( string $contents ): array
    {
        preg_match_all( '/usingMaxTokens\(\s*(.+?)\s*\)/', $contents, $matches );

        return $matches[1];
    }

    /**
     * Strip the `bounded_max_tokens()` wrapper from a ceiling expression.
     *
     * @param string $expression The argument as written.
     * @return string The inner expression, or the input unchanged when unwrapped.
     */
    private function unwrap( string $expression ): string
    {
        return preg_match( self::BOUNDED_WRAPPER, $expression, $matches )
            ? trim( $matches[1] )
            : $expression;
    }

    /**
     * Judge one ceiling expression, returning null when it clears the floor.
     *
     * @param string $expression The argument as written.
     * @return string|null Why it fails, or null when it passes.
     */
    private function shortfall( string $expression ): ?string
    {
        if ( isset( self::RESOLVED_ELSEWHERE[ $expression ] ) ) {
            return null;
        }

        if ( str_contains( $expression, 'THINKING_FLOOR' ) ) {
            /*
             * `THINKING_FLOOR + n` is floor-compliant by construction for any n >= 0,
             * so the arithmetic does not need evaluating — only the direction does.
             * Subtraction would walk back under the floor while still naming it, which
             * would read as compliant to everyone including this test.
             */
            return str_contains( $expression, '-' )
                ? 'subtracts from THINKING_FLOOR, which puts it back under the floor'
                : null;
        }

        if ( ! ctype_digit( $expression ) ) {
            return sprintf(
                'is the unresolvable expression `%s`; express it in terms of '
                    . 'LlmTextGenerator::THINKING_FLOOR, or add it to RESOLVED_ELSEWHERE '
                    . 'with an assertion covering the value it resolves to',
                $expression
            );
        }

        $ceiling = (int) $expression;

        return $ceiling < LlmTextGenerator::THINKING_FLOOR
            ? sprintf( 'is %d, below the %d-token floor', $ceiling, LlmTextGenerator::THINKING_FLOOR )
            : null;
    }

    public function test_no_caller_configures_a_ceiling_below_the_thinking_floor(): void
    {
        $offenders = array();

        foreach ( $this->plugin_sources() as $path => $contents ) {
            foreach ( $this->ceiling_arguments( $contents ) as $expression ) {
                $shortfall = $this->shortfall( $expression );
                if ( null !== $shortfall ) {
                    $offenders[] = sprintf( '%s: %s', $path, $shortfall );
                }
            }
        }

        $this->assertSame(
            array(),
            $offenders,
            "These token ceilings do not clear the reasoning cost billed against them, so the "
                . "budget can be spent entirely on model thinking and the reply come back empty:\n"
                . implode( "\n", $offenders )
        );
    }

    /**
     * A floor keeps a ceiling above the reasoning cost; it says nothing about the
     * other end. A ceiling above what the resolved model accepts is refused by the
     * provider outright — an HTTP 400 for the whole request, with no candidate to
     * read a finish reason from, so none of the cutoff reporting this class does
     * ever runs. That failure mode is one raised floor away at all times: the PDF
     * path already asks for 16,000 against `gpt-4o`'s 16,384.
     *
     * `bounded_max_tokens()` is what keeps the two ends compatible, and it only
     * works where it is actually called. Callers configure the builder themselves
     * and several never reach `generate()` at all, so nothing downstream can apply
     * the clamp on their behalf — which makes an unwrapped `usingMaxTokens()` a
     * silent opt-out of it.
     */
    public function test_every_ceiling_is_bounded_by_the_models_output_cap(): void
    {
        $offenders = array();
        $found     = 0;

        foreach ( $this->plugin_sources() as $path => $contents ) {
            foreach ( $this->raw_ceiling_arguments( $contents ) as $expression ) {
                ++$found;

                if ( isset( self::RESOLVED_ELSEWHERE[ $expression ] ) ) {
                    continue;
                }

                if ( 1 !== preg_match( self::BOUNDED_WRAPPER, $expression ) ) {
                    $offenders[] = sprintf( '%s: `%s`', $path, $expression );
                }
            }
        }

        $this->assertGreaterThan( 0, $found, 'No ceilings found; this guard would be vacuous.' );

        $this->assertSame(
            array(),
            $offenders,
            "These ceilings are passed to the provider unbounded, so a model whose output "
                . "limit is lower refuses the request outright instead of returning a short "
                . "reply. Wrap the argument in LlmTextGenerator::bounded_max_tokens():\n"
                . implode( "\n", $offenders )
        );
    }

    /**
     * The stage agents' ceiling is exempt from the guard above only because it is
     * bounded once into a local and reused, so that a cutoff can report the figure
     * the request actually carried. Assert that assignment, because nothing else
     * does.
     */
    public function test_the_stage_agent_ceiling_is_bounded_before_use(): void
    {
        $path = self::RESOLVED_ELSEWHERE['$bounded_max_tokens'];
        $this->assertFileExists( self::REPO_ROOT . $path );

        $this->assertMatchesRegularExpression(
            '/\$bounded_max_tokens\s*=\s*LlmTextGenerator::bounded_max_tokens\(\s*\$max_tokens\s*\)\s*;/',
            (string) file_get_contents( self::REPO_ROOT . $path ),
            'StageAgent passes a local rather than a bounded expression, so the bounding '
                . 'guard cannot see it. That local must come from bounded_max_tokens().'
        );
    }

    /**
     * A ceiling above the model's cap comes back as the cap.
     */
    public function test_a_ceiling_above_the_models_cap_is_clamped(): void
    {
        Functions\expect( '_doing_it_wrong' )->once();

        $this->assertSame(
            4096,
            LlmTextGenerator::bounded_max_tokens( LlmTextGenerator::THINKING_FLOOR + 10000, 'gpt-4-turbo' )
        );
    }

    /**
     * A ceiling the model can serve is passed through untouched — including the one
     * that clears its cap by the smallest margin in the repo, which is the case a
     * clamp implemented with the wrong comparison would quietly reduce.
     */
    public function test_a_ceiling_within_the_models_cap_is_untouched(): void
    {
        Functions\expect( '_doing_it_wrong' )->never();

        $this->assertSame(
            16000,
            LlmTextGenerator::bounded_max_tokens( 16000, 'gpt-4o' ),
            'The PDF ceiling fits gpt-4o by 384 tokens and must not be clamped.'
        );

        $this->assertSame(
            LlmTextGenerator::MODEL_OUTPUT_CAPS['gpt-4o'],
            LlmTextGenerator::bounded_max_tokens( LlmTextGenerator::MODEL_OUTPUT_CAPS['gpt-4o'], 'gpt-4o' ),
            'A ceiling exactly at the cap is acceptable to the provider, so it is not clamped.'
        );
    }

    /**
     * A model the table does not list is returned unclamped rather than cut to a
     * guessed value. The AI Client cannot supply these numbers, so an unlisted model
     * is the normal case for anything outside the verified set — clamping it to a
     * conservative constant would degrade every one of them to protect against a
     * limit that may not exist.
     */
    public function test_an_unlisted_model_is_not_clamped(): void
    {
        Functions\expect( '_doing_it_wrong' )->never();

        $requested = LlmTextGenerator::THINKING_FLOOR + 10000;

        $this->assertArrayNotHasKey( 'some-unreleased-model', LlmTextGenerator::MODEL_OUTPUT_CAPS );
        $this->assertSame(
            $requested,
            LlmTextGenerator::bounded_max_tokens( $requested, 'some-unreleased-model' )
        );
    }

    /**
     * An unresolvable provider selection leaves the model id empty. That is already
     * reported by `AiInference`, and the generation is going to fail regardless, so
     * this must not add a second diagnostic or invent a ceiling for it.
     */
    public function test_an_empty_model_id_is_not_clamped(): void
    {
        Functions\expect( '_doing_it_wrong' )->never();

        $this->assertSame( 20000, LlmTextGenerator::bounded_max_tokens( 20000, '' ) );
    }

    /**
     * Clamping reports itself. A silently reduced budget is spent on reasoning and
     * comes back as the truncation `generate()` reports, which tells an editor the
     * ceiling is too low and points an administrator at a number that is no longer
     * the binding one — undoing the reporting the cutoff path exists to provide.
     */
    public function test_a_clamp_names_the_model_and_both_figures(): void
    {
        $message = '';

        Functions\expect( '_doing_it_wrong' )
            ->once()
            ->andReturnUsing(
                static function ( $function, $notice ) use ( &$message ): void {
                    $message = (string) $notice;
                }
            );

        LlmTextGenerator::bounded_max_tokens( 20000, 'gpt-4' );

        $this->assertStringContainsString( 'gpt-4', $message );
        $this->assertStringContainsString( '20000', $message );
        $this->assertStringContainsString( '8192', $message );
    }

    /**
     * A cap beneath the reasoning cost is a different message, because the advice
     * differs: no ceiling makes that model work here, so telling an administrator
     * to raise one would send them in a circle. The model has to change.
     */
    public function test_a_cap_below_the_floor_says_the_model_cannot_be_used(): void
    {
        $message = '';

        Functions\expect( '_doing_it_wrong' )
            ->once()
            ->andReturnUsing(
                static function ( $function, $notice ) use ( &$message ): void {
                    $message = (string) $notice;
                }
            );

        $this->assertLessThan(
            LlmTextGenerator::THINKING_FLOOR,
            LlmTextGenerator::MODEL_OUTPUT_CAPS['gpt-4-turbo'],
            'This test is only meaningful while the model it names caps below the floor.'
        );

        LlmTextGenerator::bounded_max_tokens( LlmTextGenerator::THINKING_FLOOR, 'gpt-4-turbo' );

        $this->assertStringContainsString( 'reasoning', $message );
        $this->assertStringContainsString( 'settings', $message );
    }

    /**
     * One misconfigured ceiling reports once, not once per generation. An ideation
     * run makes many calls, and dozens of identical notices bury the one line that
     * matters.
     */
    public function test_an_identical_clamp_is_reported_once_per_request(): void
    {
        Functions\expect( '_doing_it_wrong' )->once();

        for ( $i = 0; $i < 3; $i++ ) {
            $this->assertSame( 8192, LlmTextGenerator::bounded_max_tokens( 20000, 'gpt-4' ) );
        }
    }

    /**
     * The two entries the supported-set documentation is written against, pinned to
     * the figures that were measured against the live models. The rest of the table
     * is published vendor data; these two are the ones with evidence behind them,
     * and a drift here would silently move what that document claims.
     */
    public function test_the_verified_models_keep_their_measured_caps(): void
    {
        $this->assertSame(
            array(
                'claude-sonnet-5' => 128000,
                'gpt-4o'          => 16384,
            ),
            array_intersect_key(
                LlmTextGenerator::MODEL_OUTPUT_CAPS,
                array( 'claude-sonnet-5' => true, 'gpt-4o' => true )
            ),
            'These caps are cited by docs/reference/ai-supported-models.md as verified '
                . 'against the live models. Re-verify before changing either.'
        );
    }

    /**
     * The floor is only a floor while something is measured against it. A ceiling
     * expressed in terms of `THINKING_FLOOR` passes the guard above without its
     * literal ever being read, so a floor that had drifted to a value below the
     * measured reasoning cost would take every one of those callers with it.
     */
    public function test_the_floor_still_clears_the_measured_reasoning_cost(): void
    {
        $this->assertGreaterThanOrEqual(
            4000,
            LlmTextGenerator::THINKING_FLOOR,
            'Reasoning measured ~3,900-4,000 tokens against claude-sonnet-5 and is billed '
                . 'against the same budget as the reply, so a floor beneath it guarantees '
                . 'nothing. Re-measure before lowering this.'
        );
    }

    /**
     * The one named ceiling the guard cannot evaluate, checked at its definition.
     */
    public function test_the_draft_ceiling_is_defined_from_the_floor(): void
    {
        $path = self::RESOLVED_ELSEWHERE['self::DRAFT_MAX_TOKENS'];
        $this->assertFileExists( self::REPO_ROOT . $path );

        $this->assertMatchesRegularExpression(
            '/DRAFT_MAX_TOKENS\s*=\s*LlmTextGenerator::THINKING_FLOOR\s*\+\s*\d+\s*;/',
            (string) file_get_contents( self::REPO_ROOT . $path ),
            'DRAFT_MAX_TOKENS is exempt from the ceiling guard only because it is defined '
                . 'as the floor plus a reply budget. Defined any other way it needs its own '
                . 'assertion, because nothing else checks it.'
        );
    }

    /**
     * Stage agents pass their ceiling into `StageAgent::generate()`, so the literal
     * that matters sits at the agent, not at the `usingMaxTokens()` call.
     */
    public function test_no_stage_agent_requests_a_ceiling_below_the_floor(): void
    {
        $offenders = array();
        $found     = 0;

        foreach ( $this->plugin_sources() as $path => $contents ) {
            preg_match_all( '/StageAgent::generate\(.+?,\s*([^,()]+?)\s*\)\s*;/s', $contents, $matches );

            foreach ( $matches[1] as $expression ) {
                ++$found;
                $shortfall = $this->shortfall( $expression );
                if ( null !== $shortfall ) {
                    $offenders[] = sprintf( '%s: %s', $path, $shortfall );
                }
            }
        }

        $this->assertGreaterThan( 0, $found, 'No stage agent ceilings found; this guard would be vacuous.' );

        $this->assertSame(
            array(),
            $offenders,
            "These stage agents ask for a ceiling below the reasoning cost billed against it:\n"
                . implode( "\n", $offenders )
        );
    }

    /**
     * An agent that passes no ceiling gets the default, which is the one value in
     * that path neither of the guards above ever sees.
     */
    public function test_the_stage_agent_default_ceiling_clears_the_floor(): void
    {
        $path = self::RESOLVED_ELSEWHERE['$bounded_max_tokens'];
        $this->assertFileExists( self::REPO_ROOT . $path );

        preg_match(
            '/function generate\(\s*string \$prompt,\s*int \$max_tokens = (\d+)/',
            (string) file_get_contents( self::REPO_ROOT . $path ),
            $matches
        );

        $this->assertNotEmpty( $matches, 'Could not read the default ceiling from StageAgent::generate().' );

        $this->assertGreaterThanOrEqual(
            LlmTextGenerator::THINKING_FLOOR,
            (int) $matches[1],
            'An agent that passes no ceiling would start below the floor.'
        );
    }
}
