/**
 * Transition input capture through the sidebar popover.
 *
 * A transition that requires input used to raise a full-screen modal over the
 * whole editor. It now opens a popover anchored to the rail transition that
 * asked for it, following the document-sidebar meta pattern the metadata rows
 * use — header naming the action, Close button, inputs, then the committing
 * action.
 *
 * What must hold, and what these tests pin:
 *
 * - Clicking a transition that requires input opens the popover, not a modal.
 * - Committing fires the transition with exactly the payload the modals sent
 *   (assignment `meta_key` plus optional `_notes` keys).
 * - A stored note is not asked for. Notes are no longer collected, so a
 *   transition still carrying one moves without it.
 * - Dismissing (Close, Escape) abandons the transition: nothing fires.
 * - Both assignment branches survive: user (searchable combobox) and role
 *   (role list).
 * - An assignment naming a type with no picker — `agent`, withdrawn from the
 *   sequence editor, or anything an out-of-tree filter registered — says so
 *   and commits nothing. It used to open a placeholder that assigned the
 *   literal id 'default' and moved the post anyway.
 * - Focus moves into the popover on open and returns to the trigger on close.
 *
 * @package
 */

import {
	render,
	screen,
	fireEvent,
	waitFor,
	act,
} from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

// See workflow-panel-transition-busy.test.js for why these are stubbed:
// ESM-only deps the panel names but does not otherwise exercise.
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

register(
	createReduxStore( 'core/editor', {
		reducer: ( state = {} ) => state,
		selectors: {
			getEditedPostAttribute: () => 'draft',
			getCurrentPostAttribute: () => 'draft',
			isEditedPostDirty: () => false,
		},
		actions: { savePost: () => ( { type: 'NOOP' } ) },
	} )
);

// A stable reference: hydrating a fresh array per test trips useSelect's
// equal-state-different-value warning in the assignment popover.
const ROLES = [
	{ slug: 'editor', name: 'Editor' },
	{ slug: 'author', name: 'Author' },
];

/*
 * The real editor store, seeded per test: the panel reads its workflow state
 * from it rather than holding a copy, so a stand-in would test the stand-in.
 */
// eslint-disable-next-line import/first
import { seedEditorStore } from './helpers/editor-store';
// eslint-disable-next-line import/first
import { WorkflowPanel } from '../../src/editor/components/WorkflowPanel';

const STATUS_PATH = '/vip-workflows/v1/workflow/post/42/status';
const TRANSITION_PATH = '/vip-workflows/v1/workflow/post/42/transition';

const USERS = [
	{ id: 1, name: 'Admin' },
	{ id: 7, name: 'Jane Doe' },
];

/**
 * A transition requiring an assignment, as the REST route delivers it.
 *
 * Not `required` unless asked for: almost no stored sequence has ever
 * toggled that on (it did nothing until now), so the common, real-world
 * case — an optional assignment — is this fixture's default rather than
 * something every other test in this file has to opt into.
 *
 * @param {string} assigneeType     'user' or 'role' — or a type with no picker.
 * @param {Object} [inputOverrides] Extra/overriding keys for the assignment
 *                                  input, e.g. `{ required: true }`.
 * @return {Object} A transition.
 */
function assignmentTransition( assigneeType, inputOverrides = {} ) {
	return {
		to: 'assigned',
		label: 'Assign reviewer',
		status_info: { key: 'assigned', label: 'Assigned' },
		inputs: [
			{
				type: 'assignment',
				assignee_type: assigneeType,
				meta_key: 'wfp_a1_assignee',
				...inputOverrides,
			},
		],
	};
}

/**
 * Render the panel with the given transitions and standard route mocks.
 *
 * @param {Array}  transitions         Transitions in the status payload.
 * @param {Array}  transitionResponses Responses for successive transition
 *                                     POSTs, consumed in order; when the queue
 *                                     is exhausted the standard success payload
 *                                     answers.
 * @param {Object} statusOverrides     Overrides for the initial status payload.
 */
async function renderWith(
	transitions,
	transitionResponses = [],
	statusOverrides = {}
) {
	const queued = [ ...transitionResponses ];

	apiFetch.mockImplementation( ( { path, method } ) => {
		if ( path === STATUS_PATH && method !== 'POST' ) {
			return Promise.resolve( {
				has_workflow: true,
				sequence: { id: 1, name: 'Input Flow' },
				current: {
					key: 'draft',
					label: 'Draft',
					color: '#666',
					is_terminal: false,
				},
				transitions,
				can_remove: false,
				...statusOverrides,
			} );
		}
		if ( path.startsWith( '/vip-workflows/v1/abilities' ) ) {
			return Promise.resolve( [] );
		}
		if ( path.startsWith( '/vip-workflows/v1/assignable-users' ) ) {
			return Promise.resolve( USERS );
		}
		if ( path === TRANSITION_PATH && method === 'POST' ) {
			return Promise.resolve(
				queued.shift() || {
					has_workflow: true,
					sequence: { id: 1, name: 'Input Flow' },
					current: { key: 'review', label: 'Review' },
					transitions: [],
					can_remove: false,
				}
			);
		}
		return Promise.resolve( {} );
	} );

	render( <WorkflowPanel /> );

	await waitFor( () =>
		expect(
			screen.getByRole( 'button', { name: transitions[ 0 ].label } )
		).toBeInTheDocument()
	);
}

/**
 * Every transition POST the panel fired, in order. Asserting against the
 * whole array pins the count too — a commit must fire exactly one request,
 * and a dismissal none.
 *
 * @return {Array<Object>} The request bodies.
 */
function firedTransitions() {
	return apiFetch.mock.calls
		.filter(
			( [ request ] ) =>
				request.method === 'POST' && request.path === TRANSITION_PATH
		)
		.map( ( [ request ] ) => request.data );
}

/**
 * Open the input popover for a transition, focusing its trigger first the way
 * a real click does (jsdom's click() does not focus).
 *
 * @param {string} label The transition button's label.
 * @return {HTMLElement} The trigger button.
 */
async function openPopoverFor( label ) {
	const trigger = screen.getByRole( 'button', { name: label } );
	trigger.focus();
	await act( async () => {
		fireEvent.click( trigger );
	} );
	return trigger;
}

/**
 * The mounted popover element.
 *
 * @return {?HTMLElement} The popover.
 */
function popover() {
	return document.querySelector( '.vip-workflows-transition-popover' );
}

/*
 * jsdom lays nothing out, so every element reports zero size and
 * `@wordpress/dom`'s tabbable finder — which the popover's focus-on-mount
 * relies on — sees nothing focusable. Give elements a nominal rect for this
 * suite so the focus behavior under test actually runs.
 */
const realGetClientRects = Element.prototype.getClientRects;
beforeAll( () => {
	Element.prototype.getClientRects = function () {
		return [
			{ top: 0, left: 0, bottom: 10, right: 10, width: 10, height: 10 },
		];
	};
} );
afterAll( () => {
	Element.prototype.getClientRects = realGetClientRects;
} );

beforeEach( () => {
	seedEditorStore( { roles: ROLES } );
} );

afterEach( () => {
	apiFetch.mockReset();
} );

describe( 'WorkflowPanel transition input popover', () => {
	it( 'opens a side-anchored popover, not a modal, named for the action', async () => {
		await renderWith( [ assignmentTransition( 'role' ) ] );
		await openPopoverFor( 'Assign reviewer' );

		// The popover announces as a named dialog — the role the Modal had,
		// which a bare aria-label on a role-less div would not restore.
		expect(
			screen.getByRole( 'dialog', { name: 'Assign reviewer' } )
		).toBe( popover() );

		// No full-screen modal.
		expect(
			document.querySelector( '.components-modal__screen-overlay' )
		).not.toBeInTheDocument();

		// Header: the action's name and a labelled Close button.
		expect(
			screen.getByRole( 'button', { name: 'Close' } )
		).toBeInTheDocument();
	} );

	it( 'moves without asking for a note a stored transition still carries', async () => {
		await renderWith( [
			{
				to: 'review',
				label: 'Send to Review',
				status_info: { key: 'review', label: 'Review' },
				inputs: [
					{
						type: 'textarea',
						note_id: 'n1',
						note_name: 'Editor note',
						required: true,
					},
				],
			},
		] );
		await openPopoverFor( 'Send to Review' );

		expect( popover() ).not.toBeInTheDocument();
		expect( firedTransitions() ).toEqual( [
			{ to_status: 'review', acknowledge_warnings: false },
		] );
	} );

	it( 'abandons the transition on Close — nothing fires', async () => {
		await renderWith( [ assignmentTransition( 'role' ) ] );
		await openPopoverFor( 'Assign reviewer' );

		await act( async () => {
			fireEvent.click( screen.getByRole( 'button', { name: 'Close' } ) );
		} );

		expect( popover() ).not.toBeInTheDocument();
		expect( firedTransitions() ).toEqual( [] );
	} );

	it( 'abandons the transition on Escape — nothing fires', async () => {
		await renderWith( [ assignmentTransition( 'role' ) ] );
		await openPopoverFor( 'Assign reviewer' );

		await act( async () => {
			fireEvent.keyDown(
				screen.getByRole( 'button', { name: 'Editor' } ),
				{
					key: 'Escape',
					keyCode: 27,
				}
			);
		} );

		expect( popover() ).not.toBeInTheDocument();
		expect( firedTransitions() ).toEqual( [] );
	} );

	it( 'abandons the transition when focus moves outside — nothing fires', async () => {
		await renderWith( [ assignmentTransition( 'role' ) ] );
		await openPopoverFor( 'Assign reviewer' );

		await waitFor( () =>
			expect( popover().contains( document.activeElement ) ).toBe( true )
		);

		// A real focus move to an element outside the popover: jsdom dispatches
		// focusout, which the dialog's focus-outside handling reads exactly as
		// an outside click does.
		await act( async () => {
			screen.getByRole( 'button', { name: 'Show history' } ).focus();
		} );

		await waitFor( () => expect( popover() ).not.toBeInTheDocument() );
		expect( firedTransitions() ).toEqual( [] );
	} );

	it( 'the warnings acknowledgement re-sends the captured input', async () => {
		// The first POST answers warnings_pending; the acknowledge POST
		// succeeds. The input captured by the popover must ride BOTH requests
		// — the server consumes it only after the warning gates, so an
		// acknowledge without it completes the move with the assignment
		// silently absent.
		await renderWith(
			[ assignmentTransition( 'role' ) ],
			[
				{
					warnings_pending: true,
					soft_warnings: [ { message: 'Slug is short.' } ],
				},
			]
		);
		await openPopoverFor( 'Assign reviewer' );

		await act( async () => {
			fireEvent.click( screen.getByRole( 'button', { name: 'Editor' } ) );
		} );
		await act( async () => {
			fireEvent.click( screen.getByRole( 'button', { name: 'Submit' } ) );
		} );

		// The warnings dialog stands between the author and the move.
		expect( screen.getByText( 'Slug is short.' ) ).toBeInTheDocument();
		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Continue' } )
			);
		} );

		const inputData = {
			wfp_a1_assignee: 'editor',
			wfp_a1_assignee__name: 'Assignee',
		};
		expect( firedTransitions() ).toEqual( [
			{
				to_status: 'assigned',
				acknowledge_warnings: false,
				input_data: inputData,
			},
			{
				to_status: 'assigned',
				acknowledge_warnings: true,
				input_data: inputData,
			},
		] );
	} );

	it( 'lets a person acknowledge the exact warning-held agent route', async () => {
		const warnings = [
			{
				code: 'soft_check_failed',
				message: 'An editor should confirm this move.',
			},
		];

		await renderWith( [ assignmentTransition( 'role' ) ], [], {
			agent_pending: false,
			agent_job: {
				status: 'warnings_pending',
				to_status: 'review',
				outcome: 'error',
				soft_warnings: warnings,
				comment: 'The agent could not complete its review.',
			},
		} );

		expect(
			screen.getByRole( 'dialog', { name: 'Warnings detected' } )
		).toBeInTheDocument();
		expect(
			screen.getByText( 'An editor should confirm this move.' )
		).toBeInTheDocument();
		expect(
			screen.queryByText( 'The AI agent could not finish.' )
		).not.toBeInTheDocument();

		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Continue' } )
			);
		} );

		expect( firedTransitions() ).toEqual( [
			{
				to_status: 'review',
				acknowledge_warnings: true,
				comment: 'The agent could not complete its review.',
			},
		] );
	} );

	it( 'moves focus into the popover and returns it to the trigger on close', async () => {
		await renderWith( [ assignmentTransition( 'role' ) ] );
		const trigger = await openPopoverFor( 'Assign reviewer' );

		await waitFor( () =>
			expect( popover().contains( document.activeElement ) ).toBe( true )
		);

		await act( async () => {
			fireEvent.click( screen.getByRole( 'button', { name: 'Close' } ) );
		} );

		await waitFor( () => expect( trigger ).toHaveFocus() );
	} );

	it( 'user assignment: the searchable combobox commits the user id, with notes', async () => {
		await renderWith( [ assignmentTransition( 'user' ) ] );
		await openPopoverFor( 'Assign reviewer' );

		// The combobox renders once the assignable users load; its suggestion
		// list is inline, so it opens inside the popover.
		const combobox = await screen.findByRole( 'combobox' );
		await act( async () => {
			fireEvent.focus( combobox );
			fireEvent.change( combobox, { target: { value: 'Jane' } } );
		} );
		await act( async () => {
			fireEvent.click(
				await screen.findByRole( 'option', { name: 'Jane Doe' } )
			);
		} );

		// The notes step follows the selection, headed by its own label. Role
		// `textbox`, because the popover itself also wears the step's name as
		// its aria-label.
		const notes = await screen.findByRole( 'textbox', {
			name: 'Notes (optional)',
		} );
		await act( async () => {
			fireEvent.change( notes, { target: { value: 'Please review' } } );
		} );
		await act( async () => {
			fireEvent.click( screen.getByRole( 'button', { name: 'Submit' } ) );
		} );

		expect( firedTransitions() ).toEqual( [
			{
				to_status: 'assigned',
				acknowledge_warnings: false,
				input_data: {
					wfp_a1_assignee: 7,
					wfp_a1_assignee__name: 'Assignee',
					wfp_a1_assignee_notes: 'Please review',
					wfp_a1_assignee_notes__name: 'Notes',
				},
			},
		] );
	} );

	it( 'role assignment: lists roles, selecting one marks it, and empty notes are omitted', async () => {
		await renderWith( [
			assignmentTransition( 'role', { required: true } ),
		] );
		await openPopoverFor( 'Assign reviewer' );

		// The role list and the notes field render together from the start —
		// there is no separate step to reach. The label says a role is
		// required, matching the fixture's own `required: true`.
		expect(
			screen.getByText( 'Select a role', { exact: true } )
		).toBeInTheDocument();
		const editorButton = screen.getByRole( 'button', { name: 'Editor' } );
		expect( editorButton ).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Author' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'textbox', { name: 'Notes (optional)' } )
		).toBeInTheDocument();

		// Required, and nothing is selected yet, so committing is not yet
		// possible.
		expect(
			screen.getByRole( 'button', { name: 'Submit' } )
		).toBeDisabled();

		// Picking a role marks it selected rather than committing or
		// navigating away, so another role can still be picked before Submit.
		await act( async () => {
			fireEvent.click( editorButton );
		} );
		expect( editorButton ).toHaveAttribute( 'aria-pressed', 'true' );
		expect( firedTransitions() ).toEqual( [] );

		// Required means no Clear action — there is no state this popover
		// can submit that un-assigns the post.
		expect(
			screen.queryByRole( 'button', { name: 'Clear' } )
		).not.toBeInTheDocument();

		// Committing without notes sends the assignment and the name its
		// history row reads — not the minted key.
		await act( async () => {
			fireEvent.click( screen.getByRole( 'button', { name: 'Submit' } ) );
		} );

		expect( firedTransitions() ).toEqual( [
			{
				to_status: 'assigned',
				acknowledge_warnings: false,
				input_data: {
					wfp_a1_assignee: 'editor',
					wfp_a1_assignee__name: 'Assignee',
				},
			},
		] );
	} );

	it( 'role assignment: an optional assignment says so, and Submit works with nothing picked', async () => {
		await renderWith( [ assignmentTransition( 'role' ) ] );
		await openPopoverFor( 'Assign reviewer' );

		// The field's own label names the assignment optional — the one
		// place this popover currently says so.
		expect(
			screen.getByText( 'Select a role (optional)', { exact: true } )
		).toBeInTheDocument();

		// Optional: Submit is available even before anything is picked, and
		// there is nothing to Clear yet.
		expect(
			screen.getByRole( 'button', { name: 'Submit' } )
		).toBeEnabled();
		expect(
			screen.queryByRole( 'button', { name: 'Clear' } )
		).not.toBeInTheDocument();

		await act( async () => {
			fireEvent.click( screen.getByRole( 'button', { name: 'Submit' } ) );
		} );

		// Submitted with no assignee: the meta_key rides as an explicit
		// empty value (not omitted), which is how the server tells "assign
		// to no one" apart from "this transition carries no assignment
		// input at all".
		expect( firedTransitions() ).toEqual( [
			{
				to_status: 'assigned',
				acknowledge_warnings: false,
				input_data: {
					wfp_a1_assignee: '',
					wfp_a1_assignee__name: 'Assignee',
				},
			},
		] );
	} );

	it( 'role assignment: Clear un-assigns a role the post already carries', async () => {
		await renderWith( [ assignmentTransition( 'role' ) ], [], {
			assignments: {
				wfp_a1_assignee: { value: 'editor', type: 'role' },
			},
		} );
		await openPopoverFor( 'Assign reviewer' );

		const editorButton = screen.getByRole( 'button', { name: 'Editor' } );
		expect( editorButton ).toHaveAttribute( 'aria-pressed', 'true' );

		await act( async () => {
			fireEvent.click( screen.getByRole( 'button', { name: 'Clear' } ) );
		} );

		// Clearing deselects — no role reads as pressed any more — and
		// Submit stays available, since the assignment is optional.
		expect( editorButton ).toHaveAttribute( 'aria-pressed', 'false' );
		expect(
			screen.queryByRole( 'button', { name: 'Clear' } )
		).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Submit' } )
		).toBeEnabled();

		await act( async () => {
			fireEvent.click( screen.getByRole( 'button', { name: 'Submit' } ) );
		} );

		expect( firedTransitions() ).toEqual( [
			{
				to_status: 'assigned',
				acknowledge_warnings: false,
				input_data: {
					wfp_a1_assignee: '',
					wfp_a1_assignee__name: 'Assignee',
				},
			},
		] );
	} );

	it( "preselects the post's existing role assignee for this input's slot", async () => {
		await renderWith( [ assignmentTransition( 'role' ) ], [], {
			assignments: {
				wfp_a1_assignee: { value: 'editor', type: 'role' },
			},
		} );
		await openPopoverFor( 'Assign reviewer' );

		// The post is already assigned to Editor — the popover shows that
		// rather than asking the user to re-pick from a blank slate.
		expect(
			screen.getByRole( 'button', { name: 'Editor' } )
		).toHaveAttribute( 'aria-pressed', 'true' );
		expect(
			screen.getByRole( 'button', { name: 'Submit' } )
		).toBeEnabled();

		// Submitting as-is re-sends the existing assignee, e.g. to attach a
		// note to it.
		await act( async () => {
			fireEvent.click( screen.getByRole( 'button', { name: 'Submit' } ) );
		} );

		expect( firedTransitions() ).toEqual( [
			{
				to_status: 'assigned',
				acknowledge_warnings: false,
				input_data: {
					wfp_a1_assignee: 'editor',
					wfp_a1_assignee__name: 'Assignee',
				},
			},
		] );
	} );

	it( 'preselects an existing user assignee though its id was stored as a string', async () => {
		// Stored assignment values pass through sanitize_text_field
		// server-side, so a user id comes back as a numeric string — it
		// must still match the combobox's numeric option id.
		await renderWith( [ assignmentTransition( 'user' ) ], [], {
			assignments: {
				wfp_a1_assignee: { value: '7', type: 'user' },
			},
		} );
		await openPopoverFor( 'Assign reviewer' );

		expect(
			await screen.findByDisplayValue( 'Jane Doe' )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Submit' } )
		).toBeEnabled();
	} );

	/*
	 * `agent` was an authoring option with no picker behind it. Picking it drew
	 * an "Automated task" panel claiming an automated check was about to run,
	 * then committed the literal id 'default' and advanced the post — an
	 * assignment naming no agent, faithfully stored. The option is withdrawn
	 * from the sequence editor, but the server still registers the type and a
	 * stored sequence may already carry one, so the popover has to answer for
	 * it. These pin that it answers honestly and that the placeholder cannot
	 * come back.
	 */
	describe( 'an assignee type with no picker', () => {
		let consoleError;

		beforeEach( () => {
			// The branch reports the bad config to the console as well as to the
			// screen; capture it so the assertion is on purpose, not on noise.
			consoleError = jest
				.spyOn( console, 'error' )
				.mockImplementation( () => {} );
		} );

		afterEach( () => {
			consoleError.mockRestore();
		} );

		it( 'names the problem instead of rendering an empty popover', async () => {
			await renderWith( [ assignmentTransition( 'agent' ) ] );
			await openPopoverFor( 'Assign reviewer' );

			expect(
				screen.getByRole( 'dialog', {
					name: 'Transition misconfigured',
				} )
			).toBe( popover() );
			expect(
				screen.getByText( /assignee of type “agent”/ )
			).toBeInTheDocument();
			expect( consoleError ).toHaveBeenCalledWith(
				expect.stringContaining( 'assignee_type "agent"' )
			);
		} );

		it( 'offers nothing that commits, and fires no transition', async () => {
			await renderWith( [ assignmentTransition( 'agent' ) ] );
			await openPopoverFor( 'Assign reviewer' );

			// The withdrawn placeholder, verb and all.
			expect(
				screen.queryByRole( 'button', { name: 'Start check' } )
			).not.toBeInTheDocument();
			expect(
				screen.queryByText(
					'This transition will trigger an automated check.'
				)
			).not.toBeInTheDocument();

			// Nor any other commit: Close is the only button in the popover.
			expect(
				screen.queryByRole( 'button', { name: 'Submit' } )
			).not.toBeInTheDocument();
			expect(
				Array.from( popover().querySelectorAll( 'button' ) ).map(
					( button ) => button.getAttribute( 'aria-label' )
				)
			).toEqual( [ 'Close' ] );

			expect( firedTransitions() ).toEqual( [] );
		} );

		it( 'names whatever type is stored, not just the withdrawn one', async () => {
			await renderWith( [ assignmentTransition( 'wombat' ) ] );
			await openPopoverFor( 'Assign reviewer' );

			expect(
				screen.getByText( /assignee of type “wombat”/ )
			).toBeInTheDocument();
			expect( firedTransitions() ).toEqual( [] );
		} );
	} );
} );
