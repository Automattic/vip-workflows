/**
 * The Workflow row and the metadata rows where core's Summary panel cannot
 * show them.
 *
 * The rows are a `PluginPostStatusInfo` fill. Core skips that slot while the
 * `post-status` panel is removed, and some experimental DataForm Summary builds
 * draw no slot at all. In both, the Workflow sidebar has to carry the same rows,
 * or the author has no way to assign or remove a workflow or fill a required
 * field. And it must never carry a second copy where the Summary panel shows
 * them.
 *
 * The `post-status` panel is removed with `removeEditorPanel()`. Preferences →
 * Panels has no switch for it, and `toggleEditorPanelEnabled( 'post-status' )`
 * changes nothing either Summary reads.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );
const {
	WORKFLOW_SIDEBAR,
	createDraftPost,
	deletePost,
	getEditorialSequence,
	openWorkflowSidebar,
	openWorkflowSummaryRows,
} = require( './helpers/workflow' );

/**
 * The sidebar's copy of the rows, found by its section label.
 *
 * @param {import('@playwright/test').Page} page
 * @return {import('@playwright/test').Locator} The section.
 */
const sidebarDetails = ( page ) =>
	page.locator( WORKFLOW_SIDEBAR ).getByRole( 'region', { name: 'Details' } );

test.describe( 'VIP Workflows — Summary rows fallback', () => {
	let postId;

	test.afterEach( async ( { requestUtils } ) => {
		if ( postId ) {
			await deletePost( requestUtils, postId );
			postId = undefined;
		}
	} );

	test( 'the Workflow sidebar carries no copy while the Summary panel shows the rows', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const post = await createDraftPost( requestUtils, {
			title: 'Summary rows present e2e',
		} );
		postId = post.id;

		await admin.editPost( postId );
		await openWorkflowSummaryRows( page );

		await openWorkflowSidebar( page );
		await expect( page.locator( '.vip-workflows-panel' ) ).toBeVisible();
		await expect( sidebarDetails( page ) ).toHaveCount( 0 );
	} );

	test( 'with the post-status panel removed, the Workflow sidebar assigns the workflow', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const sequence = await getEditorialSequence( requestUtils );
		const post = await createDraftPost( requestUtils, {
			title: 'Summary panel removed e2e',
		} );
		postId = post.id;

		await admin.editPost( postId );
		await page.evaluate( () =>
			window.wp.data
				.dispatch( 'core/editor' )
				.removeEditorPanel( 'post-status' )
		);

		// Core no longer renders the slot, so the rows are gone from the
		// Summary panel.
		await expect(
			page.locator( '.vip-workflows-summary-rows' )
		).toHaveCount( 0 );

		await openWorkflowSidebar( page );
		const details = sidebarDetails( page );
		await expect( details ).toBeVisible();
		await expect(
			details.getByRole( 'heading', { name: 'Details' } )
		).toBeVisible();

		// The same row, reached from the keyboard.
		const trigger = details.getByRole( 'button', {
			name: 'Select a workflow',
		} );
		await trigger.focus();
		await page.keyboard.press( 'Enter' );

		const dialog = page.getByRole( 'dialog', { name: 'Workflow' } );
		await expect( dialog ).toBeVisible();
		await dialog
			.getByRole( 'combobox', { name: 'Workflow' } )
			.fill( sequence.name );
		await page.getByRole( 'option', { name: sequence.name } ).click();

		await expect( dialog ).toBeHidden();
		await expect(
			details.getByRole( 'button', {
				name: `Change workflow: ${ sequence.name }`,
			} )
		).toBeVisible();

		// One copy only.
		await expect(
			page.locator( '.vip-workflows-summary-rows' )
		).toHaveCount( 1 );
	} );

	test.describe( 'with the DataForm Summary experiment on', () => {
		test.beforeAll( async ( { requestUtils } ) => {
			await requestUtils.setGutenbergExperiments( [
				'gutenberg-dataform-inspector',
			] );
		} );

		test.afterAll( async ( { requestUtils } ) => {
			await requestUtils.setGutenbergExperiments( [] );
		} );

		/*
		 * Gutenberg builds differ here. An experimental DataForm Summary that
		 * draws no slot leaves the rows to the Workflow sidebar; a build that
		 * draws the slot (and the stabilized Summary, where the experiment
		 * switch no longer exists) shows them in the Summary panel. Either way
		 * the author reaches exactly one copy.
		 */
		test( 'the author reaches exactly one copy of the Workflow row', async ( {
			admin,
			page,
			requestUtils,
		} ) => {
			const post = await createDraftPost( requestUtils, {
				title: 'DataForm Summary e2e',
			} );
			postId = post.id;

			await admin.editPost( postId );

			// The document sidebar opens by default; wait for its Summary to
			// settle before counting what it drew.
			await page.locator( '.editor-post-summary' ).first().waitFor();
			const inSummary = await page
				.locator( '.editor-post-summary .vip-workflows-summary-rows' )
				.count();

			await openWorkflowSidebar( page );
			await expect(
				page.locator( '.vip-workflows-panel' )
			).toBeVisible();

			const details = sidebarDetails( page );
			await expect( details ).toHaveCount( inSummary ? 0 : 1 );

			if ( ! inSummary ) {
				await expect(
					details.getByRole( 'button', {
						name: 'Select a workflow',
					} )
				).toBeVisible();
			}
		} );
	} );
} );
