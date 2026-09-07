/**
 * Sequence graph editor — canvas gestures.
 *
 * Covers the pointer interactions the unit tests can't reach: the graph model's
 * mutations are pure and tested in `tests/unit-js/graph-model.test.js`, but
 * whether a drag off a handle actually reaches them depends on React Flow's
 * connection handling, which only exists in a real browser.
 *
 * Selector note: `.wf-stage-node` is a canvas node,
 * `.wf-stage-node__handle--source` its outgoing (bottom) handle, and
 * `.wf-canvas__viewport` the pane the drop has to land on. Rewiring adds
 * `.wf-edge-anchors__anchor--source` / `--target`, the two grab rings drawn on
 * the selected edge's ends (`EdgeAnchors`) — they exist only while that edge is
 * selected, so every rewire test clicks the edge first.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );
const { deleteSequence } = require( './helpers/workflow' );

/**
 * Create a minimal two-stage sequence to drag from.
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').RequestUtils} requestUtils
 * @return {Promise<Object>} Created sequence record.
 */
async function createTwoStageSequence( requestUtils ) {
	return requestUtils.rest( {
		path: '/vip-workflows/v1/sequences',
		method: 'POST',
		data: {
			name: `E2E Canvas Gestures ${ Date.now() }`,
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
 * Create a three-stage sequence, so a transition has somewhere else to be
 * rewired to.
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').RequestUtils} requestUtils
 * @return {Promise<Object>} Created sequence record.
 */
async function createThreeStageSequence( requestUtils ) {
	return requestUtils.rest( {
		path: '/vip-workflows/v1/sequences',
		method: 'POST',
		data: {
			name: `E2E Canvas Rewire ${ Date.now() }`,
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
}

/**
 * Select an edge on the canvas, which is what puts its grab rings on screen.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string}                          id   Edge id (`from->to`).
 */
async function selectEdge( page, id ) {
	// By coordinate rather than `.click()`: the target is an SVG path with no
	// fill inside React Flow's transformed viewport group, and Playwright's
	// actionability check reports it outside the viewport even when it is
	// plainly on screen. Its box is measured correctly, so aim the mouse at the
	// middle of it — which is what a person clicking the line does anyway.
	const box = await page
		.locator( `.react-flow__edge[data-id="${ id }"]` )
		.locator( '.react-flow__edge-interaction' )
		.boundingBox();
	await page.mouse.click( box.x + box.width / 2, box.y + box.height / 2 );
	await expect(
		page.locator( '.wf-edge-anchors__anchor--target' )
	).toBeVisible();
}

/**
 * Drag one of the selected edge's grab rings to a point and let go.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string}                          end  `'source'` or `'target'`.
 * @param {{ x: number, y: number }}        to   Client coordinates.
 */
async function dragAnchor( page, end, to ) {
	const ring = await page
		.locator( `.wf-edge-anchors__anchor--${ end }` )
		.boundingBox();
	await page.mouse.move( ring.x + ring.width / 2, ring.y + ring.height / 2 );
	await page.mouse.down();
	// The session opens on the first move and hit-tests every one after it.
	await page.mouse.move( to.x, to.y, { steps: 12 } );
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
	await admin.visitAdminPage( 'admin.php', 'page=vip-workflows-sequences' );
	await page
		.locator( '.vip-workflows-summary-card' )
		.filter( { hasText: name } )
		.getByRole( 'button', { name: 'Edit' } )
		.click();
	await expect( page.getByRole( 'button', { name: 'Save' } ) ).toBeVisible();
}

test.describe( 'VIP Workflows — sequence canvas gestures', () => {
	let sequenceId;

	test.afterEach( async ( { requestUtils } ) => {
		if ( sequenceId ) {
			await deleteSequence( requestUtils, sequenceId );
			sequenceId = undefined;
		}
	} );

	test( 'drop a connection on empty canvas to create the stage it points at', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const bp = await createTwoStageSequence( requestUtils );
		sequenceId = bp.id;

		await openEditor( admin, page, bp.name );

		const nodes = page.locator( '.wf-stage-node' );
		await expect( nodes ).toHaveCount( 2 );

		// Grab Draft's outgoing handle and release over blank canvas, well clear
		// of the (centered, 200px wide) node column. The canvas runs full-bleed
		// under the floating inspector, so aim at the gap just left of that
		// panel — the far right of the canvas element is covered by it, and a
		// release there would land on the card instead of the graph.
		const handle = page
			.locator( '.wf-stage-node' )
			.filter( { hasText: 'Draft' } )
			.locator( '.wf-stage-node__handle--source' );
		const from = await handle.boundingBox();
		const inspector = await page
			.locator( '.wf-sequence-editor__inspector' )
			.boundingBox();
		// Below Draft as well as clear of the column, so the new stage has room
		// of its own rather than landing on the one it came from. Any point in
		// the group would do for the assertion below — a release is recorded
		// where it happened, in the header strip as readily as under it, and
		// the group grows in whichever direction it has to to hold it.
		const to = {
			x: inspector.x - 60,
			y: from.y + 140,
		};

		await page.mouse.move(
			from.x + from.width / 2,
			from.y + from.height / 2
		);
		await page.mouse.down();
		// Several steps: React Flow starts the connection on the first move and
		// tracks the pointer until release.
		await page.mouse.move( to.x, to.y, { steps: 12 } );
		await page.mouse.up();

		// A third stage exists, wired up and selected for naming.
		await expect( nodes ).toHaveCount( 3 );
		await expect(
			page.getByRole( 'textbox', { name: 'Label' } )
		).toHaveValue( 'Stage 3' );

		// And it sits where the connection was dropped, not in the slot dagre
		// would have given it (which is under the column, far to the left).
		const placed = await page
			.locator( '.wf-stage-node' )
			.filter( { hasText: 'Stage 3' } )
			.boundingBox();
		expect( Math.abs( placed.x + placed.width / 2 - to.x ) ).toBeLessThan(
			8
		);
		expect( Math.abs( placed.y + placed.height / 2 - to.y ) ).toBeLessThan(
			8
		);

		// It survives a save as a real transition out of Draft.
		await page.getByRole( 'button', { name: 'Save' } ).click();
		// Saving stays on the editor, so the button's success state is what
		// says the write landed — the Sequences list is no longer where a save
		// ends up.
		await expect(
			page.getByRole( 'button', { name: 'Saved!' } )
		).toBeVisible();

		const saved = await requestUtils.rest( {
			path: `/vip-workflows/v1/sequences/${ sequenceId }`,
		} );
		const draft = saved.config.statuses.find( ( s ) => s.key === 'draft' );
		const added = saved.config.statuses.find(
			( s ) => s.key !== 'draft' && s.key !== 'review'
		);
		expect( added ).toBeTruthy();
		expect( draft.transitions.map( ( t ) => t.to ) ).toContain( added.key );
	} );

	test( 'drop a connection anywhere on a stage to connect to it', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const bp = await createTwoStageSequence( requestUtils );
		sequenceId = bp.id;

		await openEditor( admin, page, bp.name );

		// Release over the middle of the Draft node — not on any handle. The
		// whole node is the drop target, so this connects Review back to Draft.
		const handle = page
			.locator( '.wf-stage-node' )
			.filter( { hasText: 'Review' } )
			.locator( '.wf-stage-node__handle--source' );
		const from = await handle.boundingBox();
		const draft = await page
			.locator( '.wf-stage-node' )
			.filter( { hasText: 'Draft' } )
			.boundingBox();

		await page.mouse.move(
			from.x + from.width / 2,
			from.y + from.height / 2
		);
		await page.mouse.down();
		await page.mouse.move(
			draft.x + draft.width / 2,
			draft.y + draft.height / 2,
			{ steps: 12 }
		);
		await page.mouse.up();

		// The new transition is selected, so the inspector names both ends.
		await expect( page.getByText( 'Review → Draft' ) ).toBeVisible();

		await page.getByRole( 'button', { name: 'Save' } ).click();
		// Saving stays on the editor, so the button's success state is what
		// says the write landed — the Sequences list is no longer where a save
		// ends up.
		await expect(
			page.getByRole( 'button', { name: 'Saved!' } )
		).toBeVisible();

		const saved = await requestUtils.rest( {
			path: `/vip-workflows/v1/sequences/${ sequenceId }`,
		} );
		const review = saved.config.statuses.find(
			( s ) => s.key === 'review'
		);
		expect( review.transitions.map( ( t ) => t.to ) ).toContain( 'draft' );
	} );

	test( 'a hand-placed node keeps its spot when the layout re-runs', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const bp = await createTwoStageSequence( requestUtils );
		sequenceId = bp.id;

		await openEditor( admin, page, bp.name );

		// Read positions in flow coordinates (the node's own transform), not
		// screen space: adding a stage re-centers the viewport, which would move
		// every node on screen without moving it in the graph.
		const wrapper = page
			.locator( '.react-flow__node' )
			.filter( { hasText: 'Review' } );
		const flowPosition = () =>
			wrapper.evaluate( ( el ) => {
				const match = el.style.transform.match(
					/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/
				);
				return {
					x: parseFloat( match[ 1 ] ),
					y: parseFloat( match[ 2 ] ),
				};
			} );

		const before = await flowPosition();
		const box = await wrapper.boundingBox();
		await page.mouse.move( box.x + box.width / 2, box.y + box.height / 2 );
		await page.mouse.down();
		await page.mouse.move(
			box.x + box.width / 2 + 200,
			box.y + box.height / 2 + 60,
			{ steps: 20 }
		);
		await page.mouse.up();

		// The node followed the pointer. React Flow reports a drag one pointer
		// event behind, so allow a few px either way rather than an exact hit.
		const dragged = await flowPosition();
		expect( dragged.x - before.x ).toBeGreaterThan( 180 );
		expect( dragged.y - before.y ).toBeGreaterThan( 45 );

		// Adding a stage re-runs dagre for everything else; the hand-placed node
		// must not be dragged back into the column.
		const draftHandle = page
			.locator( '.wf-stage-node' )
			.filter( { hasText: 'Draft' } )
			.locator( '.wf-stage-node__handle--source' );
		const grip = await draftHandle.boundingBox();
		await page.mouse.move(
			grip.x + grip.width / 2,
			grip.y + grip.height / 2
		);
		await page.mouse.down();
		await page.mouse.move( grip.x - 260, grip.y + 140, { steps: 12 } );
		await page.mouse.up();
		await expect( page.locator( '.wf-stage-node' ) ).toHaveCount( 3 );

		expect( await flowPosition() ).toEqual( dragged );

		// "Reset layout" hands placement back to dagre.
		await page.getByRole( 'button', { name: 'Reset layout' } ).click();
		await expect
			.poll( async () => ( await flowPosition() ).x )
			.not.toBe( dragged.x );
	} );

	test( 'rewire a transition by dragging its destination onto another stage', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const sequence = await createThreeStageSequence( requestUtils );
		sequenceId = sequence.id;

		await openEditor( admin, page, sequence.name );
		await expect( page.locator( '.wf-stage-node' ) ).toHaveCount( 3 );

		await selectEdge( page, 'draft->review' );
		await expect( page.getByText( 'Draft → Review' ) ).toBeVisible();

		// Anywhere on the Done card: the whole node is the landing, the same
		// target a dropped connection gets.
		const done = await page
			.locator( '.wf-stage-node' )
			.filter( { hasText: 'Done' } )
			.boundingBox();
		await dragAnchor( page, 'target', {
			x: done.x + done.width / 2,
			y: done.y + done.height / 2,
		} );

		// The endpoint moved: the edge is now Draft → Done, still selected, and
		// the one it replaced is gone rather than left behind alongside it.
		await expect( page.getByText( 'Draft → Done' ) ).toBeVisible();
		// Counted rather than `toBeVisible`: an edge that runs straight down is
		// a zero-width SVG box, which Playwright reads as hidden however plainly
		// it is drawn. Whether the edge exists is the question here anyway.
		await expect(
			page.locator( '.react-flow__edge[data-id="draft->done"]' )
		).toHaveCount( 1 );
		await expect(
			page.locator( '.react-flow__edge[data-id="draft->review"]' )
		).toHaveCount( 0 );

		await page.getByRole( 'button', { name: 'Save' } ).click();
		await expect(
			page.getByRole( 'button', { name: 'Saved!' } )
		).toBeVisible();

		const saved = await requestUtils.rest( {
			path: `/vip-workflows/v1/sequences/${ sequenceId }`,
		} );
		const draft = saved.config.statuses.find( ( s ) => s.key === 'draft' );
		expect( draft.transitions.map( ( t ) => t.to ) ).toEqual( [ 'done' ] );
		// The move carried the transition's label with it rather than arriving
		// on a bare edge.
		expect( draft.transitions[ 0 ].label ).toBe( 'Send to review' );
	} );

	test( "release a transition's destination on empty canvas to create the stage it lands on", async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const sequence = await createThreeStageSequence( requestUtils );
		sequenceId = sequence.id;

		await openEditor( admin, page, sequence.name );

		await selectEdge( page, 'draft->review' );

		// Clear of the node column and of the floating inspector, for the
		// reasons the dropped-connection test above spells out.
		const anchorBox = await page
			.locator( '.wf-edge-anchors__anchor--target' )
			.boundingBox();
		const inspector = await page
			.locator( '.wf-sequence-editor__inspector' )
			.boundingBox();
		await dragAnchor( page, 'target', {
			x: inspector.x - 60,
			y: anchorBox.y + 140,
		} );

		// A fourth stage exists and the endpoint landed on it, selected for
		// naming — the release that grew it is not undone by the click the
		// browser synthesizes on the pane behind it.
		await expect( page.locator( '.wf-stage-node' ) ).toHaveCount( 4 );
		await expect(
			page.getByRole( 'textbox', { name: 'Label' } )
		).toHaveValue( 'Stage 4' );

		await page.getByRole( 'button', { name: 'Save' } ).click();
		await expect(
			page.getByRole( 'button', { name: 'Saved!' } )
		).toBeVisible();

		const saved = await requestUtils.rest( {
			path: `/vip-workflows/v1/sequences/${ sequenceId }`,
		} );
		const draft = saved.config.statuses.find( ( s ) => s.key === 'draft' );
		const added = saved.config.statuses.find(
			( s ) => ! [ 'draft', 'review', 'done' ].includes( s.key )
		);
		expect( added ).toBeTruthy();
		expect( draft.transitions.map( ( t ) => t.to ) ).toEqual( [
			added.key,
		] );
	} );

	test( 'a source endpoint dropped on Start is refused, changing nothing', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const sequence = await createThreeStageSequence( requestUtils );
		sequenceId = sequence.id;

		await openEditor( admin, page, sequence.name );

		await selectEdge( page, 'draft->review' );

		// Start has no transition to hand over, so this would leave the dragged
		// edge where it is while the flow entry moved out from under it. The
		// model refuses it, and the ring says so while it is still held.
		const start = await page
			.locator( '.wf-terminal-node--start' )
			.boundingBox();
		const target = {
			x: start.x + start.width / 2,
			y: start.y + start.height / 2,
		};

		const ring = await page
			.locator( '.wf-edge-anchors__anchor--source' )
			.boundingBox();
		await page.mouse.move(
			ring.x + ring.width / 2,
			ring.y + ring.height / 2
		);
		await page.mouse.down();
		await page.mouse.move( target.x, target.y, { steps: 12 } );
		// Held over Start, the lead line reads as refused rather than droppable.
		await expect(
			page.locator( '.wf-edge-anchors .is-invalid' )
		).toHaveCount( 1 );
		await page.mouse.up();

		// Nothing moved: the transition is where it was, and so is the entry.
		// (Counted, for the zero-width reason the rewire test above gives.)
		await expect( page.getByText( 'Draft → Review' ) ).toBeVisible();
		await expect(
			page.locator( '.react-flow__edge[data-id="draft->review"]' )
		).toHaveCount( 1 );
		await expect(
			page.locator( '.react-flow__edge[data-id="__wf_start__->draft"]' )
		).toHaveCount( 1 );

		const saved = await requestUtils.rest( {
			path: `/vip-workflows/v1/sequences/${ sequenceId }`,
		} );
		expect( saved.config.statuses[ 0 ].key ).toBe( 'draft' );
		const draft = saved.config.statuses.find( ( s ) => s.key === 'draft' );
		expect( draft.transitions.map( ( t ) => t.to ) ).toEqual( [
			'review',
		] );
	} );

	test( 'dropping on a node that rejects the connection creates nothing', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const bp = await createTwoStageSequence( requestUtils );
		sequenceId = bp.id;

		await openEditor( admin, page, bp.name );

		const nodes = page.locator( '.wf-stage-node' );
		await expect( nodes ).toHaveCount( 2 );

		// Nothing connects *into* Start (isValidConnection), and Start renders
		// inside the pane — so this drop must be read as a cancelled connection,
		// not as empty canvas.
		const handle = page
			.locator( '.wf-stage-node' )
			.filter( { hasText: 'Draft' } )
			.locator( '.wf-stage-node__handle--source' );
		const from = await handle.boundingBox();
		const start = await page
			.locator( '.wf-terminal-node--start' )
			.boundingBox();

		await page.mouse.move(
			from.x + from.width / 2,
			from.y + from.height / 2
		);
		await page.mouse.down();
		await page.mouse.move(
			start.x + start.width / 2,
			start.y + start.height / 2,
			{ steps: 12 }
		);
		await page.mouse.up();

		await expect( nodes ).toHaveCount( 2 );
	} );
} );
