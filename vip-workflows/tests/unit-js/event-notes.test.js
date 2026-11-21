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
import { EventNotesModal } from '../../src/common/EventNotesModal';

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
		expect( props.title ).toBe( 'Transition notes' );
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

describe( 'sequence change notes', () => {
	it( 'renders an HTML stage name as text in the preview', () => {
		const label = '<img src=x onerror=alert(1)>';
		const notes = collectedNotes( {
			event_type: 'sequence.updated',
			event_data: {
				changes: { stages_added: [ { key: 'unsafe', label } ] },
			},
		} );
		const { container } = render(
			<EventNotes notes={ notes } onShowNotes={ () => {} } />
		);
		expect( container.querySelector( 'img' ) ).toBeNull();
		expect( container.textContent ).toContain( label );
	} );

	const update = ( changes ) => ( {
		event_type: 'sequence.updated',
		event_data: { statuses_count: 4, changes },
	} );
	const changes = {
		stages_added: [ { key: 'legal', label: 'Legal review' } ],
		transitions_changed: [
			{
				from: 'review',
				to: 'ready',
				from_label: 'Review',
				to_label: 'Ready',
				roles_added: [ { slug: 'editor', name: 'Editor' } ],
				roles_removed: [],
				tools_added: [],
				tools_removed: [],
			},
		],
	};

	it( 'lists what an update changed, one line per kind of change', () => {
		expect( collectedNotes( update( changes ) ) ).toEqual( [
			{ label: 'Stages added', value: 'Legal review' },
			{
				label: 'Transitions changed',
				value: 'Review → Ready: roles added Editor',
			},
		] );
	} );

	it( 'opens under its own title', () => {
		expect( notesDialogProps( update( changes ) ).title ).toBe(
			'Sequence changes'
		);
	} );

	it( 'names the old name, other fields, regions, agents and renames', () => {
		expect(
			collectedNotes(
				update( {
					fields_changed: [ 'name', 'post_types', 'stages' ],
					previous_name: 'Desk',
					stages_renamed: [
						{ key: 'review', from: 'Review', to: 'Copy desk' },
					],
					regions_changed: [
						{
							key: 'ready',
							label: 'Ready',
							from: 'pending',
							to: 'private',
						},
						{ key: 'old', label: 'Old', from: null, to: 'draft' },
					],
					agents_changed: [
						{ key: 'review', label: 'Copy desk', change: 'added' },
					],
					transitions_removed: [
						{ from: 'a', to: 'b', from_label: 'A', to_label: 'B' },
					],
				} )
			)
		).toEqual( [
			{ label: 'Name changed from', value: 'Desk' },
			{ label: 'Also changed', value: 'post types, stage details' },
			{ label: 'Stages renamed', value: 'Review → Copy desk' },
			{
				label: 'Stage regions changed',
				value: 'Ready: Pending Review → Private, Old: none → Draft',
			},
			{ label: 'AI stages changed', value: 'Copy desk: agent added' },
			{ label: 'Transitions removed', value: 'A → B' },
		] );
	} );

	describe( 'a capped list', () => {
		// The server keeps the first 50 entries of a list and counts the rest.
		const stages = ( count ) =>
			Array.from( { length: count }, ( _, i ) => ( {
				key: `s${ i }`,
				label: `S${ i }`,
			} ) );

		it( 'adds no closing line when nothing was left out', () => {
			const notes = collectedNotes(
				update( { stages_added: stages( 1 ) } )
			);

			expect( notes ).toEqual( [
				{ label: 'Stages added', value: 'S0' },
			] );
		} );

		it( 'adds no closing line at exactly the cap', () => {
			const notes = collectedNotes(
				update( { stages_added: stages( 50 ) } )
			);

			expect( notes ).toHaveLength( 1 );
			expect( notes[ 0 ].label ).toBe( 'Stages added' );
		} );

		it( 'closes with one more change', () => {
			const notes = collectedNotes(
				update( {
					stages_added: stages( 50 ),
					truncated: { stages_added: 1 },
				} )
			);

			expect( notes.at( -1 ) ).toEqual( {
				label: '',
				value: 'And 1 more change',
			} );
			expect( notes[ 0 ].value ).not.toMatch( /more/ );
		} );

		it( 'closes with the total every capped list left out', () => {
			const notes = collectedNotes(
				update( {
					stages_added: stages( 50 ),
					transitions_added: [
						{ from: 'a', to: 'b', from_label: 'A', to_label: 'B' },
					],
					truncated: { stages_added: 5, transitions_added: 7 },
				} )
			);

			expect( notes ).toHaveLength( 3 );
			expect( notes.at( -1 ) ).toEqual( {
				label: '',
				value: 'And 12 more changes',
			} );
		} );

		it( 'shows the closing line in the dialog without a label', () => {
			render(
				<EventNotesModal
					title="Sequence changes"
					notes={ [
						{ label: 'Stages added', value: 'A' },
						{ label: '', value: 'And 12 more changes' },
					] }
					onClose={ () => {} }
				/>
			);

			expect(
				screen.getByText( 'And 12 more changes' )
			).toBeInTheDocument();
			expect(
				document.querySelectorAll(
					'.vip-workflows-event-note-item__label'
				)
			).toHaveLength( 1 );
		} );

		it( 'previews the closing line without a label', () => {
			render(
				<EventNotes
					notes={ [
						{ label: 'Stages added', value: 'A' },
						{ label: '', value: 'And 12 more changes' },
					] }
					onShowNotes={ () => {} }
				/>
			);

			expect(
				screen.getByText( 'Stages added: A · And 12 more changes' )
			).toBeInTheDocument();
		} );
	} );

	it( 'offers nothing for a row written before the summary', () => {
		const old = {
			event_type: 'sequence.updated',
			event_data: { statuses_count: 5 },
		};

		expect( collectedNotes( old ) ).toEqual( [] );
		expect( notesDialogProps( old ).title ).toBe( 'Transition notes' );
	} );
} );
