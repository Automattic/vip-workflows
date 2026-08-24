/**
 * Stage agents.
 *
 * A workflow stage may declare an `agent`: when a post enters that stage the
 * agent runs, and its outcome routes the exit transition. This suite proves the
 * user-facing surface of that feature end-to-end:
 *
 *   1. Dispatch    — entering an AI stage queues the agent and marks the post
 *                    "pending" (surfaced synchronously in the transition
 *                    response, before any cron fires).
 *   2. Working state — while the agent is pending, the editor shows the
 *                    "AI working" indicator and offers none of the stage's
 *                    transitions: the agent owns the way out. Withholding is an
 *                    offer-layer decision only — nothing refuses the move, and
 *                    transition() still confirms for a caller who means it.
 *   3. Fail-in-place — the tests environment blocks external HTTP, so the
 *                    agent's AI call always fails. The suite's sequence routes
 *                    no `error` destination (the error path is opt-in), so the
 *                    post stays in the AI stage and the editor surfaces the
 *                    error + a "Go back to Draft" action wired to the
 *                    agent-revert endpoint — the stage's own transitions stay
 *                    withheld.
 *   4. Go back     — reverting a failed agent returns the post to the stage it
 *                    entered from; re-entering the AI stage is how a run is
 *                    retried.
 *   5. Error route — a stage that DOES route `error` sends the errored run
 *                    along it instead of failing in place.
 *
 * The AI success path (a real completion routing pass → review) needs a stubbed
 * provider and is out of scope here; wp-env has no AI credentials and blocks
 * egress, which is exactly what makes the failure path deterministic.
 *
 * Arrange over REST; act/assert over both REST and the editor UI.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );
const {
	createDraftPost,
	assignSequence,
	getWorkflowStatus,
	transition,
	deletePost,
	deleteSequence,
	createAiStageSequence,
	waitForAgentStatus,
	revertAgent,
	runDueCron,
	getPostContent,
	openWorkflowPanel,
} = require( './helpers/workflow' );

test.describe( 'VIP Workflow — stage agents', () => {
	let sequenceId;
	let postId;

	test.beforeAll( async ( { requestUtils } ) => {
		const sequence = await createAiStageSequence( requestUtils );
		sequenceId = sequence.id;
	} );

	test.afterAll( async ( { requestUtils } ) => {
		if ( sequenceId ) {
			await deleteSequence( requestUtils, sequenceId );
			sequenceId = undefined;
		}
	} );

	test.afterEach( async ( { requestUtils } ) => {
		if ( postId ) {
			await deletePost( requestUtils, postId );
			postId = undefined;
		}
	} );

	/**
	 * Enrol a fresh draft post in the AI-stage sequence and move it into the AI
	 * stage. Returns the transition response, which already reflects the queued
	 * agent (JOB_META is set during the transition, before the response is built).
	 *
	 * @param {import('@wordpress/e2e-test-utils-playwright').RequestUtils} requestUtils
	 * @param {string}                                                      title
	 * @return {Promise<Object>} The transition response payload.
	 */
	async function enterAiStage( requestUtils, title ) {
		const post = await createDraftPost( requestUtils, {
			title,
			// Give the agent something to read; read_post() bails on empty content.
			content: 'Some draft copy for the agent to reformat.',
		} );
		postId = post.id;
		await assignSequence( requestUtils, postId, sequenceId, 'draft' );
		return transition( requestUtils, postId, 'ai_copy_desk' );
	}

	test( 'entering an AI stage dispatches the agent and marks the post pending', async ( {
		requestUtils,
	} ) => {
		const afterTransition = await enterAiStage(
			requestUtils,
			'Agent dispatch e2e'
		);

		// The transition response is built after the dispatch hook ran, so it
		// already reports the queued agent — no cron, no race.
		expect( afterTransition.current.key ).toBe( 'ai_copy_desk' );
		expect( afterTransition.agent_pending ).toBe( true );
		expect( afterTransition.agent_job ).toMatchObject( {
			status: 'pending',
		} );
	} );

	test( 'while an agent runs, the editor shows an "AI working" state in place of the stage actions', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const afterTransition = await enterAiStage(
			requestUtils,
			'Agent gate e2e'
		);
		expect( afterTransition.agent_pending ).toBe( true );

		// The tests env disables auto-cron, so the job stays pending until a spec
		// drives it — the "working" state is stable to assert against.
		await admin.editPost( postId );

		const panel = await openWorkflowPanel( page );

		// The rail's stage mark is a spinner while the agent works…
		await expect(
			panel.locator( '.vip-workflow-rail__spinner' )
		).toBeVisible();

		// …and the stage's transitions are withheld while the run is in flight:
		// the agent owns the way out, so get_available_transitions() returns
		// nothing (StatusManager::agent_owns_stage_exits) and the rail draws
		// the sequence's routed outcomes in their place — labelled, but never
		// clickable. Not offering an edge is not refusing it — transition()
		// still confirms for a caller who means it. If the run fails, the
		// exits STAY withheld: the failed state's one action is the panel's
		// "Go back" button.
		await expect(
			panel.locator(
				'.vip-workflow-rail__actions button:not([aria-disabled="true"])'
			)
		).toHaveCount( 0 );

		// It's genuinely still parked in the AI stage.
		const status = await getWorkflowStatus( requestUtils, postId );
		expect( status.current.key ).toBe( 'ai_copy_desk' );
		expect( status.agent_pending ).toBe( true );
	} );

	test( 'a failed agent surfaces the error and a Go back action in the editor', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		await enterAiStage( requestUtils, 'Agent fail-in-place e2e' );

		// Drive the queued agent to completion. External HTTP is blocked, so
		// the AI call fails; the suite's sequence routes no `error`
		// destination, so the agent fails in place — the deterministic outcome.
		const failed = await waitForAgentStatus(
			requestUtils,
			postId,
			'failed'
		);
		expect( failed.current.key ).toBe( 'ai_copy_desk' );
		expect( failed.agent_pending ).toBe( false );
		expect( failed.agent_job.error ).toBeTruthy();
		// The server names the go-back destination the panel will offer.
		expect( failed.agent_job.revert_to ).toMatchObject( { key: 'draft' } );
		// The stage's own transitions stay the agent's: the failed state's one
		// human exit is the go-back, so nothing is offered here.
		expect( failed.transitions ).toEqual( [] );

		await admin.editPost( postId );

		const panel = await openWorkflowPanel( page );

		// The failure is surfaced with its message.
		const failedBlock = panel.locator(
			'.vip-workflow-panel__agent-failed'
		);
		await expect( failedBlock ).toBeVisible();
		await expect(
			panel.locator( '.vip-workflow-panel__agent-failed-error' )
		).not.toBeEmpty();

		// The "AI working" spinner is gone (job is no longer pending).
		await expect(
			panel.locator( '.vip-workflow-rail__spinner' )
		).toHaveCount( 0 );

		// The rail keeps drawing the routed outcomes, still disabled — no
		// clickable transition exists anywhere in the failed state.
		await expect(
			panel.locator(
				'.vip-workflow-rail__actions button:not([aria-disabled="true"])'
			)
		).toHaveCount( 0 );

		// The Go back control is wired to the agent-revert endpoint and names
		// the origin stage. Prove the button fires it and the post moves back.
		const revertButton = failedBlock.getByRole( 'button', {
			name: 'Go back to Draft',
		} );
		await expect( revertButton ).toBeEnabled();

		const revertResponse = page.waitForResponse(
			( response ) =>
				response.url().includes( `/post/${ postId }/agent-revert` ) &&
				response.request().method() === 'POST'
		);
		await revertButton.click();
		expect( ( await revertResponse ).ok() ).toBe( true );

		const status = await getWorkflowStatus( requestUtils, postId );
		expect( status.current.key ).toBe( 'draft' );
	} );

	test( 'transitioning into an AI stage from the editor flushes unsaved edits first', async ( {
		admin,
		editor,
		page,
		requestUtils,
	} ) => {
		// A fresh draft with known saved content, so we can tell the unsaved edit
		// apart from what is already in the database.
		const post = await createDraftPost( requestUtils, {
			title: 'Agent save-before-transition e2e',
			content: 'Initial saved copy.',
		} );
		postId = post.id;
		await assignSequence( requestUtils, postId, sequenceId, 'draft' );

		await admin.editPost( postId );

		// Edit in the editor WITHOUT saving: the post is now dirty and the new
		// text lives only in the browser, not the database.
		const marker = `Unsaved edit ${ Date.now() }`;
		await editor.insertBlock( {
			name: 'core/paragraph',
			attributes: { content: marker },
		} );

		// Precondition: the database still holds only the original content.
		expect( await getPostContent( requestUtils, postId ) ).not.toContain(
			marker
		);

		// Open the Workflow sidebar and send the post to the AI stage. Its own
		// sidebar, so inserting a block (which flips the document sidebar to the
		// Block inspector) cannot hide it.
		const panel = await openWorkflowPanel( page );

		const transitionResponse = page.waitForResponse(
			( response ) =>
				response.url().includes( `/post/${ postId }/transition` ) &&
				response.request().method() === 'POST'
		);
		await panel
			.getByRole( 'button', { name: 'Send to AI Copy Desk' } )
			.click();
		expect( ( await transitionResponse ).ok() ).toBe( true );

		// The unsaved edit was flushed to the database before the agent was
		// queued, so the agent reads the author's actual content — not the stale
		// (here, pre-edit) row. This is the save-before-transition guarantee.
		expect( await getPostContent( requestUtils, postId ) ).toContain(
			marker
		);

		// And the post is genuinely in the AI stage with the agent queued.
		const status = await getWorkflowStatus( requestUtils, postId );
		expect( status.current.key ).toBe( 'ai_copy_desk' );
		expect( status.agent_pending ).toBe( true );
	} );

	test( 'reverting a failed agent returns the post to its origin, and re-entering retries the run', async ( {
		requestUtils,
	} ) => {
		await enterAiStage( requestUtils, 'Agent revert e2e' );
		await waitForAgentStatus( requestUtils, postId, 'failed' );

		// The revert endpoint returns the refreshed status with the post back
		// at the stage it entered the AI stage from, its failed marker cleared.
		const afterRevert = await revertAgent( requestUtils, postId );
		expect( afterRevert.current.key ).toBe( 'draft' );
		expect( afterRevert.agent_pending ).toBe( false );
		expect( afterRevert.agent_job ).toBeNull();

		// Going forward again IS the retry: entry re-dispatches the agent.
		const reEntered = await transition(
			requestUtils,
			postId,
			'ai_copy_desk'
		);
		expect( reEntered.current.key ).toBe( 'ai_copy_desk' );
		expect( reEntered.agent_pending ).toBe( true );
		expect( reEntered.agent_job ).toMatchObject( { status: 'pending' } );
	} );

	test( 'an errored run follows the on-error route when the stage configures one', async ( {
		requestUtils,
	} ) => {
		// A second sequence, identical but for an explicit `error` destination.
		const routed = await createAiStageSequence( requestUtils, 'err', {
			routing: { pass: 'review', fail: 'draft', error: 'review' },
		} );

		try {
			const post = await createDraftPost( requestUtils, {
				title: 'Agent error-route e2e',
				content: 'Some draft copy for the agent to reformat.',
			} );
			postId = post.id;
			await assignSequence( requestUtils, postId, routed.id, 'draft' );
			await transition( requestUtils, postId, 'ai_copy_desk' );

			// The blocked AI call errors, and the error routes instead of
			// failing in place: drive cron until the post lands on `review`.
			let status;
			for ( let i = 0; i < 30; i++ ) {
				await runDueCron( requestUtils );
				status = await getWorkflowStatus( requestUtils, postId );
				if ( status.current.key === 'review' ) {
					break;
				}
				await new Promise( ( resolve ) => setTimeout( resolve, 500 ) );
			}

			expect( status.current.key ).toBe( 'review' );
			expect( status.agent_job ).toBeNull();
			expect( status.agent_last_run ).toMatchObject( {
				stage_key: 'ai_copy_desk',
				outcome: 'error',
				to: 'review',
			} );
		} finally {
			await deleteSequence( requestUtils, routed.id );
		}
	} );

	/*
	 * The stage agent rewrites the post in the database, but an open editor still
	 * shows the pre-agent content. These two cases cover how the panel reconciles
	 * that when the agent finishes.
	 *
	 * The AI *success* path can't run here (the tests env blocks the provider's
	 * egress), so a successful completion is simulated the only way the panel can
	 * tell them apart anyway: an admin advances the post out of the AI stage,
	 * which clears `agent_pending` exactly as a finished run would. The panel
	 * reacts purely to that pending → finished edge.
	 *
	 * That advance is itself an agent interruption, so it acknowledges the
	 * warning transition() raises for one — see the call sites below.
	 */

	test( 'a finished stage agent auto-reloads a clean editor to reveal its changes', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const after = await enterAiStage(
			requestUtils,
			'Agent refresh (clean) e2e'
		);
		expect( after.agent_pending ).toBe( true );

		await admin.editPost( postId );

		const panel = await openWorkflowPanel( page );
		await expect(
			panel.locator( '.vip-workflow-rail__spinner' )
		).toBeVisible();

		// A marker any full page reload wipes.
		await page.evaluate( () => {
			window.__vipwfReloadMarker = true;
		} );

		// Simulate a successful agent completion (see the block comment above).
		//
		// acknowledgeWarnings, because moving a post out of a stage whose agent
		// is mid-run IS the interruption transition() now warns about: without
		// it the call answers `warnings_pending` and the post does not move, so
		// there is no pending → finished edge for the panel to react to. The
		// warning is the product behaviour under test elsewhere; here it is
		// simply acknowledged, exactly as a human would in the confirm.
		const reloaded = page.waitForEvent( 'load', { timeout: 20000 } );
		await transition( requestUtils, postId, 'review', {
			acknowledgeWarnings: true,
		} );

		// The panel polls, sees the agent finished with a clean editor, reloads.
		await reloaded;
		expect(
			await page.evaluate( () => window.__vipwfReloadMarker )
		).toBeUndefined();

		const status = await getWorkflowStatus( requestUtils, postId );
		expect( status.current.key ).toBe( 'review' );
	} );

	test( 'a finished stage agent offers a reload instead of discarding unsaved edits', async ( {
		admin,
		editor,
		page,
		requestUtils,
	} ) => {
		const after = await enterAiStage(
			requestUtils,
			'Agent refresh (dirty) e2e'
		);
		expect( after.agent_pending ).toBe( true );

		await admin.editPost( postId );

		// An unsaved edit the reload must not silently throw away.
		await editor.insertBlock( {
			name: 'core/paragraph',
			attributes: { content: 'Unsaved reviewer note' },
		} );

		const panel = await openWorkflowPanel( page );
		await expect(
			panel.locator( '.vip-workflow-rail__spinner' )
		).toBeVisible();

		await page.evaluate( () => {
			window.__vipwfReloadMarker = true;
		} );

		// acknowledgeWarnings for the same reason as the clean-editor case above:
		// this transition interrupts a running agent, which the server now asks
		// about rather than performing silently.
		await transition( requestUtils, postId, 'review', {
			acknowledgeWarnings: true,
		} );

		// With unsaved edits the panel must NOT auto-reload; it surfaces a reload
		// prompt instead.
		const refresh = panel.locator( '.vip-workflow-panel__agent-refresh' );
		await expect( refresh ).toBeVisible( { timeout: 15000 } );
		await expect(
			refresh.getByRole( 'button', { name: 'Reload' } )
		).toBeVisible();

		// No reload happened, and the "AI working" state has cleared.
		expect( await page.evaluate( () => window.__vipwfReloadMarker ) ).toBe(
			true
		);
		await expect(
			panel.locator( '.vip-workflow-rail__spinner' )
		).toHaveCount( 0 );
	} );
} );
