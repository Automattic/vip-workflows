/**
 * URL scheme allowlist for values used as an href or src.
 *
 * URLs surfaced from remote services, imported configuration, scraped pages, and
 * model or agent output are rendered as link and image targets across the admin
 * and editor. React does not neutralise a `javascript:` scheme in an href, so an
 * unvalidated value could run script when the element is activated. This gates
 * every such value against an explicit scheme allowlist.
 */

/**
 * Schemes permitted in a link or image URL.
 *
 * Anything else — `javascript:`, `data:`, `vbscript:`, `file:` — renders as text
 * rather than as a link, so a crafted URL in model output or a scraped page
 * cannot become a clickable payload. Protocol-relative (`//host`) and
 * root-relative (`/path`) URLs are allowed: they inherit the admin's own origin.
 */
const SAFE_SCHEME = /^(?:https?:|mailto:|tel:|#|\/)/i;

/**
 * Whether a URL is safe to put in an href or src.
 *
 * @param {string} url Candidate URL.
 * @return {boolean} True when the URL may be linked.
 */
export function isSafeUrl( url ) {
	const trimmed = ( url || '' ).trim();

	if ( ! trimmed ) {
		return false;
	}

	// Control characters are stripped by browsers before scheme matching, so
	// `java\0script:` and `java\nscript:` would slip a naive test.
	// eslint-disable-next-line no-control-regex
	const normalized = trimmed.replace( /[\s\u0000-\u001f\u007f-\u009f]/g, '' );

	return SAFE_SCHEME.test( normalized );
}
