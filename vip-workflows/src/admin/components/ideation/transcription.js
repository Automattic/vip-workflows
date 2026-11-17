/**
 * Transcription availability for Ideation uploads.
 *
 * Audio and video sources are transcribed by OpenAI whatever AI provider the
 * site selected, so they need an OpenAI key. The server says whether one is
 * set (`vipWorkflowsIdeation.transcriptionAvailable`, read at page load) and
 * refuses audio and video uploads without it; these helpers let the screens
 * say so before an upload starts.
 */

import { __ } from '@wordpress/i18n';

/**
 * Whether audio and video can be transcribed on this site.
 *
 * `wp_localize_script()` turns top-level booleans into strings, so the value
 * arrives as `'1'` or `''` and is read for truthiness. A missing value reads
 * as unavailable: the server refuses those uploads anyway, so the stricter
 * answer is the honest one.
 *
 * @return {boolean} True when an OpenAI key is configured.
 */
export function isTranscriptionAvailable() {
	return Boolean( window.vipWorkflowsIdeation?.transcriptionAvailable );
}

/**
 * Whether a file would be sent for transcription.
 *
 * Uses the browser-reported type. That is enough for a pre-filter, because
 * the upload route checks the file itself.
 *
 * @param {File} file File chosen or dropped.
 * @return {boolean} True for audio and video files.
 */
export function needsTranscription( file ) {
	const type = file?.type || '';
	return type.startsWith( 'audio/' ) || type.startsWith( 'video/' );
}

/**
 * The message for an audio or video file that can't be transcribed.
 *
 * The server sends the sentence its upload route would return for this reader
 * (`vipWorkflowsIdeation.transcriptionUnavailableMessage`), so the drop zone
 * and the route can't drift apart, and an administrator is told where the key
 * goes. The literal is only a fallback for a page without that value, and
 * matches the server's wording for a reader who can't add the key.
 *
 * @return {string} Translated message.
 */
export function transcriptionUnavailableMessage() {
	return (
		window.vipWorkflowsIdeation?.transcriptionUnavailableMessage ||
		__(
			'OpenAI transcribes audio and video. OpenAI is not connected. Ask an administrator to connect it.',
			'vip-workflows'
		)
	);
}
