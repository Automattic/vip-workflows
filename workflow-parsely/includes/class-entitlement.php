<?php
/**
 * What this Site ID is actually allowed to do.
 *
 * Parse.ly entitles its analytics endpoints and its Suggestions endpoints
 * separately on the same Site ID, and nothing local reveals which you have. Four
 * real Site IDs were tested while this was written; three had full analytics
 * access and no Suggestions access at all.
 *
 * That left the bridge reporting every tool as available and failing at the
 * moment of use, with Parse.ly's own sentence — "Suggestions API access not
 * enabled for this site" — shown to whoever clicked. So the first refusal is
 * remembered, and availability tells the truth from then on.
 *
 * ## Why not just ask
 *
 * `Suggestions_API_Service::get_check_auth()` exists for exactly this question
 * and cannot be used: it returns a 403 body as a **success**, a plain array
 * `{"code":403,"message":"Forbidden"}` rather than a `WP_Error`. Any caller
 * reading its return value concludes the Site ID is authorized. Reported
 * upstream; until it is fixed, the trustworthy signal is the `NO_AUTHORIZATION`
 * code on a real call.
 *
 * Asking on every availability check is not an option either. Availability is
 * read on every Agents-page load and several times per settings save, so a
 * network round trip there would make the admin crawl.
 *
 * ## Why a transient
 *
 * Entitlement can be granted at any time, and a permanent record would leave a
 * site stuck reporting a problem that had been fixed. A transient expires on its
 * own, so the next call re-probes and a granted entitlement heals without anyone
 * clearing a cache. Keyed by Site ID, so swapping the key — which is how someone
 * actually fixes this — takes effect immediately.
 *
 * @package WorkflowParsely
 */

declare( strict_types=1 );

namespace WorkflowParsely;

use WP_Error;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Records and reports what Parse.ly has refused.
 */
class Entitlement {

	/**
	 * Parse.ly's error code for an unentitled Site ID.
	 */
	public const REFUSED_CODE = 'NO_AUTHORIZATION';

	/**
	 * Transient key prefix. The Site ID is appended.
	 */
	private const DENIAL_KEY = 'workflow_parsely_suggestions_denied_';

	/**
	 * How long a refusal is trusted before the next call re-probes.
	 *
	 * Long enough that a working site is not re-probing constantly, short enough
	 * that a newly granted entitlement appears the same working day.
	 */
	private const DENIAL_TTL = 6 * HOUR_IN_SECONDS;

	/**
	 * Whether Parse.ly has refused Suggestions access for the current Site ID.
	 */
	public static function suggestions_denied(): bool {
		$key = self::denial_key();

		if ( null === $key ) {
			return false;
		}

		return (bool) get_transient( $key );
	}

	/**
	 * Note a refusal, if that is what this result is.
	 *
	 * Takes any result rather than a boolean so callers do not have to know which
	 * error code means what. Returns the result untouched so it can be dropped
	 * into a return path without changing behaviour.
	 *
	 * @param  mixed $result Result of a Suggestions API call.
	 * @return mixed The same result.
	 */
	public static function observe( mixed $result ): mixed {
		if ( ! $result instanceof WP_Error ) {
			return $result;
		}

		if ( self::REFUSED_CODE !== $result->get_error_code() ) {
			return $result;
		}

		$key = self::denial_key();

		if ( null !== $key ) {
			set_transient( $key, 1, self::DENIAL_TTL );
		}

		return $result;
	}

	/**
	 * Forget any recorded refusal for the current Site ID.
	 *
	 * Used when credentials change and by tests. Not exposed in the UI: the
	 * transient expires on its own, and a button to clear it would imply the user
	 * had to.
	 */
	public static function forget_suggestions_denial(): void {
		$key = self::denial_key();

		if ( null !== $key ) {
			delete_transient( $key );
		}
	}

	/**
	 * Transient key for the current Site ID, or null when there is no Site ID.
	 *
	 * With no Site ID there is nothing to remember against — and nothing to
	 * remember, since availability already reports missing credentials.
	 */
	private static function denial_key(): ?string {
		$options = get_option( 'parsely', array() );

		if ( ! is_array( $options ) ) {
			return null;
		}

		$site_id = trim( (string) ( $options['apikey'] ?? '' ) );

		if ( '' === $site_id ) {
			return null;
		}

		return self::DENIAL_KEY . md5( $site_id );
	}
}
