/**
 * Unit tests for saving a sequence, and for the unsaved work that guards it.
 *
 * Saving used to navigate back to the Sequences list, and the navigation was
 * doing three jobs nobody had noticed it was doing: it confirmed the save (there
 * is no other signal), it cleared the "Saving…" button (the success path never
 * reset it), and it took the editor away before a second save could post a
 * duplicate of the sequence the first one created. Staying on the page removes
 * all three, so each is pinned here.
 *
 * The dirty state underneath them is measured against the LAST SERVER RESPONSE,
 * not the last load — the write gate normalizes what it stores, so the editor
 * re-seats from what came back and takes its baseline from that. A save
 * therefore leaves the editor clean even when the server changed something.
 *
 * The canvas is stubbed: React Flow measures a viewport jsdom does not lay out,
 * and none of this is about the canvas. Everything asserted here is reachable
 * through the sequence settings panel, which is what the inspector shows while
 * nothing is selected.
 *
 * @package
 */

import {
	act,
	render,
	screen,
	fireEvent,
	waitFor,
	within,
} from './helpers/render-wp-component';

// The unwrapped dispatcher. RTL re-exports `fireEvent` wrapped in `act`, which
// drains React's queues around every event; one test below needs an event to
// travel React's ordinary discrete path instead, the way a keystroke does.
import { fireEvent as domFireEvent } from '@testing-library/dom';

import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch' );

// React Flow + dagre, and irrelevant to saving. The stub keeps one canvas
// gesture — drawing the Draft → End edge — because drawing an edge is also what
// selects one, and a selected edge swaps the inspector away from the sequence
// settings the rest of this file reads. It is NOT what makes a new sequence
// savable: one opens on Draft → Published → End and saves as it stands (see the
// describe at the end of this file). Everything else here is reachable through
// the sequence settings panel.
jest.mock(
	'../../src/admin/components/graph/GraphCanvas',
	() =>
		function GraphCanvasStub( { onConnectTransition, onClearSelection } ) {
			return (
				<div data-testid="canvas">
					<button
						onClick={ () =>
							onConnectTransition( 'draft', '__wf_end__', null )
						}
					>
						end the flow
					</button>
					{ /* Drawing an edge selects it, which swaps the inspector
					     to that edge's panel. Clicking empty canvas is how the
					     sequence settings come back. */ }
					<button onClick={ onClearSelection }>
						deselect everything
					</button>
				</div>
			);
		}
);

import SequenceGraphEditor from '../../src/admin/components/graph/SequenceGraphEditor';

// A sequence the validator is happy with, so Save is refused for no reason but
// the ones under test: one stage, in a region it enters, and an end to the flow.
const STAGES = [
	{
		key: 'draft',
		label: 'Draft',
		color: '#C36EFF',
		status: 'draft',
		region_entry: true,
		is_terminal: true,
		transitions: [],
	},
];

const sequence = ( overrides = {} ) => ( {
	id: 7,
	name: 'Editorial Review',
	description: '',
	status: 'active',
	stages_missing_region: [],
	config: {
		statuses: STAGES,
		post_types: [ 'post' ],
		// A key nothing in the editor knows about, so writing one can be shown
		// not to replace the rest.
		settings: { kept: 'value' },
		metadata_fields: [],
	},
	...overrides,
} );

// What a sequence may be built out of, as the server answers it: the eligible
// post types and the phase hand-offs, both decided there rather than worked out
// in the editor.
const OPTIONS = {
	post_types: [ { value: 'post', label: 'Posts' } ],
	phase_transitions: [ { from: 'ideation', to: 'editorial' } ],
	required_phase_transitions: [ { from: 'ideation', to: 'editorial' } ],
};

/** Every write the editor made, in order. */
let writes;

beforeEach( () => {
	writes = [];
	window.location.hash = '';
	apiFetch.mockImplementation( ( { path, method, data } ) => {
		if ( path === '/vip-workflow/v1/sequences/options' ) {
			return Promise.resolve( OPTIONS );
		}
		if (
			path.startsWith( '/vip-workflow/v1/abilities' ) ||
			path === '/vip-workflow/v1/notifications/channels'
		) {
			return Promise.resolve( [] );
		}
		if ( method === 'POST' || method === 'PUT' ) {
			writes.push( { path, method, data } );
			// The server echoes the stored sequence back, which is what the
			// editor re-seats from.
			return Promise.resolve(
				sequence( {
					id: 7,
					name: data.name,
					status: data.status,
					config: {
						...sequence().config,
						statuses: data.statuses,
						post_types: data.post_types,
						// Echoed, not dropped: the editor re-seats from this, so a
						// mock that discards it hides the very regression the
						// settings tests below exist to catch.
						settings: data.settings,
					},
				} )
			);
		}
		return Promise.resolve( sequence() );
	} );
} );

afterEach( () => {
	jest.clearAllMocks();
} );

// Anchored to the three exact states getSaveButtonLabel renders — an
// unanchored /Save/ would match any button whose name merely contains it.
const saveButton = () =>
	screen.getByRole( 'button', { name: /^(Save|Saving…|Saved!)$/ } );
const nameField = () => screen.getByRole( 'textbox', { name: /^Name/ } );

/**
 * Render the editor and wait for its sequence to land AND settle.
 *
 * `waitFor` returns the moment the Save button exists, which is the commit that
 * clears `loading` — the reads the editor fires alongside the sequence (post
 * types, tools, channels, agents; roles come off `window`, not the network) can
 * still be in flight behind it, and it yields its last turn OUTSIDE `act`, so
 * how much of that got done depends on how busy the machine is. The explicit
 * `act` turn below settles the rest before the test starts asserting, on a fast
 * machine and a contended one alike.
 *
 * What it does NOT do is give the editor its dirty-state baseline: that is
 * taken in the same batch that reveals the form, so it is already there. The
 * last describes in this file are what hold that.
 *
 * @param {Object} props Props for the editor, e.g. `sequenceId`. Omit it for a
 *                       new sequence.
 * @return {Function} The `onCancel` spy the editor was given.
 */
async function renderEditor( props = {} ) {
	const onCancel = jest.fn();
	render( <SequenceGraphEditor onCancel={ onCancel } { ...props } /> );
	await waitFor( () => expect( saveButton() ).toBeInTheDocument() );
	await act( async () => {
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
	} );
	return onCancel;
}

describe( 'The sequence carries its own settings through a save', () => {
	const publishToggle = () =>
		screen.getByRole( 'checkbox', { name: /Let AI stages publish/ } );

	it( 'is off until somebody turns it on', async () => {
		await renderEditor( { sequenceId: 7 } );

		expect( publishToggle() ).not.toBeChecked();
	} );

	it( 'sends the flag with the save', async () => {
		// build_config() rebuilds the stored config from an explicit field list,
		// so a setting the editor does not send is dropped. That is how
		// reviewer_roles became unconfigurable.
		await renderEditor( { sequenceId: 7 } );

		fireEvent.click( publishToggle() );
		fireEvent.click( saveButton() );

		await waitFor( () => expect( writes ).toHaveLength( 1 ) );
		expect( writes[ 0 ].data.settings ).toEqual(
			expect.objectContaining( { allow_agent_publish: true } )
		);
	} );

	it( 'stays on after the save round trip', async () => {
		// Asserting the request only would pass against a server that accepted the
		// flag and threw it away — the editor re-seats from the response, so the
		// toggle is where a dropped setting becomes visible.
		await renderEditor( { sequenceId: 7 } );

		fireEvent.click( publishToggle() );
		fireEvent.click( saveButton() );

		await waitFor( () => expect( writes ).toHaveLength( 1 ) );
		await waitFor( () => expect( publishToggle() ).toBeChecked() );
	} );

	it( 'leaves the rest of the settings bag alone', async () => {
		// The bag is shared, so writing one key must not replace the rest.
		await renderEditor( { sequenceId: 7 } );

		fireEvent.click( publishToggle() );
		fireEvent.click( saveButton() );

		await waitFor( () => expect( writes ).toHaveLength( 1 ) );
		expect( writes[ 0 ].data.settings ).toEqual(
			expect.objectContaining( { kept: 'value' } )
		);
	} );
} );

describe( 'Saving a sequence stays on the editor', () => {
	it( 'writes, then leaves the author where they were', async () => {
		const onCancel = await renderEditor( { sequenceId: 7 } );

		fireEvent.change( nameField(), { target: { value: 'Renamed' } } );
		fireEvent.click( saveButton() );

		await waitFor( () => expect( writes ).toHaveLength( 1 ) );
		expect( writes[ 0 ].method ).toBe( 'PUT' );
		expect( writes[ 0 ].path ).toBe( '/vip-workflow/v1/sequences/7' );
		// The canvas is still there, and nothing asked the page to leave.
		expect( screen.getByTestId( 'canvas' ) ).toBeInTheDocument();
		expect( onCancel ).not.toHaveBeenCalled();
	} );

	it( 'confirms the save on the button, since navigation no longer does', async () => {
		await renderEditor( { sequenceId: 7 } );

		fireEvent.change( nameField(), { target: { value: 'Renamed' } } );
		fireEvent.click( saveButton() );

		await waitFor( () =>
			expect( saveButton() ).toHaveTextContent( 'Saved!' )
		);
	} );

	it( 'stops being busy on success, not only on failure', async () => {
		// The success path used to leave `saving` set, because unmounting was
		// what cleared it. Staying means the button would read "Saving…" for as
		// long as the editor stayed open.
		await renderEditor( { sequenceId: 7 } );

		fireEvent.change( nameField(), { target: { value: 'Renamed' } } );
		fireEvent.click( saveButton() );

		await waitFor( () => expect( writes ).toHaveLength( 1 ) );
		await waitFor( () =>
			expect( saveButton() ).not.toHaveTextContent( 'Saving' )
		);
	} );

	it( 'updates the sequence it just created instead of posting a second one', async () => {
		const onCreated = jest.fn();
		await renderEditor( { onCreated } );

		fireEvent.change( nameField(), { target: { value: 'Brand New' } } );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'end the flow' } )
		);
		fireEvent.click( saveButton() );
		await waitFor( () => expect( writes ).toHaveLength( 1 ) );
		expect( writes[ 0 ].method ).toBe( 'POST' );
		expect( writes[ 0 ].path ).toBe( '/vip-workflow/v1/sequences' );

		// The row that now exists is reported to the page, which is what moves
		// the address to it — this editor does not touch the address, because
		// the page keys it by route and would then be holding an editor the
		// address no longer names (see sequences-page-routing.test.js).
		expect( onCreated ).toHaveBeenCalledWith( 7 );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'deselect everything' } )
		);
		fireEvent.change( nameField(), {
			target: { value: 'Brand New Again' },
		} );
		fireEvent.click( saveButton() );
		await waitFor( () => expect( writes ).toHaveLength( 2 ) );
		expect( writes[ 1 ].method ).toBe( 'PUT' );
		expect( writes[ 1 ].path ).toBe( '/vip-workflow/v1/sequences/7' );
	} );
} );

describe( 'Unsaved work in the sequence editor', () => {
	it( 'offers nothing to save until something changes', async () => {
		await renderEditor( { sequenceId: 7 } );

		expect( saveButton() ).toBeDisabled();

		fireEvent.change( nameField(), { target: { value: 'Renamed' } } );

		expect( saveButton() ).toBeEnabled();
	} );

	it( 'goes clean again once the server has it', async () => {
		await renderEditor( { sequenceId: 7 } );

		fireEvent.change( nameField(), { target: { value: 'Renamed' } } );
		fireEvent.click( saveButton() );

		await waitFor( () => expect( writes ).toHaveLength( 1 ) );
		// Re-baselined from the response, so there is nothing left to save —
		// even though the editor never navigated away and re-loaded.
		await waitFor( () => expect( saveButton() ).toBeDisabled() );
	} );

	it( 'goes clean again when a change is typed back to where it started', async () => {
		await renderEditor( { sequenceId: 7 } );

		fireEvent.change( nameField(), { target: { value: 'Renamed' } } );
		expect( saveButton() ).toBeEnabled();

		fireEvent.change( nameField(), {
			target: { value: 'Editorial Review' },
		} );

		expect( saveButton() ).toBeDisabled();
	} );

	it( 'leaves on Cancel without asking when nothing would be lost', async () => {
		const onCancel = await renderEditor( { sequenceId: 7 } );

		fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );

		await waitFor( () => expect( onCancel ).toHaveBeenCalled() );
	} );

	it( 'asks before Cancel throws away unsaved work', async () => {
		const onCancel = await renderEditor( { sequenceId: 7 } );

		fireEvent.change( nameField(), { target: { value: 'Renamed' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );

		await screen.findByRole( 'dialog', {
			name: /Discard unsaved changes/,
		} );
		expect( onCancel ).not.toHaveBeenCalled();
	} );

	it( 'keeps editing when the author says so', async () => {
		const onCancel = await renderEditor( { sequenceId: 7 } );

		fireEvent.change( nameField(), { target: { value: 'Renamed' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
		// The dialog's retreat is also named Cancel now, so the click is
		// scoped to the dialog — the header's Cancel is what opened it.
		const dialog = await screen.findByRole( 'dialog', {
			name: /Discard unsaved changes/,
		} );
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		);

		await waitFor( () =>
			expect(
				screen.queryByRole( 'dialog', {
					name: /Discard unsaved changes/,
				} )
			).not.toBeInTheDocument()
		);
		expect( onCancel ).not.toHaveBeenCalled();
		expect( nameField() ).toHaveValue( 'Renamed' );
	} );

	it( 'leaves once the author says the work can go', async () => {
		const onCancel = await renderEditor( { sequenceId: 7 } );

		fireEvent.change( nameField(), { target: { value: 'Renamed' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Discard changes' } )
		);

		await waitFor( () => expect( onCancel ).toHaveBeenCalled() );
	} );

	it( 'does not ask again about the departure it was just told to allow', async () => {
		// Cancel routes to the page's `navigateToList`, which clears the hash —
		// which is a hash change, which the guard below would otherwise stop and
		// question a second time.
		const onCancel = await renderEditor( { sequenceId: 7 } );

		fireEvent.change( nameField(), { target: { value: 'Renamed' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Discard changes' } )
		);
		await waitFor( () => expect( onCancel ).toHaveBeenCalled() );

		window.location.hash = '';
		await waitFor( () =>
			expect(
				screen.queryByRole( 'dialog', {
					name: /Discard unsaved changes/,
				} )
			).not.toBeInTheDocument()
		);
	} );
} );

describe( 'Leaving the sequence editor by the browser', () => {
	it( 'puts the address back and asks, rather than letting the work go', async () => {
		await renderEditor( { sequenceId: 7 } );
		fireEvent.change( nameField(), { target: { value: 'Renamed' } } );

		// What Back does. The guard cannot veto it — the shell listens for
		// `hashchange` too, and registered first — so it undoes it instead, and
		// asks with the canvas still holding the work.
		window.location.hash = '#/other';

		await screen.findByRole( 'dialog', {
			name: /Discard unsaved changes/,
		} );
		expect( window.location.hash ).toBe( '#/edit/7' );
		// Still mounted behind the question — `getByTestId`, because the modal
		// hides the rest of the app from the accessibility tree while it is up.
		expect( screen.getByTestId( 'canvas' ) ).toBeInTheDocument();
	} );

	it( 'replays the navigation it undid once the work is given up', async () => {
		await renderEditor( { sequenceId: 7 } );
		fireEvent.change( nameField(), { target: { value: 'Renamed' } } );

		window.location.hash = '#/other';
		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Discard changes' } )
		);

		await waitFor( () => expect( window.location.hash ).toBe( '#/other' ) );
	} );

	it( 'stays out of the way while there is nothing to lose', async () => {
		await renderEditor( { sequenceId: 7 } );

		window.location.hash = '#/other';

		await waitFor( () => expect( window.location.hash ).toBe( '#/other' ) );
		expect(
			screen.queryByRole( 'dialog', {
				name: /Discard unsaved changes/,
			} )
		).not.toBeInTheDocument();
	} );

	// A region repair replays the STORED config, so it can only speak for the
	// stages. Re-taking the whole baseline from it would absorb edits it never
	// saw: the author's new name would sit on screen with Save disabled and
	// both exit guards stood down, and leaving would discard it in silence.
	it( 'keeps an unsaved rename dirty across a region repair', async () => {
		apiFetch.mockImplementation( ( { path, method } ) => {
			if ( path === '/vip-workflow/v1/sequences/options' ) {
				return Promise.resolve( OPTIONS );
			}
			if (
				path.startsWith( '/vip-workflow/v1/abilities' ) ||
				path === '/vip-workflow/v1/notifications/channels'
			) {
				return Promise.resolve( [] );
			}
			if ( path.endsWith( '/repair-regions' ) && method === 'POST' ) {
				return Promise.resolve( {
					...sequence( { stages_missing_region: [] } ),
					repair: { defaulted: [ 'legacy' ], dropped: [] },
				} );
			}
			// A legacy sequence, so the repair notice is offered.
			return Promise.resolve(
				sequence( { stages_missing_region: [ 'legacy' ] } )
			);
		} );

		await renderEditor( { sequenceId: 7 } );

		fireEvent.change( nameField(), { target: { value: 'Renamed' } } );
		await waitFor( () => expect( saveButton() ).toBeEnabled() );

		fireEvent.click(
			screen.getByRole( 'button', { name: /Assign default status/ } )
		);

		await waitFor( () =>
			expect(
				screen.queryByRole( 'button', {
					name: /Assign default status/,
				} )
			).not.toBeInTheDocument()
		);

		expect( nameField() ).toHaveValue( 'Renamed' );
		expect( saveButton() ).toBeEnabled();
	} );
} );

/**
 * Type into the commit that `ready` names, in the same task that commits it.
 *
 * The change is dispatched from a `MutationObserver`, which runs in the same
 * task as the commit that changed the DOM — where a keystroke the browser had
 * already queued is delivered. `act` is switched off around that (which is what
 * RTL's own `waitFor` does), because inside `act` React drains everything the
 * test schedules and the window closes before the observer can type into it.
 * The dispatcher is `@testing-library/dom`'s, for the same reason: RTL 16 wraps
 * `fireEvent` in `act` through its `eventWrapper`, which would drain the
 * pending lane and close the window from the other end.
 *
 * The wait is raced against a timer, and the observer is disconnected in a
 * `finally`. Without both, a `ready` that never comes true — a renamed label, a
 * changed mock, a load regression — hangs the promise forever: the env flag is
 * never put back, so every later test in the file runs with `act` off too, and
 * the failure surfaces as a 5s timeout somewhere else instead of here.
 *
 * @param {Function} ready Returns the field to type into once the commit under
 *                         test has happened, and a falsy value until then.
 * @param {string}   value What to type into it.
 * @param {string}   what  What was being waited for, for the timeout message.
 * @return {Promise<void>} Resolves once the change has been made and everything
 *                         it scheduled has been flushed.
 */
async function typeAtTheCommit( ready, value, what ) {
	const wasActEnvironment = global.IS_REACT_ACT_ENVIRONMENT;
	global.IS_REACT_ACT_ENVIRONMENT = false;

	let observer;
	let timer;
	try {
		const typed = new Promise( ( resolve ) => {
			observer = new MutationObserver( () => {
				const field = ready();
				if ( ! field ) {
					return;
				}
				observer.disconnect();
				domFireEvent.change( field, { target: { value } } );
				resolve();
			} );
			observer.observe( document.body, {
				childList: true,
				subtree: true,
				characterData: true,
				attributes: true,
			} );
		} );
		const gaveUp = new Promise( ( resolve, reject ) => {
			timer = setTimeout(
				() =>
					reject(
						new Error(
							`Timed out waiting for ${ what }: the commit to type into never arrived.`
						)
					),
				2000
			);
		} );
		await Promise.race( [ typed, gaveUp ] );
	} finally {
		// The flag goes back first, and the cleanup after it tolerates having
		// nothing to clean: if the observer itself had thrown, a `finally` that
		// touched it first would throw again over the original failure AND
		// leave `act` switched off for the rest of the file — the leak this
		// helper exists to prevent, reached through its own cleanup.
		global.IS_REACT_ACT_ENVIRONMENT = wasActEnvironment;
		observer?.disconnect();
		clearTimeout( timer );
	}

	await act( async () => {
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
	} );
}

/**
 * The baseline has to exist by the time the form does.
 *
 * The form — Save button and all — is revealed by the commit that clears
 * `loading`. If the dirty-state baseline is taken any later than that same
 * commit, everything typed in between is absorbed INTO the baseline instead of
 * measured against it: the change sits on screen, the editor reads clean, Save
 * is disabled, and both exit guards — which are gated on the editor being dirty
 * — never attach. The next navigation then takes the work without asking.
 *
 * The window is real, not a testing artifact. A baseline taken in a passive
 * effect is set from that effect's own lower-priority lane; a keystroke is a
 * discrete update, so it re-renders ahead of the baseline it should have been
 * measured against, the effect re-runs with the typed value in hand, and the
 * baseline it then takes is the typed one.
 *
 * Typing into that window takes some care, because it closes in a microtask —
 * see `renameAsTheFormAppears`.
 */
describe( 'A change made as the form appears', () => {
	/**
	 * Render the editor and rename the sequence the instant its form appears.
	 *
	 * @return {Promise<void>} Resolves once the rename has been made and
	 *                         everything it scheduled has been flushed.
	 */
	async function renameAsTheFormAppears() {
		render(
			<SequenceGraphEditor sequenceId={ 7 } onCancel={ jest.fn() } />
		);

		await typeAtTheCommit(
			() => screen.queryAllByRole( 'textbox', { name: /^Name/ } )[ 0 ],
			'Renamed',
			'the sequence form to appear'
		);
	}

	it( 'is work the editor knows it has', async () => {
		await renameAsTheFormAppears();

		expect( nameField() ).toHaveValue( 'Renamed' );
		expect( saveButton() ).toBeEnabled();

		// Which sequence the baseline holds, said out loud: typing the server's
		// own name back has to read as clean. A baseline that had absorbed the
		// rename would call this a change and the rename before it nothing —
		// the polarity inverted, not merely lost.
		fireEvent.change( nameField(), {
			target: { value: 'Editorial Review' },
		} );

		expect( saveButton() ).toBeDisabled();
	} );

	it( 'is work the way out still asks about', async () => {
		await renameAsTheFormAppears();

		window.location.hash = '#/other';

		await screen.findByRole( 'dialog', {
			name: /Discard unsaved changes/,
		} );
		expect( window.location.hash ).toBe( '#/edit/7' );
	} );
} );

/**
 * The response is not an echo, and what came back is what has to be on screen.
 *
 * The write gate normalizes what it stores — whitespace off the name, stage
 * keys and transition targets through `sanitize_key` — so the sequence that
 * exists after a save is the server's, not the one the editor sent. Re-seating
 * from the response is the whole reason the save path reads it back: an editor
 * that kept its own copy would show one sequence and send that copy the next
 * time, and read as dirty in between on a save that succeeded.
 *
 * Every other save test here runs against a mock that echoes the payload back
 * verbatim, where re-seating and not re-seating are indistinguishable. This one
 * moves the values on the way through, so only a real re-seat passes.
 *
 * Nothing is typed while the write is out, which is what separates this from
 * the describe below: with no in-flight edit to protect, every field takes the
 * server's copy.
 */
describe( 'What the write gate changed on the way in', () => {
	// The gate's stage-key rule, in the one respect this needs: `sanitize_key`
	// lowercases and rewrites anything outside [a-z0-9_].
	const sanitizeKey = ( key ) =>
		key.toLowerCase().replace( /[^a-z0-9_]+/g, '_' );

	// Stored holding a key the gate would not have written — an older row,
	// saved before the rule — so replaying it through the gate rewrites it.
	const STORED_STAGES = [ { ...STAGES[ 0 ], key: 'Draft Stage' } ];

	beforeEach( () => {
		apiFetch.mockImplementation( ( { path, method, data } ) => {
			if ( path === '/vip-workflow/v1/sequences/options' ) {
				return Promise.resolve( OPTIONS );
			}
			if (
				path.startsWith( '/vip-workflow/v1/abilities' ) ||
				path === '/vip-workflow/v1/notifications/channels'
			) {
				return Promise.resolve( [] );
			}
			if ( method === 'POST' || method === 'PUT' ) {
				writes.push( { path, method, data } );
				// Normalized, not echoed: this is the write gate.
				return Promise.resolve(
					sequence( {
						name: data.name.trim(),
						status: data.status,
						config: {
							...sequence().config,
							statuses: data.statuses.map( ( stage ) => ( {
								...stage,
								key: sanitizeKey( stage.key ),
							} ) ),
							post_types: data.post_types,
						},
					} )
				);
			}
			return Promise.resolve(
				sequence( {
					config: {
						...sequence().config,
						statuses: STORED_STAGES,
					},
				} )
			);
		} );
	} );

	it( 'is what the editor is showing once the save lands', async () => {
		await renderEditor( { sequenceId: 7 } );

		// Typed with whitespace the gate strips, and then left alone for the
		// whole of the write — there is no in-flight edit here to protect.
		fireEvent.change( nameField(), { target: { value: '  Renamed  ' } } );
		fireEvent.click( saveButton() );

		await waitFor( () => expect( writes ).toHaveLength( 1 ) );
		// What went out still holds both of the things the gate rewrites.
		expect( writes[ 0 ].data.name ).toBe( '  Renamed  ' );
		expect( writes[ 0 ].data.statuses[ 0 ].key ).toBe( 'Draft Stage' );

		// And what is on screen is the stored name, not the sent one.
		await waitFor( () => expect( nameField() ).toHaveValue( 'Renamed' ) );

		// The stages went the same way. No key is visible on the stubbed
		// canvas, but the baseline is taken from the server's copy either way,
		// so an editor still holding its own would read as unsaved work — and
		// offer a write of the very thing the gate just refused to store.
		await waitFor( () => expect( saveButton() ).toBeDisabled() );
	} );
} );

/**
 * A change typed while the write is in flight is not the write's to take back.
 *
 * The form stays live for the whole of a save — that is the point of staying on
 * the editor — so an author can rename the sequence again while the PUT is out.
 * The response then re-seats the canvas from what the server stored, and a
 * re-seat that wrote over every field would put the server's echo where the
 * second rename was: the typing gone from the screen, the baseline matching
 * what replaced it, Save switched off and both exit guards stood down. Same end
 * state as an absorbed baseline, reached from the other direction.
 *
 * What is stored is still the right baseline. It is the on-screen value that
 * has to survive, so the two disagree and the editor reads dirty — which is
 * exactly what it is.
 */
describe( 'A change typed while the save is in flight', () => {
	/**
	 * Hold the next write open, so the test can type while it is out.
	 *
	 * The write is recorded and its response built when it is issued, as
	 * usual; only the landing waits.
	 *
	 * @return {Function} Lands the response.
	 */
	function holdTheWrite() {
		const respond = apiFetch.getMockImplementation();
		let land;
		apiFetch.mockImplementation( ( options ) => {
			if ( options.method !== 'POST' && options.method !== 'PUT' ) {
				return respond( options );
			}
			const response = respond( options );
			return new Promise( ( resolve ) => {
				land = () => resolve( response );
			} );
		} );
		return async () => {
			await act( async () => {
				land();
				await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
			} );
		};
	}

	/**
	 * Save a rename, then type a second one before the write lands.
	 *
	 * @return {Promise<void>} Resolves once the response has landed and
	 *                         everything it scheduled has been flushed.
	 */
	async function renameWhileTheWriteIsOut() {
		await renderEditor( { sequenceId: 7 } );
		const land = holdTheWrite();

		fireEvent.change( nameField(), { target: { value: 'First' } } );
		fireEvent.click( saveButton() );
		fireEvent.change( nameField(), { target: { value: 'Second' } } );

		await land();
	}

	it( 'is still on screen when the response lands on top of it', async () => {
		await renameWhileTheWriteIsOut();

		expect( nameField() ).toHaveValue( 'Second' );
		expect( saveButton() ).toBeEnabled();

		// Which sequence the baseline holds, said out loud: it is what the
		// server stored — "First" — so typing that back reads as clean, and
		// the second rename before it reads as the unsaved work it is.
		fireEvent.change( nameField(), { target: { value: 'First' } } );

		expect( saveButton() ).toBeDisabled();
	} );

	it( 'is work the way out still asks about', async () => {
		await renameWhileTheWriteIsOut();

		window.location.hash = '#/other';

		await screen.findByRole( 'dialog', {
			name: /Discard unsaved changes/,
		} );
		expect( window.location.hash ).toBe( '#/edit/7' );
	} );
} );

/**
 * The baseline has to arrive in the commit that confirms the save.
 *
 * The mirror of the load window, from both sides. A baseline that lands a
 * commit after the confirmation leaves that commit reading the wrong answer: if
 * it was CLEARED, the commit has no baseline at all — `isDirty` false, both
 * exit guards unregistered — and whatever is typed into the window is then
 * taken INTO the baseline by the retake instead of measured against it. If it
 * was merely left stale, the commit reads dirty on a sequence that was just
 * stored, and offers a write with nothing to write.
 *
 * The window is entered the way the load one is: from a `MutationObserver`
 * firing on the commit itself, which here is the commit that swaps the Save
 * button to "Saved!".
 */
describe( 'The commit that confirms a save', () => {
	/** Whether the Save button is currently showing the save as confirmed. */
	const confirmed = () =>
		screen
			.queryAllByRole( 'button' )
			.some( ( button ) => /Saved!/.test( button.textContent ) );

	it( 'both reads clean and registers a change typed into it', async () => {
		await renderEditor( { sequenceId: 7 } );

		fireEvent.change( nameField(), { target: { value: 'Renamed' } } );
		fireEvent.click( saveButton() );

		// Read at the confirming commit itself, before anything is typed into
		// it: the baseline is there, so the sequence that was just stored reads
		// as stored. A baseline still on its way would leave Save live here.
		let offeredNothingToSave;
		await typeAtTheCommit(
			() => {
				if ( ! confirmed() ) {
					return null;
				}
				offeredNothingToSave = screen
					.queryAllByRole( 'button' )
					.find( ( button ) =>
						/Saved!/.test( button.textContent )
					).disabled;
				return screen.queryAllByRole( 'textbox', {
					name: /^Name/,
				} )[ 0 ];
			},
			'Renamed Twice',
			'the save to be confirmed'
		);

		expect( offeredNothingToSave ).toBe( true );

		expect( nameField() ).toHaveValue( 'Renamed Twice' );
		expect( saveButton() ).toBeEnabled();

		// The baseline is the sequence the save stored, so typing that back
		// reads as clean. One taken from the canvas afterwards would hold
		// "Renamed Twice", calling this a change and the change before it
		// nothing — the polarity inverted, not merely lost.
		fireEvent.change( nameField(), { target: { value: 'Renamed' } } );

		expect( saveButton() ).toBeDisabled();
	} );
} );

/*
 * A metadata field the author started and did not finish.
 *
 * The inspector flags a row that carries a label and no key — "This field needs
 * a key. Saving is refused until it has one." — and the save has to make that
 * true. It used to drop any row missing either half from the payload instead, so
 * the write succeeded, the response reseated the field list without the row, and
 * the field the author configured disappeared under a success toast with nothing
 * naming it. The server refuses such a row by name
 * (`invalid_metadata_field_key` / `invalid_metadata_field_label`), so it has to
 * reach the server that refuses it.
 *
 * A row nobody has typed into is a different thing — incomplete rather than
 * wrong, which is why the inspector leaves it unflagged — and still never
 * leaves the editor.
 */
describe( 'A half-filled metadata field', () => {
	const storedWith = ( metadataFields ) =>
		sequence( {
			config: { ...sequence().config, metadata_fields: metadataFields },
		} );

	const renderWithFields = async ( metadataFields ) => {
		apiFetch.mockImplementation( ( { path, method, data } ) => {
			if ( path === '/vip-workflow/v1/sequences/options' ) {
				return Promise.resolve( OPTIONS );
			}
			if (
				path.startsWith( '/vip-workflow/v1/abilities' ) ||
				path === '/vip-workflow/v1/notifications/channels'
			) {
				return Promise.resolve( [] );
			}
			if ( method === 'POST' || method === 'PUT' ) {
				writes.push( { path, method, data } );
				return Promise.resolve( storedWith( metadataFields ) );
			}
			return Promise.resolve( storedWith( metadataFields ) );
		} );

		await renderEditor( { sequenceId: 7 } );
		fireEvent.change( nameField(), { target: { value: 'Renamed' } } );
		fireEvent.click( saveButton() );
		await waitFor( () => expect( writes ).toHaveLength( 1 ) );
	};

	it( 'is sent, so the refusal the inspector promised is the one that happens', async () => {
		await renderWithFields( [
			{ key: '', label: 'Section', type: 'text', required: false },
		] );

		expect( writes[ 0 ].data.metadata_fields ).toHaveLength( 1 );
		expect( writes[ 0 ].data.metadata_fields[ 0 ].label ).toBe( 'Section' );
	} );

	it( 'is sent when it is the label that is missing, for the same reason', async () => {
		await renderWithFields( [
			{ key: 'section', label: '', type: 'text', required: false },
		] );

		expect( writes[ 0 ].data.metadata_fields ).toHaveLength( 1 );
		expect( writes[ 0 ].data.metadata_fields[ 0 ].key ).toBe( 'section' );
	} );

	it( 'is not sent when nobody has typed into it at all', async () => {
		await renderWithFields( [
			{ key: '', label: '', type: 'text', required: false },
		] );

		expect( writes[ 0 ].data.metadata_fields ).toHaveLength( 0 );
	} );
} );

/**
 * A read the editor cannot be built without, that came back a failure.
 *
 * Two reads stand between an author and a canvas: what a sequence may be built
 * out of, and — for an existing sequence — the sequence itself. Neither has a
 * safe empty answer, so a failure blocks editing with the error rather than
 * drawing a canvas over what is not there.
 *
 * The sequence read used to baseline the blank sequence it opened on and clear
 * `loading` instead, which left an editable, empty canvas still pointed at the
 * row that failed to read: the validator refuses to save no stages, so adding
 * one stage was all it took to PUT a brand-new config over a sequence nobody
 * had seen.
 *
 * Blocking editing is also why the baseline goes: both exit guards are gated on
 * unsaved work, and they sit above the early return that replaces the editor
 * with the error, so a guard left attached restores the address and then waits
 * on a confirm dialog this render never draws.
 */
describe( 'A sequence the editor could not read', () => {
	beforeEach( () => {
		apiFetch.mockImplementation( ( { path } ) => {
			if ( path === '/vip-workflow/v1/sequences/options' ) {
				return Promise.resolve( OPTIONS );
			}
			if (
				path.startsWith( '/vip-workflow/v1/abilities' ) ||
				path === '/vip-workflow/v1/notifications/channels'
			) {
				return Promise.resolve( [] );
			}
			return Promise.reject(
				new Error( 'The sequence could not be read.' )
			);
		} );
	} );

	/**
	 * Render the editor on a sequence whose read fails, and settle.
	 *
	 * @return {Promise<void>} Resolves once the failure is on screen and the
	 *                         reads alongside it have landed.
	 */
	async function renderFailedRead() {
		render(
			<SequenceGraphEditor sequenceId={ 7 } onCancel={ jest.fn() } />
		);
		// `All`: the Notice is also announced through wp.a11y.speak, which
		// mirrors it into a live region, so the message is on screen twice.
		await screen.findAllByText( 'The sequence could not be read.' );
		await act( async () => {
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		} );
	}

	it( 'is not offered as an editable canvas over the row it failed to read', async () => {
		await renderFailedRead();

		// No canvas to add a stage to, and no Save to write it with — the two
		// halves of the overwrite this refuses to make possible.
		expect( screen.queryByTestId( 'canvas' ) ).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: /^(Save|Saving…|Saved!)$/ } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'textbox', { name: /^Name/ } )
		).not.toBeInTheDocument();
	} );

	it( 'leaves the way out open, having nothing to ask about and nothing to ask with', async () => {
		await renderFailedRead();

		window.location.hash = '#/other';

		await waitFor( () => expect( window.location.hash ).toBe( '#/other' ) );
		expect(
			screen.queryByRole( 'dialog', { name: /Discard unsaved changes/ } )
		).not.toBeInTheDocument();
	} );
} );

/**
 * The options read failing under an author who has already started.
 *
 * A new sequence opens on its canvas without waiting for anything, so the read
 * that decides what it may be built from is still out while the author types.
 * When it fails, the editor is replaced by the error — canvas, Save button and
 * confirm dialog all gone — and anything typed before that is work that can no
 * longer be saved OR discarded through the editor.
 *
 * So it must stop counting as work to guard. It used to: the hash guard put the
 * address back and awaited a dialog the blocked render never mounted, leaving
 * no prompt, no way on, and a reload as the only exit.
 */
describe( 'A new sequence whose options read fails under the author', () => {
	it( 'does not hold them with a question the blocked editor cannot ask', async () => {
		let failOptions;
		apiFetch.mockImplementation( ( { path } ) => {
			if ( path === '/vip-workflow/v1/sequences/options' ) {
				// Held open, so the author gets to type before it fails.
				return new Promise( ( resolve, reject ) => {
					failOptions = () =>
						reject( new Error( 'The options could not be read.' ) );
				} );
			}
			if (
				path.startsWith( '/vip-workflow/v1/abilities' ) ||
				path === '/vip-workflow/v1/notifications/channels'
			) {
				return Promise.resolve( [] );
			}
			return Promise.resolve( sequence() );
		} );

		render( <SequenceGraphEditor onCancel={ jest.fn() } /> );

		fireEvent.change(
			await screen.findByRole( 'textbox', { name: /^Name/ } ),
			{
				target: { value: 'Brand New' },
			}
		);
		// Both exit guards are gated on the same unsaved work this enables
		// Save with, so they are attached at this point — which is the state
		// the failure below has to take them out of.
		expect( saveButton() ).toBeEnabled();

		await act( async () => {
			failOptions();
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		} );

		await screen.findAllByText( 'The options could not be read.' );
		expect( screen.queryByTestId( 'canvas' ) ).not.toBeInTheDocument();

		// Leaving wp-admin: the browser is not asked to hold the author over
		// work the editor no longer offers any way to keep.
		const leaving = new Event( 'beforeunload', { cancelable: true } );
		window.dispatchEvent( leaving );
		expect( leaving.defaultPrevented ).toBe( false );

		// And Back: the address stands, rather than being put back to wait on
		// a dialog that is not on screen.
		window.location.hash = '#/other';

		await waitFor( () => expect( window.location.hash ).toBe( '#/other' ) );
		expect(
			screen.queryByRole( 'dialog', { name: /Discard unsaved changes/ } )
		).not.toBeInTheDocument();
	} );
} );

/*
 * What a new sequence opens on.
 *
 * It used to be one Draft stage: a start with no end, which the validator
 * refuses and the canvas flags twice over — nothing leaves Draft, nothing
 * finishes the flow. Typing a name and pressing Save, which is the whole of what
 * anyone does first, was met with a refusal they had not earned.
 *
 * It now opens on Draft → Published → End, which is the smallest thing that is
 * actually a workflow, and which the write gate accepts as it stands.
 */
describe( 'A sequence the author has only named', () => {
	it( 'saves as it opens, with nothing else drawn', async () => {
		await renderEditor();

		fireEvent.change( nameField(), { target: { value: 'Brand New' } } );
		fireEvent.click( saveButton() );

		await waitFor( () => expect( writes ).toHaveLength( 1 ) );
		expect( writes[ 0 ].method ).toBe( 'POST' );
		expect( writes[ 0 ].path ).toBe( '/vip-workflow/v1/sequences' );
	} );

	it( 'sends the pair wired the way the write gate requires', async () => {
		await renderEditor();

		fireEvent.change( nameField(), { target: { value: 'Brand New' } } );
		fireEvent.click( saveButton() );
		await waitFor( () => expect( writes ).toHaveLength( 1 ) );

		const statuses = writes[ 0 ].data.statuses;
		expect( statuses ).toHaveLength( 2 );

		// The flow enters at statuses[0], and new content is created as a
		// draft — so the entry has to be a draft-region stage.
		expect( statuses[ 0 ] ).toMatchObject( {
			key: 'draft',
			label: 'Draft',
			status: 'draft',
			region_entry: true,
			is_terminal: false,
			transitions: [ { to: 'publish' } ],
		} );
		// Published ends the flow, and is the publish region's checkpoint:
		// every used region needs exactly one, and Sequence::
		// prepare_config_for_write refuses a config that gets that wrong.
		expect( statuses[ 1 ] ).toMatchObject( {
			key: 'publish',
			label: 'Published',
			status: 'publish',
			region_entry: true,
			is_terminal: true,
			transitions: [],
		} );
	} );
} );

/*
 * A refused save, said in full.
 *
 * The editor used to show `errors[0]` — one reason, and the rule rather than the
 * fix. An author with three problems fixed one, pressed Save, and met the
 * second: the sequence looked broken a different way each time instead of broken
 * in three named ways once.
 */
describe( 'A save the editor refuses', () => {
	/**
	 * What the refusal notice says, or '' when there is no refusal.
	 *
	 * Scoped to the notice rather than asked of the screen, because `Notice`
	 * also speaks its message into wp.a11y's live region — which finds every
	 * message twice, and goes on holding the last one after the notice itself
	 * is gone.
	 *
	 * @return {string} The notice's text.
	 */
	const refusal = () =>
		document.querySelector( '.components-notice.is-error' )?.textContent ||
		'';

	it( 'names what is wrong and the control that fixes it', async () => {
		await renderEditor( { sequenceId: 7 } );

		fireEvent.change( nameField(), { target: { value: '' } } );
		fireEvent.click( saveButton() );

		expect( writes ).toHaveLength( 0 );
		expect( refusal() ).toContain( 'fill in Name in the Sequence panel' );
	} );

	it( 'lists every reason at once, rather than the first of them', async () => {
		await renderEditor( { sequenceId: 7 } );

		fireEvent.change( nameField(), { target: { value: '' } } );
		fireEvent.click( screen.getByRole( 'checkbox', { name: 'Posts' } ) );
		fireEvent.click( saveButton() );

		expect( writes ).toHaveLength( 0 );
		expect( refusal() ).toContain( '2 things need fixing' );
		expect( refusal() ).toContain( 'fill in Name in the Sequence panel' );
		expect( refusal() ).toContain( 'attached to no post type' );
	} );

	it( 'drops each reason as it is fixed, and goes away with the last', async () => {
		await renderEditor( { sequenceId: 7 } );

		fireEvent.change( nameField(), { target: { value: '' } } );
		fireEvent.click( screen.getByRole( 'checkbox', { name: 'Posts' } ) );
		fireEvent.click( saveButton() );
		expect( refusal() ).toContain( '2 things need fixing' );

		// One fixed: the notice stands, now saying the one thing that is left.
		fireEvent.click( screen.getByRole( 'checkbox', { name: 'Posts' } ) );
		expect( refusal() ).not.toContain( 'things need fixing' );
		expect( refusal() ).toContain( 'fill in Name in the Sequence panel' );

		// And the last: nothing stands in the way, so nothing says it does.
		fireEvent.change( nameField(), { target: { value: 'Named again' } } );
		expect( refusal() ).toBe( '' );
	} );

	it( 'is about this press, not about the failure before it', async () => {
		await renderEditor( { sequenceId: 7 } );

		// A save the server refuses: the notice carries what it said.
		const answerNormally = apiFetch.getMockImplementation();
		apiFetch.mockImplementation( ( options ) =>
			options.method === 'POST' || options.method === 'PUT'
				? Promise.reject( new Error( 'Internal server error' ) )
				: answerNormally( options )
		);
		fireEvent.change( nameField(), { target: { value: 'Renamed' } } );
		await act( async () => {
			fireEvent.click( saveButton() );
		} );
		expect( refusal() ).toContain( 'Internal server error' );

		// The next press never reaches the server, so the server's last word is
		// not an answer to it. The notice shows `error` in preference to the
		// reasons, so a refusal that left it standing would say nothing at all
		// about what is wrong now.
		fireEvent.change( nameField(), { target: { value: '' } } );
		fireEvent.click( saveButton() );

		expect( refusal() ).not.toContain( 'Internal server error' );
		expect( refusal() ).toContain( 'fill in Name in the Sequence panel' );
	} );
} );
