/**
 * The required-field gate, as the block editor meets it.
 *
 * The server now holds a transition when the post's sequence declares a
 * required metadata field the post has not filled in — the same refusal a
 * required tool's hard check produces, in the same `hard_failures` shape, under
 * its own error code. The panel used to special-case `tool_check_failed` alone,
 * so the new code fell through to the inline notice and the per-field list was
 * thrown away. Both codes open the one dialog; anything else still becomes a
 * notice, which is what keeps the routing from swallowing unrelated failures.
 *
 * And the other half of making that refusal survivable: the values the author
 * types into the sidebar are written through useEntityProp, which edits the
 * editor store and nothing else until a save, while the server's gate reads
 * post meta. A transition against a sequence that declares a required field
 * therefore has to flush the post first, or the author is refused for a field
 * whose value is on screen in front of them.
 *
 * Which leaves the case the author actually hits first, since the server also
 * projects that gate onto the edge as `_locked`: the button is DISABLED, so the
 * refusal never happens and the save that would have fixed it never runs. The
 * projection is computed from get_post_meta(), so filling the fields changes
 * nothing it was derived from — the move stayed held under "Required fields are
 * empty: …" with both values on screen until the post was saved AND the page
 * reloaded. The panel re-judges that one lock against the editor's own meta,
 * which is what the last group here pins.
 *
 * @package
 */

import { render, screen, waitFor, act } from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

// Same stand-ins as the other WorkflowPanel tests: @wordpress/core-data,
// /editor, /notices and /a11y each pull dependencies jsdom or Jest cannot load,
// and the panel needs nothing from them but the store names.
jest.mock( '@wordpress/core-data', () => ( { store: 'core' } ) );
jest.mock( '@wordpress/editor', () => ( { store: 'core/editor' } ) );
jest.mock( '@wordpress/notices', () => ( { store: 'core/notices' } ) );
jest.mock( '@wordpress/a11y', () => ( { speak: jest.fn() } ) );

// eslint-disable-next-line import/first
import { createReduxStore, register } from '@wordpress/data';

register(
	createReduxStore( 'core', {
		reducer: ( state = {} ) => state,
		selectors: { getEntityRecord: () => null },
		actions: { invalidateResolution: () => ( { type: 'NOOP' } ) },
	} )
);

register(
	createReduxStore( 'core/notices', {
		reducer: ( state = {} ) => state,
		actions: {
			createSuccessNotice: () => ( { type: 'NOOP' } ),
			createErrorNotice: () => ( { type: 'NOOP' } ),
		},
	} )
);

// Dirtiness and the save are what the save-before-transition tests drive, so
// they live outside the store: the selector and the action creator read and
// write these, and each test arranges them itself.
let postIsDirty = false;

// The post's edited meta, keyed the way the sequence namespaces its fields.
let editedMeta = {};

// Records the order the panel does things in — a save that lands after the
// request it was supposed to precede is the bug, not a missing call.
let sequence = [];

const savePost = jest.fn( () => {
	sequence.push( 'save' );
	// A real save persists the edits, so the post stops being dirty. The panel
	// re-checks this afterwards and bails when it is still true.
	postIsDirty = false;
	// @wordpress/data's promise middleware hands a returned promise straight
	// back out of dispatch, which is what the panel chains onto.
	return Promise.resolve();
} );

register(
	createReduxStore( 'core/editor', {
		reducer: ( state = {} ) => state,
		selectors: {
			// The post's meta as the editor holds it — saved values with the
			// sidebar's unsaved edits merged over them. This is what stands in
			// for fields the author has filled in but not yet persisted.
			getEditedPostAttribute: ( state, attribute ) =>
				'meta' === attribute ? editedMeta : 'draft',
			getCurrentPostAttribute: () => 'draft',
			isEditedPostDirty: () => postIsDirty,
		},
		actions: { savePost },
	} )
);

// eslint-disable-next-line import/first
import { seedEditorStore } from './helpers/editor-store';
// eslint-disable-next-line import/first
import { WorkflowPanel } from '../../src/editor/components/WorkflowPanel';

const STATUS_PATH = '/vip-workflow/v1/workflow/post/42/status';

const STATUS_RESPONSE = {
	has_workflow: true,
	sequence: { id: 1, name: 'Required Fields Flow' },
	current: {
		key: 'draft',
		label: 'Draft',
		color: '#666',
		is_terminal: false,
	},
	transitions: [
		{
			to: 'review',
			label: 'Send to Review',
			status_info: { key: 'review', label: 'Review' },
		},
	],
	can_remove: false,
};

// The same sequence, plus the sequence's declared metadata fields — the shape
// the status endpoint really returns, and the only thing that tells the panel
// this transition can depend on meta that is not persisted yet.
const STATUS_WITH_REQUIRED_FIELD = {
	...STATUS_RESPONSE,
	metadata_fields: [
		{
			key: 'section',
			label: 'Section',
			type: 'text',
			required: true,
			meta_key: 'wf_meta_1_section',
		},
	],
};

const STATUS_WITH_OPTIONAL_FIELD = {
	...STATUS_RESPONSE,
	metadata_fields: [
		{
			key: 'section',
			label: 'Section',
			type: 'text',
			required: false,
			meta_key: 'wf_meta_1_section',
		},
	],
};

// Two required fields and a publish edge the server is holding for both — the
// payload the status endpoint really serves a post whose sequence declares
// them and whose meta rows are empty. `_locked_code` is what tells the panel
// this particular lock is one it may re-judge.
const SECTION_FIELD = {
	key: 'section',
	label: 'Section Name',
	type: 'text',
	required: true,
	meta_key: 'wf_meta_1_section',
};

const EDITOR_FIELD = {
	key: 'assigned_editor',
	label: 'Assigned editor',
	type: 'user',
	required: true,
	meta_key: 'wf_meta_1_assigned_editor',
};

const STATUS_WITH_HELD_PUBLISH_EDGE = {
	...STATUS_RESPONSE,
	metadata_fields: [ SECTION_FIELD, EDITOR_FIELD ],
	transitions: [
		{
			to: 'published',
			label: 'Publish',
			status_info: {
				key: 'published',
				label: 'Published',
				status: 'publish',
			},
			_locked: true,
			_locked_code: 'required_fields_missing',
			_locked_reason:
				'Required fields are empty: Section Name and Assigned editor',
		},
	],
};

const REQUIRED_FIELDS_ERROR = {
	code: 'required_fields_missing',
	message: 'Transition blocked by required fields: Section',
	data: {
		status: 422,
		hard_failures: [
			{
				field: 'section',
				label: 'Section',
				message: 'Section is required and has no value.',
				severity: 'hard',
			},
		],
		soft_warnings: [],
	},
};

/**
 * Render the panel with the transition POST rejected by the given error.
 *
 * @param {Object} error Rejection value for the transition request.
 */
async function renderWithRefusal( error ) {
	apiFetch.mockImplementation( ( { path, method } ) => {
		if ( path === STATUS_PATH && method !== 'POST' ) {
			return Promise.resolve( STATUS_RESPONSE );
		}
		if ( path.startsWith( '/vip-workflow/v1/abilities' ) ) {
			return Promise.resolve( [] );
		}
		if ( 'POST' === method ) {
			return Promise.reject( error );
		}
		return Promise.resolve( {} );
	} );

	render( <WorkflowPanel /> );

	await waitFor( () =>
		expect(
			screen.getByRole( 'button', { name: 'Send to Review' } )
		).toBeInTheDocument()
	);

	await act( async () => {
		screen.getByRole( 'button', { name: 'Send to Review' } ).click();
	} );
}

/**
 * Render the panel against a status payload and click the one transition, with
 * the transition POST succeeding.
 *
 * @param {Object} status Status-endpoint payload the store is answered with.
 */
async function renderAndTransition( status ) {
	apiFetch.mockImplementation( ( { path, method } ) => {
		if ( path === STATUS_PATH && method !== 'POST' ) {
			return Promise.resolve( status );
		}
		if ( path.startsWith( '/vip-workflow/v1/abilities' ) ) {
			return Promise.resolve( [] );
		}
		if ( 'POST' === method ) {
			sequence.push( 'transition' );
			return Promise.resolve( status );
		}
		return Promise.resolve( {} );
	} );

	render( <WorkflowPanel /> );

	await waitFor( () =>
		expect(
			screen.getByRole( 'button', { name: 'Send to Review' } )
		).toBeInTheDocument()
	);

	await act( async () => {
		screen.getByRole( 'button', { name: 'Send to Review' } ).click();
	} );
}

/**
 * Render the panel against a status payload, with no transition attempted.
 *
 * @param {Object} status Status-endpoint payload the store is answered with.
 */
async function renderStatus( status ) {
	apiFetch.mockImplementation( ( { path, method } ) => {
		if ( path === STATUS_PATH && method !== 'POST' ) {
			return Promise.resolve( status );
		}
		if ( path.startsWith( '/vip-workflow/v1/abilities' ) ) {
			return Promise.resolve( [] );
		}
		return Promise.resolve( {} );
	} );

	render( <WorkflowPanel /> );

	await waitFor( () =>
		expect(
			screen.getByRole( 'button', { name: 'Publish' } )
		).toBeInTheDocument()
	);

	return screen.getByRole( 'button', { name: 'Publish' } );
}

describe( 'WorkflowPanel required-field refusal', () => {
	beforeEach( () => {
		apiFetch.mockReset();
		savePost.mockClear();
		postIsDirty = false;
		editedMeta = {};
		sequence = [];
		seedEditorStore();
	} );

	it( 'opens the blocked dialog and names the empty field', async () => {
		await renderWithRefusal( REQUIRED_FIELDS_ERROR );

		expect(
			screen.getByRole( 'dialog', { name: 'Transition Blocked' } )
		).toBeInTheDocument();
		expect(
			screen.getByText( 'Section is required and has no value.' )
		).toBeInTheDocument();

		// The row carries the field's label as its bold prefix, the way a tool
		// row carries the tool's — otherwise the payload's `label` is dead and
		// required-field rows sit unprefixed among prefixed ones.
		expect( screen.getByText( 'Section:' ) ).toBeInTheDocument();

		// And the section heading describes a metadata refusal rather than the
		// shared default, which says checks ran and failed. None did.
		expect(
			screen.getByRole( 'heading', { name: 'Required fields are empty' } )
		).toBeInTheDocument();
	} );

	it( 'still opens the blocked dialog for a failed tool check', async () => {
		await renderWithRefusal( {
			code: 'tool_check_failed',
			message: 'Transition blocked by required checks.',
			data: {
				status: 422,
				hard_failures: [
					{ tool: 'vip-workflow/seo', message: 'Title is too long.' },
				],
				soft_warnings: [],
			},
		} );

		expect(
			screen.getByRole( 'dialog', { name: 'Transition Blocked' } )
		).toBeInTheDocument();
		expect( screen.getByText( 'Title is too long.' ) ).toBeInTheDocument();

		// A tool refusal keeps the shared heading — checks really did run.
		expect(
			screen.getByRole( 'heading', { name: 'Required checks failed' } )
		).toBeInTheDocument();
	} );

	it( 'leaves an unrelated failure on the inline notice', async () => {
		await renderWithRefusal( {
			code: 'forbidden_transition',
			message: 'You do not have permission to perform this transition.',
		} );

		expect(
			screen.queryByRole( 'dialog', { name: 'Transition Blocked' } )
		).not.toBeInTheDocument();
	} );

	/**
	 * The defect this pins: the author types "Politics" into Section and hits
	 * the transition without saving. That value is an editor-store edit; the
	 * server's gate reads get_post_meta(). Unless the panel flushes first, the
	 * transition is refused for a field that is filled in on screen — and
	 * clicking again does exactly the same thing.
	 */
	it( 'saves a dirty post before a transition that can depend on meta', async () => {
		postIsDirty = true;

		await renderAndTransition( STATUS_WITH_REQUIRED_FIELD );

		expect( savePost ).toHaveBeenCalledTimes( 1 );
		expect( sequence ).toEqual( [ 'save', 'transition' ] );
	} );

	/**
	 * The narrowing, stated: a sequence with no required field has nothing the
	 * transition can be refused for, so a dirty post's unsaved work is left
	 * where the author left it.
	 */
	it( 'leaves a dirty post alone when no field is required', async () => {
		postIsDirty = true;

		await renderAndTransition( STATUS_WITH_OPTIONAL_FIELD );

		expect( savePost ).not.toHaveBeenCalled();
		expect( sequence ).toEqual( [ 'transition' ] );
	} );

	/**
	 * A clean post has nothing to flush, so the save is skipped even where the
	 * requirement exists.
	 */
	it( 'does not save a post that is not dirty', async () => {
		await renderAndTransition( STATUS_WITH_REQUIRED_FIELD );

		expect( savePost ).not.toHaveBeenCalled();
		expect( sequence ).toEqual( [ 'transition' ] );
	} );

	/**
	 * savePost() resolves even when the save request failed — the error goes to
	 * the editor store, not to the caller. A post still dirty afterwards never
	 * persisted, so the transition must not go out against a row that is not
	 * what the author is looking at.
	 */
	it( 'does not transition when the save did not persist', async () => {
		postIsDirty = true;
		savePost.mockImplementationOnce( () => {
			sequence.push( 'save' );
			// Still dirty: the save request failed.
			return Promise.resolve();
		} );

		await renderAndTransition( STATUS_WITH_REQUIRED_FIELD );

		expect( sequence ).toEqual( [ 'save' ] );
	} );

	/**
	 * The server's projection stands while the fields really are empty. Nothing
	 * about re-judging the lock is allowed to soften the case it was built for.
	 */
	it( 'keeps the move held while the required fields are empty', async () => {
		const publish = await renderStatus( STATUS_WITH_HELD_PUBLISH_EDGE );

		// `accessibleWhenDisabled`: the rail keeps a held move focusable so the
		// reason under it can be reached, so the state is aria-disabled.
		expect( publish ).toHaveAttribute( 'aria-disabled', 'true' );
		expect(
			screen.getByText( /Required fields are empty/ )
		).toHaveTextContent( 'Section Name' );
		expect(
			screen.getByText( /Required fields are empty/ )
		).toHaveTextContent( 'Assigned editor' );
	} );

	/**
	 * The reported defect. Both fields are filled in the editor and nothing has
	 * been saved, so the payload still carries the lock — and the move has to be
	 * offered anyway. Before this, the author saw the values they had just typed
	 * listed as empty under a button they could not press, and the only way out
	 * was a save followed by a page reload.
	 */
	it( 'releases the move once the fields are filled, before any save', async () => {
		editedMeta = {
			wf_meta_1_section: 'Politics',
			wf_meta_1_assigned_editor: 7,
		};

		const publish = await renderStatus( STATUS_WITH_HELD_PUBLISH_EDGE );

		expect( publish ).not.toHaveAttribute( 'aria-disabled' );
		expect(
			screen.queryByText( /Required fields are empty/ )
		).not.toBeInTheDocument();
	} );

	/**
	 * And filling one of two shrinks the sentence to the one still outstanding.
	 * The server's wording names what was empty when the payload was built, so
	 * left as it was it would go on naming a field the author has just answered.
	 */
	it( 'names only the fields that are still empty', async () => {
		editedMeta = { wf_meta_1_section: 'Politics' };

		const publish = await renderStatus( STATUS_WITH_HELD_PUBLISH_EDGE );

		// `accessibleWhenDisabled`: the rail keeps a held move focusable so the
		// reason under it can be reached, so the state is aria-disabled.
		expect( publish ).toHaveAttribute( 'aria-disabled', 'true' );

		const reason = screen.getByText( /Required fields are empty/ );
		expect( reason ).toHaveTextContent( 'Assigned editor' );
		expect( reason ).not.toHaveTextContent( 'Section Name' );
	} );

	/**
	 * A user field cleared to its 0 sentinel is empty, not filled — the same
	 * answer Sequence::metadata_value_is_empty() gives, which is what keeps a
	 * button this panel enables from unlocking into a 422.
	 */
	it( 'reads a cleared user field as still empty', async () => {
		editedMeta = {
			wf_meta_1_section: 'Politics',
			wf_meta_1_assigned_editor: 0,
		};

		const publish = await renderStatus( STATUS_WITH_HELD_PUBLISH_EDGE );

		// `accessibleWhenDisabled`: the rail keeps a held move focusable so the
		// reason under it can be reached, so the state is aria-disabled.
		expect( publish ).toHaveAttribute( 'aria-disabled', 'true' );
		expect(
			screen.getByText( /Required fields are empty/ )
		).toHaveTextContent( 'Assigned editor' );
	} );
} );
