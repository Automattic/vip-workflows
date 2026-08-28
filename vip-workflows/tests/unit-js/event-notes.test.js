/**
 * Unit tests for the notes preview under an event's description.
 *
 * A transition's collected input is previewed in the entry and read in full from
 * a dialog. These pin which notes count as collected at all, what the preview
 * says, and the one thing that decides whether "View more" is offered: whether
 * the clamp actually caught anything.
 */

import { render, screen, fireEvent } from './helpers/render-wp-component';
import {
	collectedNotes,
	EventNotes,
	notesDialogProps,
} from '../../src/common/EventNotes';

const event = ( notes ) => ( { event_data: { notes } } );

/**
 * Run `fn` with the layout jsdom does not do: an element whose content is
 * `scroll` tall inside a box clamped to `client`.
 *
 * @param {number}   scroll Full content height.
 * @param {number}   client Clamped height.
 * @param {Function} fn     What to run.
 */
function withHeights( scroll, client, fn ) {
	// Both live on Element, not HTMLElement, and jsdom answers 0 to each.
	const proto = window.Element.prototype;
	const saved = Object.entries( {
		scrollHeight: scroll,
		clientHeight: client,
	} ).map( ( [ name, value ] ) => {
		const descriptor = Object.getOwnPropertyDescriptor( proto, name );
		Object.defineProperty( proto, name, {
			configurable: true,
			get: () => value,
		} );
		return [ name, descriptor ];
	} );

	try {
		fn();
	} finally {
		saved.forEach( ( [ name, descriptor ] ) =>
			Object.defineProperty( proto, name, descriptor )
		);
	}
}

describe( 'collectedNotes', () => {
	it( 'keeps the answers someone actually wrote', () => {
		expect(
			collectedNotes(
				event( [ { label: 'Assignee', value: 'Ada Lovelace' } ] )
			)
		).toHaveLength( 1 );
	} );

	it( 'drops an optional field that was left blank', () => {
		// The transition records every input field it asked for, answered or
		// not, so a blank arrives as a note with an empty value. Printed, it
		// would read as a label with nothing after it.
		expect(
			collectedNotes(
				event( [
					{ label: 'Note', value: '' },
					{ label: 'Reason', value: '   ' },
				] )
			)
		).toEqual( [] );
	} );

	it( 'has nothing to collect from a transition that asked for nothing', () => {
		expect( collectedNotes( event( undefined ) ) ).toEqual( [] );
	} );
} );

describe( 'notesDialogProps', () => {
	it( 'opens on the collected answers, under one title', () => {
		// Both ways in — the preview's link and the ellipsis menu — go through
		// this, so the dialog is the same dialog whichever opened it.
		const props = notesDialogProps(
			event( [
				{ label: 'Assignee', value: 'Ada Lovelace' },
				{ label: 'Reason', value: '' },
			] )
		);

		expect( props.notes ).toEqual( [
			{ label: 'Assignee', value: 'Ada Lovelace' },
		] );
		expect( props.title ).toBe( 'Transition Notes' );
	} );
} );

describe( 'EventNotes', () => {
	const notes = [
		{ label: 'Assignee', value: 'Ada Lovelace' },
		{ label: 'Reason', value: 'needs a second pass' },
	];

	it( 'labels each answer, so several read as answers to questions', () => {
		const { container } = render(
			<EventNotes notes={ notes } onShowNotes={ () => {} } />
		);

		expect(
			container.querySelector( '.vip-workflows-event-notes' ).textContent
		).toBe( 'Assignee: Ada Lovelace · Reason: needs a second pass' );
	} );

	it( "collapses an answer's own line breaks into the run of text", () => {
		// The preview wraps where the column ends, not where the author pressed
		// return.
		const { container } = render(
			<EventNotes
				notes={ [ { label: 'Note', value: ' one\n\n two \n' } ] }
				onShowNotes={ () => {} }
			/>
		);

		expect(
			container.querySelector( '.vip-workflows-event-notes' ).textContent
		).toBe( 'Note: one two' );
	} );

	it( 'offers no way to view more when nothing was cut', () => {
		withHeights( 32, 32, () =>
			render( <EventNotes notes={ notes } onShowNotes={ () => {} } /> )
		);

		expect( screen.queryByText( 'View more' ) ).not.toBeInTheDocument();
	} );

	it( 'offers to view more once the clamp has caught something', () => {
		withHeights( 96, 32, () =>
			render( <EventNotes notes={ notes } onShowNotes={ () => {} } /> )
		);

		expect( screen.getByText( 'View more' ) ).toBeInTheDocument();
	} );

	it( 'ignores a height that differs only by a sub-pixel rounding', () => {
		// A note that fits exactly can measure a fraction taller than its box.
		withHeights( 32.5, 32, () =>
			render( <EventNotes notes={ notes } onShowNotes={ () => {} } /> )
		);

		expect( screen.queryByText( 'View more' ) ).not.toBeInTheDocument();
	} );

	it( 'opens the dialog from the link', () => {
		const onShowNotes = jest.fn();

		withHeights( 96, 32, () =>
			render( <EventNotes notes={ notes } onShowNotes={ onShowNotes } /> )
		);
		fireEvent.click( screen.getByText( 'View more' ) );

		expect( onShowNotes ).toHaveBeenCalled();
	} );
} );
