<?php
/**
 * ConditionEvaluator custom-callback hardening.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflow\Automation\ConditionEvaluator;

/**
 * A `custom` condition must never invoke a callable read straight from stored
 * condition data — only a named callback on an allowlist may run.
 */
class ConditionEvaluatorCustomTest extends TestCase
{
    private function evaluate_single( array $condition ): bool
    {
        $evaluator = new ConditionEvaluator( array(), array() );
        $method    = new \ReflectionMethod( ConditionEvaluator::class, 'evaluate_single' );
        return $method->invoke( $evaluator, $condition );
    }

    public function test_stored_callable_name_is_not_invoked(): void
    {
        // No registered callbacks (the default apply_filters stub returns []).
        $this->assertFalse(
            $this->evaluate_single( array( 'type' => 'custom', 'callback' => 'phpinfo' ) )
        );
    }

    public function test_registered_callback_is_invoked(): void
    {
        Functions\when( 'apply_filters' )->alias(
            function ( $tag, $value ) {
                if ( 'vip_workflow_condition_callbacks' === $tag ) {
                    return array( 'always_true' => fn( $event, $context ) => true );
                }
                return $value;
            }
        );

        $this->assertTrue(
            $this->evaluate_single( array( 'type' => 'custom', 'callback' => 'always_true' ) )
        );
    }
}
