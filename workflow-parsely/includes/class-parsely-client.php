<?php
/**
 * Thin wrapper over wp-parsely's service classes.
 *
 * Every capability unit in this plugin calls Parse.ly through here rather than
 * reaching for `Parsely\Services\*` directly. That keeps the coupling to
 * wp-parsely's shape in one file: when wp-parsely renames a method or moves a
 * class, one place changes instead of six.
 *
 * @package WorkflowParsely
 */

declare( strict_types=1 );

namespace WorkflowParsely;

use Parsely\Parsely;
use Parsely\Services\Content_API\Content_API_Service;
use Parsely\Services\Content_API\Endpoints\Content_API_Base_Endpoint;
use Parsely\Services\Suggestions_API\Suggestions_API_Service;
use WP_Error;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Accessor for wp-parsely's two service layers.
 */
class ParselyClient {

	/**
	 * Memoized wp-parsely instance.
	 *
	 * @var Parsely|null
	 */
	private static ?Parsely $parsely = null;

	/**
	 * The wp-parsely core object.
	 *
	 * @return Parsely|WP_Error The instance, or an error when wp-parsely is absent.
	 */
	public static function parsely(): Parsely|WP_Error {
		if ( ! wp_parsely_is_active() ) {
			return self::missing_dependency();
		}

		if ( null === self::$parsely ) {
			self::$parsely = new Parsely();
		}

		return self::$parsely;
	}

	/**
	 * Suggestions API — smart links, title suggestions, inbound links.
	 *
	 * Returned inside a SuggestionsGuard, which forwards every call untouched and
	 * notes a `NO_AUTHORIZATION` refusal on the way back. Wrapping happens after
	 * the filter below, so a substituted double is watched too, and so anything
	 * decorating the service for caching or logging still receives the real
	 * object rather than the guard.
	 *
	 * @return SuggestionsGuard|WP_Error The wrapped service, or an error when unusable.
	 */
	public static function suggestions(): mixed {
		$parsely = self::parsely();

		if ( $parsely instanceof WP_Error ) {
			return $parsely;
		}

		if ( ! is_configured() ) {
			return self::missing_credentials();
		}

		/**
		 * Filters the Suggestions API service before use.
		 *
		 * Exists so tests can substitute a double, and so anything wanting to
		 * wrap the service — caching, logging, rate limiting — has a seam that
		 * does not require editing every ability. Returning a non-service here
		 * will break callers, so wrap rather than replace.
		 *
		 * @param Suggestions_API_Service $service The service instance.
		 */
		return new SuggestionsGuard(
			apply_filters(
				'workflow_parsely_suggestions_service',
				new Suggestions_API_Service( $parsely )
			)
		);
	}

	/**
	 * Content API — top content, post detail, related posts, referrers.
	 *
	 * @return Content_API_Service|WP_Error The service, or an error when unusable.
	 */
	public static function content(): mixed {
		$parsely = self::parsely();

		if ( $parsely instanceof WP_Error ) {
			return $parsely;
		}

		if ( ! is_configured() ) {
			return self::missing_credentials();
		}

		/**
		 * Filters the Content API service before use. See the Suggestions
		 * counterpart above for why this seam exists.
		 *
		 * @param Content_API_Service $service The service instance.
		 */
		return apply_filters(
			'workflow_parsely_content_service',
			new Content_API_Service( $parsely )
		);
	}

	/**
	 * Relevance search across the site's own archive.
	 *
	 * The one call in this plugin that does not go straight to a wp-parsely
	 * method, because wp-parsely does not wrap `/search`. See
	 * includes/parsely/class-endpoint-search.php for why that endpoint is needed
	 * and how it leaves.
	 *
	 * The feature detection below is the whole deprecation plan. When wp-parsely
	 * ships its own search, this prefers it automatically and the local endpoint
	 * becomes dead code to delete — no caller changes, no behaviour change.
	 *
	 * @param array $args {
	 *     Search arguments.
	 *
	 *     @type string $q              Required. Query terms.
	 *     @type string $sort           `score` (default) or `pub_date`.
	 *     @type string $boost          Metric to re-rank relevant results by.
	 *     @type int    $limit          Results to return.
	 *     @type string $pub_date_start Earliest publication date.
	 *     @type string $section        Restrict to one section.
	 * }
	 * @return array|WP_Error Post records, or an error when unusable.
	 */
	public static function search( array $args ): mixed {
		$service = self::content();

		if ( $service instanceof WP_Error ) {
			return $service;
		}

		// Upstream implementation, once it exists.
		if ( method_exists( $service, 'get_search_results' ) ) {
			return $service->get_search_results( $args );
		}

		/*
		 * Loaded here rather than at bootstrap: the class extends one of
		 * wp-parsely's, so requiring it before wp-parsely is confirmed present
		 * would fatal rather than degrade.
		 *
		 * Reaching this line proves `Parsely\Parsely` and `Content_API_Service`
		 * exist — that is all wp_parsely_is_active() and content() establish — but
		 * not the base endpoint class Endpoint_Search extends. A wp-parsely that
		 * moved or renamed it would satisfy every check above and then fatal on the
		 * `class Endpoint_Search extends …` line, because a missing parent raises an
		 * Error rather than an Exception and so escapes the catch blocks these
		 * abilities run inside. Checked explicitly, and reported as the same unmet
		 * requirement as any other missing piece of wp-parsely.
		 */
		if ( ! class_exists( Content_API_Base_Endpoint::class ) ) {
			return self::missing_dependency();
		}

		require_once __DIR__ . '/parsely/class-endpoint-search.php';

		/*
		 * Fully qualified: this file imports `Parsely\Parsely`, so a relative
		 * `Parsely\Endpoint_Search` resolves against that alias instead of this
		 * plugin's namespace.
		 */
		return ( new \WorkflowParsely\Parsely\Endpoint_Search( $service ) )->call( $args );
	}

	/**
	 * Error for a missing wp-parsely.
	 *
	 * Callers get a WP_Error rather than a thrown exception because these run
	 * inside ability execute callbacks, where a fatal would take down the whole
	 * request instead of failing one card.
	 */
	private static function missing_dependency(): WP_Error {
		return new WP_Error(
			'workflow_parsely_missing_plugin',
			__( 'The Parse.ly plugin (wp-parsely) is not active.', 'workflow-parsely' )
		);
	}

	/**
	 * Error for missing credentials.
	 */
	private static function missing_credentials(): WP_Error {
		return new WP_Error(
			'workflow_parsely_missing_credentials',
			__( 'Parse.ly is missing its Site ID or API Secret.', 'workflow-parsely' )
		);
	}

	/**
	 * Reset memoized state. Test seam only.
	 */
	public static function reset(): void {
		self::$parsely = null;
	}
}
