/**
 * Status transition through the editor UI.
 *
 * The crown-jewel flow: an editor opens a post enrolled in a workflow and moves
 * it to the next stage from the Workflow sidebar. Proves the editor sidebar is
 * wired to the same transition path that workflow-lifecycle.spec.js exercises
 * over REST.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );
const {
	createWorkflowPost,
	getWorkflowStatus,
	deletePost,
	openWorkflowPanel,
} = require( './helpers/workflow' );

test.describe( 'VIP Workflows — transition (editor UI)', () => {
	let postId;

	test.afterEach( async ( { requestUtils } ) => {
		if ( postId ) {
			await deletePost( requestUtils, postId );
			postId = undefined;
		}
	} );

	test( 'editor submits a draft for review from the Workflow sidebar', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		( { postId } = await createWorkflowPost( requestUtils, {
			title: 'UI transition e2e',
		} ) );

		await admin.editPost( postId );

		const panel = await openWorkflowPanel( page );

		// The stage the post is on is named by the transition rail's header;
		// the whole-workflow Progress list is gone — the rail replaced it.
		const currentStage = panel.locator( '.vip-workflows-rail__stage' );
		await expect( currentStage ).toHaveText( 'Draft' );

		// Perform the transition.
		await panel
			.locator( '.vip-workflows-rail__actions' )
			.getByRole( 'button', { name: 'Submit for Review' } )
			.click();

		// UI now offers the review-stage transitions.
		await expect(
			panel.getByRole( 'button', { name: 'Approve' } )
		).toBeVisible();
		await expect( currentStage ).toHaveText( 'In Review' );

		// And the change is persisted server-side.
		const status = await getWorkflowStatus( requestUtils, postId );
		expect( status.current.key ).toBe( 'review' );
	} );
} );
