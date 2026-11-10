/**
 * Workflow lifecycle (REST end-to-end).
 *
 * The audit log records each transition. The full Editorial Review chain
 * (draft → review → ready → publish → promote) is driven over REST in
 * workflow-post-publish-stage.spec.js.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );
const {
	createWorkflowPost,
	transition,
	deletePost,
} = require( './helpers/workflow' );

test.describe( 'VIP Workflows — lifecycle (REST)', () => {
	let postId;

	test.afterEach( async ( { requestUtils } ) => {
		if ( postId ) {
			await deletePost( requestUtils, postId );
			postId = undefined;
		}
	} );

	test( 'history records each transition', async ( { requestUtils } ) => {
		( { postId } = await createWorkflowPost( requestUtils, {
			title: 'History e2e',
		} ) );

		await transition( requestUtils, postId, 'review' );
		await transition( requestUtils, postId, 'draft' ); // Request changes.

		const history = await requestUtils.rest( {
			path: `/vip-workflows/v1/workflow/post/${ postId }/history`,
		} );

		expect( Array.isArray( history ) ).toBe( true );
		// Two transitions were performed; the audit log must reflect both.
		expect( history.length ).toBeGreaterThanOrEqual( 2 );
	} );
} );
