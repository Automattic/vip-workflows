/**
 * Editorial metadata feature.
 *
 * Covers the sequence metadata_fields contract end to end:
 *   - a sequence can declare metadata_fields;
 *   - the workflow status endpoint returns them (with resolved wf_meta_* keys)
 *     so the editor can refresh fields on assign/remove;
 *   - a value written to the registered post meta round-trips through the
 *     metadata convenience endpoint.
 *
 * The editor-side flow drives the metadata rows of the Workflow sidebar, which
 * is where the fields live now: each field is a flat label + clickable-value
 * row (no "Editorial Metadata" heading) whose side-anchored popover holds the
 * field's input — the document-sidebar meta pattern. The sequence-editor flow
 * guards against the bug where the save payload omitted metadata_fields
 * entirely.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );
const {
	createDraftPost,
	assignSequence,
	getWorkflowStatus,
	deletePost,
	openWorkflowSidebar,
} = require( './helpers/workflow' );

const FIELD = {
	key: 'content_pillar',
	label: 'Content Pillar',
	type: 'text',
	required: false,
	searchable: true,
};

const USER_FIELD = {
	key: 'owner',
	label: 'Owner',
	type: 'user',
	required: false,
	searchable: true,
};

/**
 * Create an active workflow sequence that declares a single metadata field.
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').RequestUtils} requestUtils
 * @param {string}                                                      label        Disambiguating name suffix.
 * @param {Object}                                                      field        Metadata field definition.
 * @return {Promise<Object>} Created sequence record.
 */
async function createSequenceWithMetadata(
	requestUtils,
	label,
	field = FIELD
) {
	return requestUtils.rest( {
		path: '/vip-workflow/v1/sequences',
		method: 'POST',
		data: {
			name: `E2E Metadata Sequence ${ label }`,
			type: 'workflow',
			status: 'active',
			post_types: [ 'post' ],
			statuses: [
				{
					key: 'draft',
					label: 'Draft',
					status: 'draft',
					region_entry: true,
				},
				{
					key: 'published',
					label: 'Published',
					is_terminal: true,
					status: 'publish',
					region_entry: true,
				},
			],
			metadata_fields: [ field ],
		},
	} );
}

test.describe( 'VIP Workflow — editorial metadata (REST contract)', () => {
	let postId;
	let sequenceId;

	test.afterEach( async ( { requestUtils } ) => {
		if ( postId ) {
			await deletePost( requestUtils, postId );
			postId = null;
		}
		if ( sequenceId ) {
			// Best-effort cleanup; ignore if the route/permission differs.
			try {
				await requestUtils.rest( {
					path: `/vip-workflow/v1/sequences/${ sequenceId }`,
					method: 'DELETE',
				} );
			} catch ( e ) {
				// Leave the throwaway sequence behind rather than fail the run.
			}
			sequenceId = null;
		}
	} );

	test( 'status endpoint returns metadata_fields with resolved meta keys', async ( {
		requestUtils,
	} ) => {
		const sequence = await createSequenceWithMetadata(
			requestUtils,
			`status-${ Date.now() }`
		);
		sequenceId = sequence.id;

		const post = await createDraftPost( requestUtils, {
			title: 'Metadata status e2e',
		} );
		postId = post.id;
		await assignSequence( requestUtils, postId, sequenceId, 'draft' );

		const status = await getWorkflowStatus( requestUtils, postId );

		expect( status.has_workflow ).toBe( true );
		expect( Array.isArray( status.metadata_fields ) ).toBe( true );

		const field = status.metadata_fields.find(
			( f ) => f.key === FIELD.key
		);
		expect( field ).toBeTruthy();
		// The shape the editor store + Metadata panel consume.
		expect( field.label ).toBe( FIELD.label );
		expect( field.meta_key ).toBe(
			`wf_meta_${ sequenceId }_${ FIELD.key }`
		);
	} );

	test( 'a metadata value round-trips through the metadata endpoint', async ( {
		requestUtils,
	} ) => {
		const sequence = await createSequenceWithMetadata(
			requestUtils,
			`value-${ Date.now() }`
		);
		sequenceId = sequence.id;

		const post = await createDraftPost( requestUtils, {
			title: 'Metadata value e2e',
		} );
		postId = post.id;
		await assignSequence( requestUtils, postId, sequenceId, 'draft' );

		const metaKey = `wf_meta_${ sequenceId }_${ FIELD.key }`;

		// Write the value through the registered (show_in_rest) post meta, the
		// same path the editor's useEntityProp uses.
		await requestUtils.rest( {
			path: `/wp/v2/posts/${ postId }`,
			method: 'POST',
			data: { meta: { [ metaKey ]: 'News' } },
		} );

		// Read it back through the plugin's metadata convenience endpoint
		// (now gated on edit_post — admin satisfies it).
		const metaResp = await requestUtils.rest( {
			path: `/vip-workflow/v1/posts/${ postId }/metadata`,
		} );
		const returned = ( metaResp.fields || [] ).find(
			( f ) => f.key === FIELD.key
		);
		expect( returned ).toBeTruthy();
		expect( returned.value ).toBe( 'News' );
	} );

	test( 'metadata_fields survive an export -> import round-trip', async ( {
		requestUtils,
	} ) => {
		const sequence = await createSequenceWithMetadata(
			requestUtils,
			`export-${ Date.now() }`
		);
		sequenceId = sequence.id;

		// Export → the JSON carries the metadata field definitions.
		const exported = await requestUtils.rest( {
			path: `/vip-workflow/v1/sequences/${ sequenceId }/export`,
		} );
		const exportedField = ( exported.config?.metadata_fields || [] ).find(
			( f ) => f.key === FIELD.key
		);
		expect( exportedField ).toBeTruthy();
		expect( exportedField.label ).toBe( FIELD.label );

		// Import the exported JSON → the new sequence keeps the fields.
		const imported = await requestUtils.rest( {
			path: '/vip-workflow/v1/sequences/import',
			method: 'POST',
			data: {
				sequence_json: exported,
				name: `Imported ${ sequence.name }`,
			},
		} );
		const importedId = imported.sequence?.id || imported.id;
		expect( importedId ).toBeTruthy();

		try {
			const fetched = await requestUtils.rest( {
				path: `/vip-workflow/v1/sequences/${ importedId }/export`,
			} );
			const roundTripped = ( fetched.config?.metadata_fields || [] ).find(
				( f ) => f.key === FIELD.key
			);
			expect( roundTripped ).toBeTruthy();
			expect( roundTripped.type ).toBe( FIELD.type );
		} finally {
			await requestUtils
				.rest( {
					path: `/vip-workflow/v1/sequences/${ importedId }`,
					method: 'DELETE',
				} )
				.catch( () => {} );
		}
	} );

	test( 'removing the workflow clears metadata_fields from the status payload', async ( {
		requestUtils,
	} ) => {
		const sequence = await createSequenceWithMetadata(
			requestUtils,
			`remove-${ Date.now() }`
		);
		sequenceId = sequence.id;

		const post = await createDraftPost( requestUtils, {
			title: 'Metadata remove e2e',
		} );
		postId = post.id;
		await assignSequence( requestUtils, postId, sequenceId, 'draft' );

		// Remove the workflow; status should report no fields (mirrors the
		// editor clearing metadataFields on remove).
		await requestUtils.rest( {
			path: `/vip-workflow/v1/workflow/post/${ postId }/sequence`,
			method: 'DELETE',
		} );

		const status = await getWorkflowStatus( requestUtils, postId );
		expect( status.has_workflow ).toBe( false );
		expect( status.metadata_fields ).toEqual( [] );
	} );
} );

test.describe( 'VIP Workflow — editorial metadata (UI)', () => {
	let postId;
	let sequenceId;

	test.afterEach( async ( { requestUtils } ) => {
		if ( postId ) {
			await deletePost( requestUtils, postId );
			postId = null;
		}
		if ( sequenceId ) {
			try {
				await requestUtils.rest( {
					path: `/vip-workflow/v1/sequences/${ sequenceId }`,
					method: 'DELETE',
				} );
			} catch ( e ) {
				// Best-effort cleanup.
			}
			sequenceId = null;
		}
	} );

	/**
	 * Expand a sequence-inspector disclosure by its toggle name if collapsed.
	 * The whole header is the trigger and carries `aria-expanded`.
	 *
	 * Matched loosely: the disclosures append a summary to the title
	 * ("Metadata fields" + "2 fields"), so the accessible name is a
	 * superstring of the panel name.
	 *
	 * @param {import('@playwright/test').Page} page
	 * @param {string}                          name Panel toggle accessible name.
	 */
	async function openPanel( page, name ) {
		const toggle = page.getByRole( 'button', { name, exact: false } );
		await expect( toggle ).toBeVisible();
		if ( ( await toggle.getAttribute( 'aria-expanded' ) ) === 'false' ) {
			await toggle.click();
		}
	}

	/**
	 * Open one metadata field's options.
	 *
	 * A field is a row in `InspectorFieldList`, and the row itself is the
	 * control that opens the options — a button named "Configure <label>",
	 * with the field's controls in a popover anchored to it. Only one row's
	 * popover is open at a time.
	 *
	 * The popover is located by class rather than by its accessible name: the
	 * name is the field's label, which is exactly what these tests type into.
	 *
	 * @param {import('@playwright/test').Page} page
	 * @param {string}                          label Row label ("Untitled" when unnamed).
	 * @return {import('@playwright/test').Locator} The open popover.
	 */
	async function openFieldConfig( page, label ) {
		await page
			.getByRole( 'button', { name: `Configure ${ label }` } )
			.click();
		const config = page.locator( '.wf-inspector-field-list__popover' );
		await expect( config ).toBeVisible();
		return config;
	}

	/**
	 * Open a sequence from the Sequences list in the graph editor. The card is
	 * `.vip-workflow-summary-card` and its "Edit" is an onClick <Button>
	 * (role button) that routes to the editor via the URL hash. The editor's
	 * stable landmark is the primary "Save" action.
	 *
	 * @param {import('@playwright/test').Page} page
	 * @param {string}                          name Sequence name to match.
	 */
	async function openSequenceForEdit( page, name ) {
		await page
			.locator( '.vip-workflow-summary-card' )
			.filter( { hasText: name } )
			.getByRole( 'button', { name: 'Edit' } )
			.click();
		await expect(
			page.getByRole( 'button', { name: 'Save' } )
		).toBeVisible();
	}

	test( 'a metadata row opens its popover, and a committed value persists', async ( {
		admin,
		editor,
		page,
		requestUtils,
	} ) => {
		const sequence = await createSequenceWithMetadata(
			requestUtils,
			`ui-${ Date.now() }`
		);
		sequenceId = sequence.id;

		const post = await createDraftPost( requestUtils, {
			title: 'Metadata UI e2e',
		} );
		postId = post.id;
		await assignSequence( requestUtils, postId, sequenceId, 'draft' );

		await admin.editPost( postId );
		const sidebar = await openWorkflowSidebar( page );

		// The field renders flat in the sidebar as a label + clickable-value
		// row; the unset trigger's accessible name states the action.
		await sidebar
			.getByRole( 'button', { name: `Set ${ FIELD.label }` } )
			.click();

		// The popover is a dialog named after the field; its input carries the
		// field's (visually hidden) label. Enter commits and closes — and the
		// close must hold through the whole keystroke: without preventDefault
		// in MetadataPanel's Enter handler, the stroke's follow-on keypress
		// landed on the re-focused trigger and reopened the popover, which is
		// exactly what the toBeHidden assertion below guards.
		const dialog = page.getByRole( 'dialog', { name: FIELD.label } );
		await expect( dialog ).toBeVisible();
		const input = dialog.getByRole( 'textbox', { name: FIELD.label } );
		await input.fill( 'News' );
		await input.press( 'Enter' );
		await expect( dialog ).toBeHidden();

		// The row's trigger now shows the value.
		const filledTrigger = sidebar.getByRole( 'button', {
			name: `Change ${ FIELD.label }: News`,
		} );
		await expect( filledTrigger ).toBeVisible();
		await expect( filledTrigger ).toHaveText( 'News' );

		await editor.saveDraft();

		// Reload and confirm the value survives a round-trip.
		await admin.editPost( postId );
		const reopened = await openWorkflowSidebar( page );
		await expect(
			reopened.getByRole( 'button', {
				name: `Change ${ FIELD.label }: News`,
			} )
		).toBeVisible();

		// And it persisted server-side.
		const metaResp = await requestUtils.rest( {
			path: `/vip-workflow/v1/posts/${ postId }/metadata`,
		} );
		const returned = ( metaResp.fields || [] ).find(
			( f ) => f.key === FIELD.key
		);
		expect( returned ).toBeTruthy();
		expect( returned.value ).toBe( 'News' );
	} );

	test( 'user metadata row hosts a searchable selector and persists a user ID', async ( {
		admin,
		editor,
		page,
		requestUtils,
	} ) => {
		const users = await requestUtils.rest( {
			path: '/wp/v2/users?per_page=1&context=view',
		} );
		const user = users[ 0 ];
		expect( user?.id ).toBeTruthy();

		const sequence = await createSequenceWithMetadata(
			requestUtils,
			`user-ui-${ Date.now() }`,
			USER_FIELD
		);
		sequenceId = sequence.id;

		const post = await createDraftPost( requestUtils, {
			title: 'Metadata user UI e2e',
		} );
		postId = post.id;
		await assignSequence( requestUtils, postId, sequenceId, 'draft' );

		await admin.editPost( postId );
		const sidebar = await openWorkflowSidebar( page );

		await sidebar
			.getByRole( 'button', { name: `Set ${ USER_FIELD.label }` } )
			.click();

		// The popover holds the searchable user combobox; picking a user
		// commits and closes (a discrete picker, like core's PostAuthor).
		const dialog = page.getByRole( 'dialog', { name: USER_FIELD.label } );
		await expect( dialog ).toBeVisible();
		const userSelector = dialog.getByRole( 'combobox', {
			name: USER_FIELD.label,
		} );
		await userSelector.fill( user.name );
		await page.getByRole( 'option', { name: user.name } ).click();
		await expect( dialog ).toBeHidden();

		// The trigger resolves the saved id to the user's display name.
		await expect(
			sidebar.getByRole( 'button', {
				name: `Change ${ USER_FIELD.label }: ${ user.name }`,
			} )
		).toBeVisible();

		await editor.saveDraft();

		await admin.editPost( postId );
		const reopened = await openWorkflowSidebar( page );
		await expect(
			reopened.getByRole( 'button', {
				name: `Change ${ USER_FIELD.label }: ${ user.name }`,
			} )
		).toBeVisible();

		const metaResp = await requestUtils.rest( {
			path: `/vip-workflow/v1/posts/${ postId }/metadata`,
		} );
		const returned = ( metaResp.fields || [] ).find(
			( f ) => f.key === USER_FIELD.key
		);
		expect( returned ).toBeTruthy();
		expect( Number( returned.value ) ).toBe( user.id );
	} );

	test( 'editing a sequence in the Sequence editor preserves existing metadata_fields', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		// Regression guard: before the fix, the editor omitted metadata_fields
		// from its PUT, so the backend rebuilt config with an empty array and
		// stripped fields added via import/API on every save.
		const sequence = await createSequenceWithMetadata(
			requestUtils,
			`dataloss-${ Date.now() }`
		);
		sequenceId = sequence.id;

		await admin.visitAdminPage(
			'admin.php',
			'page=vip-workflow-sequences'
		);

		// Open this sequence in the graph-based Sequence editor.
		await openSequenceForEdit( page, sequence.name );

		// Make a detectable change (proves the save round-trip actually ran)
		// WITHOUT touching the Metadata fields section. Description lives in the
		// settings inspector's first section, which is always open in place.
		const newDescription = `Edited by e2e ${ Date.now() }`;
		await page
			.getByRole( 'textbox', { name: 'Description' } )
			.fill( newDescription );
		await page.getByRole( 'button', { name: 'Save' } ).click();

		// Poll REST until the description change persists (proves the save
		// round-trip ran), independent of post-save UI navigation.
		await expect
			.poll( async () => {
				const bp = await requestUtils.rest( {
					path: `/vip-workflow/v1/sequences/${ sequenceId }`,
				} );
				return bp.description;
			} )
			.toBe( newDescription );

		// The guard: metadata_fields survived the save.
		const updated = await requestUtils.rest( {
			path: `/vip-workflow/v1/sequences/${ sequenceId }`,
		} );
		const fields = updated.config?.metadata_fields || [];
		expect( fields.find( ( f ) => f.key === FIELD.key ) ).toBeTruthy();
	} );

	test( 'editing an existing metadata field label preserves its stored key', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const sequence = await createSequenceWithMetadata(
			requestUtils,
			`stable-key-${ Date.now() }`
		);
		sequenceId = sequence.id;

		await admin.visitAdminPage(
			'admin.php',
			'page=vip-workflow-sequences'
		);

		await openSequenceForEdit( page, sequence.name );

		// Metadata fields live in a disclosure section of the settings inspector
		// — shut when the sequence has no fields, already open when it does, so
		// openPanel expands it only if needed. Each field is a row whose
		// popover holds the "Field label" and "Key" textboxes.
		await openPanel( page, 'Metadata fields' );
		const config = await openFieldConfig( page, FIELD.label );
		const newLabel = `Content Category ${ Date.now() }`;

		await config
			.getByRole( 'textbox', { name: 'Field label' } )
			.fill( newLabel );
		await expect(
			config.getByRole( 'textbox', { name: 'Key' } )
		).toHaveValue( FIELD.key );

		// Shut the popover before saving: it is anchored over the canvas, and
		// dismissing it by clicking Save through it is a race, not a gesture.
		await page.keyboard.press( 'Escape' );
		await expect( config ).toBeHidden();
		await page.getByRole( 'button', { name: 'Save' } ).click();

		await expect
			.poll( async () => {
				const bp = await requestUtils.rest( {
					path: `/vip-workflow/v1/sequences/${ sequenceId }`,
				} );
				return ( bp.config?.metadata_fields || [] ).find(
					( f ) => f.key === FIELD.key
				)?.label;
			} )
			.toBe( newLabel );
	} );

	test( 'typing a metadata field label auto-populates the full key', async ( {
		admin,
		page,
	} ) => {
		await admin.visitAdminPage(
			'admin.php',
			'page=vip-workflow-sequences'
		);
		await page
			.getByRole( 'link', { name: 'New editorial sequence' } )
			.click();
		await expect(
			page.getByRole( 'button', { name: 'Save' } )
		).toBeVisible();

		await openPanel( page, 'Metadata fields' );
		await page.getByRole( 'button', { name: 'Add field' } ).click();

		// A new field is blank, so its row reads "Untitled" until it is named.
		const config = await openFieldConfig( page, 'Untitled' );
		await config
			.getByRole( 'textbox', { name: 'Field label' } )
			.pressSequentially( 'Content Pillar' );

		await expect(
			config.getByRole( 'textbox', { name: 'Key' } )
		).toHaveValue( 'content_pillar' );
	} );
} );
