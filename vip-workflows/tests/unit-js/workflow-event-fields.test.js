/**
 * Unit tests for the shared workflow-event fields and actions.
 *
 * An event entry is drawn by the DataViews `activity` layout and nothing else:
 * a glyph on the rail, a title naming the type, a one-sentence description, the
 * event's attributes as fields in the meta row, and anything a reader can *do*
 * with the entry in the layout's ellipsis menu. These pin that division, because
 * it is the one both views used to drift away from — each interpreting an event
 * with markup of its own.
 *
 * @package
 */

import { render } from './helpers/render-wp-component';
import {
	activityView,
	eventActorField,
	eventDescriptionField,
	eventPostField,
	eventTypeField,
	eventWorkflowField,
	viewNotesAction,
} from '../../src/common/workflow-event-fields';

const STAGE_CHANGE = {
	id: 1,
	event_type: 'status_transition',
	event_type_label: 'Stage Changed',
	event_data: {
		from_label: 'Ideas',
		to_label: 'Copy Desk',
		sequence_name: 'Editorial Sequence',
	},
	actor: { type: 'user', display_name: 'Ada Lovelace' },
	created_at: '2026-01-01 00:00:00',
};

describe( 'the fields DataViews renders itself', () => {
	// A field with a `render` of its own is markup this plugin controls; a field
	// with only `getValue` is drawn by DataViews. Everything an event says in
	// words is the second kind.
	it.each( [
		[ 'event_type', eventTypeField() ],
		[ 'sequence', eventWorkflowField() ],
	] )( '%s answers with a value, not a render', ( id, field ) => {
		expect( field.id ).toBe( id );
		expect( field.render ).toBeUndefined();
		expect( typeof field.getValue( { item: STAGE_CHANGE } ) ).toBe(
			'string'
		);
	} );

	// The description is the one field with both: the line is its value, so
	// search and sort see what a reader sees, and the render exists only to add
	// the clamped notes preview under it.
	it( 'describes the event in one natural sentence', () => {
		// The title above is the post, so the kind of event has to be said here
		// rather than standing over the entry as a heading.
		const field = eventDescriptionField( { onShowNotes: () => {} } );

		expect( field.id ).toBe( 'details' );
		expect( field.getValue( { item: STAGE_CHANGE } ) ).toBe(
			'Stage changed from Ideas to Copy Desk'
		);
	} );

	it( 'titles an entry with the type in words, not the stored slug', () => {
		// The label rides on every row, so the title is right on first paint and
		// in a view that offers no type filter and so has no elements to map it.
		expect( eventTypeField().getValue( { item: STAGE_CHANGE } ) ).toBe(
			'Stage Changed'
		);
	} );

	it( 'keeps the type filter keyed on the slug the query takes', () => {
		const field = eventTypeField( {
			elements: [
				{ value: 'status_transition', label: 'Stage Changed' },
			],
			enableFiltering: true,
		} );

		expect( field.elements[ 0 ].value ).toBe( 'status_transition' );
		expect( field.filterBy.operators ).toEqual( [ 'isAny' ] );
	} );

	it( 'titles an entry with the post, as a heading', () => {
		const { container } = render(
			eventPostField().render( {
				item: { ...STAGE_CHANGE, post: { title: 'Hello world!' } },
			} )
		);

		expect( container.textContent ).toBe( 'Hello world!' );
		// The <Text> variant, not a class of this plugin's own.
		expect( container.firstChild.className ).toMatch( /heading-lg/ );
	} );

	it( 'draws no title at all for an event with no post', () => {
		// A sequence being edited did not happen to a post. Rendering nothing —
		// rather than an empty heading — is what lets the layout's title slot
		// collapse instead of leaving a blank band above the description.
		expect(
			eventPostField().render( { item: { ...STAGE_CHANGE, post: null } } )
		).toBeNull();
		expect(
			eventPostField().getValue( {
				item: { ...STAGE_CHANGE, post: null },
			} )
		).toBe( '' );
	} );

	it( 'gives the sequence a field of its own', () => {
		expect( eventWorkflowField().getValue( { item: STAGE_CHANGE } ) ).toBe(
			'Editorial Sequence'
		);
	} );

	it( 'empties the sequence slot for an event with no sequence', () => {
		// The layout hides a meta field whose value is empty, so an ability run
		// outside a workflow drops the slot rather than carrying a placeholder.
		expect(
			eventWorkflowField().getValue( {
				item: { ...STAGE_CHANGE, event_data: {} },
			} )
		).toBe( '' );
	} );

	// The one field that cannot answer with a string: an avatar, or the glyph
	// that says an agent rather than a person made the entry. What it draws for
	// each kind of actor is covered in author-cell.test.js.
	it( 'draws the actor as this plugin draws an actor everywhere else', () => {
		const { container } = render(
			eventActorField().render( {
				item: {
					...STAGE_CHANGE,
					actor: { type: 'agent', display_name: 'Fact Check Agent' },
				},
			} )
		);

		expect( container.textContent ).toContain( 'Fact Check Agent' );
		expect(
			container.querySelector( '.vip-workflows-dataview-author' )
		).not.toBeNull();
	} );
} );

describe( 'viewNotesAction', () => {
	it( 'is offered only by an entry that collected input', () => {
		const action = viewNotesAction( { onShowNotes: () => {} } );
		const withNotes = ( notes ) =>
			action.isEligible( {
				...STAGE_CHANGE,
				event_data: { ...STAGE_CHANGE.event_data, notes },
			} );

		expect( action.isEligible( STAGE_CHANGE ) ).toBeFalsy();
		expect( withNotes( [ { label: 'A', value: 'Ada Lovelace' } ] ) ).toBe(
			true
		);
		// An input field the author left blank is not input collected, so the
		// menu does not offer a dialog with nothing in it.
		expect( withNotes( [ { label: 'A', value: '' } ] ) ).toBe( false );
	} );

	it( 'is not primary, so the layout files it in the ellipsis menu', () => {
		expect(
			viewNotesAction( { onShowNotes: () => {} } ).isPrimary
		).toBeFalsy();
	} );

	it( 'hands the dialog the notes the entry recorded', () => {
		const onShowNotes = jest.fn();
		const notes = [ { label: 'Assignee', value: 'Ada Lovelace' } ];

		viewNotesAction( { onShowNotes } ).callback( [
			{
				...STAGE_CHANGE,
				event_data: { ...STAGE_CHANGE.event_data, notes },
			},
		] );

		expect( onShowNotes ).toHaveBeenCalledWith(
			expect.objectContaining( { notes } )
		);
	} );
} );

describe( 'activityView', () => {
	it( 'gives each stream its own nested state', () => {
		// Two views seeded from one literal would hold the same `sort` object, and
		// a re-sort in one would silently reach the other.
		const one = activityView( {} );
		const other = activityView( {} );

		expect( one.sort ).not.toBe( other.sort );
		expect( one.layout ).not.toBe( other.layout );
	} );

	it( 'points the description and media roles at the shared fields', () => {
		const view = activityView( {} );

		expect( view.descriptionField ).toBe(
			eventDescriptionField( { onShowNotes: () => {} } ).id
		);
		expect( view.mediaField ).toBe( 'event_icon' );
		// A role field listed in `fields` too would be drawn twice.
		expect( view.fields ?? [] ).not.toContain( view.descriptionField );
	} );
} );
