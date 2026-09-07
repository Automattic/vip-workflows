/**
 * Sequences Page Component
 *
 * Wrapper for sequence management with hash-based routing.
 *
 * @package
 */

import { useCallback, useEffect, useState } from '@wordpress/element';

import { SequencesList } from '../components/SequencesList';
import SequenceGraphEditor from '../components/graph/SequenceGraphEditor';

/**
 * Sequences page component.
 *
 * @return {JSX.Element} Sequences page.
 */
export default function Sequences() {
	const [ refreshKey, setRefreshKey ] = useState( 0 );

	// The sequence the `#/new` editor created, once it has one. The address
	// moves to that row so a reload lands on it, and this is what says the
	// editor already on screen is what that address now means — see the edit
	// route below.
	const [ createdId, setCreatedId ] = useState( null );

	const navigateToList = () => {
		window.location.hash = '';
		setRefreshKey( ( k ) => k + 1 );
	};

	// Saving does not come back here. The editor stays on the sequence it saved
	// and says so on its own button, so there is nothing for this page to do
	// with a save — except the one thing only the router can do: a save that
	// CREATED the sequence changes which row the address should name, and the
	// address is this page's.
	//
	// `replaceState`, not an assignment to `location.hash`: the address should
	// name the sequence that now exists, but a hashchange would route the
	// shell, and the editor already holding that sequence is what belongs on
	// screen.
	const adoptCreated = useCallback( ( id ) => {
		window.history.replaceState( null, '', `#/edit/${ id }` );
		setCreatedId( id );
	}, [] );

	// Determine view from hash. Each editor renders its own full-bleed AdminPage
	// (header, breadcrumbs, and the canvas + inspector own the surface).
	//
	// Read on every render rather than held in state, because the address is
	// changed by things this page does not hear about in order: the editor's own
	// exit guard undoes a hash change synchronously, before React flushes, so a
	// route captured off the `hashchange` event would route to a departure that
	// was called off.
	const hash = window.location.hash;

	const editPhaseMatch = hash.match( /^#\/edit-phase\/(\d+)/ );
	const editMatch = hash.match( /^#\/edit\/(\d+)/ );

	// Whether the address still names the sequence the mounted editor created.
	// It stops as soon as the author routes anywhere else, and the created id
	// goes with it: coming back to `#/edit/{id}` later is a fresh visit to a
	// stored row, not a return to an editor that no longer exists.
	const showingCreated =
		createdId !== null &&
		editMatch !== null &&
		+editMatch[ 1 ] === createdId;

	useEffect( () => {
		if ( createdId !== null && ! showingCreated ) {
			setCreatedId( null );
		}
	}, [ createdId, showingCreated ] );

	// Each route gets its own editor, by `key`. Reconciling one in place across
	// a route change hands the next sequence the last one's state: going from
	// `#/edit-phase/3` to `#/edit/7` flips `isPhase`, so a four-field phase
	// baseline is compared against a nine-field workflow snapshot and the
	// editor reads as changed before anyone has touched it — on top of a
	// `loading` that already finished, the previous sequence's canvas, and a
	// `savedId` still pointing at the row the last route was writing to.
	//
	// The identity is the route, not the hash it was reached by:
	// `#/new?type=workflow` and the plain `#/new` the editor's own exit guard
	// puts back name the same editor, and a key that told those apart would
	// tear it down in the middle of the question it is asking.
	//
	// A sequence that was just created is the one place where two addresses name
	// ONE editor: `#/new` before the save and `#/edit/{id}` after it. The key
	// and the props stay the ones it mounted with, because that editor already
	// holds the saved sequence — and whatever has been typed into it since.
	// Re-keying it to the row instead would remount it and read the row back
	// over that work.
	if ( hash.startsWith( '#/new' ) || showingCreated ) {
		return (
			<SequenceGraphEditor
				key="new"
				mode="workflow"
				onCancel={ navigateToList }
				onCreated={ adoptCreated }
			/>
		);
	}

	if ( editPhaseMatch ) {
		return (
			<SequenceGraphEditor
				key={ `phase-${ editPhaseMatch[ 1 ] }` }
				sequenceId={ parseInt( editPhaseMatch[ 1 ], 10 ) }
				mode="phase"
				onCancel={ navigateToList }
			/>
		);
	}

	if ( editMatch ) {
		return (
			<SequenceGraphEditor
				key={ `workflow-${ editMatch[ 1 ] }` }
				sequenceId={ parseInt( editMatch[ 1 ], 10 ) }
				mode="workflow"
				onCancel={ navigateToList }
			/>
		);
	}

	// List view — SequencesList renders its own AdminPage so its tab-specific
	// add/import actions live in the header alongside the tab state.
	return <SequencesList key={ refreshKey } />;
}
