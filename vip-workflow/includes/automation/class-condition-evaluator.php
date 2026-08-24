<?php
/**
 * Condition evaluator.
 *
 * @package VIPWorkflow
 */

declare( strict_types=1 );

namespace VIPWorkflow\Automation;

/**
 * Evaluates conditions for automation flows.
 */
class ConditionEvaluator {


	/**
	 * Event data.
	 *
	 * @var array
	 */
	private array $event_data;

	/**
	 * Execution context.
	 *
	 * @var array
	 */
	private array $context;

	/**
	 * Constructor.
	 *
	 * @param array $event_data Event data.
	 * @param array $context    Execution context.
	 */
	public function __construct( array $event_data, array $context ) {
		$this->event_data = $event_data;
		$this->context    = $context;
	}

	/**
	 * Evaluate an array of conditions (AND logic).
	 *
	 * @param  array $conditions Conditions to evaluate.
	 * @return bool True if all conditions pass.
	 */
	public function evaluate( array $conditions ): bool {
		if ( empty( $conditions ) ) {
			return true; // No conditions = always pass.
		}

		foreach ( $conditions as $condition ) {
			if ( ! $this->evaluate_single( $condition ) ) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Evaluate a single condition.
	 *
	 * @param  array $condition Condition configuration.
	 * @return bool
	 */
	private function evaluate_single( array $condition ): bool {
		$type = $condition['type'] ?? '';

		switch ( $type ) {
			case 'field_equals':
				return $this->get_value( $condition['field'] ) === $condition['value'];

			case 'field_not_equals':
				return $this->get_value( $condition['field'] ) !== $condition['value'];

			case 'field_contains':
				$value = $this->get_value( $condition['field'] );
				return is_string( $value ) && str_contains( $value, $condition['value'] );

			case 'field_greater_than':
				return $this->get_value( $condition['field'] ) > $condition['value'];

			case 'field_less_than':
				return $this->get_value( $condition['field'] ) < $condition['value'];

			case 'field_in_list':
				$value = $this->get_value( $condition['field'] );
				return in_array( $value, (array) $condition['value'], true );

			case 'field_not_empty':
				$value = $this->get_value( $condition['field'] );
				return ! empty( $value );

			case 'field_empty':
				$value = $this->get_value( $condition['field'] );
				return empty( $value );

			case 'role_is':
				$user_id = $this->context['user_id'] ?? get_current_user_id();
				return $this->user_has_role( $user_id, $condition['value'] );

			case 'custom':
				// Resolve a *named* callback against an allowlist registered by
				// plugins — never invoke a callable read straight from stored
				// condition data, which would be an RCE primitive if a future
				// writer ever fed attacker input into `conditions`.
				$callback_id = $condition['callback'] ?? '';
				$registered  = apply_filters( 'vip_workflow_condition_callbacks', array() );
				if (
					is_string( $callback_id )
					&& isset( $registered[ $callback_id ] )
					&& is_callable( $registered[ $callback_id ] )
				) {
					return (bool) call_user_func( $registered[ $callback_id ], $this->event_data, $this->context );
				}
				return false;

			default:
				// Unknown condition type - fail safe.
				return false;
		}
	}

	/**
	 * Get a value from event data or context.
	 *
	 * @param  string $field Field path (dot notation supported).
	 * @return mixed
	 */
	private function get_value( string $field ): mixed {
		// Try event data first.
		$value = $this->get_nested_value( $this->event_data, $field );
		if ( null !== $value ) {
			return $value;
		}

		// Try context.
		$value = $this->get_nested_value( $this->context, $field );
		if ( null !== $value ) {
			return $value;
		}

		return null;
	}

	/**
	 * Get a nested value from an array using dot notation.
	 *
	 * @param  array  $array Array to search.
	 * @param  string $path  Dot-separated path.
	 * @return mixed
	 */
	private function get_nested_value( array $array, string $path ): mixed {
		$keys  = explode( '.', $path );
		$value = $array;

		foreach ( $keys as $key ) {
			if ( ! is_array( $value ) || ! array_key_exists( $key, $value ) ) {
				return null;
			}
			$value = $value[ $key ];
		}

		return $value;
	}

	/**
	 * Check if user has a specific role.
	 *
	 * @param  int    $user_id User ID.
	 * @param  string $role    Role to check.
	 * @return bool
	 */
	private function user_has_role( int $user_id, string $role ): bool {
		$user = get_userdata( $user_id );
		return $user && in_array( $role, $user->roles, true );
	}
}
