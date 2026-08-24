<?php
/**
 * Parse.ly Content API Endpoint: Search
 *
 * BORROWED TERRITORY — this file is written to wp-parsely's conventions, not
 * this plugin's, because it is meant to leave.
 *
 * wp-parsely wraps every Content API endpoint of consequence except `/search`:
 * `/related`, `/analytics/posts`, `/analytics/post/detail` and
 * `/referrers/post/detail` all have endpoint classes; search does not. This is
 * that missing class, kept here only until it exists upstream.
 *
 * It is needed because the ideation signals score a *text* candidate — a diary
 * event or a wire item with no URL on this site yet. `/related` cannot answer
 * that (it resolves a URL Parse.ly already indexes) and `/analytics/posts` ranks
 * rather than answering a query. `/search` is the only endpoint that takes text.
 *
 * UPSTREAMING
 * -----------
 * Two lines change: the namespace becomes
 * `Parsely\Services\Content_API\Endpoints` and `@package` becomes `Parsely`.
 * Then it registers alongside the others in
 * `Content_API_Service::register_endpoints()`, and a `get_search_results()`
 * method on that service calls it. Everything else here is already in their
 * shape so the diff is a file move.
 *
 * Once wp-parsely ships it, delete this file and the fallback branch in
 * ParselyClient::search(); the feature detection there picks up the native
 * implementation with no other change.
 *
 * @package WorkflowParsely
 * @since   0.2.0
 *
 * @link https://docs.parse.ly/api-search-endpoint/
 */

declare( strict_types=1 );

namespace WorkflowParsely\Parsely;

use Parsely\Services\Content_API\Endpoints\Content_API_Base_Endpoint;
use WP_Error;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * The endpoint for the /search API request.
 *
 * Credential injection, response unwrapping and error conversion are all
 * inherited from Content_API_Base_Endpoint. The only endpoint-specific
 * behaviour is the path and the argument tidying below.
 *
 * @since 0.2.0
 */
class Endpoint_Search extends Content_API_Base_Endpoint {

	/**
	 * Returns the endpoint for the API request.
	 *
	 * @since 0.2.0
	 *
	 * @return string
	 */
	public function get_endpoint(): string {
		return '/search';
	}

	/**
	 * Executes the API request.
	 *
	 * `boost` is validated by the remote API, which answers 422 for a metric it
	 * does not recognise, so an unknown value fails the whole call rather than
	 * being ignored. Callers are expected to have validated it; this only drops
	 * empties so an unset argument does not become `boost=`.
	 *
	 * @since 0.2.0
	 *
	 * @param array<mixed> $args The arguments to pass to the API request.
	 * @return WP_Error|array<mixed> The response from the API request.
	 */
	public function call( array $args = array() ) {
		$args = array_filter(
			$args,
			static fn( $value ): bool => null !== $value && '' !== $value
		);

		return $this->request( 'GET', $args );
	}
}
