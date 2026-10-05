<?php
/**
 * Safe URL - scheme allowlist for URLs that arrive in a provider payload.
 *
 * A URL returned by a research provider, a discovery provider, or a scraped
 * page is stored and later rendered as a link or image target. The scheme is
 * the part that decides what activating that link does, so it is checked here,
 * before the value is stored, against the only two schemes such a URL has a
 * reason to carry. The admin screens check the scheme again when they render
 * (`src/common/safe-url.js`), so neither layer is the only one.
 *
 * @package VIPWorkflows
 */

declare( strict_types=1 );

namespace VIPWorkflows\Integrations;

/**
 * Scheme allowlist for stored URLs.
 */
class SafeUrl {

	/**
	 * Reduce a value to a web address, or to nothing.
	 *
	 * The check runs on the string a browser would parse, not on the string as
	 * written. Before it reads the scheme, a browser discards C0 control
	 * characters and spaces from both ends of a URL, and tabs and newlines from
	 * anywhere in it — so `"\tjavascript:alert(1)"` and `"java\nscript:alert(1)"`
	 * both navigate as `javascript:`. The same normalization is applied here
	 * first, and the normalized form is what is returned, so the value that was
	 * checked is the value that is stored.
	 *
	 * Returns null rather than an empty string for a rejected value: the caller
	 * stores the result as a field, and a field that holds nothing is null.
	 *
	 * @param mixed $value Candidate URL. A payload is decoded JSON, so any type can arrive.
	 * @return string|null The address when it is absolute `http` or `https`, null otherwise.
	 */
	public static function http_or_null( $value ): ?string {
		if ( ! is_string( $value ) ) {
			return null;
		}

		$url = trim( $value, "\x00..\x20" );
		$url = str_replace( array( "\t", "\n", "\r" ), '', $url );

		return 1 === preg_match( '#^https?://#i', $url ) ? $url : null;
	}
}
