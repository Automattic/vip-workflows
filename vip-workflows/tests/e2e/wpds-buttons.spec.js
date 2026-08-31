/**
 * e2e coverage for the WPDS button conversions.
 *
 * Proves the round-trip for converted controls whose effect spans the real
 * stack and that unit tests can't reach (store/editor-coupled, popover/modal).
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );
const {
	createRoleGatedSequence,
	createDraftPost,
	assignSequence,
	deletePost,
	deleteSequence,
	openWorkflowPanel,
} = require( './helpers/workflow' );

test.describe( 'VIP Workflows — WPDS buttons (e2e)', () => {
	let postId;
	let sequenceId;

	test.afterEach( async ( { requestUtils } ) => {
		if ( postId ) {
			await deletePost( requestUtils, postId );
			postId = undefined;
		}
		if ( sequenceId ) {
			await deleteSequence( requestUtils, sequenceId );
			sequenceId = undefined;
		}
	} );

	// The AI Agent slideout is optional. Keep this coverage ready for builds that
	// register it, and skip when the FAB is absent.
	test( 'AI Agent FAB opens and closes the slideout panel', async ( {
		admin,
		page,
	} ) => {
		await admin.visitAdminPage( 'admin.php', 'page=vip-workflows' );

		const fab = page.getByRole( 'button', { name: 'Open AI Agent' } );
		if ( ( await fab.count() ) === 0 ) {
			test.skip( true, 'AI Agent FAB not present on this build.' );
			return;
		}
		await expect( fab ).toBeVisible();

		await fab.click();

		const panel = page.locator( '.vip-ai-slideout-panel' );
		await expect( panel ).toHaveClass( /is-open/ );

		await panel.getByRole( 'button', { name: 'Close' } ).click();
		await expect( panel ).not.toHaveClass( /is-open/ );
	} );

	test( 'Kanban hidden-column badge hides and restores a column', async ( {
		admin,
		page,
	} ) => {
		await admin.visitAdminPage( 'admin.php', 'page=vip-workflows-kanban' );

		const hideButtons = page.getByRole( 'button', { name: 'Hide column' } );
		await expect( hideButtons.first() ).toBeVisible();
		const initialCount = await hideButtons.count();

		// Hide the first column -> it collapses into a restore badge.
		await hideButtons.first().click();
		const badge = page.locator(
			'.vip-workflows-kanban-hidden-column-badge'
		);
		await expect( badge.first() ).toBeVisible();

		// Clicking the badge (a converted WPDS Button) restores the column.
		await badge.first().click();
		await expect(
			page.locator( '.vip-workflows-kanban-hidden-column-badge' )
		).toHaveCount( 0 );
		await expect(
			page.getByRole( 'button', { name: 'Hide column' } )
		).toHaveCount( initialCount );
	} );

	test( 'role-gated transition opens the role-select popover', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const sequence = await createRoleGatedSequence( requestUtils );
		sequenceId = sequence.id;
		const post = await createDraftPost( requestUtils, {
			title: 'role-select e2e',
		} );
		postId = post.id;
		await assignSequence( requestUtils, post.id, sequence.id, 'draft' );

		await admin.editPost( post.id );

		const panel = await openWorkflowPanel( page );

		// The "Assign Reviewer" rail transition requires input, so it opens the
		// transition input popover anchored beside the rail button — the
		// side-anchored dialog that replaced the full-screen modals.
		await panel.getByRole( 'button', { name: 'Assign Reviewer' } ).click();

		const popover = page.locator( '.vip-workflows-transition-popover' );
		await expect( popover ).toBeVisible();

		// Roles hydrate from the editor localize payload, so the role Buttons
		// render inside the popover's selection step. Pick the Editor role.
		await popover
			.locator( '.vip-workflows-transition-popover__role' )
			.filter( { hasText: 'Editor' } )
			.click();

		// Picking a role advances the same popover to its notes step; its
		// ActionRow's Submit (notes optional) commits the transition.
		await popover.getByRole( 'button', { name: 'Submit' } ).click();

		// The transition advances the post to the "Assigned" stage, which the
		// fixture marks terminal — so the rail heading announces the ending and
		// the stage's own name is demoted to the line beneath it, never dropped
		// (`is_terminal` is not a synonym for success, so which ending was
		// reached still has to be readable). Both halves are asserted: the
		// heading alone would pass for any terminal stage, and the ending line
		// alone would not prove the workflow was recognised as finished.
		await expect(
			panel.locator( '.vip-workflows-rail__stage' )
		).toHaveText( 'Workflow Completed' );
		await expect(
			panel.locator( '.vip-workflows-rail__ending' )
		).toHaveText( 'Assigned' );
	} );
} );
