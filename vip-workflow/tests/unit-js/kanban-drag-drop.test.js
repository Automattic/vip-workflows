/**
 * The Kanban board's drop legality and drop-failure reporting.
 *
 * Two behaviours from the drop path, both fixes for silent failures:
 *
 * 1. During a drag, a column the dragged card cannot legally move to renders
 *    visibly disabled AND its droppable is disabled in dnd-kit, so the drop
 *    cannot land there at all. Legality is the server's own answer — the
 *    `transitions` list of `GET /workflow/post/{id}/status`, the same payload
 *    the editor's transition rail renders — never a client-side re-derivation
 *    of workflow rules. While that answer is in flight, or while an agent owns
 *    the stage's exits (whose offered list is deliberately empty even though a
 *    confirmed move is still allowed), no column is disabled and the
 *    transition endpoint stays the judge.
 *
 * 2. A drop whose transition request errors reports the server's message
 *    through the screen's existing error surface — a snackbar notice via
 *    `core/notices`, rendered by the admin AppShell — and rolls the optimistic
 *    move back.
 *
 * dnd-kit is mocked at the module boundary: jsdom lays nothing out, so
 * pointer-driven drags cannot be simulated, and reimplementing its collision
 * detection in a test would test the reimplementation. The mock hands the
 * DndContext handlers to the test, which drives them the way the real sensors
 * would; everything below them — legality fetch, optimistic update, transition
 * call, rollback, notices — is the real board.
 *
 * @package
 */

import { render, screen, act, within } from './helpers/render-wp-component';
import apiFetch from '@wordpress/api-fetch';
import { createReduxStore, register } from '@wordpress/data';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );
jest.mock( '@wordpress/notices', () => ( { store: 'core/notices' } ) );

jest.mock( '@dnd-kit/core', () => {
	const state = {};
	return {
		__esModule: true,
		// Handed to the test so it can drive the handlers the sensors would.
		__mockDndState: state,
		DndContext: ( props ) => {
			state.contextProps = props;
			return props.children;
		},
		DragOverlay: () => null,
		useDroppable: jest.fn( () => ( {
			setNodeRef: () => {},
			isOver: false,
		} ) ),
		useDraggable: () => ( {
			attributes: {},
			listeners: {},
			setNodeRef: () => {},
			isDragging: false,
		} ),
		useSensor: () => null,
		useSensors: ( ...sensors ) => sensors,
		PointerSensor: function PointerSensor() {},
		KeyboardSensor: function KeyboardSensor() {},
		rectIntersection: () => [],
	};
} );

// eslint-disable-next-line import/first
import {
	KanbanBoard,
	legalDropTargets,
} from '../../src/admin/components/KanbanBoard';

const { __mockDndState: dnd, useDroppable } =
	jest.requireMock( '@dnd-kit/core' );

/**
 * Notices dispatched to the (faked) core/notices store, oldest first.
 *
 * @type {Array<{status: string, message: string, options: Object}>}
 */
const notices = [];

register(
	createReduxStore( 'core/notices', {
		reducer: ( state = {} ) => state,
		actions: {
			createSuccessNotice: ( message, options ) => {
				notices.push( { status: 'success', message, options } );
				return { type: 'NOOP' };
			},
			createErrorNotice: ( message, options ) => {
				notices.push( { status: 'error', message, options } );
				return { type: 'NOOP' };
			},
		},
	} )
);

const AUTHOR = { id: 1, display_name: 'Dana Scully', type: 'user' };

/**
 * A card fixture as the kanban endpoint serves one.
 *
 * @param {number} id    Post id.
 * @param {string} title Card title.
 * @return {Object} Card.
 */
const card = ( id, title ) => ( {
	id,
	title,
	edit_url: `post.php?post=${ id }&action=edit`,
	author: AUTHOR,
	assigned_to: null,
	due_date: null,
	urgency: 'normal',
	waiting_time: '2 hours',
	modified: '2026-08-17 09:00:00',
	created: '2026-08-15 09:00:00',
} );

const CARD_ALPHA = card( 11, 'Alpha' );

const KANBAN = {
	sequences: [
		{ id: 7, name: 'Newsroom', slug: 'newsroom', post_types: [ 'post' ] },
	],
	columns: [
		{
			key: 'newsroom__draft',
			status_key: 'draft',
			sequence_id: 7,
			label: 'Drafting',
			color: '#8073ab',
			is_initial: true,
			is_terminal: false,
			is_hidden: false,
			count: 1,
			cards: [ CARD_ALPHA ],
		},
		{
			key: 'newsroom__review',
			status_key: 'review',
			sequence_id: 7,
			label: 'In review',
			color: '#0675c4',
			is_initial: false,
			is_terminal: false,
			is_hidden: false,
			count: 1,
			cards: [ card( 22, 'Beta' ) ],
		},
		{
			key: 'newsroom__legal',
			status_key: 'legal',
			sequence_id: 7,
			label: 'Legal check',
			color: '#b26200',
			is_initial: false,
			is_terminal: false,
			is_hidden: false,
			count: 0,
			cards: [],
		},
		{
			key: 'newsroom__publish',
			status_key: 'publish',
			sequence_id: 7,
			label: 'Published',
			color: '#008a20',
			is_initial: false,
			is_terminal: false,
			is_hidden: false,
			count: 0,
			cards: [],
		},
	],
};

// Alpha sits in `draft`. The server offers one performable move (`review`),
// withholds `publish` entirely, and marks `legal` locked — an offered edge the
// user cannot take, which must count as illegal for the drag.
const STATUS_ALPHA = {
	has_workflow: true,
	post_id: 11,
	sequence: { id: 7, name: 'Newsroom', slug: 'newsroom' },
	current: { key: 'draft', label: 'Drafting' },
	transitions: [
		{ to: 'review', label: 'Send to review', kind: 'normal' },
		{
			to: 'legal',
			label: 'Legal check',
			kind: 'normal',
			_locked: true,
			_locked_reason: 'Assigned to someone else.',
		},
	],
	agent_pending: false,
	agent_job: null,
};

/**
 * Route-aware apiFetch stand-in.
 *
 * @param {Object}   [routes]            Per-route overrides.
 * @param {Function} [routes.status]     Handler for the post-status GET.
 * @param {Function} [routes.transition] Handler for the transition POST.
 */
function mockRoutes( { status, transition } = {} ) {
	apiFetch.mockImplementation( ( { path, method } ) => {
		if ( path.startsWith( '/vip-workflow/v1/workflow/kanban' ) ) {
			// A fresh clone per fetch: the board mutates its copy optimistically.
			return Promise.resolve( JSON.parse( JSON.stringify( KANBAN ) ) );
		}
		if ( /\/workflow\/post\/\d+\/status$/.test( path ) ) {
			return status ? status() : Promise.resolve( STATUS_ALPHA );
		}
		if (
			/\/workflow\/post\/\d+\/transition$/.test( path ) &&
			'POST' === method
		) {
			return transition ? transition() : Promise.resolve( {} );
		}
		return Promise.reject(
			new Error( `Unexpected apiFetch path: ${ path }` )
		);
	} );
}

/**
 * Render the board and wait for the cards to arrive.
 */
async function renderBoard() {
	render( <KanbanBoard /> );
	await screen.findByText( 'Alpha' );
}

/**
 * Begin dragging a card, driving the handler the real sensors would call, and
 * flush the legality fetch it fires.
 *
 * @param {number} cardId Card (post) id.
 */
async function startDrag( cardId = 11 ) {
	await act( async () => {
		dnd.contextProps.onDragStart( {
			active: { id: cardId, data: { current: {} } },
		} );
	} );
}

/**
 * Drop the dragged card on a column.
 *
 * @param {number} cardId    Card (post) id.
 * @param {string} columnKey Destination column key, or null for "nowhere".
 */
async function drop( cardId, columnKey ) {
	await act( async () => {
		await dnd.contextProps.onDragEnd( {
			active: { id: cardId },
			over: columnKey ? { id: columnKey } : null,
		} );
	} );
}

/**
 * The rendered column element carrying a label.
 *
 * @param {string} label Column label.
 * @return {HTMLElement} Column element.
 */
function column( label ) {
	return screen.getByText( label ).closest( '.vip-workflow-kanban-column' );
}

describe( 'KanbanBoard drop legality', () => {
	beforeEach( () => {
		apiFetch.mockReset();
		useDroppable.mockClear();
		notices.length = 0;
	} );

	it( 'disables the columns the server offers no move to, once its answer arrives', async () => {
		mockRoutes();
		await renderBoard();
		const callsBefore = useDroppable.mock.calls.length;
		await startDrag();

		// `publish` was never offered and `legal` is offered but locked —
		// both illegal. `review` is the one performable move, and the card's
		// own column stays enabled because dropping back home is a no-op.
		expect( column( 'Published' ) ).toHaveClass(
			'vip-workflow-kanban-column--drop-disabled'
		);
		expect( column( 'Legal check' ) ).toHaveClass(
			'vip-workflow-kanban-column--drop-disabled'
		);
		expect( column( 'In review' ) ).not.toHaveClass(
			'vip-workflow-kanban-column--drop-disabled'
		);
		expect( column( 'Drafting' ) ).not.toHaveClass(
			'vip-workflow-kanban-column--drop-disabled'
		);

		// Dimming alone would only discourage the drop; the droppable itself
		// must be off so the drop cannot land there. Read only the calls made
		// AFTER the drag began, keeping the last per column — before the drag
		// every column reports disabled: false, so a whole-history match would
		// prove nothing about the enabled ones.
		const dropStates = {};
		useDroppable.mock.calls
			.slice( callsBefore )
			.forEach( ( [ { id, disabled } ] ) => {
				dropStates[ id ] = disabled;
			} );
		expect( dropStates ).toEqual( {
			newsroom__draft: false,
			newsroom__review: false,
			newsroom__legal: true,
			newsroom__publish: true,
		} );
	} );

	it( 'disables nothing while the legality answer is still in flight', async () => {
		// A status request that never settles: the drag outlives the answer.
		mockRoutes( { status: () => new Promise( () => {} ) } );
		await renderBoard();
		await startDrag();

		// Unknown legality must not guess: every column stays enabled and the
		// transition endpoint remains the judge of an attempted drop.
		expect(
			document.querySelectorAll(
				'.vip-workflow-kanban-column--drop-disabled'
			)
		).toHaveLength( 0 );
	} );

	it( 'disables nothing while an agent owns the stage exits', async () => {
		// The offered list is deliberately empty while an agent runs, but a
		// confirmed move is still allowed — the board is a sanctioned rescue
		// path for a stuck post, so it must not lock every column shut.
		mockRoutes( {
			status: () =>
				Promise.resolve( {
					...STATUS_ALPHA,
					transitions: [],
					agent_pending: true,
				} ),
		} );
		await renderBoard();
		await startDrag();

		expect(
			document.querySelectorAll(
				'.vip-workflow-kanban-column--drop-disabled'
			)
		).toHaveLength( 0 );
	} );

	it( 'disables nothing while a failed agent job marks the stage', async () => {
		// A failed or timed-out run leaves `agent_job` set with `agent_pending`
		// false — and an empty offered list — while the server accepts a drop
		// to a routed destination outright. This is the stuck-post rescue the
		// board exists for; dimming every column would make it un-rescuable.
		mockRoutes( {
			status: () =>
				Promise.resolve( {
					...STATUS_ALPHA,
					transitions: [],
					agent_pending: false,
					agent_job: { status: 'failed', error: 'Timed out.' },
				} ),
		} );
		await renderBoard();
		await startDrag();

		expect(
			document.querySelectorAll(
				'.vip-workflow-kanban-column--drop-disabled'
			)
		).toHaveLength( 0 );
	} );

	it( 'discards a stale legality answer from an earlier drag of the same card', async () => {
		const answers = [];
		mockRoutes( {
			status: () => new Promise( ( resolve ) => answers.push( resolve ) ),
		} );
		await renderBoard();

		// Drag 1 starts and ends before its legality answer arrives; drag 2 of
		// the SAME card begins, its own answer also still pending.
		await startDrag();
		await drop( 11, null );
		await startDrag();

		// Drag 1's answer lands late, claiming nothing is legal. It was
		// computed against the stage the card was in before — applying it
		// would dim every column for drag 2.
		await act( async () => {
			answers[ 0 ]( { ...STATUS_ALPHA, transitions: [] } );
		} );
		expect(
			document.querySelectorAll(
				'.vip-workflow-kanban-column--drop-disabled'
			)
		).toHaveLength( 0 );

		// Drag 2's own answer still applies.
		await act( async () => {
			answers[ 1 ]( STATUS_ALPHA );
		} );
		expect( column( 'Published' ) ).toHaveClass(
			'vip-workflow-kanban-column--drop-disabled'
		);
	} );

	it( 'clears the disabled columns when the drag ends', async () => {
		mockRoutes();
		await renderBoard();
		await startDrag();
		expect( column( 'Published' ) ).toHaveClass(
			'vip-workflow-kanban-column--drop-disabled'
		);

		// Let go over nowhere (or over a disabled column, which reports no
		// droppable at all) — the board returns to rest.
		await drop( 11, null );
		expect(
			document.querySelectorAll(
				'.vip-workflow-kanban-column--drop-disabled'
			)
		).toHaveLength( 0 );
	} );
} );

describe( 'KanbanBoard drop failure reporting', () => {
	beforeEach( () => {
		apiFetch.mockReset();
		useDroppable.mockClear();
		notices.length = 0;
	} );

	it( 'surfaces a refused transition as an error snackbar and rolls the move back', async () => {
		const refusal = 'Transition from "draft" to "review" is not allowed.';
		mockRoutes( {
			transition: () =>
				Promise.reject( {
					code: 'invalid_transition',
					message: refusal,
					data: { status: 422 },
				} ),
		} );
		await renderBoard();
		await startDrag();
		await drop( 11, 'newsroom__review' );

		// The server's own words, on the screen's existing error surface.
		expect( notices ).toContainEqual( {
			status: 'error',
			message: refusal,
			options: { type: 'snackbar' },
		} );

		// And the optimistic move is undone: Alpha is back where it started.
		expect(
			within( column( 'Drafting' ) ).getByText( 'Alpha' )
		).toBeInTheDocument();
		expect(
			within( column( 'In review' ) ).queryByText( 'Alpha' )
		).toBeNull();
	} );

	it( 'reports a drop whose destination or card cannot be resolved, instead of failing silently', async () => {
		mockRoutes();
		await renderBoard();

		// A droppable id that names no column — data-integrity, but the card
		// still snapped back, so the user is told.
		await drop( 11, 'newsroom__ghost' );
		expect( notices ).toContainEqual( {
			status: 'error',
			message: 'Failed to move card',
			options: { type: 'snackbar' },
		} );

		notices.length = 0;

		// A draggable id that names no card, let go on a real column.
		await drop( 999, 'newsroom__review' );
		expect( notices ).toContainEqual( {
			status: 'error',
			message: 'Failed to move card',
			options: { type: 'snackbar' },
		} );
	} );

	it( 'reports success through the same surface when the move lands', async () => {
		mockRoutes();
		await renderBoard();
		await startDrag();
		await drop( 11, 'newsroom__review' );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/vip-workflow/v1/workflow/post/11/transition',
			method: 'POST',
			data: { to_status: 'review' },
		} );
		expect( notices ).toContainEqual( {
			status: 'success',
			message: 'Card moved successfully',
			options: { type: 'snackbar' },
		} );
	} );
} );

describe( 'legalDropTargets', () => {
	it( 'reads the performable transitions and the sequence id off the payload', () => {
		expect( legalDropTargets( STATUS_ALPHA ) ).toEqual( {
			sequenceId: 7,
			stageKeys: [ 'review' ],
		} );
	} );

	it( 'answers "unknown" for a missing payload or an agent-marked stage', () => {
		expect( legalDropTargets( null ) ).toBeNull();
		// Running agent…
		expect(
			legalDropTargets( { ...STATUS_ALPHA, agent_pending: true } )
		).toBeNull();
		// …and a failed/timed-out one, whose marker lingers with
		// agent_pending false.
		expect(
			legalDropTargets( {
				...STATUS_ALPHA,
				agent_pending: false,
				agent_job: { status: 'failed' },
			} )
		).toBeNull();
	} );
} );
