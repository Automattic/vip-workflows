/**
 * Smoke tests.
 *
 * That the plugin is active, its REST API answers and the default sequences
 * are seeded is checked before any spec runs, by the preflight in
 * global-setup.js. That the admin app mounts is checked by
 * navigation.spec.js. What is left here is the wp-admin chrome around it.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

test.describe( 'VIP Workflows — smoke', () => {
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
