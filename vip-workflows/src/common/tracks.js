/**
 * Records product-usage events in Tracks from the browser.
 *
 * The browser counterpart of the PHP Tracker (includes/telemetry/class-tracker.php):
 * same `vip_workflows_` prefix, same base properties. PHP hands those properties
 * to the page as `tracks` on `vipWorkflowsAdmin` or `vipWorkflowsEditor`, and
 * only where the VIP Telemetry library is loaded, so off VIP there is nothing
 * to send. Local environments send nothing either.
 *
 * The Tracks client is imported on the first event rather than with the bundle:
 * importing it loads stats.wp.com/w.js, which no screen should do when nothing
 * will be recorded.
 *
 * Events are queued with the client's `pushEventToTracksQueue()`, not its
 * `recordTracksEvent()`: that one drops every event whose source is not on its
 * own hard-coded list (`calypso`, `jetpack`, ...), which `vip` is not. The
 * analytics consent check it would have made is made here instead.
 */

const EVENT_PREFIX = 'vip_workflows_';

let client = null;

/**
 * The base properties PHP localized for this screen.
 *
 * @return {Object|null} Null when this screen should record nothing.
 */
export function getTracksBaseProperties() {
	return (
		window.vipWorkflowsAdmin?.tracks ??
		window.vipWorkflowsEditor?.tracks ??
		null
	);
}

/**
 * The Tracks client, imported once. A failed import is forgotten, so the next
 * event tries again.
 *
 * @return {Promise<Object>} The client module.
 */
function loadClient() {
	client ??= import(
		/* webpackChunkName: "tracks" */ '@automattic/calypso-analytics'
	).catch( ( error ) => {
		client = null;
		throw error;
	} );

	return client;
}

/**
 * Record a Tracks event.
 *
 * Properties must be flat and snake_case, and must never carry content a
 * customer typed: send a length or a count instead. Undefined values are
 * dropped.
 *
 * @param {string} event      Event name, without the `vip_workflows_` prefix.
 * @param {Object} properties Event properties, merged over the base properties.
 * @return {Promise<void>} Settles once the event is queued, or skipped.
 */
export function recordTracksEvent( event, properties = {} ) {
	const base = getTracksBaseProperties();

	if ( ! base || base.vip_env === 'local' ) {
		return Promise.resolve();
	}

	return loadClient()
		.then( ( analytics ) => {
			if ( ! analytics.getTrackingPrefs()?.buckets?.analytics ) {
				return;
			}

			analytics.pushEventToTracksQueue( [
				'recordEvent',
				`${ EVENT_PREFIX }${ event }`,
				Object.fromEntries(
					Object.entries( { ...base, ...properties } ).filter(
						( [ , value ] ) => value !== undefined
					)
				),
			] );
		} )
		.catch( () => {
			// Telemetry must never break the screen it is measuring.
		} );
}
