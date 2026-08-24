/**
 * Unit tests for the shared author cell.
 *
 * Three kinds of actor turn up in the plugin's lists — a person, an agent, and
 * the site itself — and they must read as one column: the same box in the same
 * place, differing only in what fills it. These pin that shape, and that an
 * agent-made entry stays distinguishable from a person's at a glance.
 */

import { render } from './helpers/render-wp-component';
import { AuthorCell } from '../../src/common/DataViewCells';
import { eventActorField } from '../../src/common/workflow-event-fields';

const html = ( ui ) => render( ui ).container.innerHTML;

// The shape every route serves (see `VIPWorkflow\Workflow\Actor`). Built here
// rather than spelled out per test so a test reads as "this person" instead of
// as three loose props.
const person = {
	type: 'user',
	display_name: 'Ada Lovelace',
	avatar: 'https://example.test/a.png',
};
const agent = {
	type: 'agent',
	display_name: 'Fact Check Agent',
	avatar: null,
};
const site = { type: 'system', display_name: 'System', avatar: null };

describe( 'AuthorCell', () => {
	it( 'gives every kind of actor the same avatar box', () => {
		// The point of the cell: a mixed column lines up, because the picture,
		// the initials and the two glyphs all occupy one shape.
		[ person, agent, site ].forEach( ( actor ) => {
			const { container } = render( <AuthorCell actor={ actor } /> );

			expect(
				container.querySelector( '.vip-workflow-dataview-avatar' )
			).not.toBeNull();
		} );
	} );

	it( 'renders a person with their picture and their name', () => {
		const out = html( <AuthorCell actor={ person } /> );

		expect( out ).toContain( 'Ada Lovelace' );
		expect( out ).toContain( 'vip-workflow-dataview-avatar--user' );
	} );

	it( 'renders an agent with the sparkle in place of a picture', () => {
		const { container } = render( <AuthorCell actor={ agent } /> );

		expect( container.textContent ).toContain( 'Fact Check Agent' );
		expect(
			container.querySelector(
				'.vip-workflow-dataview-avatar--agent svg'
			)
		).not.toBeNull();
		// The AI tone rides on the modifier class, so an agent is not mistakable
		// for a person whose avatar simply failed to load.
		expect( container.innerHTML ).not.toContain( '<img' );
	} );

	it( 'renders the site itself with the WordPress mark', () => {
		const { container } = render( <AuthorCell actor={ site } /> );

		expect( container.textContent ).toContain( 'System' );
		expect(
			container.querySelector(
				'.vip-workflow-dataview-avatar--system svg'
			)
		).not.toBeNull();
	} );

	it( 'never takes a picture for an actor that is not a person', () => {
		// An agent row carries no avatar URL, but nothing should reach the
		// <img> even if one were handed over: the glyph is the whole answer.
		const { container } = render(
			<AuthorCell
				actor={ { ...agent, avatar: 'https://example.test/a.png' } }
			/>
		);

		expect( container.innerHTML ).not.toContain( 'example.test' );
	} );

	it( 'draws nothing at all without an actor or a name', () => {
		expect( html( <AuthorCell actor={ undefined } /> ) ).toBe( '' );
		expect( html( <AuthorCell actor={ null } /> ) ).toBe( '' );
		expect(
			html( <AuthorCell actor={ { ...agent, display_name: '' } } /> )
		).toBe( '' );
	} );

	it( 'renders the trailing slot after the name, inside the row', () => {
		// The slot is where a call site puts what its own context adds about
		// this person — a Kanban card's "assigned", the editor's "(you)". It
		// has to sit inside the cell so it stays on the avatar's centre line.
		const { container } = render(
			<AuthorCell actor={ person }>
				<em>(you)</em>
			</AuthorCell>
		);

		const row = container.querySelector( '.vip-workflow-dataview-author' );
		const slot = row.querySelector( 'em' );
		const name = row.querySelector( '.vip-workflow-dataview-author__name' );

		expect( slot ).not.toBeNull();
		// Inside the row, and immediately after the name.
		expect( row.contains( slot ) ).toBe( true );
		expect( name.nextElementSibling ).toBe( slot );
	} );

	it( 'exposes the name as its own element so a call site can truncate it', () => {
		const { container } = render( <AuthorCell actor={ person } /> );

		expect(
			container.querySelector( '.vip-workflow-dataview-author__name' )
				.textContent
		).toBe( 'Ada Lovelace' );
	} );
} );

describe( 'eventActorField', () => {
	const actorCell = ( actor ) =>
		render( eventActorField().render( { item: { actor } } ) );

	it( 'credits a person by name, with their avatar', () => {
		const { container } = actorCell( {
			type: 'user',
			display_name: 'Ada Lovelace',
			avatar: 'https://example.test/a.png',
		} );

		expect( container.textContent ).toContain( 'Ada Lovelace' );
		expect( container.innerHTML ).toContain(
			'vip-workflow-dataview-avatar--user'
		);
	} );

	it( 'credits an agent to the ability that acted', () => {
		const { container } = actorCell( {
			type: 'agent',
			display_name: 'Fact Check Agent',
			avatar: null,
		} );

		expect( container.textContent ).toContain( 'Fact Check Agent' );
		expect( container.innerHTML ).toContain(
			'vip-workflow-dataview-avatar--agent'
		);
	} );

	it( 'reads an event no user can be credited for as the site itself', () => {
		// The route omits the actor rather than inventing a user, so the
		// reading — a cron run, a deleted account — is made here.
		const { container } = actorCell( null );

		expect( container.textContent ).toContain( 'System' );
		expect( container.innerHTML ).toContain(
			'vip-workflow-dataview-avatar--system'
		);
	} );
} );
