<?php
/**
 * The once-per-request diagnostic de-duplication maps, in one list.
 *
 * Several classes keep a `private static array $reported` keyed by message, so
 * a fault that recurs inside one request is logged once rather than dozens of
 * times. A PHPUnit run is one process, though, so an entry left by one test
 * silences the same message in every later test — the repeat fault is
 * swallowed and the test that expected it still passes.
 *
 * Both test bases reset these maps from this one list. Each base used to keep
 * its own copy, and the copies drifted: the integration base reset only one of
 * the three. `ReportedDiagnosticsCoverageTest` fails when a class under
 * `includes/` declares a `$reported` map this list does not name.
 *
 * @package VIPWorkflows\Tests
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests;

/**
 * Shared reset for every `$reported` de-duplication map.
 */
final class ReportedDiagnostics
{
    /**
     * Every class that declares a static `$reported` map.
     *
     * @var class-string[]
     */
    public const CLASSES = array(
        \VIPWorkflows\AI\AiInference::class,
        \VIPWorkflows\Integrations\GuidelineContextProvider::class,
        \VIPWorkflows\Integrations\LlmTextGenerator::class,
    );

    /**
     * Empty every map, so each test starts with nothing already reported.
     */
    public static function reset(): void
    {
        foreach ( self::CLASSES as $class ) {
            ( new \ReflectionProperty( $class, 'reported' ) )->setValue( null, array() );
        }
    }
}
