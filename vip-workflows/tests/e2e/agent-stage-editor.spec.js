/**
 * Sequence graph editor — AI stage configuration (agent stages).
 *
 * Covers the stage inspector UI for AI stages in the node/edge graph editor
 * (the form-based editor this once drove has been removed): selecting a stage
 * node, picking an agent, routing the agent's three outcomes by dragging from
 * the node's colored handles, saving, and confirming the config persists (REST)
 * and re-hydrates (reload + re-select the node).
 *
 * The gesture is the point of this spec. There is no AI toggle and no routing
 * dropdowns: choosing an agent in the inspector is what makes a stage AI-owned,
 * and where each outcome leads is set on the canvas — drag from the node's pass,
 * fail, or error handle onto the destination stage.
 *
 * Selector note: the graph editor exposes stable hooks — `.wf-stage-node` for a
 * canvas node, `.wf-stage-node__handle--{outcome}` for its outcome handles,
 * `.wf-stage-inspector__route.is-{outcome}` for the inspector's read-out of
 * where that outcome leads, and `.vip-workflows-summary-card` for a list card.
 * The agent picker is a labeled combobox sitting in the open beside Label and
 * Color on every stage — see `selectAgent`.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );
const { deleteSequence } = require( './helpers/workflow' );

/**
 * Create a sequence with a middle stage that has transitions but no agent yet.
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').RequestUtils} requestUtils
 * @return {Promise<Object>} Created sequence record.
 */
async function createAgentlessSequence( requestUtils ) {
	return requestUtils.rest( {
		path: '/vip-workflows/v1/sequences',
		method: 'POST',
		data: {
			name: `E2E AI Stage Editor ${ Date.now() }`,
			type: 'workflow',
			status: 'active',
			post_types: [ 'post' ],
			statuses: [
				{
					key: 'draft',
					label: 'Draft',
					transitions: [ { to: 'copy_desk', label: 'Send to desk' } ],
				},
				{
					key: 'copy_desk',
					label: 'Copy Desk',
					transitions: [
						{ to: 'review', label: 'Advance to Review' },
						{ to: 'draft', label: 'Bump back to Draft' },
					],
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
	// The editor's landmark action confirms it has mounted.
	await expect( page.getByRole( 'button', { name: 'Save' } ) ).toBeVisible();
}

/**
 * A stage node on the canvas, by its label.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string}                          label Stage label.
 * @return {import('@playwright/test').Locator} The node.
 */
function stageNode( page, label ) {
	return page.locator( '.wf-stage-node' ).filter( { hasText: label } );
}

/**
 * Route one of an AI stage's outcomes by dragging its handle onto a stage.
 *
 * Driven with the raw mouse rather than `dragTo`: React Flow starts a connection
 * on pointerdown and tracks the pointer to decide the drop target, so the drag
 * needs intermediate moves. Geometry is read fresh each time — routing an
 * outcome changes the graph, and the layout re-runs.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string}                          from    Source stage label.
 * @param {string}                          outcome `pass` / `fail` / `error`.
 * @param {string}                          to      Destination stage label.
 */
async function routeOutcome( page, from, outcome, to ) {
	const handle = stageNode( page, from ).locator(
		`.wf-stage-node__handle--${ outcome }`
	);
	await expect( handle ).toBeVisible();
	const source = await handle.boundingBox();
	const target = await stageNode( page, to ).boundingBox();

	await page.mouse.move(
		source.x + source.width / 2,
		source.y + source.height / 2
	);
	await page.mouse.down();
	await page.mouse.move(
		target.x + target.width / 2,
		target.y + target.height / 2,
		{ steps: 12 }
	);
	await page.mouse.up();
}

/**
 * Pick an agent in the stage inspector.
 *
 * The picker is a combobox, so the gesture is type-then-choose rather than
 * select-by-value. Matched loosely: an agent whose credentials are not wired on
 * this site is still offered, with " — setup needed" appended to its name, and
 * the spec does not care which of the two it got.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string}                          name Agent label, e.g. `Copy Edit`.
 */
async function selectAgent( page, name ) {
	const combobox = page.getByRole( 'combobox', { name: 'Agent' } );
	await combobox.click();
	await combobox.fill( name );
	await page.getByRole( 'option', { name, exact: false } ).click();
}

/**
 * The inspector's read-out of where one outcome leads.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string}                          outcome `pass` / `fail` / `error`.
 * @return {import('@playwright/test').Locator} The route row.
 */
function routeRow( page, outcome ) {
	return page.locator( `.wf-stage-inspector__route.is-${ outcome }` );
}

test.describe( 'VIP Workflows — graph editor AI stage config', () => {
	let sequenceId;

	test.afterEach( async ( { requestUtils } ) => {
		if ( sequenceId ) {
			await deleteSequence( requestUtils, sequenceId );
			sequenceId = undefined;
		}
	} );

	test( 'pick an agent, drag each outcome to a stage, save — config persists and re-hydrates', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const bp = await createAgentlessSequence( requestUtils );
		sequenceId = bp.id;

		await openEditor( admin, page, bp.name );

		// Select the Copy Desk stage node; its inspector opens in the dock.
		await stageNode( page, 'Copy Desk' ).click();

		// Picking the plugin-provided Copy Edit agent is what makes the stage
		// AI-owned — there is no toggle in front of it. Copy Edit is used here
		// (rather than, say, Fact Check) because it is one of the two stage
		// agents that still ship in core; the choice of agent is otherwise
		// incidental to this test, which only needs one with all three
		// pass/fail/error outcomes.
		await expect(
			page.getByRole( 'checkbox', { name: 'Run an agent on entry' } )
		).toHaveCount( 0 );
		await selectAgent( page, 'Copy Edit' );

		// The node becomes an AI stage: purple, and carrying three outcome
		// handles in place of its single drag-out grip.
		const node = stageNode( page, 'Copy Desk' );
		await expect( node ).toHaveClass( /is-agent/ );
		await expect(
			node.locator( '.wf-stage-node__handle--outcome' )
		).toHaveCount( 3 );

		// Its two existing transitions are disabled, not deleted: the agent owns
		// the way out now, so nobody else can take them. The node stops counting
		// them as ways out (its meta line empties, the same as a stage with no
		// transitions at all) and warns that nothing is routed.
		await expect(
			page.locator( '.react-flow__edge.is-disabled' )
		).toHaveCount( 2 );
		await expect( node.locator( '.wf-stage-node__meta' ) ).toHaveCount( 0 );
		await expect(
			node.locator( '.wf-stage-node__flag--warning' )
		).toBeVisible();

		// Route each outcome by dragging from its handle. Two of them share a
		// destination, which the model has to keep as two distinct routes.
		await routeOutcome( page, 'Copy Desk', 'pass', 'Review' );
		await routeOutcome( page, 'Copy Desk', 'fail', 'Draft' );
		await routeOutcome( page, 'Copy Desk', 'error', 'Review' );

		// Routing along the disabled transitions brought them back — the same
		// two edges, live again rather than replaced.
		await expect(
			page.locator( '.react-flow__edge.is-disabled' )
		).toHaveCount( 0 );

		// Re-select the stage (each drag selects the edge it made) and confirm
		// the inspector reads the routes back.
		await stageNode( page, 'Copy Desk' ).click();
		await expect( routeRow( page, 'pass' ) ).toContainText( 'Review' );
		await expect( routeRow( page, 'fail' ) ).toContainText( 'Draft' );
		await expect( routeRow( page, 'error' ) ).toContainText( 'Review' );

		await page.getByRole( 'button', { name: 'Save' } ).click();

		// Persisted: the agent config survives the save round-trip.
		await expect
			.poll( async () => {
				const saved = await requestUtils.rest( {
					path: `/vip-workflows/v1/sequences/${ sequenceId }`,
				} );
				return saved.config?.statuses?.find(
					( s ) => s.key === 'copy_desk'
				)?.agent?.ability_id;
			} )
			.toBe( 'workflow-agent-copy-edit/copy-edit' );

		const updated = await requestUtils.rest( {
			path: `/vip-workflows/v1/sequences/${ sequenceId }`,
		} );
		const agent = updated.config.statuses.find(
			( s ) => s.key === 'copy_desk'
		).agent;
		expect( agent.routing.pass ).toBe( 'review' );
		expect( agent.routing.fail ).toBe( 'draft' );
		expect( agent.routing.error ).toBe( 'review' );
		// Disabling never deleted anything: the stage still holds exactly the
		// two transitions it was created with, labels and all.
		const copyDesk = updated.config.statuses.find(
			( s ) => s.key === 'copy_desk'
		);
		expect( copyDesk.transitions.map( ( t ) => t.label ) ).toEqual( [
			'Advance to Review',
			'Bump back to Draft',
		] );
		// Stage agents make a binary editorial judgment: warning is never
		// authored or persisted.
		expect( agent.routing.warning ).toBeUndefined();

		// Re-open the editor (saving returns to the sequences list) and re-select
		// the node: the saved config re-hydrates into the canvas and inspector.
		await openEditor( admin, page, bp.name );
		await expect( stageNode( page, 'Copy Desk' ) ).toHaveClass(
			/is-agent/
		);
		await stageNode( page, 'Copy Desk' ).click();

		// A stage that already has an agent opens its AI section on render, so
		// the picker is reachable without expanding anything.
		// The combobox holds the agent's name, not its ability id — the id is
		// asserted above, straight off the REST record.
		await expect(
			page.getByRole( 'combobox', { name: 'Agent' } )
		).toHaveValue( /^Copy Edit/ );
		await expect( routeRow( page, 'pass' ) ).toContainText( 'Review' );
		await expect( routeRow( page, 'fail' ) ).toContainText( 'Draft' );
		await expect( routeRow( page, 'error' ) ).toContainText( 'Review' );
		// Every routed handle is drawn filled rather than hollow.
		await expect(
			stageNode( page, 'Copy Desk' ).locator(
				'.wf-stage-node__handle--outcome.is-routed'
			)
		).toHaveCount( 3 );
	} );
} );
