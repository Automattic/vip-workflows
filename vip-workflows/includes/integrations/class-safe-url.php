<?php
/**
 * Safe URL - scheme allowlist for URLs that arrive in a provider payload.
 *
 * A URL in a research agent's cards, or in the story prompt an editor selects,
 * is stored and later rendered as a link or image target. The scheme is the
 * part that decides what activating that link does, so it is checked here,
 * before the value is stored, against the only two schemes such a URL has a
 * reason to carry.
 *
 * This is one of two layers. The admin screens check the scheme again when
 * they render (`src/common/safe-url.js`), against a wider list: `mailto:`,
 * `tel:` and relative URLs pass there. That guard also serves links this class
 * never sees — the ones in a discovery provider's `recommend` and `search`
 * answers, and the ones stored before this check existed.
 *
 * A source an editor adds by its URL does not come through here. That path
 * fetches the address first, and only an `http` or `https` address can be
 * fetched (`SsrfGuard`, `UrlMetaExtractor`).
 *
 * Hand-written rather than `esc_url_raw()`, which keeps a relative URL and
 * rewrites the ones it accepts. A card's stored identity is derived from its
 * URL, so a rewritten URL would give a card that is already stored a second
 * row.
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
	 * Only a value that starts with `http://` or `https://` is returned, so a
	 * value in any other scheme is refused however it is written: there is no
	 * list of bad schemes for a variant spelling to get past.
	 *
	 * What the normalization decides is which web addresses are accepted. Before
	 * it reads the scheme, a browser discards C0 control characters and spaces
	 * from both ends of a URL, and tabs and newlines from anywhere in it, so
	 * `" https://example.com"` and `"ht\ntps://example.com"` are web addresses to
	 * a browser. The same is done here first, and the normalized form is what is
	 * returned: the value that was checked is the value that is stored, and a
	 * browser reads it as it read the original.
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
