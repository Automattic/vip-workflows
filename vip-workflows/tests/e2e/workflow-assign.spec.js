/**
 * Choosing a post's workflow from the editor sidebar.
 *
 * Which sequence a post belongs to is a property of the post, so the sidebar
 * draws it the way the document sidebar draws any other one: a label beside a
 * value you press, whose popover holds a searchable list. That single row
 * serves both states — it replaced a select-plus-Start form on a post with no
 * workflow, and an unlabelled heading (with no way to change it at all) on a
 * post with one.
 *
 * Two things are worth driving through a real browser rather than jsdom: the
 * popover, and the confirm that stands in front of giving up a place in a
 * sequence. Re-assignment re-seats the post at the NEW sequence's region entry
 * stage, so it is not a rename — the author has to be asked.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );
const {
	createDraftPost,
	createRoleGatedSequence,
	createWorkflowPost,
	deleteSequence,
	deletePost,
	getEditorialSequence,
	getWorkflowStatus,
	openWorkflowPanel,
} = require( './helpers/workflow' );

test.describe( 'VIP Workflows — assign a workflow (editor UI)', () => {
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

	test( 'picking a sequence from the row starts the workflow', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const sequence = await getEditorialSequence( requestUtils );
		const post = await createDraftPost( requestUtils, {
			title: 'Assign from sidebar e2e',
		} );
		postId = post.id;

		await admin.editPost( postId );
		const panel = await openWorkflowPanel( page );

		// The row's value is the affordance: no workflow yet, so it invites one.
		await panel
			.getByRole( 'button', { name: 'Select a workflow' } )
			.click();

		const dialog = page.getByRole( 'dialog', { name: 'Workflow' } );
		await expect( dialog ).toBeVisible();

		await dialog
			.getByRole( 'combobox', { name: 'Workflow' } )
			.fill( sequence.name );
		await page.getByRole( 'option', { name: sequence.name } ).click();

		// Picking IS starting — there is no second button to press, and the row
		// names the sequence the post now belongs to.
		await expect( dialog ).toBeHidden();
		await expect(
			panel.getByRole( 'button', {
				name: `Change workflow: ${ sequence.name }`,
			} )
		).toBeVisible();

		// The rail arrives with it: the post is seated, not merely labelled.
		await expect(
			panel.locator( '.vip-workflows-rail__stage' )
		).toBeVisible();

		const status = await getWorkflowStatus( requestUtils, postId );
		expect( status.has_workflow ).toBe( true );
		expect( status.sequence.id ).toBe( sequence.id );
	} );

	test( 'moving an enrolled post to another sequence asks first, and declining changes nothing', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		let editorialId;
		( { postId, sequenceId: editorialId } = await createWorkflowPost(
			requestUtils,
			{ title: 'Switch workflow e2e' }
		) );

		const other = await createRoleGatedSequence( requestUtils, 'switch' );
		sequenceId = other.id;

		await admin.editPost( postId );
		const panel = await openWorkflowPanel( page );

		const trigger = panel.getByRole( 'button', {
			name: /^Change workflow: /,
		} );
		await trigger.click();

		const dialog = page.getByRole( 'dialog', { name: 'Workflow' } );
		await dialog
			.getByRole( 'combobox', { name: 'Workflow' } )
			.fill( other.name );
		await page.getByRole( 'option', { name: other.name } ).click();

		// The consequence is named before anything is written: the post gives
		// up where it had got to, and picking the old sequence back does not
		// return it.
		const confirm = page.getByRole( 'dialog', {
			name: 'Change this post’s workflow?',
		} );
		await expect( confirm ).toBeVisible();

		await confirm.getByRole( 'button', { name: 'Cancel' } ).click();

		await expect( confirm ).toBeHidden();
		const status = await getWorkflowStatus( requestUtils, postId );
		expect( status.sequence.id ).toBe( editorialId );
	} );
} );
