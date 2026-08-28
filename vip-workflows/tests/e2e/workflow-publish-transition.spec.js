/**
 * Publishing through a workflow transition, in the editor UI.
 *
 * A transition into a publish-region stage crosses the publish boundary, so
 * the server writes `publish` — the post goes publicly live from a sidebar
 * button. Two behaviours are pinned here, both user-reported bugs in their
 * absence:
 *
 * 1. The panel asks before publishing (core's own Publish button does), and
 *    declining really declines.
 * 2. The open editor adopts the new status WITHOUT a reload: the entity record
 *    is refetched after the transition, so the top bar stops offering
 *    "Publish" on a post that is already live. This is end-to-end coverage the
 *    unit tests cannot give — the regression it guards was an entity-resolution
 *    cache key mismatch that only a real editor exhibits.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );
const {
	createWorkflowPost,
	getWorkflowStatus,
	deletePost,
	openWorkflowPanel,
	transition,
} = require( './helpers/workflow' );

test.describe( 'VIP Workflow — publish via transition (editor UI)', () => {
	let postId;

	test.afterEach( async ( { requestUtils } ) => {
		if ( postId ) {
			await deletePost( requestUtils, postId );
			postId = undefined;
		}
	} );

	test( 'asks before publishing, and the editor updates without a reload', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		( { postId } = await createWorkflowPost( requestUtils, {
			title: 'Publish transition e2e',
		} ) );

		// Seed the post at the publish gate over REST; the UI drives only the
		// behaviour under test.
		await transition( requestUtils, postId, 'review' );
		await transition( requestUtils, postId, 'ready' );

		await admin.editPost( postId );

		const topBar = page.getByRole( 'region', { name: 'Editor top bar' } );
		const publishButton = topBar.getByRole( 'button', {
			name: 'Publish',
			exact: true,
		} );

		// A draft: core offers Publish.
		await expect( publishButton ).toBeVisible();

		const panel = await openWorkflowPanel( page );
		await expect( panel.locator( '.vip-workflow-rail__stage' ) ).toHaveText(
			'Ready to Publish'
		);

		const publishNow = panel
			.locator( '.vip-workflow-rail__actions' )
			.getByRole( 'button', { name: 'Publish Now' } );

		// Declining the confirm abandons the transition entirely.
		await publishNow.click();
		const dialog = page.getByRole( 'dialog', {
			name: 'Publish this post?',
		} );
		await expect( dialog ).toBeVisible();
		await dialog.getByRole( 'button', { name: 'Cancel' } ).click();
		await expect( dialog ).toBeHidden();

		expect(
			( await getWorkflowStatus( requestUtils, postId ) ).current.key
		).toBe( 'ready' );

		// Confirming publishes.
		await publishNow.click();
		await dialog.getByRole( 'button', { name: 'Publish' } ).click();

		await expect( panel.locator( '.vip-workflow-rail__stage' ) ).toHaveText(
			'Published'
		);

		// The headline: the OPEN editor adopts the committed status without a
		// reload. The entity record is the editor's source of truth, so this
		// is asserted at the record first and at the chrome second.
		await page.waitForFunction(
			() =>
				window.wp.data.select( 'core/editor' ).getCurrentPost()
					.status === 'publish'
		);
		await expect( publishButton ).toBeHidden();

		// And the server agrees.
		const status = await getWorkflowStatus( requestUtils, postId );
		expect( status.current.key ).toBe( 'publish' );
		expect( status.post_status ).toBe( 'publish' );
	} );
} );
