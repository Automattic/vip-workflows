/**
 * Unit tests for the MetadataPanel row/popover pattern.
 *
 * Covers the document-sidebar meta pattern the panel follows: every field
 * type renders as a label + clickable-value row, clicking the value opens a
 * popover holding the type's input, committing a value closes the popover
 * and updates the shown value, and a sequence with no fields renders nothing.
 *
 * And the row's second state: a required field is marked with core's invalid
 * treatment only while a move is actually being held for it. Required and
 * BLOCKING are not the same thing — the asterisk says the field will be wanted,
 * the error state says the author is stuck on it right now — and an error tone
 * standing over an action nobody is blocked on is just nagging.
 */

import {
	render,
	screen,
	fireEvent,
	waitFor,
} from './helpers/render-wp-component';
import { useState } from '@wordpress/element';

import apiFetch from '@wordpress/api-fetch';

import { MetadataPanel } from '../../src/editor/components/MetadataPanel';

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

// Stub the heavy editor modules so the test does not pull @wordpress/core-data
// → block-editor → parsel-js (untransformed ESM). useEntityProp is replaced
// with a real useState-backed implementation per test so commits re-render the
// panel the way entity edits do.
const mockUseEntityProp = jest.fn();
jest.mock( '@wordpress/core-data', () => ( {
	useEntityProp: ( ...args ) => mockUseEntityProp( ...args ),
} ) );

// The panel asks the required-metadata gate which of its rows a move is being
// held for, and the gate reads the post's edited meta out of the editor store.
// Only the store NAME is needed here — `useSelect` is stubbed below, so the
// selector is never reached — and the real package pulls the whole block
// editor in behind it.
jest.mock( '@wordpress/editor', () => ( { store: 'core/editor' } ) );

// Keep the real @wordpress/data surface (rich-text registers a store through
// it when @wordpress/components loads) and replace only useSelect, which the
// panel uses to read the plugin store. The Proxy defers property reads until
// after the package finishes its own (circular) initialization — an eager
// `...spread` here evaluates its getters mid-init and explodes.
const mockUseSelect = jest.fn();
jest.mock( '@wordpress/data', () => {
	const actual = jest.requireActual( '@wordpress/data' );
	return new Proxy( actual, {
		get( target, prop, receiver ) {
			if ( prop === 'useSelect' ) {
				return ( ...args ) => mockUseSelect( ...args );
			}
			return Reflect.get( target, prop, receiver );
		},
	} );
} );

jest.mock( '../../src/editor/store', () => ( {
	STORE_NAME: 'vip-workflow',
} ) );

const FIELDS = [
	{
		key: 'headline',
		meta_key: 'vw_headline',
		label: 'Headline',
		type: 'text',
		required: true,
	},
	{
		key: 'notes',
		meta_key: 'vw_notes',
		label: 'Notes',
		type: 'textarea',
		required: false,
	},
	{
		key: 'section',
		meta_key: 'vw_section',
		label: 'Section',
		type: 'select',
		required: false,
		options: [ 'News', 'Feature' ],
	},
	{
		key: 'deadline',
		meta_key: 'vw_deadline',
		label: 'Deadline',
		type: 'date',
		required: false,
	},
	{
		key: 'photographer',
		meta_key: 'vw_photographer',
		label: 'Photographer',
		type: 'user',
		required: false,
	},
];

// The meta object the stateful useEntityProp mock starts from, and a mirror
// of its latest value so tests can assert exactly what was committed.
let initialMeta;
let latestMeta;

function useMockMeta() {
	const [ meta, setMeta ] = useState( initialMeta );
	latestMeta = meta;
	return [ meta, setMeta ];
}

/**
 * A publish edge the server is holding for the sequence's required fields.
 *
 * `_locked_code` is what marks it as the one lock the editor may re-judge; the
 * panel reads it to decide which of its rows a move is waiting on.
 */
const HELD_PUBLISH_EDGE = {
	to: 'published',
	label: 'Publish',
	_locked: true,
	_locked_code: 'required_fields_missing',
	_locked_reason: 'Required fields are empty: Headline',
};

/**
 * Point the panel at a set of fields and starting meta, then render it.
 *
 * Both consumers of the plugin store are answered from one object here, the way
 * they are answered from one payload in the browser: the panel reads
 * `metadataFields`/`postType`, and the required-metadata gate reads
 * `metadataFields`/`meta`/`storedTransitions`. `meta` is threaded live off the
 * stateful useEntityProp stand-in, so committing a value moves the gate's
 * answer the way an entity edit does.
 *
 * @param {Array}  metadataFields Sequence metadata field definitions.
 * @param {Object} meta           Starting post meta values.
 * @param {Array}  transitions    The stage's ways out, as the status endpoint
 *                                served them. Empty by default: nothing is
 *                                being held, so nothing is blocking.
 * @return {Object} RTL render result.
 */
function renderPanel( metadataFields, meta = {}, transitions = [] ) {
	initialMeta = meta;
	latestMeta = meta;
	mockUseSelect.mockImplementation( () => ( {
		metadataFields,
		postType: 'post',
		meta: latestMeta,
		storedTransitions: transitions,
	} ) );
	mockUseEntityProp.mockImplementation( useMockMeta );
	return render( <MetadataPanel /> );
}

/**
 * Default assignable-users responses: an include= lookup resolves ids 7 and
 * 1; the unfiltered list returns both users.
 */
function mockUsersEndpoint() {
	const users = [
		{ id: 1, name: 'Admin' },
		{ id: 7, name: 'Jane Doe' },
	];
	apiFetch.mockImplementation( ( { path } ) => {
		const match = path.match( /include=(\d+)/ );
		if ( match ) {
			return Promise.resolve(
				users.filter( ( user ) => String( user.id ) === match[ 1 ] )
			);
		}
		return Promise.resolve( users );
	} );
}

afterEach( () => {
	jest.clearAllMocks();
} );

describe( 'MetadataPanel rows', () => {
	it( 'renders nothing when the active sequence declares no fields', () => {
		const { container } = renderPanel( [] );
		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'renders a label + value row for every field type', async () => {
		mockUsersEndpoint();
		renderPanel( FIELDS, {
			vw_headline: 'Save the whales',
			vw_notes: 'Deep dive',
			vw_section: 'Feature',
			vw_deadline: '2026-09-01',
			vw_photographer: 7,
		} );

		// Labels, with the required-field asterisk kept on Headline.
		expect( screen.getByText( 'Headline *' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Notes' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Section' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Deadline' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Photographer' ) ).toBeInTheDocument();

		// Values render as popover triggers, closed by default. Required
		// fields carry the required signal in the accessible name — the
		// visible asterisk sits on an unassociated label.
		const headline = screen.getByRole( 'button', {
			name: 'Change Headline: Save the whales (required)',
		} );
		expect( headline ).toHaveAttribute( 'aria-expanded', 'false' );
		expect( headline ).toHaveTextContent( 'Save the whales' );
		expect(
			screen.getByRole( 'button', { name: 'Change Notes: Deep dive' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Change Section: Feature' } )
		).toBeInTheDocument();
		// The date renders through the site date format, not as raw Y-m-d.
		expect(
			screen.getByRole( 'button', {
				name: 'Change Deadline: September 1, 2026',
			} )
		).toBeInTheDocument();
		// The user id resolves to a display name for the trigger.
		expect(
			await screen.findByRole( 'button', {
				name: 'Change Photographer: Jane Doe',
			} )
		).toBeInTheDocument();
	} );

	it( 'shows an honest empty affordance per type', () => {
		renderPanel( FIELDS );

		expect(
			screen.getByRole( 'button', { name: 'Set Headline (required)' } )
		).toHaveTextContent( 'Add text' );
		expect(
			screen.getByRole( 'button', { name: 'Set Notes' } )
		).toHaveTextContent( 'Add text' );
		expect(
			screen.getByRole( 'button', { name: 'Set Section' } )
		).toHaveTextContent( 'Choose an option' );
		expect(
			screen.getByRole( 'button', { name: 'Set Deadline' } )
		).toHaveTextContent( 'Choose a date' );
		expect(
			screen.getByRole( 'button', { name: 'Set Photographer' } )
		).toHaveTextContent( 'Assign a user' );
		// No fetch fires for an unset user field.
		expect( apiFetch ).not.toHaveBeenCalled();
	} );

	// The transition guard refuses a field whose value trims to nothing, and
	// `Sequence::metadata_value_is_empty()` is the one rule that decides it.
	// These pin the JS half of that rule: if a row ever renders a whitespace
	// answer as filled, the reader sees a completed field and is refused anyway.
	it( 'reads a whitespace-only answer as empty, the way the server does', () => {
		renderPanel( FIELDS, {
			vw_headline: '   ',
			vw_notes: '\n\t',
			vw_deadline: '  ',
			vw_photographer: 0,
		} );

		expect(
			screen.getByRole( 'button', { name: 'Set Headline (required)' } )
		).toHaveTextContent( 'Add text' );
		expect(
			screen.getByRole( 'button', { name: 'Set Notes' } )
		).toHaveTextContent( 'Add text' );
		expect(
			screen.getByRole( 'button', { name: 'Set Deadline' } )
		).toHaveTextContent( 'Choose a date' );
		expect(
			screen.getByRole( 'button', { name: 'Set Photographer' } )
		).toHaveTextContent( 'Assign a user' );
	} );

	it( 'text: opens a textbox, and Enter commits, closes, and shows the value', async () => {
		renderPanel( [ FIELDS[ 0 ] ] );

		const trigger = screen.getByRole( 'button', {
			name: 'Set Headline (required)',
		} );
		fireEvent.click( trigger );
		expect( trigger ).toHaveAttribute( 'aria-expanded', 'true' );

		const input = screen.getByRole( 'textbox' );
		fireEvent.change( input, { target: { value: 'Hello' } } );

		// Enter during IME composition picks a candidate, not a commit: the
		// popover must stay open.
		fireEvent.keyDown( input, { key: 'Enter', isComposing: true } );
		expect( screen.getByRole( 'textbox' ) ).toBeInTheDocument();

		fireEvent.keyDown( input, { key: 'Enter' } );

		await waitFor( () =>
			expect( screen.queryByRole( 'textbox' ) ).not.toBeInTheDocument()
		);
		expect(
			screen.getByRole( 'button', {
				name: 'Change Headline: Hello (required)',
			} )
		).toHaveTextContent( 'Hello' );
		expect( latestMeta.vw_headline ).toBe( 'Hello' );
	} );

	it( 'required: the trigger accessible name and popover header both spell out the signal', () => {
		renderPanel( [ FIELDS[ 0 ] ] );

		// The visible asterisk stays on the row label…
		expect( screen.getByText( 'Headline *' ) ).toBeInTheDocument();

		// …while the trigger's accessible name spells the signal out.
		const trigger = screen.getByRole( 'button', {
			name: 'Set Headline (required)',
		} );
		fireEvent.click( trigger );

		// The popover announces as a dialog named for the field — the
		// explicit role, since Popover's own div is role-less and a bare
		// aria-label there is ARIA assistive tech ignores.
		expect(
			screen.getByRole( 'dialog', { name: 'Headline' } )
		).toBeInTheDocument();

		// The popover header title carries it too.
		expect( screen.getByText( 'Headline (required)' ) ).toBeInTheDocument();
	} );

	it( 'textarea: opens a multiline textbox; Close commits the typed value', async () => {
		renderPanel( [ FIELDS[ 1 ] ] );

		fireEvent.click( screen.getByRole( 'button', { name: 'Set Notes' } ) );

		const textarea = screen.getByRole( 'textbox' );
		expect( textarea.tagName ).toBe( 'TEXTAREA' );
		fireEvent.change( textarea, { target: { value: 'Deep dive' } } );

		fireEvent.click( screen.getByRole( 'button', { name: 'Close' } ) );

		await waitFor( () =>
			expect( screen.queryByRole( 'textbox' ) ).not.toBeInTheDocument()
		);
		expect(
			screen.getByRole( 'button', { name: 'Change Notes: Deep dive' } )
		).toBeInTheDocument();
		expect( latestMeta.vw_notes ).toBe( 'Deep dive' );
	} );

	it( 'select: opens the options list, and choosing commits and closes', async () => {
		renderPanel( [ FIELDS[ 2 ] ] );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Set Section' } )
		);

		const select = screen.getByRole( 'combobox' );
		expect( select.tagName ).toBe( 'SELECT' );
		fireEvent.change( select, { target: { value: 'Feature' } } );

		await waitFor( () =>
			expect( screen.queryByRole( 'combobox' ) ).not.toBeInTheDocument()
		);
		expect(
			screen.getByRole( 'button', { name: 'Change Section: Feature' } )
		).toBeInTheDocument();
		expect( latestMeta.vw_section ).toBe( 'Feature' );
	} );

	it( 'date: opens a calendar, and picking a day commits Y-m-d and closes', async () => {
		renderPanel( [ FIELDS[ 3 ] ], { vw_deadline: '2026-08-05' } );

		fireEvent.click(
			screen.getByRole( 'button', {
				name: 'Change Deadline: August 5, 2026',
			} )
		);

		expect(
			screen.getByRole( 'application', { name: 'Calendar' } )
		).toBeInTheDocument();

		fireEvent.click(
			screen.getByRole( 'button', { name: /August 20, 2026/ } )
		);

		await waitFor( () =>
			expect(
				screen.queryByRole( 'application', { name: 'Calendar' } )
			).not.toBeInTheDocument()
		);
		expect(
			screen.getByRole( 'button', {
				name: 'Change Deadline: August 20, 2026',
			} )
		).toBeInTheDocument();
		// The stored shape stays exactly what the old date input wrote.
		expect( latestMeta.vw_deadline ).toBe( '2026-08-20' );
	} );

	it( 'date: Remove clears the value and restores the empty affordance', async () => {
		renderPanel( [ FIELDS[ 3 ] ], { vw_deadline: '2026-08-05' } );

		fireEvent.click(
			screen.getByRole( 'button', {
				name: 'Change Deadline: August 5, 2026',
			} )
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Remove' } ) );

		await waitFor( () =>
			expect(
				screen.queryByRole( 'application', { name: 'Calendar' } )
			).not.toBeInTheDocument()
		);
		expect(
			screen.getByRole( 'button', { name: 'Set Deadline' } )
		).toHaveTextContent( 'Choose a date' );
		expect( latestMeta.vw_deadline ).toBe( '' );
	} );

	it( 'user: opens the user search, and picking a user commits and closes', async () => {
		mockUsersEndpoint();
		renderPanel( [ FIELDS[ 4 ] ] );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Set Photographer' } )
		);

		// The popover holds the searchable user combobox; it expands its
		// inline suggestion list on focus.
		const combobox = await screen.findByRole( 'combobox' );
		fireEvent.focus( combobox );
		fireEvent.change( combobox, { target: { value: 'Jane' } } );

		fireEvent.click(
			await screen.findByRole( 'option', { name: 'Jane Doe' } )
		);

		await waitFor( () =>
			expect( screen.queryByRole( 'combobox' ) ).not.toBeInTheDocument()
		);
		expect(
			await screen.findByRole( 'button', {
				name: 'Change Photographer: Jane Doe',
			} )
		).toBeInTheDocument();
		expect( latestMeta.vw_photographer ).toBe( 7 );
	} );

	it( 'user: clearing the selection commits 0, never an empty string', async () => {
		// A `user` field is the one metadata type registered as `integer` meta
		// with `show_in_rest`, and core validates a REST meta value against that
		// registered schema before the field's `absint` sanitiser runs. An empty
		// string is therefore rejected outright — "is not of type integer" — and
		// the post cannot be saved at all. 0 is what the read side already means
		// by "no user", so it is what clearing writes.
		mockUsersEndpoint();
		renderPanel( [ FIELDS[ 4 ] ], { vw_photographer: 7 } );

		fireEvent.click(
			await screen.findByRole( 'button', {
				name: 'Change Photographer: Jane Doe',
			} )
		);

		const combobox = await screen.findByRole( 'combobox' );
		fireEvent.focus( combobox );

		fireEvent.click(
			await screen.findByRole( 'option', { name: '— Select —' } )
		);

		await waitFor( () =>
			expect( screen.queryByRole( 'combobox' ) ).not.toBeInTheDocument()
		);
		expect( latestMeta.vw_photographer ).toBe( 0 );
		expect( latestMeta.vw_photographer ).not.toBe( '' );
	} );

	it( 'user: a failed lookup shows the neutral id, not "(unavailable)"', async () => {
		apiFetch.mockRejectedValue( new Error( 'Service unavailable' ) );
		renderPanel( [ FIELDS[ 4 ] ], { vw_photographer: 7 } );

		expect(
			await screen.findByRole( 'button', {
				name: 'Change Photographer: User #7',
			} )
		).toBeInTheDocument();
		expect( screen.queryByText( /unavailable/ ) ).not.toBeInTheDocument();
	} );

	// =====================================================================
	// Required and blocking
	// =====================================================================

	/**
	 * The row a move is waiting on wears the state core gives a required form
	 * field it is waiting on: the control reports itself invalid, and the
	 * message saying why is associated with it rather than left floating.
	 */
	it( 'marks a required field that is holding a move as invalid', () => {
		renderPanel( [ FIELDS[ 0 ] ], {}, [ HELD_PUBLISH_EDGE ] );

		const trigger = screen.getByRole( 'button', {
			name: 'Set Headline (required)',
		} );

		expect( trigger ).toHaveAttribute( 'aria-invalid', 'true' );

		const message = screen.getByText( 'Required to publish.' );
		expect( trigger ).toHaveAttribute(
			'aria-describedby',
			message.getAttribute( 'id' )
		);
	} );

	/**
	 * The narrowing. The field is required and empty, but the stage offers no
	 * move the gate is holding — so there is nothing for the author to be stuck
	 * on, and the asterisk carries the whole of what is owed.
	 */
	it( 'leaves a required field alone when no move is being held', () => {
		renderPanel( [ FIELDS[ 0 ] ], {} );

		const trigger = screen.getByRole( 'button', {
			name: 'Set Headline (required)',
		} );

		expect( trigger ).not.toHaveAttribute( 'aria-invalid' );
		expect(
			screen.queryByText( 'Required to publish.' )
		).not.toBeInTheDocument();
		// The asterisk still says the field will be wanted.
		expect( screen.getByText( 'Headline *' ) ).toBeInTheDocument();
	} );

	/**
	 * An optional field is never the reason a move is held, whatever else is.
	 */
	it( 'never marks an optional field', () => {
		renderPanel( [ FIELDS[ 0 ], FIELDS[ 1 ] ], {}, [ HELD_PUBLISH_EDGE ] );

		expect(
			screen.getByRole( 'button', { name: 'Set Notes' } )
		).not.toHaveAttribute( 'aria-invalid' );
	} );

	/**
	 * And the state clears as soon as the author answers — from the edit alone,
	 * with nothing saved and no payload re-read. Before this, the row and the
	 * held move both went on insisting the field was empty until the post was
	 * saved AND the page reloaded.
	 */
	it( 'clears the invalid state the moment a value is committed', () => {
		renderPanel( [ FIELDS[ 0 ] ], {}, [ HELD_PUBLISH_EDGE ] );

		const trigger = screen.getByRole( 'button', {
			name: 'Set Headline (required)',
		} );
		fireEvent.click( trigger );

		const input = screen.getByRole( 'textbox' );
		fireEvent.change( input, { target: { value: 'Save the whales' } } );
		fireEvent.keyDown( input, { key: 'Enter' } );

		expect(
			screen.getByRole( 'button', {
				name: 'Change Headline: Save the whales (required)',
			} )
		).not.toHaveAttribute( 'aria-invalid' );
		expect(
			screen.queryByText( 'Required to publish.' )
		).not.toBeInTheDocument();
	} );

	it( 'user: closing the popover after a failed lookup re-resolves the name', async () => {
		// The first include= lookup fails; every later call succeeds.
		let failedOnce = false;
		apiFetch.mockImplementation( ( { path } ) => {
			if ( path.includes( 'include=' ) && ! failedOnce ) {
				failedOnce = true;
				return Promise.reject( new Error( 'Service unavailable' ) );
			}
			return Promise.resolve( [ { id: 7, name: 'Jane Doe' } ] );
		} );
		renderPanel( [ FIELDS[ 4 ] ], { vw_photographer: 7 } );

		const trigger = await screen.findByRole( 'button', {
			name: 'Change Photographer: User #7',
		} );

		// Open and close without picking anyone: the recovered network heals
		// the trigger.
		fireEvent.click( trigger );
		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Close' } )
		);

		expect(
			await screen.findByRole( 'button', {
				name: 'Change Photographer: Jane Doe',
			} )
		).toBeInTheDocument();
	} );
} );
