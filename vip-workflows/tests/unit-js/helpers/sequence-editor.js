/**
 * The one harness for every suite that renders the sequence editor.
 *
 * Each of those suites used to carry its own copy of three things: a stub for
 * the canvas, a hand-built `/sequences/options` answer, and an `apiFetch` mock
 * that routed the editor's reads. The editor refuses to load when the options
 * answer is missing any list it checks, so a field added to that endpoint had
 * to be added to every copy — and a copy that was missed either failed its
 * whole suite at load or kept passing against a server shape that no longer
 * exists. This file is the single place that answer is described.
 *
 * Usage, in a test file — both mocks are required, and must be declared in the
 * test file itself so Jest hoists them above this module's imports:
 *
 *     jest.mock( '@wordpress/api-fetch' );
 *     jest.mock(
 *         '../../src/admin/components/graph/GraphCanvas',
 *         () => require( './helpers/graph-canvas-stub' ).GraphCanvasStub
 *     );
 *
 * The canvas stub itself, and what it recorded, live in `graph-canvas-stub.js`
 * and are re-exported here.
 *
 * @package
 */

import apiFetch from '@wordpress/api-fetch';

import { act, render, screen, waitFor } from './render-wp-component';

import SequenceGraphEditor from '../../../src/admin/components/graph/SequenceGraphEditor';

export { canvas, canvasReveals, resetCanvas } from './graph-canvas-stub';

export const OPTIONS_PATH = '/vip-workflows/v1/sequences/options';

/** The hand-off a phase sequence ships with, as `{ from, to }` pairs. */
export const IDEATION_TO_EDITORIAL = [ { from: 'ideation', to: 'editorial' } ];

/** Two phases with nothing joining them. */
export const LIFECYCLE = [
	{ key: 'ideation', label: 'Ideation', transitions: [] },
	{ key: 'editorial', label: 'Editorial', transitions: [] },
];

/** The same two phases, joined by the hand-off they owe. */
export const LIFECYCLE_CONNECTED = [
	{
		key: 'ideation',
		label: 'Ideation',
		transitions: [ { to: 'editorial', label: 'Create Draft' } ],
	},
	{ key: 'editorial', label: 'Editorial', transitions: [] },
];

/**
 * What a sequence may be built out of, as the server answers it.
 *
 * Every list the editor checks is present, so a test only names the ones it is
 * about. `required_phase_transitions` follows `phase_transitions` unless it is
 * given, which is what the server publishes for the shipped lifecycle.
 *
 * @param {Object} overrides Fields to replace.
 * @return {Object} An options response.
 */
export function sequenceOptions( overrides = {} ) {
	const phaseTransitions =
		overrides.phase_transitions ?? IDEATION_TO_EDITORIAL;

	return {
		post_types: [ { value: 'post', label: 'Posts' } ],
		phase_transitions: phaseTransitions,
		required_phase_transitions: phaseTransitions,
		...overrides,
	};
}

/**
 * Answer the editor's reads the way the server does.
 *
 * @param {Object}          server           What the server answers.
 * @param {Object|Function} server.sequence  The stored sequence, or a function
 *                                           of the request path returning it
 *                                           (or a promise of it).
 * @param {Object|Function} [server.options] The options answer, or a function
 *                                           returning a promise of it, for a
 *                                           test that holds or fails the read.
 * @param {Function}        [server.write]   Answers a POST or PUT, given the
 *                                           request. Defaults to the stored
 *                                           sequence.
 * @return {{writes: Array, calls: Array}} Every write the editor made, and
 *                                         every request, in order.
 */
export function serveSequenceEditor( {
	sequence,
	options = sequenceOptions(),
	write,
} ) {
	const writes = [];
	const calls = [];
	const read = ( path ) =>
		'function' === typeof sequence ? sequence( path ) : sequence;

	apiFetch.mockImplementation( ( request ) => {
		const { path, method, data } = request;
		calls.push( { path, method } );

		if ( path === OPTIONS_PATH ) {
			return 'function' === typeof options
				? options()
				: Promise.resolve( options );
		}
		if (
			path.startsWith( '/vip-workflows/v1/abilities' ) ||
			path === '/vip-workflows/v1/notifications/channels'
		) {
			return Promise.resolve( [] );
		}
		// Answered inside a promise, so a `write` or `sequence` that throws
		// rejects the request the way a failed fetch does, rather than
		// throwing out of `apiFetch` itself.
		if ( method === 'POST' || method === 'PUT' ) {
			writes.push( { path, method, data } );
			return new Promise( ( resolve ) =>
				resolve( write ? write( request ) : read( path ) )
			);
		}
		return new Promise( ( resolve ) => resolve( read( path ) ) );
	} );

	return { writes, calls };
}

/**
 * Let the reads the editor fired alongside its load land, inside `act`.
 *
 * @return {Promise<void>} Resolves after one macrotask.
 */
export async function settle() {
	await act( async () => {
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
	} );
}

/**
 * A stored sequence in the shape the server returns it.
 *
 * @param {Object} fields Fields to set on it.
 * @return {Object} Sequence.
 */
export function storedSequence( fields = {} ) {
	return {
		id: 3,
		name: 'Content Lifecycle',
		description: '',
		status: 'active',
		stages_missing_region: [],
		...fields,
	};
}

/**
 * Render the editor on a stored sequence, and wait for it to settle.
 *
 * Waits for the canvas to be on screen, then lets the remaining reads land.
 *
 * @param {Object}   args            Harness arguments.
 * @param {string}   [args.mode]     `phase` or `workflow`.
 * @param {Object}   [args.config]   The stored config. Ignored when `sequence`
 *                                   is given.
 * @param {Object}   [args.sequence] The whole stored sequence.
 * @param {Object}   [args.options]  The options answer.
 * @param {Function} [args.write]    Answers a write.
 * @return {Promise<{writes: Array, calls: Array}>} The server's record.
 */
export async function renderSequenceEditor( {
	mode,
	config = {},
	sequence = storedSequence( { type: mode, config } ),
	options,
	write,
} = {} ) {
	const server = serveSequenceEditor( { sequence, options, write } );

	render(
		<SequenceGraphEditor
			sequenceId={ sequence.id }
			mode={ mode }
			onCancel={ () => {} }
		/>
	);

	// `getByTestId` throws until the canvas is there, which is what `waitFor`
	// retries on.
	await waitFor( () => screen.getByTestId( 'canvas' ) );
	await settle();

	return server;
}

/**
 * The Save button, in any of the three states it renders.
 *
 * Anchored, because an unanchored /Save/ matches any button whose name merely
 * contains it.
 *
 * @return {HTMLElement} Button.
 */
export const saveButton = () =>
	screen.getByRole( 'button', { name: /^(Save|Saving…|Saved!)$/ } );

/**
 * The sequence's Name field.
 *
 * @return {HTMLElement} Field.
 */
export const nameField = () => screen.getByRole( 'textbox', { name: /^Name/ } );
