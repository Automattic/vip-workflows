/**
 * Smoke tests — the cheap regression net.
 *
 * Confirms the plugin is active, its REST API answers, the default sequences
 * are seeded, and the admin Workflow app mounts. If an AI change breaks
 * activation, asset enqueueing, or REST registration, these fail first.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );
const { EDITORIAL_REVIEW_SLUG } = require( './helpers/workflow' );

test.describe( 'VIP Workflows — smoke', () => {
	test( 'REST API is available and default sequences are seeded', async ( {
		requestUtils,
	} ) => {
		const sequences = await requestUtils.rest( {
			path: '/vip-workflows/v1/sequences',
		} );

		expect( Array.isArray( sequences ) ).toBe( true );
		const slugs = sequences.map( ( bp ) => bp.slug );
		expect( slugs ).toContain( EDITORIAL_REVIEW_SLUG );
	} );

	test( 'admin Workflow app renders', async ( { admin, page } ) => {
		await admin.visitAdminPage( 'admin.php', 'page=vip-workflows' );

		// The React app mounts into #vip-workflows-root (src/admin/index.js).
		const root = page.locator( '#vip-workflows-root' );
		await expect( root ).toBeAttached();
		// The app renders content into the root once booted.
		await expect( root ).not.toBeEmpty();
	} );

	test( 'renders in the standard wp-admin canvas (no fullscreen shell)', async ( {
		admin,
		page,
	} ) => {
		await admin.visitAdminPage( 'admin.php', 'page=vip-workflows' );

		// The removed app shell hid the admin bar and menu and added a
		// fullscreen body class. Guard the central behavioral change: the
		// native wp-admin chrome must remain visible and the takeover gone.
		await expect( page.locator( '#wpadminbar' ) ).toBeVisible();
		await expect( page.locator( '#adminmenu' ) ).toBeVisible();
		await expect( page.locator( 'body.is-fullscreen-mode' ) ).toHaveCount(
			0
		);
	} );
} );
