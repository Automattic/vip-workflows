/**
 * The Workflow row and the metadata rows where core's Summary panel cannot
 * show them.
 *
 * The rows are a `PluginPostStatusInfo` fill. Core skips that slot while the
 * `post-status` panel is removed, and some experimental DataForm Summary builds
 * draw no slot at all. In both, the Workflow panel has to carry the same rows,
 * or the author has no way to assign or remove a workflow or fill a required
 * field. And it must never carry a second copy where the Summary panel shows
 * them.
 *
 * The `post-status` panel is removed with `removeEditorPanel()`. Preferences →
 * Panels has no switch for it, and `toggleEditorPanelEnabled( 'post-status' )`
 * changes nothing either Summary reads.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );
const {
	WORKFLOW_PANEL_BODY,
	assignSequence,
	createDraftPost,
	deletePost,
	deleteSequence,
	getEditorialSequence,
	openWorkflowDocumentPanel,
	openWorkflowSummaryRows,
} = require( './helpers/workflow' );

/**
 * The Workflow document panel's name in core's panel preferences.
 *
 * @type {string}
 */
const WORKFLOW_PANEL_NAME = 'vip-workflows/workflow';

/**
 * The Workflow panel's copy of the rows, found by its section label.
 *
 * @param {import('@playwright/test').Page} page
 * @return {import('@playwright/test').Locator} The section.
 */
const panelDetails = ( page ) =>
	page
		.locator( WORKFLOW_PANEL_BODY )
		.getByRole( 'region', { name: 'Details' } );

test.describe( 'VIP Workflows — Summary rows fallback', () => {
	let postId;

	test.afterEach( async ( { requestUtils } ) => {
		if ( postId ) {
			await deletePost( requestUtils, postId );
			postId = undefined;
		}
	} );

	test( 'the Workflow panel carries no copy while the Summary panel shows the rows', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const post = await createDraftPost( requestUtils, {
			title: 'Summary rows present e2e',
		} );
		postId = post.id;

		await admin.editPost( postId );
		await openWorkflowSummaryRows( page );

		await openWorkflowDocumentPanel( page );
		await expect( page.locator( '.vip-workflows-panel' ) ).toBeVisible();
		await expect( panelDetails( page ) ).toHaveCount( 0 );
	} );

	test( 'with the post-status panel removed, the Workflow panel assigns the workflow', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const sequence = await getEditorialSequence( requestUtils );
		const post = await createDraftPost( requestUtils, {
			title: 'Summary panel removed e2e',
		} );
		postId = post.id;

		await admin.editPost( postId );
		await page.evaluate( () =>
			window.wp.data
				.dispatch( 'core/editor' )
				.removeEditorPanel( 'post-status' )
		);

		// Core no longer renders the slot, so the rows are gone from the
		// Summary panel. Scoped to it: the Workflow panel sits in the same
		// document sidebar and may already be drawing its fallback copy.
		await expect(
			page.locator( '.editor-post-summary .vip-workflows-summary-rows' )
		).toHaveCount( 0 );

		await openWorkflowDocumentPanel( page );
		const details = panelDetails( page );
		await expect( details ).toBeVisible();
		await expect(
			details.getByRole( 'heading', { name: 'Details' } )
		).toBeVisible();

		// The same row, reached from the keyboard.
		const trigger = details.getByRole( 'button', {
			name: 'Select a workflow',
		} );
		await trigger.focus();
		await page.keyboard.press( 'Enter' );

		const dialog = page.getByRole( 'dialog', { name: 'Workflow' } );
		await expect( dialog ).toBeVisible();
		await dialog
			.getByRole( 'combobox', { name: 'Workflow' } )
			.fill( sequence.name );
		await page.getByRole( 'option', { name: sequence.name } ).click();

		await expect( dialog ).toBeHidden();
		await expect(
			details.getByRole( 'button', {
				name: `Change workflow: ${ sequence.name }`,
			} )
		).toBeVisible();

		// One copy only.
		await expect(
			page.locator( '.vip-workflows-summary-rows' )
		).toHaveCount( 1 );
	} );

	test.describe( 'with the DataForm Summary experiment on', () => {
		/*
		 * Whether this environment can turn the experiment on at all. The
		 * switch exists only in Gutenberg plugin builds that still ship the
		 * DataForm Summary as an experiment: without the plugin there is no
		 * experiments page, and after the Summary was stabilized the switch is
		 * gone. Either way there is no DataForm-without-slot build to drive, so
		 * the case is skipped and the not-mounted path is covered by
		 * tests/unit-js/summary-rows-fallback.test.js instead.
		 */
		let experimentAvailable = false;

		test.beforeAll( async ( { requestUtils } ) => {
			const response = await requestUtils.request.get(
				'/wp-admin/admin.php?page=gutenberg-experiments'
			);
			const html = response.ok() ? await response.text() : '';
			experimentAvailable =
				html.includes( 'name="_wpnonce"' ) &&
				html.includes( 'gutenberg-dataform-inspector' );

			if ( experimentAvailable ) {
				await requestUtils.setGutenbergExperiments( [
					'gutenberg-dataform-inspector',
				] );
			}
		} );

		test.afterAll( async ( { requestUtils } ) => {
			if ( experimentAvailable ) {
				await requestUtils.setGutenbergExperiments( [] );
			}
		} );

		/*
		 * Gutenberg builds differ here. An experimental DataForm Summary that
		 * draws no slot leaves the rows to the Workflow panel; a build that
		 * draws the slot (and the stabilized Summary, where the experiment
		 * switch no longer exists) shows them in the Summary panel. Either way
		 * the author reaches exactly one copy.
		 */
		test( 'the author reaches exactly one copy of the Workflow row', async ( {
			admin,
			page,
			requestUtils,
		} ) => {
			test.skip(
				! experimentAvailable,
				'This environment has no DataForm Summary experiment switch.'
			);

			const post = await createDraftPost( requestUtils, {
				title: 'DataForm Summary e2e',
			} );
			postId = post.id;

			await admin.editPost( postId );

			// The document sidebar opens by default; wait for its Summary to
			// settle before counting what it drew.
			await page.locator( '.editor-post-summary' ).first().waitFor();
			const inSummary = await page
				.locator( '.editor-post-summary .vip-workflows-summary-rows' )
				.count();

			await openWorkflowDocumentPanel( page );
			await expect(
				page.locator( '.vip-workflows-panel' )
			).toBeVisible();

			const details = panelDetails( page );
			await expect( details ).toHaveCount( inSummary ? 0 : 1 );

			if ( ! inSummary ) {
				await expect(
					details.getByRole( 'button', {
						name: 'Select a workflow',
					} )
				).toBeVisible();
			}
		} );
	} );
} );

/*
 * The one configuration in which the rows have no home on screen: the
 * `post-status` panel is removed, so the Workflow panel carries them, and the
 * person has switched the Workflow panel off in Preferences → Panels. While a
 * move is held on an empty required field, the header offers "Show Workflow
 * panel", which turns the panel back on, expands it and moves focus into it.
 */
test.describe( 'VIP Workflows — Workflow panel switched off', () => {
	let postId;
	let sequenceId;

	test.beforeEach( async ( { requestUtils } ) => {
		// Administrators bypass the workflow by default, and a bypass is
		// never held on required fields. Take it away for this test; the
		// default goes back in afterEach (see workflow-header-action.spec.js).
		await requestUtils.rest( {
			path: '/vip-workflows/v1/settings/general',
			method: 'POST',
			data: { bypass_workflow_roles: [] },
		} );
	} );

	test.afterEach( async ( { page, requestUtils } ) => {
		// Panel preferences are stored per user: a run that failed before the
		// action turned the panel back on must not leave it off for the next
		// spec.
		await page.evaluate( ( name ) => {
			const editor = window.wp?.data?.select( 'core/editor' );
			if ( editor && ! editor.isEditorPanelEnabled( name ) ) {
				window.wp.data
					.dispatch( 'core/editor' )
					.toggleEditorPanelEnabled( name );
			}
		}, WORKFLOW_PANEL_NAME );

		await requestUtils.rest( {
			path: '/vip-workflows/v1/settings/general',
			method: 'POST',
			data: { bypass_workflow_roles: [ 'administrator' ] },
		} );

		if ( postId ) {
			await deletePost( requestUtils, postId );
			postId = undefined;
		}
		if ( sequenceId ) {
			await deleteSequence( requestUtils, sequenceId );
			sequenceId = undefined;
		}
	} );

	test( 'a held move offers the way back to the panel', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const sequence = await requestUtils.rest( {
			path: '/vip-workflows/v1/sequences',
			method: 'POST',
			data: {
				name: `E2E Required Section ${ Date.now() }`,
				type: 'workflow',
				status: 'active',
				post_types: [ 'post' ],
				statuses: [
					{
						key: 'draft',
						label: 'Draft',
						status: 'draft',
						region_entry: true,
						transitions: [ { to: 'published', label: 'Go live' } ],
					},
					{
						key: 'published',
						label: 'Published',
						is_terminal: true,
						status: 'publish',
						region_entry: true,
					},
				],
				metadata_fields: [
					{
						key: 'section',
						label: 'Section',
						type: 'text',
						required: true,
					},
				],
			},
		} );
		sequenceId = sequence.id;

		const post = await createDraftPost( requestUtils, {
			title: 'Workflow panel switched off e2e',
		} );
		postId = post.id;
		await assignSequence( requestUtils, postId, sequenceId, 'draft' );

		await admin.editPost( postId );

		// The rows can only be drawn in the Workflow panel...
		await page.evaluate( () =>
			window.wp.data
				.dispatch( 'core/editor' )
				.removeEditorPanel( 'post-status' )
		);

		// ...and the person switches that panel off in Preferences.
		await page
			.getByRole( 'region', { name: 'Editor top bar' } )
			.getByRole( 'button', { name: 'Options' } )
			.click();
		await page.getByRole( 'menuitem', { name: 'Preferences' } ).click();
		const preferences = page.getByRole( 'dialog', {
			name: 'Preferences',
		} );
		const toggle = preferences.getByLabel( 'Workflow', { exact: true } );
		await expect( toggle ).toBeChecked();
		await toggle.click();
		await expect( toggle ).not.toBeChecked();
		await preferences.getByRole( 'button', { name: 'Close' } ).click();

		await expect( page.locator( WORKFLOW_PANEL_BODY ) ).toHaveCount( 0 );

		// The move is held on the empty field, and the header says where to
		// fill it.
		await expect(
			page.locator( '.vip-workflows-header-action__main' )
		).toBeDisabled();
		const showPanel = page
			.getByRole( 'region', { name: 'Editor top bar' } )
			.getByRole( 'button', { name: 'Show Workflow panel' } );
		await expect( showPanel ).toBeVisible();

		await showPanel.click();

		// The panel is on, expanded, and has focus, with the field in it.
		const body = page.locator( WORKFLOW_PANEL_BODY );
		await expect( body ).toBeVisible();
		await expect( body ).toBeFocused();
		await expect(
			body.getByRole( 'region', { name: 'Details' } )
		).toContainText( 'Section' );

		const panelState = await page.evaluate( ( name ) => {
			const editor = window.wp.data.select( 'core/editor' );
			return {
				enabled: editor.isEditorPanelEnabled( name ),
				opened: editor.isEditorPanelOpened( name ),
			};
		}, WORKFLOW_PANEL_NAME );
		expect( panelState ).toEqual( { enabled: true, opened: true } );

		// The panel is reachable again, so the action is withdrawn.
		await expect( showPanel ).toHaveCount( 0 );
	} );
} );
