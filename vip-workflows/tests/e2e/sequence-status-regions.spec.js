/**
 * Sequence graph editor — post status regions.
 *
 * A stage's status region is drawn as a section of the canvas the node sits in,
 * so the region a stage belongs to is a *position* on the canvas rather than a
 * value in a dropdown. That makes these gestures untestable anywhere but a real
 * browser: the band geometry comes from the layout, and "which section did this
 * land in" is answered against measured rectangles. The pure half — which
 * regions exist, what `buildGraph` projects for them, how `layoutSequence` bands
 * them — is covered in `tests/unit-js/sequence-regions.test.js`.
 *
 * Selector note: `.wf-region[data-region="…"]` is the band rectangle (it draws
 * nothing and takes no pointer events — its top edge is the boundary line, and
 * its bounding box is what the drop tests are written against),
 * `.wf-region-labels__label[data-region="…"]` the viewport-pinned status label
 * to click, `.wf-region__slot` the outline of a region's entry checkpoint while
 * that is empty, `.wf-stage-node.is-checkpoint` the stage docked in it, and
 * `.wf-canvas-menu` the right-click menu.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );
const { deleteSequence } = require( './helpers/workflow' );

/**
 * Create a minimal two-stage sequence. Neither stage declares a status, so the
 * server's write gate seats both in the draft region — one section to start
 * from.
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').RequestUtils} requestUtils
 * @return {Promise<Object>} Created sequence record.
 */
async function createTwoStageSequence( requestUtils ) {
	return requestUtils.rest( {
		path: '/vip-workflow/v1/sequences',
		method: 'POST',
		data: {
			name: `E2E Status Regions ${ Date.now() }`,
			type: 'workflow',
			status: 'active',
			post_types: [ 'post' ],
			statuses: [
				{
					key: 'draft',
					label: 'Draft',
					transitions: [ { to: 'review', label: 'Send to review' } ],
				},
				{
					key: 'review',
					label: 'Review',
					is_terminal: true,
					transitions: [],
				},
			],
		},
	} );
}

/**
 * Create a sequence whose publish region holds two stages — `published` is its
 * checkpoint, `promote` is not. A region needs two stages before "somewhere other
 * than the checkpoint" is a place an edge can point.
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').RequestUtils} requestUtils
 * @return {Promise<Object>} Created sequence record.
 */
async function createCheckpointSequence( requestUtils ) {
	return requestUtils.rest( {
		path: '/vip-workflow/v1/sequences',
		method: 'POST',
		data: {
			name: `E2E Region Checkpoint ${ Date.now() }`,
			type: 'workflow',
			status: 'active',
			post_types: [ 'post' ],
			statuses: [
				{
					key: 'draft',
					label: 'Draft',
					status: 'draft',
					region_entry: true,
					transitions: [],
				},
				{
					key: 'published',
					label: 'Published',
					status: 'publish',
					region_entry: true,
					transitions: [ { to: 'promote', label: 'Promote' } ],
				},
				{
					key: 'promote',
					label: 'Promote',
					status: 'publish',
					is_terminal: true,
					transitions: [],
				},
			],
		},
	} );
}

/**
 * A stage node by its label.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string}                          label Stage label.
 * @return {import('@playwright/test').Locator} The node.
 */
const nodeNamed = ( page, label ) =>
	page.locator( '.wf-stage-node' ).filter( { hasText: label } );

/**
 * Drag a connection off a source grip and drop it on a target node.
 *
 * @param {import('@playwright/test').Page}    page
 * @param {import('@playwright/test').Locator} grip   Source handle.
 * @param {import('@playwright/test').Locator} target Node to drop on.
 */
async function dragConnection( page, grip, target ) {
	const from = await grip.boundingBox();
	const to = await target.boundingBox();
	await page.mouse.move( from.x + from.width / 2, from.y + from.height / 2 );
	await page.mouse.down();
	await page.mouse.move( to.x + to.width / 2, to.y + to.height / 2, {
		steps: 12,
	} );
	await page.mouse.up();
}

/**
 * Open a sequence in the graph editor from the sequences list.
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').Admin} admin
 * @param {import('@playwright/test').Page}                      page
 * @param {string}                                               name  Sequence name.
 */
async function openEditor( admin, page, name ) {
	await admin.visitAdminPage( 'admin.php', 'page=vip-workflow-sequences' );
	await page
		.locator( '.vip-workflow-summary-card' )
		.filter( { hasText: name } )
		.getByRole( 'button', { name: 'Edit' } )
		.click();
	await expect( page.getByRole( 'button', { name: 'Save' } ) ).toBeVisible();
}

/**
 * Scale the graph into view. A band is wider than the strip the floating
 * inspector leaves, and two stacked bands are taller than a 700px viewport, so
 * anything that measures or drags has to zoom out first.
 *
 * @param {import('@playwright/test').Page} page
 */
async function fitView( page ) {
	await page.getByRole( 'button', { name: 'Fit View' } ).click();
	// Settled once every band sits inside the canvas — an assertion about what
	// the zoom was for, rather than a sleep waiting for it.
	const canvas = page.locator( '.wf-canvas__viewport' );
	await expect
		.poll( async () => {
			const view = await canvas.boundingBox();
			const bands = await page.locator( '.wf-region' ).all();
			const boxes = await Promise.all(
				bands.map( ( b ) => b.boundingBox() )
			);
			return boxes.every(
				( b ) => b.y >= view.y && b.y + b.height <= view.y + view.height
			);
		} )
		.toBe( true );
}

/**
 * A region's band rectangle, by status slug.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string}                          region Status slug, e.g. "publish".
 * @return {import('@playwright/test').Locator} The band.
 */
const band = ( page, region ) =>
	page.locator( `.wf-region[data-region="${ region }"]` );

/**
 * A region's viewport-pinned label — what says which status a section is, and
 * the only part of a region that takes a click.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string}                          region Status slug, e.g. "publish".
 * @return {import('@playwright/test').Locator} The label.
 */
const regionLabel = ( page, region ) =>
	page.locator( `.wf-region-labels__label[data-region="${ region }"]` );

test.describe( 'VIP Workflow — sequence status regions', () => {
	let sequenceId;

	test.afterEach( async ( { requestUtils } ) => {
		if ( sequenceId ) {
			await deleteSequence( requestUtils, sequenceId );
			sequenceId = undefined;
		}
	} );

	test( 'stages are drawn in the canvas section for the status they hold', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const bp = await createTwoStageSequence( requestUtils );
		sequenceId = bp.id;

		await openEditor( admin, page, bp.name );
		await fitView( page );

		// Both stages are drafts, so there is exactly one region.
		await expect( page.locator( '.wf-region' ) ).toHaveCount( 1 );
		await expect( regionLabel( page, 'draft' ) ).toContainText(
			'2 stages'
		);

		// And it contains them — the section is the region, so a stage outside
		// its band would be saying the opposite of what the data says. The one
		// exception is the region's checkpoint, which is *supposed* to sit on
		// the boundary; it gets its own test below.
		const box = await band( page, 'draft' ).boundingBox();
		const review = await page
			.locator( '.wf-stage-node' )
			.filter( { hasText: 'Review' } )
			.boundingBox();
		expect( review.x ).toBeGreaterThanOrEqual( box.x - 1 );
		expect( review.y ).toBeGreaterThanOrEqual( box.y - 1 );
		expect( review.x + review.width ).toBeLessThanOrEqual(
			box.x + box.width + 1
		);
		expect( review.y + review.height ).toBeLessThanOrEqual(
			box.y + box.height + 1
		);

		const docked = await page
			.locator( '.wf-stage-node.is-checkpoint' )
			.boundingBox();
		expect( docked.y ).toBeLessThan( box.y );
		expect( docked.y + docked.height ).toBeGreaterThan( box.y );
	} );

	test( 'right-click adds a status section, and dragging a stage into it changes the stage’s status', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const bp = await createTwoStageSequence( requestUtils );
		sequenceId = bp.id;

		await openEditor( admin, page, bp.name );

		// Right-click empty canvas, above the first band. The band takes no
		// pointer events, so this reaches the pane either way.
		await page
			.locator( '.wf-canvas__viewport' )
			.click( { button: 'right', position: { x: 40, y: 40 } } );
		await expect( page.locator( '.wf-canvas-menu' ) ).toBeVisible();
		await page.getByRole( 'menuitem', { name: /Add post status/ } ).click();

		// The modal offers the statuses not already on the canvas.
		const dialog = page.getByRole( 'dialog', { name: 'Add post status' } );
		await expect( dialog ).toBeVisible();
		await dialog
			.getByRole( 'combobox', { name: 'Post status' } )
			.selectOption( { label: 'Published' } );
		await dialog.getByRole( 'button', { name: 'Add status' } ).click();

		await expect( page.locator( '.wf-region' ) ).toHaveCount( 2 );
		await expect( regionLabel( page, 'publish' ) ).toContainText(
			'0 stages'
		);

		// Drag Review out of Draft and into the new section. The drop point is
		// on the left of the band, clear of the floating inspector.
		await fitView( page );
		const from = await page
			.locator( '.wf-stage-node' )
			.filter( { hasText: 'Review' } )
			.boundingBox();
		const target = await band( page, 'publish' ).boundingBox();

		await page.mouse.move(
			from.x + from.width / 2,
			from.y + from.height / 2
		);
		await page.mouse.down();
		await page.mouse.move(
			target.x + Math.min( target.width / 4, 120 ),
			target.y + target.height / 2,
			{ steps: 16 }
		);

		// Still mid-drag: the section being aimed at is tinted, because letting
		// go here is a post-status change rather than a move.
		await expect(
			page.locator(
				'.wf-region-bands__section[data-region="publish"].is-drop-target'
			)
		).toBeVisible();

		await page.mouse.up();

		// The canvas has re-parented it.
		await expect( regionLabel( page, 'draft' ) ).toContainText( '1 stage' );
		await expect( regionLabel( page, 'publish' ) ).toContainText(
			'1 stage'
		);

		// Arriving in the section does not fill its checkpoint slot — that is a
		// second, deliberate drop onto the boundary. Do it, so the sequence can be
		// saved and the status change checked.
		await expect(
			band( page, 'publish' ).locator( '.wf-region__slot' )
		).toBeVisible();
		const publishedBand = await band( page, 'publish' ).boundingBox();
		const moved = await page
			.locator( '.wf-stage-node' )
			.filter( { hasText: 'Review' } )
			.boundingBox();
		await page.mouse.move(
			moved.x + moved.width / 2,
			moved.y + moved.height / 2
		);
		await page.mouse.down();
		await page.mouse.move(
			publishedBand.x + publishedBand.width / 2,
			publishedBand.y,
			{ steps: 16 }
		);
		await page.mouse.up();

		// And that is a real post-status change, not just a position.
		await page.getByRole( 'button', { name: 'Save' } ).click();
		// Saving stays on the editor, so the button's success state is what
		// says the write landed — the Sequences list is no longer where a save
		// ends up.
		await expect(
			page.getByRole( 'button', { name: 'Saved!' } )
		).toBeVisible();

		const saved = await requestUtils.rest( {
			path: `/vip-workflow/v1/sequences/${ sequenceId }`,
		} );
		const review = saved.config.statuses.find(
			( s ) => s.key === 'review'
		);
		expect( review.status ).toBe( 'publish' );
		// It is the only stage in that region, so it inherits its checkpoint.
		expect( review.region_entry ).toBe( true );
	} );

	test( 'the entry checkpoint is a stage docked on the region’s boundary, and dragging it off frees the slot', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const bp = await createTwoStageSequence( requestUtils );
		sequenceId = bp.id;

		await openEditor( admin, page, bp.name );
		await fitView( page );

		// The write gate seated the region's first stage as its entry, so Draft
		// is the stage sitting on the region's boundary — there is no separate
		// marker to read it off.
		const checkpoint = page.locator( '.wf-stage-node.is-checkpoint' );
		await expect( checkpoint ).toHaveCount( 1 );
		await expect( checkpoint ).toContainText( 'Draft' );

		const draftBand = await band( page, 'draft' ).boundingBox();
		const docked = await checkpoint.boundingBox();
		// Straddling the boundary rather than sitting below it.
		expect( docked.y ).toBeLessThan( draftBand.y );
		expect( docked.y + docked.height ).toBeGreaterThan( draftBand.y );

		// Drag it down into the body of its own section: same region, but the
		// checkpoint slot is vacated.
		await page.mouse.move(
			docked.x + docked.width / 2,
			docked.y + docked.height / 2
		);
		await page.mouse.down();
		await page.mouse.move(
			docked.x + docked.width / 2,
			draftBand.y + draftBand.height - 30,
			{ steps: 16 }
		);
		await page.mouse.up();

		await expect(
			page.locator( '.wf-stage-node.is-checkpoint' )
		).toHaveCount( 0 );
		// The empty slot is now showing, and Save is refused.
		await expect(
			band( page, 'draft' ).locator( '.wf-region__slot' )
		).toBeVisible();
		await page.getByRole( 'button', { name: 'Save' } ).click();
		await expect(
			page
				.locator( '.components-notice' )
				.filter( { hasText: /has no entry checkpoint/i } )
		).toBeVisible();
		// Still in the editor — nothing was written.
		await expect(
			page.getByRole( 'button', { name: 'Save' } )
		).toBeVisible();
	} );

	test( 'dragging a stage onto the region’s boundary makes it the entry checkpoint', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const bp = await createTwoStageSequence( requestUtils );
		sequenceId = bp.id;

		await openEditor( admin, page, bp.name );
		await fitView( page );

		// Review starts inside the section; Draft holds the checkpoint.
		await expect(
			page.locator( '.wf-stage-node.is-checkpoint' )
		).toContainText( 'Draft' );

		const slot = await band( page, 'draft' )
			.locator( '.wf-region__slot' )
			.boundingBox()
			.catch( () => null );
		// The slot is only rendered while empty or mid-drag, so aim at the
		// stage currently in it instead.
		const target =
			slot ||
			( await page
				.locator( '.wf-stage-node.is-checkpoint' )
				.boundingBox() );

		const review = await page
			.locator( '.wf-stage-node' )
			.filter( { hasText: 'Review' } )
			.boundingBox();

		await page.mouse.move(
			review.x + review.width / 2,
			review.y + review.height / 2
		);
		await page.mouse.down();
		await page.mouse.move(
			target.x + target.width / 2,
			target.y + target.height / 2,
			{ steps: 16 }
		);
		await page.mouse.up();

		// The checkpoint moved: Review is on the boundary, Draft is not.
		const checkpoint = page.locator( '.wf-stage-node.is-checkpoint' );
		await expect( checkpoint ).toHaveCount( 1 );
		await expect( checkpoint ).toContainText( 'Review' );

		await page.getByRole( 'button', { name: 'Save' } ).click();
		// Saving stays on the editor, so the button's success state is what
		// says the write landed — the Sequences list is no longer where a save
		// ends up.
		await expect(
			page.getByRole( 'button', { name: 'Saved!' } )
		).toBeVisible();

		const saved = await requestUtils.rest( {
			path: `/vip-workflow/v1/sequences/${ sequenceId }`,
		} );
		const byKey = Object.fromEntries(
			saved.config.statuses.map( ( s ) => [ s.key, s ] )
		);
		expect( byKey.review.region_entry ).toBe( true );
		expect( byKey.draft.region_entry ).toBeFalsy();
	} );

	test( 'an empty status section can be taken back off the canvas', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const bp = await createTwoStageSequence( requestUtils );
		sequenceId = bp.id;

		await openEditor( admin, page, bp.name );

		await page
			.locator( '.wf-canvas__viewport' )
			.click( { button: 'right', position: { x: 40, y: 40 } } );
		await page.getByRole( 'menuitem', { name: /Add post status/ } ).click();
		const dialog = page.getByRole( 'dialog', { name: 'Add post status' } );
		await dialog
			.getByRole( 'combobox', { name: 'Post status' } )
			.selectOption( { label: 'Pending Review' } );
		await dialog.getByRole( 'button', { name: 'Add status' } ).click();

		await expect( page.locator( '.wf-region' ) ).toHaveCount( 2 );

		// Adding selects the new region, so its options are already open.
		await page
			.getByRole( 'button', { name: 'Remove this status' } )
			.click();
		await expect( page.locator( '.wf-region' ) ).toHaveCount( 1 );
		await expect( band( page, 'draft' ) ).toBeVisible();
	} );

	test( 'a transition can be drawn into a status anywhere, not only at its checkpoint', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const bp = await createCheckpointSequence( requestUtils );
		sequenceId = bp.id;

		await openEditor( admin, page, bp.name );
		await fitView( page );

		const edges = page.locator( '.react-flow__edge' );
		const before = await edges.count();
		const grip = page
			.locator( '.wf-stage-node' )
			.filter( { hasText: 'Draft' } )
			.locator( '.wf-stage-node__handle--source' );

		// Onto Promote: in the publish region, past the stage core would land a
		// post on. The edge lands, and no stage is created — the drop was a
		// connection to an existing node, not a request for a new one.
		await dragConnection( page, grip, nodeNamed( page, 'Promote' ) );
		await expect( edges ).toHaveCount( before + 1 );
		await expect( page.locator( '.wf-stage-node' ) ).toHaveCount( 3 );

		// Onto Published, the same region's checkpoint: connects the same way,
		// so the checkpoint is not special to an edge.
		await dragConnection( page, grip, nodeNamed( page, 'Published' ) );
		await expect( edges ).toHaveCount( before + 2 );

		// And the sequence the canvas just drew is one the server stores as drawn
		// — the write gate no longer asks where a crossing lands either.
		await page.getByRole( 'button', { name: 'Save' } ).click();
		// Saving stays on the editor, so the button's success state is what
		// says the write landed — the Sequences list is no longer where a save
		// ends up.
		await expect(
			page.getByRole( 'button', { name: 'Saved!' } )
		).toBeVisible();

		const saved = await requestUtils.rest( {
			path: `/vip-workflow/v1/sequences/${ sequenceId }`,
		} );
		const draft = saved.config.statuses.find( ( s ) => s.key === 'draft' );

		expect( draft.transitions.map( ( tr ) => tr.to ) ).toEqual(
			expect.arrayContaining( [ 'promote', 'published' ] )
		);
	} );

	test( 'the status holding stages, and Draft, cannot be removed', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const bp = await createTwoStageSequence( requestUtils );
		sequenceId = bp.id;

		await openEditor( admin, page, bp.name );
		await fitView( page );

		await regionLabel( page, 'draft' ).click();
		await expect(
			page.getByRole( 'button', { name: 'Remove this status' } )
		).toBeDisabled();
	} );
} );
