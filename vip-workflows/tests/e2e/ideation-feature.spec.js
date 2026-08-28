/**
 * Ideation experiment gate.
 *
 * Ideation ships disabled by default behind the experiment registry. These
 * specs assert the disabled shape (no nav item, no admin page, no ideation
 * REST routes, no phase-sequences surface) and the enabled round-trip via
 * the Settings → Experiments tab / experiments REST endpoint.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

/**
 * Set the Ideation experiment toggle via the experiments REST endpoint.
 *
 * @param {Object}  requestUtils Authenticated request utils fixture.
 * @param {boolean} enabled      Desired state.
 */
async function setIdeationExperiment( requestUtils, enabled ) {
	await requestUtils.rest( {
		path: '/vip-workflows/v1/settings/experiments',
		method: 'POST',
		data: { id: 'ideation', enabled },
	} );
}

test.describe( 'VIP Workflows — Ideation experiment gate', () => {
	test.describe( 'disabled by default', () => {
		test( 'Workflows menu has no Ideation item', async ( {
			admin,
			page,
		} ) => {
			await admin.visitAdminPage( 'admin.php', 'page=vip-workflows' );

			const submenu = page.locator(
				'#toplevel_page_vip-workflows .wp-submenu'
			);
			await expect(
				submenu.getByRole( 'link', {
					name: 'My Dashboard',
					exact: true,
				} )
			).toBeVisible();
			await expect(
				submenu.getByRole( 'link', { name: 'Ideation', exact: true } )
			).toHaveCount( 0 );
		} );

		test( 'ideation page slug does not mount the workflow shell', async ( {
			admin,
			page,
		} ) => {
			await admin.visitAdminPage(
				'admin.php',
				'page=vip-workflows-ideation'
			);

			await expect( page.locator( '#vip-workflows-root' ) ).toHaveCount(
				0
			);
		} );

		test( 'ideation REST routes are not registered', async ( {
			requestUtils,
		} ) => {
			let error;
			try {
				await requestUtils.rest( {
					path: '/vip-workflows/v1/ideation',
				} );
			} catch ( e ) {
				error = e;
			}

			expect( error ).toBeDefined();
			expect( error.code ).toBe( 'rest_no_route' );
			expect( error.data.status ).toBe( 404 );
		} );

		test( 'sequences list contains no phase sequences', async ( {
			requestUtils,
		} ) => {
			const sequences = await requestUtils.rest( {
				path: '/vip-workflows/v1/sequences',
			} );

			expect( Array.isArray( sequences ) ).toBe( true );
			expect(
				sequences.filter( ( bp ) => bp.type === 'phase' )
			).toHaveLength( 0 );
		} );

		test( 'creating a phase sequence is rejected', async ( {
			requestUtils,
		} ) => {
			let error;
			try {
				await requestUtils.rest( {
					path: '/vip-workflows/v1/sequences',
					method: 'POST',
					data: {
						type: 'phase',
						name: 'e2e phase gate probe',
						statuses: [
							{ key: 'ideation', label: 'Ideation' },
							{ key: 'editorial', label: 'Editorial' },
						],
					},
				} );
			} catch ( e ) {
				error = e;
			}

			expect( error ).toBeDefined();
			expect( error.code ).toBe( 'rest_sequence_type_disabled' );
			expect( error.data.status ).toBe( 403 );
		} );

		test( 'Sequences page shows no Phase Sequences tab', async ( {
			admin,
			page,
		} ) => {
			await admin.visitAdminPage(
				'admin.php',
				'page=vip-workflows-sequences'
			);

			await expect(
				page.getByRole( 'tab', { name: /Editorial Sequences/ } )
			).toBeVisible();
			await expect(
				page.getByRole( 'tab', { name: /Phase Sequences/ } )
			).toHaveCount( 0 );
		} );

		test( 'Settings Experiments tab renders the Ideation toggle', async ( {
			admin,
			page,
		} ) => {
			await admin.visitAdminPage(
				'admin.php',
				'page=vip-workflows-settings'
			);

			await page.getByRole( 'tab', { name: 'Experiments' } ).click();

			await expect(
				page.getByRole( 'checkbox', { name: 'Ideation' } )
			).toBeVisible();
		} );
	} );

	test.describe.serial( 'enabled via the experiments endpoint', () => {
		test.afterAll( async ( { requestUtils } ) => {
			// Best-effort restore of the default (disabled) state for other specs.
			try {
				await setIdeationExperiment( requestUtils, false );
			} catch ( e ) {
				// Ignore — nothing to restore if the toggle never flipped.
			}
		} );

		test( 'enabling exposes nav, page, REST routes, and phase sequences', async ( {
			admin,
			page,
			requestUtils,
		} ) => {
			await setIdeationExperiment( requestUtils, true );

			// Workflows submenu item appears.
			await admin.visitAdminPage( 'admin.php', 'page=vip-workflows' );
			await expect(
				page
					.locator( '#toplevel_page_vip-workflows .wp-submenu' )
					.getByRole( 'link', { name: 'Ideation', exact: true } )
			).toBeVisible();

			// Ideation page mounts the shell.
			await admin.visitAdminPage(
				'admin.php',
				'page=vip-workflows-ideation'
			);
			const root = page.locator( '#vip-workflows-root' );
			await expect( root ).toBeAttached();
			await expect( root ).not.toBeEmpty();
			await expect( root ).not.toContainText( 'Coming Soon' );

			// IdeationAdmin's localized data must reach the admin bundle —
			// it localizes at admin_enqueue_scripts priority 20 because the
			// 'vip-workflows-admin' handle is registered at priority 10.
			const ideationData = await page.evaluate(
				() => window.vipWorkflowsIdeation
			);
			expect( ideationData ).toBeTruthy();
			expect( ideationData.restUrl ).toContain( 'vip-workflows/v1' );

			// Ideation REST routes answer.
			const projects = await requestUtils.rest( {
				path: '/vip-workflows/v1/ideation',
			} );
			expect( projects ).toBeDefined();

			// Phase tab is back, with the activation-seeded Content Lifecycle.
			await admin.visitAdminPage(
				'admin.php',
				'page=vip-workflows-sequences'
			);
			const phaseTab = page.getByRole( 'tab', {
				name: /Phase Sequences/,
			} );
			await expect( phaseTab ).toBeVisible();
			await phaseTab.click();
			await expect(
				page.getByRole( 'heading', { name: 'Content Lifecycle' } )
			).toBeVisible();
		} );

		test( 'disabling restores the gated shape', async ( {
			admin,
			page,
			requestUtils,
		} ) => {
			await setIdeationExperiment( requestUtils, false );

			await admin.visitAdminPage( 'admin.php', 'page=vip-workflows' );
			await expect(
				page
					.locator( '#toplevel_page_vip-workflows .wp-submenu' )
					.getByRole( 'link', { name: 'Ideation', exact: true } )
			).toHaveCount( 0 );

			// Seeded phase sequence is hidden, not deleted: list excludes it
			// while the route still 404s.
			const sequences = await requestUtils.rest( {
				path: '/vip-workflows/v1/sequences',
			} );
			expect(
				sequences.filter( ( bp ) => bp.type === 'phase' )
			).toHaveLength( 0 );
		} );
	} );
} );
