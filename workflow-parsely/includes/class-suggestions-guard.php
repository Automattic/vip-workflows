<?php
/**
 * Watches Suggestions API calls for a refusal.
 *
 * A pass-through wrapper around wp-parsely's Suggestions service. Every call is
 * forwarded untouched and every result returned unchanged; the only thing it does
 * is notice a `NO_AUTHORIZATION` and record it, so availability can stop claiming
 * the tools work.
 *
 * A wrapper rather than a check in each ability, because there is no reliable
 * place to put such a check. Each ability calls a different method and returns
 * early on error, so the observation would have to be repeated in every one and
 * remembered by whoever adds the next. Here it applies to every Suggestions call
 * that exists now and every one added later, and nobody has to know it happened.
 *
 * @package WorkflowParsely
 */

declare( strict_types=1 );

namespace WorkflowParsely;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Pass-through wrapper that records refusals.
 */
class SuggestionsGuard {

	/**
	 * The wrapped service.
	 *
	 * Untyped on purpose. The real service is
	 * `Parsely\Services\Suggestions_API\Suggestions_API_Service`, but tests
	 * substitute duck-typed doubles through the same filter this wraps, and the
	 * wrapper has no reason to care which it holds.
	 *
	 * @var object
	 */
	private object $service;

	/**
	 * Wrap a Suggestions service.
	 *
	 * @param object $service The Suggestions service to wrap.
	 */
	public function __construct( object $service ) {
		$this->service = $service;
	}

	/**
	 * The service being wrapped.
	 *
	 * For anything that genuinely needs the real object rather than the wrapper.
	 *
	 * @return object
	 */
	public function unwrap(): object {
		return $this->service;
	}

	/**
	 * Forward any call, and notice a refusal on the way back.
	 *
	 * @param  string $method Method name.
	 * @param  array  $args   Arguments.
	 * @return mixed The service's return value, unchanged.
	 */
	public function __call( string $method, array $args ): mixed {
		return Entitlement::observe( $this->service->$method( ...$args ) );
	}
}
