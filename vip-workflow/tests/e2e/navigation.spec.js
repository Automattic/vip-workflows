/**
 * Navigation — guards the Phase A menu restructure.
 *
 * Covers removal of the old Dashboard and standalone Queue, plus the split of
 * Integrations into Notifications, Agents, Tools, and Jobs.
 *
 * Asserts the new menu shape exists, so a change that breaks it fails here.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

test.describe( 'VIP Workflow — navigation', () => {
	test( 'editors land on My Dashboard at the bare workflow page', async ( {
		admin,
		page,
	} ) => {
		await admin.visitAdminPage( 'admin.php', 'page=vip-workflow' );

		const root = page.locator( '#vip-workflow-root' );
		await expect( root ).toBeAttached();
		await expect( root ).not.toBeEmpty();
		// Not the "Coming Soon" fallback — the bare slug must route to My Dashboard.
		await expect( root ).not.toContainText( 'Coming Soon' );
		// The native wp-admin Workflows submenu lists My Dashboard.
		await expect(
			page
				.locator( '#toplevel_page_vip-workflow .wp-submenu' )
				.getByRole( 'link', { name: 'My Dashboard', exact: true } )
		).toBeVisible();
	} );

	const splitPages = [
		'vip-workflow-notifications',
		'vip-workflow-agents',
		'vip-workflow-tools',
		'vip-workflow-jobs',
	];
	for ( const slug of splitPages ) {
		test( `${ slug } page loads the workflow shell`, async ( {
			admin,
			page,
		} ) => {
			await admin.visitAdminPage( 'admin.php', `page=${ slug }` );

			const root = page.locator( '#vip-workflow-root' );
			await expect( root ).toBeAttached();
			await expect( root ).not.toBeEmpty();
			await expect( root ).not.toContainText( 'Coming Soon' );
		} );
	}

	test( 'Notifications divides into Channels and Routing, with one Save', async ( {
		admin,
		page,
	} ) => {
		await admin.visitAdminPage(
			'admin.php',
			'page=vip-workflow-notifications'
		);

		// The strip used to grow with the site: a tab per channel group, a tab
		// per ungrouped channel, then System Events and Routing & Debug. Those
		// were instances, not topics — every channel is a card in Channels now,
		// and everything about which event reaches which channel is in Routing.
		// Two tabs, on every site, whatever is installed.
		await expect(
			page.getByRole( 'tab', { name: 'Channels' } )
		).toBeVisible();
		await expect(
			page.getByRole( 'tab', { name: 'Routing' } )
		).toBeVisible();
		await expect( page.getByRole( 'tab' ) ).toHaveCount( 2 );

		// Slack ships with core and the test env activates workflow-channel-ntfy,
		// so both are addable from the header rather than from a tab of their own.
		await expect(
			page.getByRole( 'button', { name: 'Add Slack' } )
		).toBeVisible();

		// One Save for the screen: not one per channel card, and not the
		// separate ones the events matrix and the routing panel each carried.
		await expect(
			page.getByRole( 'button', { name: 'Save', exact: true } )
		).toHaveCount( 1 );

		await page.getByRole( 'tab', { name: 'Routing' } ).click();

		await expect(
			page.getByRole( 'heading', { name: 'Event routing' } )
		).toBeVisible();
		await expect(
			page.getByRole( 'heading', { name: 'Debug mode' } )
		).toBeVisible();
		await expect(
			page.getByRole( 'button', { name: 'Save', exact: true } )
		).toHaveCount( 1 );
	} );

	test( 'Workflows menu shows the four split items', async ( {
		admin,
		page,
	} ) => {
		await admin.visitAdminPage( 'admin.php', 'page=vip-workflow' );

		// Scope to the Workflows submenu so labels like "Tools" don't collide
		// with the core wp-admin top-level menus of the same name.
		const submenu = page.locator(
			'#toplevel_page_vip-workflow .wp-submenu'
		);
		await expect(
			submenu.getByRole( 'link', { name: 'Notifications', exact: true } )
		).toBeVisible();
		await expect(
			submenu.getByRole( 'link', { name: 'Agents', exact: true } )
		).toBeVisible();
		await expect(
			submenu.getByRole( 'link', { name: 'Tools', exact: true } )
		).toBeVisible();
		await expect(
			submenu.getByRole( 'link', { name: 'Jobs', exact: true } )
		).toBeVisible();
	} );
} );
