/**
 * Shared e2e helpers for VIP Workflow.
 *
 * These wrap the plugin's REST API (called with the admin session via
 * `requestUtils`) so specs can seed preconditions — a post enrolled in a
 * workflow at a known stage — without driving the UI for setup. Drive the UI
 * for the behaviour under test; use these to arrange and assert.
 *
 * The seeded "Editorial Review" sequence (slug `editorial-review`, post type
 * `post`) is the default fixture: stages draft → review → ready → publish.
 */

const EDITORIAL_REVIEW_SLUG = 'editorial-review';
const WF = '/vip-workflow/v1/workflow';

/**
 * The workflow sidebar's own root — the `<Stack className="vip-workflow-sidebar">`
 * that `src/editor/index.js` renders inside its `PluginSidebar`. Anchoring on
 * our own markup rather than on core's complementary-area chrome, whose class
 * names and ARIA labels are core's to change.
 */
const WORKFLOW_SIDEBAR = '.vip-workflow-sidebar';

/**
 * Open the Workflow plugin sidebar and return its root locator.
 *
 * Everything the plugin puts in the editor now lives here: the stage, its
 * progress, the transitions, Tools and Editorial Metadata. It replaces the two
 * `PluginDocumentSettingPanel`s ("Workflow Stage", "Editorial Metadata") specs
 * used to expand in the document settings sidebar, so
 * `editor.openDocumentSettingsSidebar()` no longer reaches any of it.
 *
 * Opening an unpinned plugin sidebar reliably has been the open problem in this
 * suite (see docs/TESTING.md); solving it once here is the point of this helper.
 * Two routes, in order:
 *
 *  1. The pinned header button. `PluginSidebar` is pinnable and pinned by
 *     default, so its icon sits in the editor header with the sidebar's title
 *     as its accessible name. This is the fast path and the one a user takes.
 *  2. The Options (⋮) menu. `PluginSidebarMoreMenuItem` puts the sidebar in
 *     that menu unconditionally, so it works even if a preference has unpinned
 *     the icon. Both routes *toggle*, which is why an already-open sidebar
 *     returns before either is used — clicking would close it.
 *
 * @param {import('@playwright/test').Page} page
 * @return {Promise<import('@playwright/test').Locator>} The sidebar root.
 */
async function openWorkflowSidebar( page ) {
	const sidebar = page.locator( WORKFLOW_SIDEBAR );

	if ( ! ( await sidebar.isVisible() ) ) {
		const pinned = page
			.getByRole( 'region', { name: 'Editor top bar' } )
			.getByRole( 'button', { name: 'Workflow', exact: true } );

		if ( await pinned.count() ) {
			await pinned.first().click();
		} else {
			await page.getByRole( 'button', { name: 'Options' } ).click();
			// The item carries its checked state, so core renders it as a
			// `menuitemcheckbox`; matched as either so a core change to the
			// menu primitive does not silently take the fallback away.
			await page
				.getByRole( 'menuitemcheckbox', {
					name: 'Workflow',
					exact: true,
				} )
				.or(
					page.getByRole( 'menuitem', {
						name: 'Workflow',
						exact: true,
					} )
				)
				.first()
				.click();
		}
	}

	await sidebar.waitFor( { state: 'visible' } );
	return sidebar;
}

/**
 * The workflow panel inside the sidebar — the stage, its progress, the
 * transitions and the actions on the workflow itself.
 *
 * @param {import('@playwright/test').Page} page
 * @return {Promise<import('@playwright/test').Locator>} The panel root.
 */
async function openWorkflowPanel( page ) {
	const sidebar = await openWorkflowSidebar( page );
	const panel = sidebar.locator( '.vip-workflow-panel' );
	await panel.waitFor( { state: 'visible' } );
	return panel;
}

/**
 * Fetch the seeded Editorial Review sequence.
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').RequestUtils} requestUtils
 * @return {Promise<Object>} Sequence record.
 */
async function getEditorialSequence( requestUtils ) {
	return requestUtils.rest( {
		path: `/vip-workflow/v1/sequences/slug/${ EDITORIAL_REVIEW_SLUG }`,
	} );
}

/**
 * Create a draft post via the core REST API.
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').RequestUtils} requestUtils
 * @param {Object}                                                      [overrides]         Post field overrides.
 * @param {string}                                                      [overrides.title]
 * @param {string}                                                      [overrides.status]
 * @param {string}                                                      [overrides.content]
 * @return {Promise<Object>} Created post record.
 */
async function createDraftPost( requestUtils, overrides = {} ) {
	return requestUtils.rest( {
		path: '/wp/v2/posts',
		method: 'POST',
		data: {
			title: overrides.title || 'VIP Workflow e2e post',
			status: overrides.status || 'draft',
			content: overrides.content || '',
		},
	} );
}

/**
 * Assign a sequence to a post.
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').RequestUtils} requestUtils
 * @param {number}                                                      postId
 * @param {number}                                                      sequenceId
 * @param {string|null}                                                 [stageKey]   Starting stage; omit to let the server map it.
 * @return {Promise<Object>} Assignment response.
 */
async function assignSequence(
	requestUtils,
	postId,
	sequenceId,
	stageKey = null
) {
	const data = { sequence_id: sequenceId };
	if ( stageKey ) {
		data.stage_key = stageKey;
	}
	return requestUtils.rest( {
		path: `${ WF }/post/${ postId }/sequence`,
		method: 'POST',
		data,
	} );
}

/**
 * Create a post already enrolled in the Editorial Review workflow.
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').RequestUtils} requestUtils
 * @param {Object}                                                      [overrides]  Post field overrides passed to createDraftPost.
 * @return {Promise<{postId: number, sequenceId: number}>} The new post id and the sequence it was enrolled in.
 */
async function createWorkflowPost( requestUtils, overrides = {} ) {
	const sequence = await getEditorialSequence( requestUtils );
	const post = await createDraftPost( requestUtils, overrides );
	await assignSequence( requestUtils, post.id, sequence.id, 'draft' );
	return { postId: post.id, sequenceId: sequence.id };
}

/**
 * Create a sequence whose draft stage has a role-gated transition — i.e. the
 * transition requires assigning a role, which surfaces the role-select modal in
 * the editor. Delete it in afterEach/afterAll with deleteSequence.
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').RequestUtils} requestUtils
 * @param {string}                                                      [label]      Disambiguating label.
 * @return {Promise<Object>} Created sequence record.
 */
async function createRoleGatedSequence( requestUtils, label = 'role' ) {
	return requestUtils.rest( {
		path: '/vip-workflow/v1/sequences',
		method: 'POST',
		data: {
			name: `E2E Role Gated ${ label } ${ Date.now() }`,
			type: 'workflow',
			status: 'active',
			post_types: [ 'post' ],
			statuses: [
				{
					key: 'draft',
					label: 'Draft',
					transitions: [
						{
							to: 'assigned',
							label: 'Assign Reviewer',
							inputs: [
								{
									type: 'assignment',
									required: true,
									meta_key: 'wf_reviewer',
									assignee_type: 'role',
									label: 'Select Reviewer Role',
									filter: { roles: [ 'editor' ] },
								},
							],
						},
					],
				},
				{ key: 'assigned', label: 'Assigned', is_terminal: true },
			],
		},
	} );
}

/**
 * Create an active AI-stage sequence: draft → AI Copy Desk (agent) → review →
 * published. The `ai_copy_desk` stage is owned by the `copy-edit` stage
 * agent, which runs on entry and routes its own exit (default:
 * pass → review, fail → draft, no error route). Mirrors the committed AI Copy
 * Desk fixture (tests/fixtures/ai-copy-desk-workflow.json) but seeds inline
 * over the create endpoint so the sequence is active immediately. Delete it
 * with deleteSequence.
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').RequestUtils} requestUtils
 * @param {string}                                                      [label]        Disambiguating label.
 * @param {Object}                                                      [opts]         Options.
 * @param {Object}                                                      [opts.routing] The AI stage's `agent.routing` map.
 * @return {Promise<Object>} Created sequence record (has id, slug).
 */
async function createAiStageSequence(
	requestUtils,
	label = 'ai',
	{ routing = { pass: 'review', fail: 'draft' } } = {}
) {
	// The default routing carries NO `error` destination on purpose: the error
	// path is opt-in per stage, and without one an errored run fails in place —
	// which is the deterministic outcome these suites drive (the tests env
	// blocks provider egress). Pass an explicit routing with `error` to exercise
	// the routed-error path instead.
	return requestUtils.rest( {
		path: '/vip-workflow/v1/sequences',
		method: 'POST',
		data: {
			name: `E2E AI Copy Desk ${ label } ${ Date.now() }`,
			type: 'workflow',
			status: 'active',
			post_types: [ 'post' ],
			statuses: [
				{
					key: 'draft',
					label: 'Draft',
					color: '#8c8f94',
					status: 'draft',
					region_entry: true,
					transitions: [
						{ to: 'ai_copy_desk', label: 'Send to AI Copy Desk' },
					],
				},
				{
					key: 'ai_copy_desk',
					label: 'AI Copy Desk',
					color: '#674ea7',
					status: 'draft',
					transitions: [
						{ to: 'review', label: 'Advance to Review' },
						{ to: 'draft', label: 'Bump back to Draft' },
					],
					agent: {
						ability_id: 'workflow-agent-copy-edit/copy-edit',
						settings: {
							style: 'Short punchy paragraphs (1-2 sentences each).',
						},
						routing,
					},
				},
				{
					key: 'review',
					label: 'Review',
					color: '#dba617',
					status: 'draft',
					transitions: [ { to: 'published', label: 'Publish' } ],
				},
				{
					key: 'published',
					label: 'Published',
					color: '#00a32a',
					is_terminal: true,
					status: 'publish',
					region_entry: true,
					transitions: [],
				},
			],
		},
	} );
}

/**
 * Run any due WP-Cron events synchronously.
 *
 * Stage agents dispatch via `wp_schedule_single_event`, so the agent only runs
 * once cron fires. The tests environment sets DISABLE_WP_CRON (WP's loopback
 * spawn can't run with egress blocked), so nothing fires the queue on its own —
 * a spec drives it by requesting wp-cron.php directly, which processes due
 * events in that request. Uses the absolute base URL because requestUtils'
 * request context has no baseURL for non-REST paths.
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').RequestUtils} requestUtils
 * @return {Promise<void>}
 */
async function runDueCron( requestUtils ) {
	const baseURL = process.env.WP_BASE_URL || 'http://localhost:8889';
	await requestUtils.request.get( `${ baseURL }/wp-cron.php`, {
		failOnStatusCode: false,
	} );
}

/**
 * Poll a post's workflow status until its agent job reaches a status, running
 * due cron each round so a queued agent actually executes. The tests
 * environment blocks external HTTP, so a dispatched agent's AI call always
 * fails — the job reliably lands on `failed` (fail-in-place).
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').RequestUtils} requestUtils
 * @param {number}                                                      postId
 * @param {string}                                                      wanted            Desired agent_job.status (e.g. 'failed').
 * @param {Object}                                                      [opts]
 * @param {number}                                                      [opts.attempts]
 * @param {number}                                                      [opts.intervalMs]
 * @return {Promise<Object>} The status payload once the job reaches `wanted`.
 */
async function waitForAgentStatus(
	requestUtils,
	postId,
	wanted,
	{ attempts = 30, intervalMs = 500 } = {}
) {
	for ( let i = 0; i < attempts; i++ ) {
		await runDueCron( requestUtils );
		const status = await getWorkflowStatus( requestUtils, postId );
		if ( status.agent_job?.status === wanted ) {
			return status;
		}
		await new Promise( ( resolve ) => setTimeout( resolve, intervalMs ) );
	}
	throw new Error(
		`agent_job.status never reached "${ wanted }" for post ${ postId }`
	);
}

/**
 * Return a post whose stage agent failed in place to the stage it came from.
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').RequestUtils} requestUtils
 * @param {number}                                                      postId
 * @return {Promise<Object>} Updated status payload (post back at its origin stage).
 */
async function revertAgent( requestUtils, postId ) {
	return requestUtils.rest( {
		path: `${ WF }/post/${ postId }/agent-revert`,
		method: 'POST',
	} );
}

/**
 * Delete a sequence (best-effort; ignore failures so a throwaway sequence
 * never fails the run).
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').RequestUtils} requestUtils
 * @param {number}                                                      sequenceId
 * @return {Promise<void>}
 */
async function deleteSequence( requestUtils, sequenceId ) {
	try {
		await requestUtils.rest( {
			path: `/vip-workflow/v1/sequences/${ sequenceId }`,
			method: 'DELETE',
		} );
	} catch ( e ) {
		// Leave the throwaway sequence behind rather than fail the run.
	}
}

/**
 * Get the workflow status payload for a post.
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').RequestUtils} requestUtils
 * @param {number}                                                      postId
 * @return {Promise<Object>} Status payload (has_workflow, current, transitions, …).
 */
async function getWorkflowStatus( requestUtils, postId ) {
	return requestUtils.rest( { path: `${ WF }/post/${ postId }/status` } );
}

/**
 * Transition a post to a new status via REST.
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').RequestUtils} requestUtils
 * @param {number}                                                      postId
 * @param {string}                                                      toStatus
 * @param {Object}                                                      [opts]
 * @param {boolean}                                                     [opts.acknowledgeWarnings]
 * @param {Object}                                                      [opts.inputData]
 * @return {Promise<Object>} Transition response.
 */
async function transition( requestUtils, postId, toStatus, opts = {} ) {
	return requestUtils.rest( {
		path: `${ WF }/post/${ postId }/transition`,
		method: 'POST',
		data: {
			to_status: toStatus,
			acknowledge_warnings: opts.acknowledgeWarnings || false,
			...( opts.inputData ? { input_data: opts.inputData } : {} ),
		},
	} );
}

/**
 * Read a post's stored content (raw, edit context) via the core REST API.
 * Use this to assert what actually landed in the database — e.g. that the
 * editor flushed unsaved edits before a transition.
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').RequestUtils} requestUtils
 * @param {number}                                                      postId
 * @return {Promise<string>} The post's `content.raw` (empty string if absent).
 */
async function getPostContent( requestUtils, postId ) {
	const post = await requestUtils.rest( {
		path: `/wp/v2/posts/${ postId }`,
		params: { context: 'edit' },
	} );
	return post?.content?.raw ?? '';
}

/**
 * Delete a post (force) — use in afterEach/afterAll to keep runs isolated.
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').RequestUtils} requestUtils
 * @param {number}                                                      postId
 * @return {Promise<void>}
 */
async function deletePost( requestUtils, postId ) {
	await requestUtils.rest( {
		path: `/wp/v2/posts/${ postId }`,
		method: 'DELETE',
		params: { force: true },
	} );
}

/**
 * Create a reviewer user — an `editor` (a reviewer role for the default
 * sequence, and not in the tool-check bypass list). Username is unique per run
 * so reruns don't collide; delete it in afterEach with `deleteUser`.
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').RequestUtils} requestUtils
 * @param {string}                                                      [label]      Disambiguating label for the username.
 * @return {Promise<{id:number, username:string, password:string}>} The created user's id, username, and password.
 */
async function createReviewerUser( requestUtils, label = 'reviewer' ) {
	const username = `vipwf_${ label }_${ Date.now() }`;
	const password = 'vip-workflow-e2e-pw';
	const user = await requestUtils.createUser( {
		username,
		email: `${ username }@example.com`,
		password,
		roles: [ 'editor' ],
	} );
	return { id: user.id, username, password };
}

/**
 * Claim a workflow post (POST).
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').RequestUtils} utils  Request utils with the admin session.
 * @param {number}                                                      postId The post to claim.
 * @return {Promise<Object>} Claim response.
 */
function claimPost( utils, postId ) {
	return utils.rest( {
		path: `${ WF }/post/${ postId }/claim`,
		method: 'POST',
	} );
}

/**
 * Release a claimed workflow post (DELETE).
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').RequestUtils} utils  Request utils with the admin session.
 * @param {number}                                                      postId The post to release.
 * @return {Promise<Object>} Release response.
 */
function releasePost( utils, postId ) {
	return utils.rest( {
		path: `${ WF }/post/${ postId }/unclaim`,
		method: 'DELETE',
	} );
}

module.exports = {
	EDITORIAL_REVIEW_SLUG,
	WORKFLOW_SIDEBAR,
	openWorkflowSidebar,
	openWorkflowPanel,
	getEditorialSequence,
	createDraftPost,
	assignSequence,
	createWorkflowPost,
	createRoleGatedSequence,
	createAiStageSequence,
	runDueCron,
	waitForAgentStatus,
	revertAgent,
	deleteSequence,
	getWorkflowStatus,
	getPostContent,
	transition,
	deletePost,
	createReviewerUser,
	claimPost,
	releasePost,
};
