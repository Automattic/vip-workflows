/**
 * Sequence graph editor — the inspector's mobile layout.
 *
 * Below wp-admin's own 782px breakpoint the editor stops being
 * canvas-plus-side-panel: there is no width to spare for a 360px column, so the
 * inspector docks across the bottom of the viewport, starts collapsed, and the
 * canvas controls move out from under it to the top left.
 *
 * These run at real viewport sizes rather than by poking classes, because the
 * whole point is the breakpoint: a CSS media query places the panel and a
 * matchMedia listener in `Inspector.js` sets the collapsed default, and the two
 * have to agree on where the switch happens. The desktop cases are here as the
 * contrast — the same assertions, opposite answers.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );
const { deleteSequence } = require( './helpers/workflow' );

const MOBILE = { width: 600, height: 900 };
const DESKTOP = { width: 1400, height: 900 };

/**
 * Create a small sequence to open in the editor.
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').RequestUtils} requestUtils
 * @return {Promise<Object>} Created sequence record.
 */
async function createSequence( requestUtils ) {
	return requestUtils.rest( {
		path: '/vip-workflows/v1/sequences',
		method: 'POST',
		data: {
			name: `E2E Inspector Mobile ${ Date.now() }`,
			type: 'workflow',
			status: 'active',
			post_types: [ 'post' ],
			statuses: [
				{
					key: 'draft',
					label: 'Draft',
					transitions: [ { to: 'review', label: 'Submit' } ],
				},
				{
					key: 'review',
					label: 'Review',
					is_terminal: true,
					transitions: [],
				},
			],
		},
	} );
}

/**
 * Open a sequence in the graph editor from the sequences list.
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').Admin} admin
 * @param {import('@playwright/test').Page}                      page
 * @param {string}                                               name  Sequence name.
 */
async function openEditor( admin, page, name ) {
	await admin.visitAdminPage( 'admin.php', 'page=vip-workflows-sequences' );
	await page
		.locator( '.vip-workflows-summary-card' )
		.filter( { hasText: name } )
		.getByRole( 'button', { name: 'Edit' } )
		.click();
	await expect( page.getByRole( 'button', { name: 'Save' } ) ).toBeVisible();
}

const panelToggle = ( page ) =>
	page.getByRole( 'button', { name: /Collapse panel|Expand panel/ } );

test.describe( 'VIP Workflows — inspector mobile layout', () => {
	let sequenceId;

	test.afterEach( async ( { requestUtils } ) => {
		if ( sequenceId ) {
			await deleteSequence( requestUtils, sequenceId );
			sequenceId = undefined;
		}
	} );

	test( 'below the breakpoint the panel docks to the bottom, collapsed', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const bp = await createSequence( requestUtils );
		sequenceId = bp.id;

		await page.setViewportSize( MOBILE );
		await openEditor( admin, page, bp.name );

		// Collapsed by default: the graph is what matters on a small screen.
		await expect( panelToggle( page ) ).toHaveAttribute(
			'aria-expanded',
			'false'
		);

		const editor = await page
			.locator( '.wf-sequence-editor' )
			.boundingBox();
		const panel = await page
			.locator( '.wf-sequence-editor__inspector' )
			.boundingBox();

		// Stuck to the bottom edge, not the top.
		expect(
			editor.y + editor.height - ( panel.y + panel.height )
		).toBeLessThan( 20 );
		// Spanning the width rather than sitting in a 360px column.
		expect( panel.width ).toBeGreaterThan( editor.width - 40 );
		// And short — a collapsed bar, not a sheet over the canvas.
		expect( panel.height ).toBeLessThan( editor.height / 3 );
	} );

	test( 'below the breakpoint the canvas controls move to the top left', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const bp = await createSequence( requestUtils );
		sequenceId = bp.id;

		await page.setViewportSize( MOBILE );
		await openEditor( admin, page, bp.name );

		const editor = await page
			.locator( '.wf-sequence-editor' )
			.boundingBox();
		const controls = await page
			.locator( '.react-flow__controls' )
			.boundingBox();

		// Top left: near the editor's top edge, and on its left half.
		expect( controls.y - editor.y ).toBeLessThan( 40 );
		expect( controls.x - editor.x ).toBeLessThan( 40 );
		// Clear of the docked panel, which owns the bottom of the screen.
		const panel = await page
			.locator( '.wf-sequence-editor__inspector' )
			.boundingBox();
		expect( controls.y + controls.height ).toBeLessThan( panel.y );
	} );

	test( 'above the breakpoint it is the right-hand panel again, open', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const bp = await createSequence( requestUtils );
		sequenceId = bp.id;

		await page.setViewportSize( DESKTOP );
		await openEditor( admin, page, bp.name );

		await expect( panelToggle( page ) ).toHaveAttribute(
			'aria-expanded',
			'true'
		);

		const editor = await page
			.locator( '.wf-sequence-editor' )
			.boundingBox();
		const panel = await page
			.locator( '.wf-sequence-editor__inspector' )
			.boundingBox();
		const controls = await page
			.locator( '.react-flow__controls' )
			.boundingBox();

		// A column on the right, roughly full height.
		expect( panel.width ).toBeLessThan( 400 );
		expect(
			editor.x + editor.width - ( panel.x + panel.width )
		).toBeLessThan( 20 );
		expect( panel.height ).toBeGreaterThan( editor.height / 2 );
		// Controls stay at the bottom left, where there is nothing in their way.
		expect(
			editor.y + editor.height - ( controls.y + controls.height )
		).toBeLessThan( 40 );
	} );

	test( 'crossing the breakpoint re-applies that layout’s default', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const bp = await createSequence( requestUtils );
		sequenceId = bp.id;

		await page.setViewportSize( DESKTOP );
		await openEditor( admin, page, bp.name );
		await expect( panelToggle( page ) ).toHaveAttribute(
			'aria-expanded',
			'true'
		);

		// Shrinking past the breakpoint collapses it…
		await page.setViewportSize( MOBILE );
		await expect( panelToggle( page ) ).toHaveAttribute(
			'aria-expanded',
			'false'
		);

		// …and growing back past it opens it again.
		await page.setViewportSize( DESKTOP );
		await expect( panelToggle( page ) ).toHaveAttribute(
			'aria-expanded',
			'true'
		);
	} );
} );
