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
 *   (`wfp_{note_id}_{slug}` note keys; assignment `meta_key` plus optional
 *   `_notes` keys).
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
 * A transition requiring a textarea note, as the REST route delivers it.
 *
 * @param {Object} inputOverrides Overrides for the input config.
 * @return {Object} A transition.
 */
function noteTransition( inputOverrides = {} ) {
	return {
		to: 'review',
		label: 'Send to Review',
		status_info: { key: 'review', label: 'Review' },
		inputs: [
			{
				type: 'textarea',
				note_id: 'n1',
				note_name: 'Editor note',
				required: false,
				...inputOverrides,
			},
		],
	};
}

/**
 * A transition requiring an assignment, as the REST route delivers it.
 *
 * @param {string} assigneeType 'user' or 'role' — or a type with no picker.
 * @return {Object} A transition.
 */
function assignmentTransition( assigneeType ) {
	return {
		to: 'assigned',
		label: 'Assign reviewer',
		status_info: { key: 'assigned', label: 'Assigned' },
		inputs: [
			{
				type: 'assignment',
				assignee_type: assigneeType,
				meta_key: 'wfp_a1_assignee',
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
		await renderWith( [ noteTransition() ] );
		await openPopoverFor( 'Send to Review' );

		// The popover announces as a named dialog — the role the Modal had,
		// which a bare aria-label on a role-less div would not restore.
		expect( screen.getByRole( 'dialog', { name: 'Send to Review' } ) ).toBe(
			popover()
		);

		// No full-screen modal.
		expect(
			document.querySelector( '.components-modal__screen-overlay' )
		).not.toBeInTheDocument();

		// Header: the action's name and a labelled Close button.
		expect(
			screen.getByRole( 'button', { name: 'Close' } )
		).toBeInTheDocument();

		// The note's input, labelled with the note's name, and the commit
		// action with its kept verb.
		expect( screen.getByLabelText( 'Editor note' ) ).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Submit' } )
		).toBeInTheDocument();
	} );

	it( 'commits the note with exactly the payload the modal sent', async () => {
		await renderWith( [ noteTransition() ] );
		await openPopoverFor( 'Send to Review' );

		fireEvent.change( screen.getByLabelText( 'Editor note' ), {
			target: { value: 'Checked twice' },
		} );
		await act( async () => {
			fireEvent.click( screen.getByRole( 'button', { name: 'Submit' } ) );
		} );

		expect( firedTransitions() ).toEqual( [
			{
				to_status: 'review',
				acknowledge_warnings: false,
				input_data: {
					wfp_n1_editor_note: 'Checked twice',
					wfp_n1_editor_note__name: 'Editor note',
				},
			},
		] );

		// The popover closed with the commit.
		await waitFor( () => expect( popover() ).not.toBeInTheDocument() );
	} );

	it( 'abandons the transition on Close — nothing fires', async () => {
		await renderWith( [ noteTransition() ] );
		await openPopoverFor( 'Send to Review' );

		fireEvent.change( screen.getByLabelText( 'Editor note' ), {
			target: { value: 'Never sent' },
		} );
		await act( async () => {
			fireEvent.click( screen.getByRole( 'button', { name: 'Close' } ) );
		} );

		expect( popover() ).not.toBeInTheDocument();
		expect( firedTransitions() ).toEqual( [] );
	} );

	it( 'abandons the transition on Escape — nothing fires', async () => {
		await renderWith( [ noteTransition() ] );
		await openPopoverFor( 'Send to Review' );

		await act( async () => {
			fireEvent.keyDown( screen.getByLabelText( 'Editor note' ), {
				key: 'Escape',
				keyCode: 27,
			} );
		} );

		expect( popover() ).not.toBeInTheDocument();
		expect( firedTransitions() ).toEqual( [] );
	} );

	it( 'abandons the transition when focus moves outside — nothing fires', async () => {
		await renderWith( [ noteTransition() ] );
		await openPopoverFor( 'Send to Review' );

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

	it( 'refuses an empty required note and stays open', async () => {
		await renderWith( [ noteTransition( { required: true } ) ] );
		await openPopoverFor( 'Send to Review' );

		await act( async () => {
			fireEvent.click( screen.getByRole( 'button', { name: 'Submit' } ) );
		} );

		expect(
			screen.getByText( 'This field is required.' )
		).toBeInTheDocument();
		expect( popover() ).toBeInTheDocument();
		expect( firedTransitions() ).toEqual( [] );
	} );

	it( 'the warnings acknowledgement re-sends the captured input', async () => {
		// The first POST answers warnings_pending; the acknowledge POST
		// succeeds. The input captured by the popover must ride BOTH requests
		// — the server consumes it only after the warning gates, so an
		// acknowledge without it completes the move with the note silently
		// absent.
		await renderWith(
			[ noteTransition() ],
			[
				{
					warnings_pending: true,
					soft_warnings: [ { message: 'Slug is short.' } ],
				},
			]
		);
		await openPopoverFor( 'Send to Review' );

		fireEvent.change( screen.getByLabelText( 'Editor note' ), {
			target: { value: 'Checked twice' },
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
			wfp_n1_editor_note: 'Checked twice',
			wfp_n1_editor_note__name: 'Editor note',
		};
		expect( firedTransitions() ).toEqual( [
			{
				to_status: 'review',
				acknowledge_warnings: false,
				input_data: inputData,
			},
			{
				to_status: 'review',
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

		await renderWith( [ noteTransition() ], [], {
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
			screen.getByRole( 'dialog', { name: 'Warnings Detected' } )
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
		await renderWith( [ noteTransition() ] );
		const trigger = await openPopoverFor( 'Send to Review' );

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
					wfp_a1_assignee_notes: 'Please review',
					wfp_a1_assignee_notes__name: 'Notes',
				},
			},
		] );
	} );

	it( 'role assignment: lists roles, Back returns to them, and empty notes are omitted', async () => {
		await renderWith( [ assignmentTransition( 'role' ) ] );
		await openPopoverFor( 'Assign reviewer' );

		// The role list.
		expect(
			screen.getByRole( 'button', { name: 'Editor' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Author' } )
		).toBeInTheDocument();

		// Picking a role reaches the notes step; Back returns to the list.
		await act( async () => {
			fireEvent.click( screen.getByRole( 'button', { name: 'Editor' } ) );
		} );
		expect(
			screen.getByRole( 'textbox', { name: 'Notes (optional)' } )
		).toBeInTheDocument();
		await act( async () => {
			fireEvent.click( screen.getByRole( 'button', { name: 'Back' } ) );
		} );
		expect(
			screen.getByRole( 'button', { name: 'Editor' } )
		).toBeInTheDocument();
		expect( firedTransitions() ).toEqual( [] );

		// Committing without notes sends only the assignment key.
		await act( async () => {
			fireEvent.click( screen.getByRole( 'button', { name: 'Editor' } ) );
		} );
		await act( async () => {
			fireEvent.click( screen.getByRole( 'button', { name: 'Submit' } ) );
		} );

		expect( firedTransitions() ).toEqual( [
			{
				to_status: 'assigned',
				acknowledge_warnings: false,
				input_data: { wfp_a1_assignee: 'editor' },
			},
		] );
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
