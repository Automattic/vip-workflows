/**
 * Sanitize metadata field keys for in-progress editor input.
 *
 * Matches the server-side metadata field key contract of lowercase letters,
 * digits, and underscores while preserving typed underscores as the user enters
 * them.
 *
 * @param {string} str Raw metadata field key input.
 * @return {string} Sanitized metadata field key.
 */
export function sanitizeMetadataKey( str ) {
	return str.toLowerCase().replace( /[^a-z0-9_]+/g, '_' );
}
