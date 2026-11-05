/**
 * Where focus goes when a section's Add takes itself away.
 *
 * A section's heading actions are offered only while there is something left to
 * add: Assignments stops offering its Add once the transition has its one
 * assignment, and Tools once every tool the site offers is on the list. Both
 * Adds are removed by their own press, while they hold focus. A focused node
 * that leaves the DOM drops focus to `<body>` — nothing is announced, and the
 * next Tab starts from the top of the admin page.
 *
 * `InspectorSection` hands focus to a control of its own that stays mounted:
 * the disclosure trigger, or for an open section its title.
 *
 * @package
 */

import { createPortal, useState } from '@wordpress/element';

import { render, screen, fireEvent, act } from './helpers/render-wp-component';

import InspectorSection from '../../src/admin/components/graph/InspectorSection';
import TransitionInspector from '../../src/admin/components/graph/TransitionInspector';

// A section whose single Add removes itself once used — the shape of both
// real cases, without anything else in the way.
function SelfRemovingAdd( { collapsible = false } ) {
	const [ added, setAdded ] = useState( false );

	return (
		<>
			<InspectorSection
				title="Things"
				collapsible={ collapsible }
				actions={
					added ? undefined : (
						<button
							type="button"
							onClick={ () => setAdded( true ) }
						>
							Add a thing
						</button>
					)
				}
			>
				{ added && <p>A thing</p> }
			</InspectorSection>
			<button type="button">Elsewhere</button>
		</>
	);
}

// An Add whose options render outside the wrapper's DOM, the way a dropdown's
// menu items do in a popover.
function PortalAdd( { onAdd } ) {
	const [ open, setOpen ] = useState( false );

	return (
		<>
			<button type="button" onClick={ () => setOpen( true ) }>
				Add a thing
			</button>
			{ open &&
				createPortal(
					<button type="button" onClick={ onAdd }>
						The last thing
					</button>,
					document.body
				) }
		</>
	);
}

function SelfRemovingMenu() {
	const [ added, setAdded ] = useState( false );

	return (
		<InspectorSection
			title="Things"
			actions={
				added ? undefined : (
					<PortalAdd onAdd={ () => setAdded( true ) } />
				)
			}
		>
			{ added && <p>A thing</p> }
		</InspectorSection>
	);
}

function press( name ) {
	const control = screen.getByRole( 'button', { name } );
	control.focus();
	fireEvent.click( control );
}

describe( 'InspectorSection actions focus hand-off', () => {
	it( 'moves focus to the disclosure trigger when its Add goes', () => {
		render( <SelfRemovingAdd collapsible /> );

		press( 'Add a thing' );

		expect(
			screen.queryByRole( 'button', { name: 'Add a thing' } )
		).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: /Things/ } )
		).toHaveFocus();
		// Handing focus over must not undo the press: the section stays open
		// on the row it just gained.
		expect( screen.getByText( 'A thing' ) ).toBeVisible();
	} );

	it( 'moves focus to the title of an open section when its Add goes', () => {
		render( <SelfRemovingAdd /> );

		press( 'Add a thing' );

		const title = screen.getByRole( 'heading', { name: 'Things' } );
		expect( title ).toHaveFocus();
		// A focus target, not a new stop in the tab order.
		expect( title ).toHaveAttribute( 'tabindex', '-1' );
	} );

	it( 'follows focus into a menu rendered outside the section', () => {
		render( <SelfRemovingMenu /> );

		press( 'Add a thing' );
		press( 'The last thing' );

		expect(
			screen.getByRole( 'heading', { name: 'Things' } )
		).toHaveFocus();
	} );

	it( 'leaves focus alone when it was not on the Add', () => {
		function ExternalRemove() {
			const [ added, setAdded ] = useState( false );

			return (
				<>
					<InspectorSection
						title="Things"
						collapsible
						actions={
							added ? undefined : (
								<button type="button">Add a thing</button>
							)
						}
					/>
					<button type="button" onClick={ () => setAdded( true ) }>
						Elsewhere
					</button>
				</>
			);
		}

		render( <ExternalRemove /> );

		press( 'Elsewhere' );

		expect(
			screen.getByRole( 'button', { name: 'Elsewhere' } )
		).toHaveFocus();
	} );
} );

describe( 'Transition inspector Add controls keep focus in the panel', () => {
	function StatefulInspector( { initial, tools = [] } ) {
		const [ transition, setTransition ] = useState( initial );

		return (
			<TransitionInspector
				transition={ transition }
				sourceLabel="Draft"
				targetLabel="Review"
				availableRoles={ [ { slug: 'editor', name: 'Editor' } ] }
				availableTools={ tools }
				toolsLoaded
				availableChannels={ [] }
				onChange={ ( patch ) =>
					setTransition( ( current ) => ( {
						...current,
						...patch,
					} ) )
				}
				onRemove={ () => {} }
			/>
		);
	}

	it( 'hands focus to the Assignments trigger after adding the assignment', async () => {
		render( <StatefulInspector initial={ { to: 'review' } } /> );

		await act( async () => {
			press( 'Add an assignment' );
		} );

		expect(
			screen.queryByRole( 'button', { name: 'Add an assignment' } )
		).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: /^Assignments/ } )
		).toHaveFocus();
	} );

	it( 'hands focus to the Tools title after adding the last tool', async () => {
		const tools = [
			{
				id: 'vip-workflows/seo',
				name: 'vip-workflows/seo',
				label: 'SEO check',
				meta: {},
				category: 'vip-workflows',
				enabled: true,
				availability: { available: true, groups: [] },
			},
		];

		render(
			<StatefulInspector initial={ { to: 'review' } } tools={ tools } />
		);

		await act( async () => {
			press( 'Add a tool' );
		} );

		expect(
			screen.queryByRole( 'button', { name: 'Add a tool' } )
		).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'heading', { name: 'Tools' } )
		).toHaveFocus();
	} );

	// A tool with a summary is offered from a menu, so the press that adds it
	// is on a menu item in a popover, not on the Add itself.
	it( 'hands focus to the Tools title after adding the last tool from the menu', async () => {
		const tools = [
			{
				id: 'vip-workflows/seo',
				name: 'vip-workflows/seo',
				label: 'SEO check',
				meta: { summary: 'Checks the SEO.' },
				category: 'vip-workflows',
				enabled: true,
				availability: { available: true, groups: [] },
			},
		];

		render(
			<StatefulInspector initial={ { to: 'review' } } tools={ tools } />
		);

		await act( async () => {
			press( 'Add a tool' );
		} );
		await act( async () => {
			const item = screen.getByRole( 'menuitem', { name: /SEO check/ } );
			item.focus();
			fireEvent.click( item );
		} );

		expect(
			screen.queryByRole( 'button', { name: 'Add a tool' } )
		).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'heading', { name: 'Tools' } )
		).toHaveFocus();
	} );
} );
