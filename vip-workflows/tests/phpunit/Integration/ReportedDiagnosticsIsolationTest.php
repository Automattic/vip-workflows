<?php
/**
 * A repeated fault is reported in every integration test that trips it.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

/**
 * The two tests below trip the same fault message on every de-duplicated
 * class. Each expects the `_doing_it_wrong()` notice, and WP_UnitTestCase
 * fails a test whose expected notice never fires — so if a `$reported` map
 * survived from the first test, the second would fail rather than pass with
 * the repeat swallowed.
 */
class ReportedDiagnosticsIsolationTest extends TestCase
{
    private const MESSAGE = 'Repeated fault used by the isolation test.';

    /**
     * Class, private reporting method, and the function name its notice names.
     */
    private const REPORTERS = array(
        array( \VIPWorkflows\AI\AiInference::class, 'report', 'model' ),
        array( \VIPWorkflows\Integrations\GuidelineContextProvider::class, 'report_fault', 'gather_context' ),
        array( \VIPWorkflows\Integrations\LlmTextGenerator::class, 'report', 'bounded_max_tokens' ),
    );

    public function test_first_occurrence_is_reported(): void
    {
        $this->trip_every_reporter();
    }

    public function test_same_fault_in_a_later_test_is_reported_again(): void
    {
        $this->trip_every_reporter();
    }

    private function trip_every_reporter(): void
    {
        foreach ( self::REPORTERS as list( $class, $method, $label ) ) {
            $this->setExpectedIncorrectUsage( $class . '::' . $label );
            ( new \ReflectionMethod( $class, $method ) )->invoke( null, self::MESSAGE );
        }
    }
}
