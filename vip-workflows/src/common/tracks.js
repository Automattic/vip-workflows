/**
 * Records product-usage events in Tracks from the browser.
 *
 * The browser counterpart of the PHP Tracker (includes/telemetry/class-tracker.php):
 * same `vip_workflows_` prefix, same base properties. PHP hands those properties
 * to the page as `tracks` on `vipWorkflowsAdmin` or `vipWorkflowsEditor`, and
 * only where the VIP Telemetry library is loaded, so off VIP there is nothing
 * to send. Local environments send nothing either.
 *
 * Events go on the standard Tracks queue, `window._tkq`, and the Tracks script
 * (stats.wp.com/w.js) is loaded on the first event, rather than with the
 * bundle, so no screen loads it when nothing will be recorded. The script
 * sends whatever is already queued once it loads.
 */

const EVENT_PREFIX = 'vip_workflows_';
const SCRIPT_URL = 'https://stats.wp.com/w.js';

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
 * Load the Tracks script, unless it is on the page already (another plugin may
 * have loaded it). A failed load is removed, so the next event tries again.
 */
function loadScript() {
	if ( document.querySelector( 'script[src*="stats.wp.com/w.js"]' ) ) {
		return;
	}

	const script = document.createElement( 'script' );
	script.async = true;
	script.src = SCRIPT_URL;
	script.onerror = () => script.remove();
	document.head.appendChild( script );
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
 */
export function recordTracksEvent( event, properties = {} ) {
	const base = getTracksBaseProperties();

	if ( ! base || base.vip_env === 'local' ) {
		return;
	}

	try {
		window._tkq = window._tkq || [];
		window._tkq.push( [
			'recordEvent',
			`${ EVENT_PREFIX }${ event }`,
			Object.fromEntries(
				Object.entries( { ...base, ...properties } ).filter(
					( [ , value ] ) => value !== undefined
				)
			),
		] );
		loadScript();
	} catch {
		// Telemetry must never break the screen it is measuring.
	}
}
