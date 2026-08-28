/**
 * Post-publish workflow stage (REST end-to-end).
 *
 * Drives a post through the Editorial Review chain to the publish gate and then
 * into the post-publish `promote` stage, proving the decoupling's headline
 * capability: a post can be live (post_status = publish) AND still advancing
 * through workflow stages. Verifies visibility stays `publish` across the
 * post-publish transition and that the post remains in the live collection.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );
const {
	createWorkflowPost,
	getWorkflowStatus,
	transition,
	deletePost,
} = require( './helpers/workflow' );

/**
 * Read a post's core post_status (edit context).
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').RequestUtils} requestUtils
 * @param {number}                                                      postId
 * @return {Promise<string>} The core post_status.
 */
async function coreStatus( requestUtils, postId ) {
	const post = await requestUtils.rest( {
		path: `/wp/v2/posts/${ postId }`,
		params: { context: 'edit' },
	} );
	return post.status;
}

test.describe( 'VIP Workflow — post-publish stage (REST)', () => {
	let postId;

	test.afterEach( async ( { requestUtils } ) => {
		if ( postId ) {
			await deletePost( requestUtils, postId );
			postId = undefined;
		}
	} );

	test( 'post stays live while advancing into a post-publish stage', async ( {
		requestUtils,
	} ) => {
		( { postId } = await createWorkflowPost( requestUtils, {
			title: 'Post-publish e2e',
		} ) );

		// Pre-publish stages live in the draft status region — moves between
		// them never touch post_status.
		await transition( requestUtils, postId, 'review' );
		await transition( requestUtils, postId, 'ready' );
		expect( await coreStatus( requestUtils, postId ) ).toBe( 'draft' );

		// Crossing into the publish region makes the post live.
		await transition( requestUtils, postId, 'publish' );
		let status = await getWorkflowStatus( requestUtils, postId );
		expect( status.current.key ).toBe( 'publish' );
		expect( await coreStatus( requestUtils, postId ) ).toBe( 'publish' );

		// The post-publish stage: stage advances but the post STAYS live.
		expect( status.transitions.map( ( t ) => t.to ) ).toContain(
			'promote'
		);
		await transition( requestUtils, postId, 'promote' );
		status = await getWorkflowStatus( requestUtils, postId );
		expect( status.current.key ).toBe( 'promote' );
		expect( await coreStatus( requestUtils, postId ) ).toBe( 'publish' );

		// It is genuinely in the live collection.
		const live = await requestUtils.rest( {
			path: '/wp/v2/posts',
			params: { status: 'publish', include: [ postId ], _fields: 'id' },
		} );
		expect( live.map( ( p ) => p.id ) ).toContain( postId );
	} );
} );
