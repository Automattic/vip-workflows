/**
 * Unit tests for the activity-rail event icons.
 *
 * Both activity views — the admin Audit Log and the editor's Workflow History
 * modal — hand DataViews an `event_icon` field as their `mediaField`, so the
 * timeline disc carries a glyph for the event type instead of a plain bullet.
 *
 * The list of slugs below is written out rather than read off the icon map on
 * purpose: it is the independent statement of what must be covered. Drop an
 * event type from the map and its row silently falls back to the retired-slug
 * glyph, which is exactly what these tests catch.
 *
 * @package
 */

import { render } from './helpers/render-wp-component';
import { EventTypeIcon } from '../../src/common/EventTypeIcon';
import { eventIconField } from '../../src/common/workflow-event-fields';

// Every event type the plugin writes, with the tone its glyph must carry.
//
// Both writers are covered: StatusManager and the ability tools (the transition
// and configuration events) and the automation EventBus, which stores every
// event it emits into the same table — so the audit log serves those too. The
// two `stage.*` entries stand in for the per-stage family, whose slugs carry the
// stage key and so cannot be listed.
const EVENT_TYPES = {
	status_transition: 'success',
	transition_blocked: 'error',
	tool_warnings: 'warning',
	'workflow.assigned': 'info',
	'workflow.removed': 'warning',
	'post.claimed': 'info',
	'post.released': 'neutral',
	'ability.executed': 'info',
	'ability.failed': 'error',
	'sequence.updated': 'neutral',
	'sequence.activated': 'success',
	'sequence.deactivated': 'neutral',
	'post.stage_changed': 'success',
	'post.workflow_assigned': 'info',
	'post.workflow_completed': 'success',
	'post.published': 'success',
	'post.sla_warning': 'warning',
	'sla.warning': 'warning',
	'post.sla_breached': 'error',
	'sla.breached': 'error',
	'goal.at_risk': 'warning',
	'task.created': 'info',
	'task.completed': 'success',
	'stage.copy_desk.entered': 'info',
	'stage.copy_desk.completed': 'success',
};

/**
 * The concatenated path data of the rendered glyph — its identity, for the
 * purpose of telling one icon from another.
 *
 * @param {string} eventType Event-type slug.
 * @return {string} Path data.
 */
function glyphOf( eventType ) {
	const { container } = render( <EventTypeIcon eventType={ eventType } /> );

	return Array.from( container.querySelectorAll( 'path' ) )
		.map( ( path ) => path.getAttribute( 'd' ) )
		.join( '|' );
}

describe( 'EventTypeIcon', () => {
	it.each( Object.entries( EVENT_TYPES ) )(
		'%s carries the %s tone',
		( eventType, tone ) => {
			const { container } = render(
				<EventTypeIcon eventType={ eventType } />
			);
			const svg = container.querySelector( 'svg' );

			expect( svg ).toHaveClass( 'vip-workflow-event-icon' );
			expect( svg ).toHaveClass( `vip-workflow-event-icon--${ tone }` );
		}
	);

	it( 'claims every event type, leaving none on the generic glyph', () => {
		// The property that matters, and the one that catches a map entry going
		// missing. Not distinctness: some of these are one occurrence surfaced by
		// two subsystems (a stage change is both `status_transition` and
		// `post.stage_changed`), and those are meant to draw alike.
		const generic = glyphOf( 'nothing.claims.this' );
		const unclaimed = Object.keys( EVENT_TYPES ).filter(
			( eventType ) => glyphOf( eventType ) === generic
		);

		expect( unclaimed ).toEqual( [] );
	} );

	it( 'matches the per-stage family by pattern, whatever the stage is called', () => {
		// The stage key is part of the slug, so no literal map can hold these.
		const entered = glyphOf( 'stage.copy_desk.entered' );

		expect( glyphOf( 'stage.some_other_stage.entered' ) ).toBe( entered );
		expect( entered ).not.toBe( glyphOf( 'nothing.claims.this' ) );
	} );

	it( 'draws a neutral disc for a slug nothing claims', () => {
		// An extension may register events of its own, and the type filter is
		// built from the distinct slugs the table holds, so an unknown row must
		// still draw something on the rail.
		const { container } = render(
			<EventTypeIcon eventType="acme.some_extension_event" />
		);
		const svg = container.querySelector( 'svg' );

		expect( svg ).toHaveClass( 'vip-workflow-event-icon--neutral' );
		expect( svg.querySelector( 'path' ) ).not.toBeNull();
	} );

	it( 'hides the glyph from assistive technology', () => {
		// Every entry names its event in its own title; announcing the
		// decorative disc as well would say it twice.
		const { container } = render(
			<EventTypeIcon eventType="status_transition" />
		);

		expect( container.querySelector( 'svg' ) ).toHaveAttribute(
			'aria-hidden',
			'true'
		);
	} );
} );

describe( 'eventIconField', () => {
	it( 'is named event_icon, so a view can point mediaField at it', () => {
		expect( eventIconField().id ).toBe( 'event_icon' );
	} );

	it( 'takes no part in sorting, filtering or field hiding', () => {
		const field = eventIconField();

		expect( field.enableSorting ).toBe( false );
		expect( field.enableHiding ).toBe( false );
		expect( field.filterBy ).toBe( false );
	} );

	it( 'reads the event type off the item both routes now serve', () => {
		const field = eventIconField();
		const item = { event_type: 'ability.failed', event_data: {} };

		expect( field.getValue( { item } ) ).toBe( 'ability.failed' );

		const { container } = render( field.render( { item } ) );

		expect( container.querySelector( 'svg' ) ).toHaveClass(
			'vip-workflow-event-icon--error'
		);
	} );
} );
