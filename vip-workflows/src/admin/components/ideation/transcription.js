/**
 * Transcription availability for Ideation uploads.
 *
 * Audio and video sources are transcribed by OpenAI whatever AI provider the
 * site selected, so they need an OpenAI key. Without one they still upload,
 * and the processing job fails them with a message on the source's card. The
 * server says whether a key is set (`vipWorkflowsIdeation.transcriptionAvailable`,
 * read at page load), so the screens can warn before an upload starts.
 */

import { __ } from '@wordpress/i18n';

/**
 * Whether audio and video can be transcribed on this site.
 *
 * `wp_localize_script()` turns top-level booleans into strings, so the value
 * arrives as `'1'` or `''` and is read for truthiness. A missing value reads
 * as unavailable, so the screens warn rather than promise a transcript.
 *
 * @return {boolean} True when an OpenAI key is configured.
 */
export function isTranscriptionAvailable() {
	return Boolean( window.vipWorkflowsIdeation?.transcriptionAvailable );
}

/**
 * The warning shown before an upload when audio and video can't be transcribed.
 *
 * One sentence, shared by the Add source dialog and the drop zone.
 *
 * @return {string} Translated message.
 */
export function transcriptionUnavailableWarning() {
	return __(
		'OpenAI transcribes audio and video. OpenAI is not connected, so they won’t be transcribed.',
		'vip-workflows'
	);
}

/**
 * Where the OpenAI key goes, for a reader who can add it.
 *
 * The server sends it only to readers with the capability every other
 * credential notice uses (`vipWorkflowsIdeation.transcriptionKeyDestination`),
 * so an editor gets null and keeps the warning alone. `hint` is the sentence to
 * show ("Add its API key in Settings → Connectors." on that backend); `url` is
 * set only when there is a screen to link to (`kind` `admin_url`).
 *
 * @return {?{kind: string, url: string, hint: string}} The destination, or null.
 */
export function transcriptionKeyDestination() {
	const destination =
		window.vipWorkflowsIdeation?.transcriptionKeyDestination;
	return destination?.hint ? destination : null;
}

/**
 * The warning as plain text, with the destination for a reader who can act.
 *
 * For the drop zone's hint, which only shows mid-drag and so can't hold a
 * link. The Add source dialog renders the same two parts with a link instead.
 *
 * @return {string} Translated warning, plus the destination when there is one.
 */
export function transcriptionUnavailableWarningText() {
	const destination = transcriptionKeyDestination();
	return destination
		? `${ transcriptionUnavailableWarning() } ${ destination.hint }`
		: transcriptionUnavailableWarning();
}
