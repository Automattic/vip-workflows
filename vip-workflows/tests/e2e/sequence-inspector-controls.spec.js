/**
 * Inspector structural edits must keep the graph and its selection in sync.
 * Keyboard activation reaches React Flow's real focusable node/edge wrappers,
 * which component tests cannot exercise.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );
const { deleteSequence } = require( './helpers/workflow' );

test.describe( 'VIP Workflows — sequence inspector controls', () => {
	let sequenceId;

	test.afterEach( async ( { requestUtils } ) => {
		if ( sequenceId ) {
			await deleteSequence( requestUtils, sequenceId );
			sequenceId = undefined;
		}
	} );

	test( 'keyboard selection survives adding, repointing, and moving stages through the inspector', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const sequence = await requestUtils.rest( {
			path: '/vip-workflows/v1/sequences',
			method: 'POST',
			data: {
				name: `E2E Inspector Controls ${ Date.now() }`,
				type: 'workflow',
				status: 'active',
				post_types: [ 'post' ],
				statuses: [
					{
						key: 'draft',
						label: 'Draft',
						status: 'draft',
						region_entry: true,
						transitions: [ { to: 'review', label: 'Submit' } ],
					},
					{
						key: 'review',
						label: 'Review',
						status: 'draft',
						transitions: [],
					},
					{
						key: 'done',
						label: 'Done',
						status: 'publish',
						region_entry: true,
						is_terminal: true,
						transitions: [],
					},
				],
			},
		} );
		sequenceId = sequence.id;

		await page.setViewportSize( { width: 1400, height: 900 } );
		await admin.visitAdminPage(
			'admin.php',
			'page=vip-workflows-sequences'
		);
		await page
			.locator( '.vip-workflows-summary-card' )
			.filter( { hasText: sequence.name } )
			.getByRole( 'button', { name: 'Edit' } )
			.click();

		const nodes = page.locator( '.wf-stage-node' );
		const edges = page.locator( '.react-flow__edge' );
		const reviewNode = page.locator(
			'.react-flow__node[data-id="review"]'
		);
		const stageLabel = page.getByRole( 'textbox', {
			name: 'Label',
			exact: true,
		} );
		await expect( nodes ).toHaveCount( 3 );
		// Start → Draft, Draft → Review, and Done → End.
		await expect( edges ).toHaveCount( 3 );
		await page
			.getByRole( 'button', { name: 'Add post status…', exact: true } )
			.click();
		const dialog = page.getByRole( 'dialog', { name: 'Add post status' } );
		await dialog
			.getByRole( 'combobox', { name: 'Post status' } )
			.selectOption( 'pending' );
		await dialog.getByRole( 'button', { name: 'Add status' } ).click();
		const pending = page.locator(
			'.wf-region-labels__label[data-region="pending"]'
		);
		await expect( pending ).toContainText( '0 stages' );

		await expect( reviewNode ).toHaveAttribute( 'tabindex', '0' );
		await reviewNode.focus();
		await page.keyboard.press( 'Enter' );
		await expect( stageLabel ).toHaveValue( 'Review' );

		await page.getByRole( 'button', { name: 'Add exit' } ).click();
		await page
			.getByRole( 'menuitem', { name: 'Done', exact: true } )
			.click();
		// Adding an exit from the stage panel keeps that stage selected.
		await expect( stageLabel ).toHaveValue( 'Review' );
		await expect( edges ).toHaveCount( 4 );
		const reviewEdge = page.locator(
			'.react-flow__edge[data-id="review->done"]'
		);
		await expect( reviewEdge ).toHaveAttribute( 'tabindex', '0' );
		await reviewEdge.focus();
		await page.keyboard.press( 'Space' );
		const destination = page.getByRole( 'combobox', {
			name: 'To',
			exact: true,
		} );
		await expect( destination ).toHaveValue( 'done' );
		await expect(
			page.getByRole( 'combobox', { name: 'From', exact: true } )
		).toHaveValue( 'review' );

		// Each repoint changes the edge ID. Keep the new edge selected and all
		// graph elements mounted across repeated controlled-state updates.
		for ( const target of [ 'draft', 'done' ] ) {
			await destination.selectOption( target );
			await expect( destination ).toHaveValue( target );
			await expect(
				page.locator(
					`.react-flow__edge[data-id="review->${ target }"]`
				)
			).toHaveClass( /selected/ );
			await expect( nodes ).toHaveCount( 3 );
			await expect( edges ).toHaveCount( 4 );
		}

		// Move Review into the empty section without dragging. Its first stage
		// must take the entry checkpoint so the sequence stays saveable.
		await reviewNode.focus();
		await page.keyboard.press( 'Enter' );
		await page
			.getByRole( 'combobox', { name: 'Post status' } )
			.selectOption( 'pending' );
		await expect( stageLabel ).toHaveValue( 'Review' );
		await expect( pending ).toContainText( '1 stage' );
		await expect( reviewNode.locator( '.wf-stage-node' ) ).toHaveClass(
			/is-checkpoint/
		);

		// Clearing keyboard selection through the pane must not clear edges.
		await page
			.locator( '.react-flow__pane' )
			.click( { position: { x: 12, y: 12 } } );
		await expect(
			page.getByRole( 'button', { name: 'Add stage', exact: true } )
		).toBeVisible();
		await expect( nodes ).toHaveCount( 3 );
		await expect( edges ).toHaveCount( 4 );
		await page.getByRole( 'button', { name: 'Save', exact: true } ).click();
		await expect(
			page.getByRole( 'button', { name: 'Saved!' } )
		).toBeVisible();

		const saved = await requestUtils.rest( {
			path: `/vip-workflows/v1/sequences/${ sequenceId }`,
		} );
		const review = saved.config.statuses.find(
			( stage ) => stage.key === 'review'
		);
		expect( review ).toMatchObject( {
			status: 'pending',
			region_entry: true,
		} );
		expect(
			review.transitions.map( ( transition ) => transition.to )
		).toEqual( [ 'done' ] );
		expect(
			saved.config.statuses.find( ( stage ) => stage.key === 'done' )
		).toMatchObject( {
			status: 'publish',
			is_terminal: true,
		} );
	} );
} );
