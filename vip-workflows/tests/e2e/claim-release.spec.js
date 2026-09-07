/**
 * Claim / release (REST), driven as a reviewer who is not the post author.
 *
 * The post is authored by the admin session; the reviewer is a separate `editor`
 * user (a reviewer role, and not in the tool-check bypass list). Editors have
 * `edit_post` on others' posts, which is what the claim/release endpoints gate
 * on. We assert through the endpoints themselves — claim succeeds, a second user
 * is locked out (409), release frees it, and it can be claimed again — rather
 * than coupling to the status payload's assignment shape.
 */

const {
	test,
	expect,
	RequestUtils,
} = require( '@wordpress/e2e-test-utils-playwright' );
const {
	createWorkflowPost,
	deletePost,
	createReviewerUser,
	claimPost,
	releasePost,
} = require( './helpers/workflow' );

test.describe( 'VIP Workflows — claim / release (REST)', () => {
	let postId;
	let reviewer;

	test.afterEach( async ( { requestUtils } ) => {
		if ( postId ) {
			await deletePost( requestUtils, postId );
			postId = undefined;
		}
		if ( reviewer ) {
			await requestUtils.rest( {
				method: 'DELETE',
				path: `/wp/v2/users/${ reviewer.id }`,
				params: { force: true, reassign: 1 },
			} );
			reviewer = undefined;
		}
	} );

	test( 'a reviewer (not the author) claims a post, then releases it', async ( {
		requestUtils,
	} ) => {
		// Admin authors the post, so the reviewer is necessarily a different user.
		( { postId } = await createWorkflowPost( requestUtils, {
			title: 'Claim/release e2e',
		} ) );

		reviewer = await createReviewerUser( requestUtils );
		const reviewerUtils = await RequestUtils.setup( {
			user: { username: reviewer.username, password: reviewer.password },
		} );

		// Reviewer claims the admin-authored post.
		const claimed = await claimPost( reviewerUtils, postId );
		expect( claimed.success ).toBe( true );
		expect( claimed.assigned_to ).toBe( reviewer.id );

		// It's now claimed — a different user (admin) is locked out. `rest()`
		// throws the REST error body (a plain object, not an Error), so match on
		// its shape rather than `toThrow()`.
		await expect( claimPost( requestUtils, postId ) ).rejects.toMatchObject(
			{ code: 'post_already_claimed' }
		);

		// Reviewer releases it.
		const released = await releasePost( reviewerUtils, postId );
		expect( released.success ).toBe( true );

		// Released — it can be claimed again.
		const reclaimed = await claimPost( requestUtils, postId );
		expect( reclaimed.success ).toBe( true );
	} );
} );
