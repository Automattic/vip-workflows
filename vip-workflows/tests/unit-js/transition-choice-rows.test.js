/**
 * The transition's two multi-selects, as summary rows rather than tick sheets.
 *
 * Allowed roles and Notifications each used to render one checkbox per thing the
 * site had, always expanded, taking the panel's height in proportion to how many
 * roles and channels were installed rather than to what the transition used.
 * Each is now one line — what it is, what it is set to — that opens its
 * checkboxes in a popover.
 *
 * What the line says is most of the point, so most of this covers that: "All"
 * and "None" as the empty states, names giving way to a count once they stop
 * fitting, and a button whose accessible name carries the value rather than only
 * the label. The rest covers what the line opens — a named group of checkboxes,
 * and the field each one writes back.
 *
 * Notifications also proves the other half of the rule: a channel this site has
 * not set up is not on the list to be CHOSEN. Greyed out it read as a capability
 * withheld from the author; absent, it reads as what it is — the dispatcher
 * skips an unconfigured channel before it sends, so it would notify nobody.
 *
 * What IS chosen is never hidden, which is the same rule from the other side and
 * the sharper half of it. The row asserts what the transition is set to, and the
 * server acts on the stored array whatever the editor can resolve of it: an
 * unconfigured channel keeps sending the day its webhook comes back, a role slug
 * no plugin answers to still restricts. Both keep their place on the row and
 * their box in the popover, saying what is wrong with them.
 *
 * @package
 */

import { render, screen, fireEvent, act } from './helpers/render-wp-component';

import TransitionInspector from '../../src/admin/components/graph/TransitionInspector';

const ROLES = [
	{ slug: 'administrator', name: 'Administrator' },
	{ slug: 'editor', name: 'Editor' },
	{ slug: 'author', name: 'Author' },
	{ slug: 'contributor', name: 'Contributor' },
	{ slug: 'subscriber', name: 'Subscriber' },
];

const CHANNELS = [
	{ id: 'email', name: 'Email', configured: true },
	{ id: 'slack', name: 'Slack', configured: false },
];

function renderInspector( {
	transition,
	channels = CHANNELS,
	onChange = () => {},
} ) {
	render(
		<TransitionInspector
			transition={ transition }
			sourceLabel="Draft"
			targetLabel="Review"
			availableRoles={ ROLES }
			availableTools={ [] }
			toolsLoaded
			availableChannels={ channels }
			onChange={ onChange }
			onRemove={ () => {} }
		/>
	);
}

/**
 * Press a summary row open.
 *
 * @param {string} name The row's accessible name, value and all.
 */
async function openRow( name ) {
	await act( async () => {
		fireEvent.click( screen.getByRole( 'button', { name } ) );
	} );
}

describe( 'Allowed roles', () => {
	it( 'reads All when the transition restricts nobody', () => {
		// Truthful rather than a new mechanism: an empty `allowed_roles` skips
		// the permission check outright, so the transition really is open to
		// everyone.
		renderInspector( { transition: { to: 'review' } } );

		expect(
			screen.getByRole( 'button', { name: 'Allowed roles: All' } )
		).toBeInTheDocument();
	} );

	it( 'names the roles while the names fit', () => {
		renderInspector( {
			transition: { to: 'review', allowed_roles: [ 'editor', 'author' ] },
		} );

		expect(
			screen.getByRole( 'button', {
				name: 'Allowed roles: Editor, Author',
			} )
		).toBeInTheDocument();
	} );

	it( 'counts them once the names stop fitting', () => {
		// "Administrator, Contributor, Subscriber" is longer than the value end
		// of a row in a 360px panel, and a list that wraps says less than the
		// count does.
		renderInspector( {
			transition: {
				to: 'review',
				allowed_roles: [ 'administrator', 'contributor', 'subscriber' ],
			},
		} );

		expect(
			screen.getByRole( 'button', { name: 'Allowed roles: 3 roles' } )
		).toBeInTheDocument();
	} );

	it( 'says the value on the row as well as in the button name', () => {
		renderInspector( {
			transition: { to: 'review', allowed_roles: [ 'editor' ] },
		} );

		expect( screen.getByText( 'Editor' ) ).toBeInTheDocument();
	} );

	it( 'opens the roles as one named group', async () => {
		// A run of checkboxes with nothing binding them says nothing about what
		// ticking one does; the group carries the name, and the sentence the
		// section used to spend a line of the panel on.
		renderInspector( { transition: { to: 'review' } } );

		await openRow( 'Allowed roles: All' );

		const group = screen.getByRole( 'group', { name: 'Allowed roles' } );
		expect( group ).toHaveTextContent( 'With none checked, everyone can.' );
		expect(
			screen.getByRole( 'checkbox', { name: 'Contributor' } )
		).not.toBeChecked();
	} );

	it( 'adds the role that is ticked', async () => {
		const onChange = jest.fn();
		renderInspector( { transition: { to: 'review' }, onChange } );

		await openRow( 'Allowed roles: All' );
		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'checkbox', { name: 'Editor' } )
			);
		} );

		expect( onChange ).toHaveBeenCalledWith( {
			allowed_roles: [ 'editor' ],
		} );
	} );

	it( 'counts a slug the site no longer has, rather than reading All', async () => {
		// The permit list is non-empty, so the server runs the check and
		// intersects it — the transition is open to whoever holds Editor and to
		// nobody else. A row counting only the roles it could resolve would read
		// "All", which is the opposite of what happens.
		renderInspector( {
			transition: {
				to: 'review',
				allowed_roles: [ 'editor', 'shop_manager' ],
			},
		} );

		await openRow( 'Allowed roles: Editor, shop_manager' );

		expect(
			screen.getByRole( 'checkbox', { name: /^shop_manager/ } )
		).toBeChecked();
		expect(
			screen.getByText( /No role with this slug exists on this site/ )
		).toBeInTheDocument();
	} );

	it( 'drops a slug the site no longer has when it is unticked', async () => {
		// The only place it can be dropped: nothing prunes `allowed_roles` on
		// save, so a row without a box for it would leave the author no way to
		// clear a restriction that permits nobody.
		const onChange = jest.fn();
		renderInspector( {
			transition: {
				to: 'review',
				allowed_roles: [ 'editor', 'shop_manager' ],
			},
			onChange,
		} );

		await openRow( 'Allowed roles: Editor, shop_manager' );
		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'checkbox', { name: /^shop_manager/ } )
			);
		} );

		expect( onChange ).toHaveBeenCalledWith( {
			allowed_roles: [ 'editor' ],
		} );
	} );

	it( 'drops the role that is unticked', async () => {
		const onChange = jest.fn();
		renderInspector( {
			transition: { to: 'review', allowed_roles: [ 'editor', 'author' ] },
			onChange,
		} );

		await openRow( 'Allowed roles: Editor, Author' );
		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'checkbox', { name: 'Editor' } )
			);
		} );

		expect( onChange ).toHaveBeenCalledWith( {
			allowed_roles: [ 'author' ],
		} );
	} );
} );

describe( 'Notifications', () => {
	it( 'reads None when the transition notifies nobody', () => {
		renderInspector( { transition: { to: 'review' } } );

		expect(
			screen.getByRole( 'button', { name: 'Notifications: None' } )
		).toBeInTheDocument();
	} );

	it( 'names the channels it notifies', () => {
		renderInspector( {
			transition: { to: 'review', notifications: [ 'email' ] },
		} );

		expect(
			screen.getByRole( 'button', { name: 'Notifications: Email' } )
		).toBeInTheDocument();
	} );

	it( 'still names a channel it notifies that this site has not set up', async () => {
		// Slack is stored and unconfigured — a webhook away from sending, since
		// nothing prunes the stored id and the dispatcher resumes the moment
		// `is_configured()` answers yes. A row saying "None" about it would deny
		// a live setting and offer no box to clear it.
		renderInspector( {
			transition: { to: 'review', notifications: [ 'slack' ] },
		} );

		await openRow( 'Notifications: Slack' );

		expect(
			screen.getByRole( 'checkbox', { name: /^Slack/ } )
		).toBeChecked();
		expect(
			screen.getByText( /This channel is not set up/ )
		).toBeInTheDocument();
	} );

	it( 'unticks a channel this site has not set up', async () => {
		const onChange = jest.fn();
		renderInspector( {
			transition: { to: 'review', notifications: [ 'slack' ] },
			onChange,
		} );

		await openRow( 'Notifications: Slack' );
		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'checkbox', { name: /^Slack/ } )
			);
		} );

		expect( onChange ).toHaveBeenCalledWith( { notifications: [] } );
	} );

	it( 'names a channel id nothing on this site answers to', async () => {
		// Its plugin has left the site, so there is no channel to take a name
		// from. The id stands in for itself rather than vanishing: it is stored,
		// it survives the save, and this is the only place it can be dropped.
		renderInspector( {
			transition: { to: 'review', notifications: [ 'ntfy' ] },
			channels: [ { id: 'email', name: 'Email', configured: true } ],
		} );

		await openRow( 'Notifications: ntfy' );

		expect(
			screen.getByRole( 'checkbox', { name: /^ntfy/ } )
		).toBeChecked();
		expect(
			screen.getByText( /No channel with this id is registered/ )
		).toBeInTheDocument();
	} );

	it( 'offers no checkbox for a channel this site has not set up', async () => {
		renderInspector( { transition: { to: 'review' } } );

		await openRow( 'Notifications: None' );

		expect(
			screen.getByRole( 'checkbox', { name: 'Email' } )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'checkbox', { name: 'Slack' } )
		).toBeNull();
	} );

	it( 'drops the row entirely when no channel is set up', () => {
		renderInspector( {
			transition: { to: 'review' },
			channels: [ { id: 'slack', name: 'Slack', configured: false } ],
		} );

		// By the row's button, not its text: wp.a11y's live region carries a
		// hidden "Notifications" heading of its own on every page.
		expect(
			screen.queryByRole( 'button', { name: /^Notifications:/ } )
		).toBeNull();
	} );

	it( 'keeps the row when the only channel is unset but notified', () => {
		// Nothing on offer, but something set: the transition notifies through
		// a channel whose settings were cleared out from under it, and the row
		// is the only line that can say so.
		renderInspector( {
			transition: { to: 'review', notifications: [ 'slack' ] },
			channels: [ { id: 'slack', name: 'Slack', configured: false } ],
		} );

		expect(
			screen.getByRole( 'button', { name: 'Notifications: Slack' } )
		).toBeInTheDocument();
	} );
} );
