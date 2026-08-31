/**
 * Workflow lifecycle (REST end-to-end).
 *
 * Drives a post through the full Editorial Review chain
 * (draft → review → ready → publish) against the real REST API, StatusManager,
 * and database. Deterministic and fast — it doesn't depend on editor UI state,
 * so it's the dependable backbone of workflow coverage. The UI transition spec
 * complements it by proving the editor wires into the same path.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );
const {
	createWorkflowPost,
	getWorkflowStatus,
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

	test( 'post advances draft → review → ready → publish', async ( {
		requestUtils,
	} ) => {
		( { postId } = await createWorkflowPost( requestUtils, {
			title: 'Lifecycle e2e',
		} ) );

		// Starts in draft with a single "Submit for Review" transition.
		let status = await getWorkflowStatus( requestUtils, postId );
		expect( status.has_workflow ).toBe( true );
		expect( status.current.key ).toBe( 'draft' );
		expect( status.transitions.map( ( t ) => t.to ) ).toContain( 'review' );

		// draft → review.
		await transition( requestUtils, postId, 'review' );
		status = await getWorkflowStatus( requestUtils, postId );
		expect( status.current.key ).toBe( 'review' );

		// review → ready.
		await transition( requestUtils, postId, 'ready' );
		status = await getWorkflowStatus( requestUtils, postId );
		expect( status.current.key ).toBe( 'ready' );

		// ready → publish (the publish gate — no longer terminal; a post-publish
		// `promote` stage follows it.
		await transition( requestUtils, postId, 'publish' );
		status = await getWorkflowStatus( requestUtils, postId );
		expect( status.current.key ).toBe( 'publish' );
		expect( status.transitions.map( ( t ) => t.to ) ).toContain(
			'promote'
		);
	} );

	test( 'history records each transition', async ( { requestUtils } ) => {
		( { postId } = await createWorkflowPost( requestUtils, {
			title: 'History e2e',
		} ) );

		await transition( requestUtils, postId, 'review' );
		await transition( requestUtils, postId, 'draft' ); // Request Changes.

		const history = await requestUtils.rest( {
			path: `/vip-workflows/v1/workflow/post/${ postId }/history`,
		} );

		expect( Array.isArray( history ) ).toBe( true );
		// Two transitions were performed; the audit log must reflect both.
		expect( history.length ).toBeGreaterThanOrEqual( 2 );
	} );
} );
