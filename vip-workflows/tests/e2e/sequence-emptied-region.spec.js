/**
 * Sequence graph editor — a status group emptied by an edit.
 *
 * When an edit takes the last stage out of a status group, the group stays
 * drawn until the next save: on the canvas, in the Post status picker and in
 * the stage's right-click menu, so the stage can be put back in one step. A
 * successful save makes the stored stages the new reference, which is when an
 * emptied group stops being drawn. A group the author added by hand is kept
 * for the rest of the session, saves included.
 *
 * The pure half (`keptRegions`, `prunedRemovals`) and the editor's state
 * handling are covered in `tests/unit-js/sequence-emptied-region.test.js`.
 * This spec checks the same promises in a real browser, against the server's
 * own save response.
 *
 * Selectors follow `sequence-status-regions.spec.js`.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );
const { deleteSequence } = require( './helpers/workflow' );

/**
 * Create a sequence whose Published group holds one stage.
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').RequestUtils} requestUtils
 * @return {Promise<Object>} Created sequence record.
 */
async function createSequence( requestUtils ) {
	return requestUtils.rest( {
		path: '/vip-workflows/v1/sequences',
		method: 'POST',
		data: {
			name: `E2E Emptied Region ${ Date.now() }`,
			type: 'workflow',
			status: 'active',
			post_types: [ 'post' ],
			statuses: [
				{
					key: 'draft',
					label: 'Draft',
					status: 'draft',
					region_entry: true,
					transitions: [ { to: 'review', label: 'Submit' } ],
				},
				{
					key: 'review',
					label: 'Review',
					status: 'draft',
					transitions: [ { to: 'published', label: 'Publish' } ],
				},
				{
					key: 'published',
					label: 'Published',
					status: 'publish',
					region_entry: true,
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
	// The editor fetches the sequence before it draws; allow for a slow host.
	await expect( page.getByRole( 'button', { name: 'Save' } ) ).toBeVisible( {
		timeout: 20000,
	} );
	await page.getByRole( 'button', { name: 'Fit View' } ).click();
}

/**
 * A stage node by its label.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string}                          label Stage label.
 * @return {import('@playwright/test').Locator} The node.
 */
const nodeNamed = ( page, label ) =>
	page.locator( '.wf-stage-node' ).filter( { hasText: label } );

/**
 * A region's viewport-pinned label, by status slug.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string}                          region Status slug, e.g. "publish".
 * @return {import('@playwright/test').Locator} The label.
 */
const regionLabel = ( page, region ) =>
	page.locator( `.wf-region-labels__label[data-region="${ region }"]` );

/**
 * The stage panel's Post status picker.
 *
 * @param {import('@playwright/test').Page} page
 * @return {import('@playwright/test').Locator} The select.
 */
const postStatus = ( page ) =>
	page.getByRole( 'combobox', { name: 'Post status' } );

/**
 * Save, and wait for the server to confirm the write.
 *
 * @param {import('@playwright/test').Page} page
 */
async function save( page ) {
	await page.getByRole( 'button', { name: 'Save' } ).click();
	await expect( page.getByRole( 'button', { name: 'Saved!' } ) ).toBeVisible(
		{ timeout: 20000 }
	);
}

test.describe( 'VIP Workflows — emptied status groups', () => {
	let sequenceId;

	test.afterEach( async ( { requestUtils } ) => {
		if ( sequenceId ) {
			await deleteSequence( requestUtils, sequenceId );
			sequenceId = undefined;
		}
	} );

	test( 'an emptied group stays drawn: moving its stage back takes one step, and deleting the stage leaves it until removed', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const bp = await createSequence( requestUtils );
		sequenceId = bp.id;
		await openEditor( admin, page, bp.name );

		await expect( regionLabel( page, 'publish' ) ).toContainText(
			'1 stage'
		);

		await nodeNamed( page, 'Published' ).click();
		await postStatus( page ).selectOption( { label: 'Draft' } );

		// The group is still drawn, empty, and still offered as a status.
		await expect( regionLabel( page, 'publish' ) ).toContainText(
			'0 stages'
		);
		await expect(
			postStatus( page ).locator( 'option', { hasText: 'Published' } )
		).toHaveCount( 1 );

		// The right-click menu offers it too.
		await nodeNamed( page, 'Published' ).click( { button: 'right' } );
		await expect(
			page.getByRole( 'menuitem', {
				name: 'Set post status to “Published”',
			} )
		).toBeVisible();
		await page.keyboard.press( 'Escape' );

		// Back in one step, without adding the status again.
		await nodeNamed( page, 'Published' ).click();
		await postStatus( page ).selectOption( { label: 'Published' } );
		await expect( regionLabel( page, 'publish' ) ).toContainText(
			'1 stage'
		);

		// Deleting the only stage empties the group the same way, and it stays
		// drawn until it is taken off the canvas by hand.
		await nodeNamed( page, 'Published' ).click();
		await page.getByRole( 'button', { name: 'Delete stage' } ).click();

		await expect( nodeNamed( page, 'Published' ) ).toHaveCount( 0 );
		await expect( regionLabel( page, 'publish' ) ).toContainText(
			'0 stages'
		);

		await regionLabel( page, 'publish' ).click();
		await page
			.getByRole( 'button', { name: 'Remove this status' } )
			.click();
		await expect( regionLabel( page, 'publish' ) ).toHaveCount( 0 );
	} );

	test( 'an emptied group does not block Save, and the save stops drawing it', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const bp = await createSequence( requestUtils );
		sequenceId = bp.id;
		await openEditor( admin, page, bp.name );

		await nodeNamed( page, 'Published' ).click();
		await postStatus( page ).selectOption( { label: 'Draft' } );
		await expect( regionLabel( page, 'publish' ) ).toContainText(
			'0 stages'
		);

		await save( page );
		await expect( regionLabel( page, 'publish' ) ).toHaveCount( 0 );

		const saved = await requestUtils.rest( {
			path: `/vip-workflows/v1/sequences/${ sequenceId }`,
		} );
		const published = saved.config.statuses.find(
			( s ) => s.key === 'published'
		);
		expect( published.status ).toBe( 'draft' );
	} );

	test( 'a group added by hand is still drawn after a save', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const bp = await createSequence( requestUtils );
		sequenceId = bp.id;
		await openEditor( admin, page, bp.name );

		await page
			.locator( '.wf-canvas__viewport' )
			.click( { button: 'right', position: { x: 40, y: 40 } } );
		await page.getByRole( 'menuitem', { name: /Add post status/ } ).click();
		const dialog = page.getByRole( 'dialog', { name: 'Add post status' } );
		await dialog
			.getByRole( 'combobox', { name: 'Post status' } )
			.selectOption( { label: 'Private' } );
		await dialog.getByRole( 'button', { name: 'Add status' } ).click();
		await expect( regionLabel( page, 'private' ) ).toContainText(
			'0 stages'
		);

		// Empty the Published group in the same save: the save clears it,
		// but not the group added by hand.
		await nodeNamed( page, 'Published' ).click();
		await postStatus( page ).selectOption( { label: 'Draft' } );

		await save( page );
		await expect( regionLabel( page, 'publish' ) ).toHaveCount( 0 );
		await expect( regionLabel( page, 'private' ) ).toContainText(
			'0 stages'
		);
	} );
} );
