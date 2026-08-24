<?php
/**
 * Every generation call site must gate on availability before resolving a model.
 *
 * `PromptBuilder::usingModel()` takes `ModelInterface`, not `?ModelInterface`,
 * while `AiInference::model()` returns null whenever the selection cannot be
 * resolved. Handing one to the other raises a `TypeError` — an `\Error`, which
 * the `catch ( \Exception $e )` these call sites use does not catch. The result
 * is an uncaught fatal, on the most ordinary configuration there is: a site with
 * no AI provider connected.
 *
 * This is a structural test rather than a behavioral one because the gate's whole
 * job is to return before anything observable happens — the guarded and unguarded
 * versions of a method are indistinguishable from the outside until the fatal.
 * The bug it pins was real: `analyze_video_source()` shipped without the gate its
 * sibling `analyze_image_source()` carried twelve lines below it, and the null
 * return only became reachable in everyday states once the provider default was
 * removed.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

class AiCallSiteGatingTest extends TestCase
{
    /**
     * Expressions that establish a model is resolvable before one is requested.
     *
     * `AiAvailability::is_configured()` is the direct form. `check_configuration()`
     * is the WP_Error-returning wrapper the ideation and media surfaces expose,
     * which delegates to it. A method carrying either has asked the question.
     */
    private const GATES = array(
        'AiAvailability::is_configured',
        'AiAvailability::for_selected_provider',
        'check_configuration',
        // A TypeError is an \Error, so only the wider catch contains it. A call
        // site that catches Throwable turns the same failure into a WP_Error and
        // is safe without asking first — `StageAgent::generate()` is deliberately
        // built this way, which is why the four stage agents never fataled.
        'catch ( \\Throwable',
    );

    /**
     * Call sites whose gate lives in their caller, verified by hand.
     *
     * Each entry names the method that asks the question before this one runs.
     * The list is explicit rather than inferred because a gate one frame up is
     * indistinguishable, to this test, from no gate at all — and that ambiguity
     * is exactly what let `analyze_video_source()` ship without one while its
     * sibling twelve lines below had it.
     *
     * @var array<string, string>
     */
    private const GATED_BY_CALLER = array(
        'class-media-processor.php::analyze_image'   => 'MediaProcessor::process_file',
        'class-media-processor.php::process_pdf'     => 'MediaProcessor::process_file',
        'class-media-processor.php::summarize_text'  => 'MediaProcessor::process_file',
        'class-seed-analyst.php::analyze_seed'       => 'SeedAnalyst::run',
        'class-editorial-mentor.php::evaluate'       => 'EditorialMentor::run',
    );

    /**
     * Every first-party PHP file that could hold a generation call.
     *
     * Scanned with `glob()` over an explicit depth rather than a recursive
     * iterator: the unit suite runs under Patchwork, whose stream wrapper makes
     * directory iteration expensive enough to exhaust memory on a tree that
     * includes `node_modules`. The roots below are the only places this plugin
     * and its extensions keep PHP, so bounded globbing loses nothing.
     *
     * @return string[]
     */
    private static function php_files(): array
    {
        $repo = dirname( __DIR__, 4 );

        $patterns = array(
            $repo . '/vip-workflow/includes/*.php',
            $repo . '/vip-workflow/includes/*/*.php',
            $repo . '/vip-workflow/includes/*/*/*.php',
            $repo . '/workflow-*/*.php',
            $repo . '/workflow-*/includes/*.php',
            $repo . '/workflow-*/includes/*/*.php',
        );

        $files = array();

        foreach ( $patterns as $pattern ) {
            foreach ( glob( $pattern ) ?: array() as $path ) {
                if ( str_contains( $path, '/vendor/' ) || str_contains( $path, '/build/' ) || str_contains( $path, '/node_modules/' ) ) {
                    continue;
                }

                $files[ $path ] = $path;
            }
        }

        return array_values( $files );
    }

    /**
     * Split a file into `name => body` for every function it declares.
     *
     * Deliberately crude: it slices from one `function` keyword to the next, which
     * is enough to answer "does the code around this call also ask the question",
     * and cannot silently pass a call site by mis-parsing a brace.
     *
     * @param  string $code File contents.
     * @return array<string, string>
     */
    private function functions_in( string $code ): array
    {
        $matches = array();
        preg_match_all( '/function\s+(\w+)\s*\(/', $code, $matches, PREG_OFFSET_CAPTURE );

        $bodies = array();
        $count  = count( $matches[0] );

        for ( $i = 0; $i < $count; $i++ ) {
            $start = $matches[0][ $i ][1];
            $end   = ( $i + 1 < $count ) ? $matches[0][ $i + 1 ][1] : strlen( $code );

            $bodies[ $matches[1][ $i ][0] . '@' . $start ] = substr( $code, $start, $end - $start );
        }

        return $bodies;
    }

    public function test_every_inference_call_site_is_gated_on_availability(): void
    {
        $ungated = array();
        $checked = 0;

        foreach ( self::php_files() as $path ) {
            $code = file_get_contents( $path );

            if ( ! str_contains( $code, 'usingModel(' ) || ! str_contains( $code, 'AiInference' ) ) {
                continue;
            }

            foreach ( $this->functions_in( $code ) as $label => $body ) {
                if ( ! preg_match( '/usingModel\(\s*[^)]*AiInference/s', $body ) ) {
                    continue;
                }

                ++$checked;

                foreach ( self::GATES as $gate ) {
                    if ( str_contains( $body, $gate ) ) {
                        continue 2;
                    }
                }

                $site = sprintf( '%s::%s', basename( $path ), strtok( $label, '@' ) );

                if ( isset( self::GATED_BY_CALLER[ $site ] ) ) {
                    continue;
                }

                $ungated[] = $site;
            }
        }

        $this->assertGreaterThan(
            0,
            $checked,
            'Found no call site handing AiInference::model() to usingModel(); this test has stopped watching anything.'
        );

        $this->assertSame(
            array(),
            $ungated,
            "usingModel() is not nullable and AiInference::model() returns null on an unresolved selection, "
                . "so an ungated call site is an uncaught TypeError on a site with no AI provider configured. "
                . 'Ungated: ' . implode( ', ', $ungated )
        );
    }
}
