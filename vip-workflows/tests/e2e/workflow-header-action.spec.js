/**
 * The workflow split button in the editor header.
 *
 * For a person who cannot bypass the workflow, a post on the draft side of the
 * publish boundary has nowhere for core's Publish button to go but a refusal,
 * so the header offers the stage's primary transition in its place. A person
 * who can bypass keeps core's Publish, with the workflow button beside it.
 *
 * Administrators bypass by default, so this spec takes the bypass away for its
 * own run and restores the stored setting afterwards. The suite runs on one
 * worker, so no other spec sees the change.
 *
 * @package
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );
const {
	createWorkflowPost,
	deletePost,
	getWorkflowStatus,
	openWorkflowPanel,
} = require( './helpers/workflow' );

const SETTINGS_PATH = '/vip-workflows/v1/settings/general';

/**
 * Set which roles bypass the workflow.
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').RequestUtils} requestUtils
 * @param {string[]}                                                    roles        Role slugs.
 * @return {Promise<Object>} The saved settings.
 */
function setBypassRoles( requestUtils, roles ) {
	return requestUtils.rest( {
		path: SETTINGS_PATH,
		method: 'POST',
		data: { bypass_workflow_roles: roles },
	} );
}

test.describe( 'VIP Workflows — header split button (editor UI)', () => {
	let postId;
	let storedBypassRoles;

	test.beforeAll( async ( { requestUtils } ) => {
		const settings = await requestUtils.rest( { path: SETTINGS_PATH } );
		storedBypassRoles = settings.bypass_workflow_roles;
	} );

	test.afterAll( async ( { requestUtils } ) => {
		await setBypassRoles( requestUtils, storedBypassRoles );
	} );

	test.afterEach( async ( { requestUtils } ) => {
		if ( postId ) {
			await deletePost( requestUtils, postId );
			postId = undefined;
		}
	} );

	test( 'stands in for Publish, saves the edit, and moves the post', async ( {
		admin,
		editor,
		page,
		requestUtils,
	} ) => {
		await setBypassRoles( requestUtils, [] );
		( { postId } = await createWorkflowPost( requestUtils, {
			title: 'Header action e2e',
		} ) );

		await admin.editPost( postId );

		const topBar = page.getByRole( 'region', { name: 'Editor top bar' } );
		const primary = topBar.locator( '.vip-workflows-header-action__main' );

		// The first transition of the Draft stage, under its own label.
		await expect( primary ).toHaveText( 'Submit for review' );
		await expect(
			topBar.getByRole( 'button', { name: 'Publish', exact: true } )
		).toBeHidden();

		// The arrow opens the rail with every way out.
		await topBar
			.getByRole( 'button', { name: 'Workflow transitions' } )
			.click();
		const rail = page.locator( '.vip-workflows-header-action__rail' );
		await expect( rail.locator( '.vip-workflows-rail__stage' ) ).toHaveText(
			'Draft'
		);
		await page.keyboard.press( 'Escape' );
		await expect( rail ).toBeHidden();

		// An unsaved edit travels with the move: the button saves first.
		await editor.canvas
			.getByRole( 'textbox', { name: 'Add title' } )
			.fill( 'Header action e2e, edited' );
		await primary.click();

		await expect
			.poll(
				async () =>
					( await getWorkflowStatus( requestUtils, postId ) ).current
						.key
			)
			.toBe( 'review' );

		const saved = await requestUtils.rest( {
			path: `/wp/v2/posts/${ postId }`,
			params: { context: 'edit' },
		} );
		expect( saved.title.raw ).toBe( 'Header action e2e, edited' );

		// The rail in the sidebar follows the move made from the header.
		const panel = await openWorkflowPanel( page );
		await expect(
			panel.locator( '.vip-workflows-rail__stage' )
		).toHaveText( 'In review' );
	} );

	test( 'keeps core Publish for a person who can bypass the workflow', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		await setBypassRoles( requestUtils, [ 'administrator' ] );
		( { postId } = await createWorkflowPost( requestUtils, {
			title: 'Header action bypass e2e',
		} ) );

		await admin.editPost( postId );

		const topBar = page.getByRole( 'region', { name: 'Editor top bar' } );
		await expect(
			topBar.getByRole( 'button', { name: 'Publish', exact: true } )
		).toBeVisible();
		await expect(
			topBar.locator( '.vip-workflows-header-action__main' )
		).toHaveText( 'Submit for review' );
	} );
} );
