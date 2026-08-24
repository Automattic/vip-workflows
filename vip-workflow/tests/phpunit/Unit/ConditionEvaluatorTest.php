<?php
/**
 * ConditionEvaluator unit tests.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflow\Automation\ConditionEvaluator;

/**
 * Smoke tests for ConditionEvaluator.
 */
class ConditionEvaluatorTest extends TestCase
{
    private function make_evaluator( array $event_data = [], array $context = [] ): ConditionEvaluator
    {
        return new ConditionEvaluator( $event_data, $context );
    }

    public function test_empty_conditions_always_pass(): void
    {
        $evaluator = $this->make_evaluator();
        $this->assertTrue( $evaluator->evaluate( [] ) );
    }

    public function test_field_equals_match(): void
    {
        $evaluator = $this->make_evaluator( [ 'status' => 'draft' ] );
        $this->assertTrue( $evaluator->evaluate( [ [ 'type' => 'field_equals', 'field' => 'status', 'value' => 'draft' ] ] ) );
    }

    public function test_field_equals_no_match(): void
    {
        $evaluator = $this->make_evaluator( [ 'status' => 'published' ] );
        $this->assertFalse( $evaluator->evaluate( [ [ 'type' => 'field_equals', 'field' => 'status', 'value' => 'draft' ] ] ) );
    }

    public function test_field_not_equals_match(): void
    {
        $evaluator = $this->make_evaluator( [ 'status' => 'published' ] );
        $this->assertTrue( $evaluator->evaluate( [ [ 'type' => 'field_not_equals', 'field' => 'status', 'value' => 'draft' ] ] ) );
    }

    public function test_field_not_equals_no_match(): void
    {
        $evaluator = $this->make_evaluator( [ 'status' => 'draft' ] );
        $this->assertFalse( $evaluator->evaluate( [ [ 'type' => 'field_not_equals', 'field' => 'status', 'value' => 'draft' ] ] ) );
    }

    public function test_field_contains_match(): void
    {
        $evaluator = $this->make_evaluator( [ 'title' => 'Breaking News: Something Happened' ] );
        $this->assertTrue( $evaluator->evaluate( [ [ 'type' => 'field_contains', 'field' => 'title', 'value' => 'Breaking' ] ] ) );
    }

    public function test_field_contains_no_match(): void
    {
        $evaluator = $this->make_evaluator( [ 'title' => 'Sports Update' ] );
        $this->assertFalse( $evaluator->evaluate( [ [ 'type' => 'field_contains', 'field' => 'title', 'value' => 'Breaking' ] ] ) );
    }

    public function test_field_greater_than(): void
    {
        $evaluator = $this->make_evaluator( [ 'word_count' => 500 ] );
        $this->assertTrue( $evaluator->evaluate( [ [ 'type' => 'field_greater_than', 'field' => 'word_count', 'value' => 100 ] ] ) );
        $this->assertFalse( $evaluator->evaluate( [ [ 'type' => 'field_greater_than', 'field' => 'word_count', 'value' => 1000 ] ] ) );
    }

    public function test_field_less_than(): void
    {
        $evaluator = $this->make_evaluator( [ 'priority' => 2 ] );
        $this->assertTrue( $evaluator->evaluate( [ [ 'type' => 'field_less_than', 'field' => 'priority', 'value' => 5 ] ] ) );
        $this->assertFalse( $evaluator->evaluate( [ [ 'type' => 'field_less_than', 'field' => 'priority', 'value' => 1 ] ] ) );
    }

    public function test_field_in_list_match(): void
    {
        $evaluator = $this->make_evaluator( [ 'category' => 'sports' ] );
        $this->assertTrue( $evaluator->evaluate( [ [ 'type' => 'field_in_list', 'field' => 'category', 'value' => [ 'sports', 'tech', 'politics' ] ] ] ) );
    }

    public function test_field_in_list_no_match(): void
    {
        $evaluator = $this->make_evaluator( [ 'category' => 'arts' ] );
        $this->assertFalse( $evaluator->evaluate( [ [ 'type' => 'field_in_list', 'field' => 'category', 'value' => [ 'sports', 'tech' ] ] ] ) );
    }

    public function test_field_not_empty_with_value(): void
    {
        $evaluator = $this->make_evaluator( [ 'byline' => 'Jane Doe' ] );
        $this->assertTrue( $evaluator->evaluate( [ [ 'type' => 'field_not_empty', 'field' => 'byline' ] ] ) );
    }

    public function test_field_not_empty_with_empty_value(): void
    {
        $evaluator = $this->make_evaluator( [ 'byline' => '' ] );
        $this->assertFalse( $evaluator->evaluate( [ [ 'type' => 'field_not_empty', 'field' => 'byline' ] ] ) );
    }

    public function test_field_empty_with_empty_value(): void
    {
        $evaluator = $this->make_evaluator( [ 'notes' => '' ] );
        $this->assertTrue( $evaluator->evaluate( [ [ 'type' => 'field_empty', 'field' => 'notes' ] ] ) );
    }

    public function test_field_empty_with_present_value(): void
    {
        $evaluator = $this->make_evaluator( [ 'notes' => 'some notes' ] );
        $this->assertFalse( $evaluator->evaluate( [ [ 'type' => 'field_empty', 'field' => 'notes' ] ] ) );
    }

    public function test_dot_notation_nested_field(): void
    {
        $evaluator = $this->make_evaluator( [ 'post' => [ 'status' => 'draft' ] ] );
        $this->assertTrue( $evaluator->evaluate( [ [ 'type' => 'field_equals', 'field' => 'post.status', 'value' => 'draft' ] ] ) );
    }

    public function test_context_field_used_as_fallback(): void
    {
        // event_data is empty; field should be resolved from context.
        $evaluator = $this->make_evaluator( [], [ 'sequence_id' => 42 ] );
        $this->assertTrue( $evaluator->evaluate( [ [ 'type' => 'field_equals', 'field' => 'sequence_id', 'value' => 42 ] ] ) );
    }

    public function test_unknown_condition_type_returns_false(): void
    {
        $evaluator = $this->make_evaluator( [ 'status' => 'draft' ] );
        $this->assertFalse( $evaluator->evaluate( [ [ 'type' => 'totally_unknown_type', 'field' => 'status', 'value' => 'draft' ] ] ) );
    }

    public function test_and_logic_all_must_pass(): void
    {
        $evaluator = $this->make_evaluator( [ 'status' => 'draft', 'author_id' => 5 ] );
        $conditions = [
            [ 'type' => 'field_equals', 'field' => 'status', 'value' => 'draft' ],
            [ 'type' => 'field_equals', 'field' => 'author_id', 'value' => 99 ], // fails
        ];
        $this->assertFalse( $evaluator->evaluate( $conditions ) );
    }

    public function test_and_logic_passes_when_all_true(): void
    {
        $evaluator = $this->make_evaluator( [ 'status' => 'draft', 'author_id' => 5 ] );
        $conditions = [
            [ 'type' => 'field_equals', 'field' => 'status', 'value' => 'draft' ],
            [ 'type' => 'field_equals', 'field' => 'author_id', 'value' => 5 ],
        ];
        $this->assertTrue( $evaluator->evaluate( $conditions ) );
    }

    public function test_custom_callback_true(): void
    {
        // Custom conditions resolve a *named* callback from an allowlist; a
        // callable value stored on the condition is never invoked directly.
        Functions\when( 'apply_filters' )->alias(
            function ( $tag, $value ) {
                if ( 'vip_workflow_condition_callbacks' === $tag ) {
                    return [ 'flag_is_true' => fn( $data, $ctx ) => ( $data['flag'] ?? false ) === true ];
                }
                return $value;
            }
        );

        $evaluator = $this->make_evaluator( [ 'flag' => true ] );
        $conditions = [
            [
                'type'     => 'custom',
                'callback' => 'flag_is_true',
            ],
        ];
        $this->assertTrue( $evaluator->evaluate( $conditions ) );
    }

    public function test_custom_callback_false(): void
    {
        // A callback name that isn't on the allowlist does not run.
        $evaluator = $this->make_evaluator( [] );
        $conditions = [
            [
                'type'     => 'custom',
                'callback' => 'not_registered',
            ],
        ];
        $this->assertFalse( $evaluator->evaluate( $conditions ) );
    }

    public function test_custom_with_no_callable_returns_false(): void
    {
        $evaluator = $this->make_evaluator( [] );
        $conditions = [ [ 'type' => 'custom' ] ]; // no 'callback' key
        $this->assertFalse( $evaluator->evaluate( $conditions ) );
    }

    public function test_role_is_condition(): void
    {
        $mock_user        = (object) [ 'roles' => [ 'editor' ] ];
        $context          = [ 'user_id' => 7 ];
        $evaluator        = $this->make_evaluator( [], $context );

        Functions\when( 'get_userdata' )->justReturn( $mock_user );

        $conditions = [ [ 'type' => 'role_is', 'value' => 'editor' ] ];
        $this->assertTrue( $evaluator->evaluate( $conditions ) );
    }
}
