/**
 * The `window.vipWorkflowsAdmin` object the admin pages are given.
 *
 * `Admin::enqueue_admin_scripts()` localizes it on every core VIP Workflows
 * screen. Pages read what they need from it without a fallback (missing data is
 * a data-integrity error), so a test fixture that leaves a key out makes the
 * page throw rather than exercising what the test is about. Build it here, so a
 * key the server starts sending is added once.
 *
 * @param {Object} overrides Keys to replace on the default object.
 * @return {Object} The localized admin data.
 */
export function adminGlobals( overrides = {} ) {
	return {
		currentUser: { id: 42 },
		myWork: { windowDays: 60 },
		...overrides,
	};
}
