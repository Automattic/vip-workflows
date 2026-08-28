/**
 * The tools a transition requires, as an ordered list rather than a tick sheet.
 *
 * The old control was a `CheckboxControl` per registered tool, showing a label
 * and nothing else. Everything that decides whether a tool will actually run —
 * whether it is switched on for the site, whether its dependencies are met — was
 * serialized by the REST layer and thrown away by the UI, so a tool that could
 * not run looked exactly like one that could. Ticking a disabled tool was
 * allowed, and both executors then skipped it in silence.
 *
 * It is now the same list component the capture inputs use: rows the author
 * orders and prunes, added from a picker in the section's header. The picker
 * offers what the transition can be given and nothing else — a tool that cannot
 * run on this site is left out rather than shown barred, because a greyed entry
 * reads as a capability withheld from the reader. The reason is owed where there
 * is something to do about it: on the row of a tool the transition already
 * carries.
 *
 * Order is presentational and stays that way. The executors iterate stored order
 * and neither of them stops early or feeds one tool's output to the next, so the
 * only thing an author is arranging is the sequence their failures get reported
 * in — which is reason enough to let them arrange it, and no reason at all to
 * change what running them means.
 *
 * @package
 */

import { render, screen, fireEvent, act } from './helpers/render-wp-component';

import TransitionInspector from '../../src/admin/components/graph/TransitionInspector';

// Captured from the list's `DndContext` so a drop can be reported without
// dnd-kit's pointer maths, which needs a layout jsdom does not do. What is under
// test is the mapping from a drop to the stored array, and that mapping runs
// entirely in the handler.
let mockDragEnd = null;

jest.mock( '@dnd-kit/core', () => {
	const actual = jest.requireActual( '@dnd-kit/core' );
	const { createElement } = jest.requireActual( '@wordpress/element' );

	return {
		...actual,
		DndContext: ( props ) => {
			mockDragEnd = props.onDragEnd;
			return createElement( actual.DndContext, props );
		},
	};
} );

const ROLES = [ { slug: 'editor', name: 'Editor' } ];

/**
 * A serialized ability, shaped the way `AbilitiesController` sends one.
 *
 * `availability` is always present in the response — an ability with nothing
 * unmet serializes the empty result rather than omitting the key — so the
 * fixture always carries it too.
 *
 * @param {string} id        Ability id.
 * @param {string} label     Human-readable name.
 * @param {Object} overrides Anything this particular tool differs on.
 * @return {Object} The serialized ability.
 */
const tool = ( id, label, overrides = {} ) => ( {
	id,
	name: id,
	label,
	description: `What ${ label } does.`,
	category: 'vip-workflow',
	enabled: true,
	availability: { available: true, groups: [] },
	...overrides,
} );

const TOOLS = [
	tool( 'vip-workflow/copy-edit', 'Copy edit' ),
	tool( 'vip-workflow/fact-check', 'Fact check' ),
	tool( 'vip-workflow/seo', 'SEO check' ),
];

function renderInspector( {
	transition,
	tools = TOOLS,
	toolsLoaded = true,
	onChange = () => {},
} ) {
	render(
		<TransitionInspector
			transition={ transition }
			sourceLabel="Draft"
			targetLabel="Review"
			availableRoles={ ROLES }
			availableTools={ tools }
			toolsLoaded={ toolsLoaded }
			availableChannels={ [] }
			onChange={ onChange }
			onRemove={ () => {} }
		/>
	);
}

/** @return {Array<string>} The label of every row in the tools list, in order. */
const rowLabels = () =>
	screen
		.getAllByRole( 'button', { name: /^Reorder / } )
		.map( ( grip ) =>
			grip.getAttribute( 'aria-label' ).replace( 'Reorder ', '' )
		);

async function openPicker() {
	await act( async () => {
		fireEvent.click( screen.getByRole( 'button', { name: 'Add a tool' } ) );
	} );
}

describe( 'Required tools list', () => {
	it( 'lists what the transition requires, in the order it stores it', () => {
		renderInspector( {
			transition: {
				to: 'review',
				required_tools: [
					'vip-workflow/seo',
					'vip-workflow/copy-edit',
				],
			},
		} );

		// Stored order, not the order the site happens to register them in.
		expect( rowLabels() ).toEqual( [ 'SEO check', 'Copy edit' ] );
	} );

	it( 'keeps the section on a site with no tools, so a stored one stays reachable', () => {
		// The section used to disappear whole when the list of registered tools
		// was empty, taking any tool the transition already required with it:
		// stored, still running, and with no way to see or remove it.
		renderInspector( {
			transition: {
				to: 'review',
				required_tools: [ 'vip-workflow/seo' ],
			},
			tools: [],
		} );

		expect( rowLabels() ).toEqual( [ 'vip-workflow/seo' ] );
		expect(
			screen.getByRole( 'button', { name: 'Remove tool' } )
		).toBeEnabled();
	} );

	it( 'says the transition runs none rather than showing nothing', () => {
		renderInspector( { transition: { to: 'review' } } );

		expect(
			screen.getByText( /This transition runs no tools/ )
		).toBeInTheDocument();
	} );

	it( 'says so when the site has no tool to offer', () => {
		renderInspector( { transition: { to: 'review' }, tools: [] } );

		expect(
			screen.getByText( /No tools are available for transitions/ )
		).toBeInTheDocument();
	} );

	it( 'says the same when every tool the site has is unusable', () => {
		// Nothing can be added, so there is no Add control either — and an
		// empty state telling the author to add one would be pointing at a
		// button that is not there.
		renderInspector( {
			transition: { to: 'review' },
			tools: [
				tool( 'vip-workflow/copy-edit', 'Copy edit', {
					enabled: false,
				} ),
			],
		} );

		expect(
			screen.getByText( /No tools are available for transitions/ )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Add a tool' } )
		).toBeNull();
	} );

	// ── The picker ───────────────────────────────────────────────────

	describe( 'the picker', () => {
		it( 'offers only what the transition does not already require', async () => {
			renderInspector( {
				transition: {
					to: 'review',
					required_tools: [ 'vip-workflow/copy-edit' ],
				},
			} );

			await openPicker();

			expect(
				screen.queryByRole( 'menuitem', { name: /^Copy edit/ } )
			).toBeNull();
			expect(
				screen.getByRole( 'menuitem', { name: /^Fact check/ } )
			).toBeEnabled();
		} );

		it( 'adds the tool it is given, at the end of the list', async () => {
			const onChange = jest.fn();
			renderInspector( {
				transition: {
					to: 'review',
					required_tools: [ 'vip-workflow/copy-edit' ],
				},
				onChange,
			} );

			await openPicker();
			await act( async () => {
				fireEvent.click(
					screen.getByRole( 'menuitem', { name: /^SEO check/ } )
				);
			} );

			expect( onChange ).toHaveBeenCalledWith( {
				required_tools: [
					'vip-workflow/copy-edit',
					'vip-workflow/seo',
				],
			} );
		} );

		it( 'leaves out a tool turned off for the whole site', async () => {
			renderInspector( {
				transition: { to: 'review' },
				tools: [
					TOOLS[ 0 ],
					tool( 'vip-workflow/fact-check', 'Fact check', {
						enabled: false,
					} ),
				],
			} );

			await openPicker();

			// Both executors skip a disabled tool, so adding one would put a
			// check on the transition that never runs. It is not offered barred
			// either: switching it back on happens under Workflows → Tools, and
			// a greyed row in this menu says nothing about where.
			expect(
				screen.queryByRole( 'menuitem', { name: /^Fact check/ } )
			).toBeNull();
			expect(
				screen.getByRole( 'menuitem', { name: /^Copy edit/ } )
			).toBeEnabled();
		} );

		it( 'leaves out a tool whose dependencies are unmet', async () => {
			renderInspector( {
				transition: { to: 'review' },
				tools: [
					TOOLS[ 0 ],
					tool( 'vip-workflow/seo', 'SEO check', {
						availability: {
							available: false,
							groups: [
								{
									satisfy: 'all',
									requirements: [
										{
											id: 'openai',
											kind: 'missing_credential',
											sources: [ 'SEO check' ],
											reason: 'OpenAI needs an API key.',
										},
									],
								},
							],
						},
					} ),
				],
			} );

			await openPicker();

			expect(
				screen.queryByRole( 'menuitem', { name: /^SEO check/ } )
			).toBeNull();
		} );
	} );

	// ── The rows ─────────────────────────────────────────────────────

	describe( 'a row', () => {
		it( 'reports nothing about a tool that will run', () => {
			renderInspector( {
				transition: {
					to: 'review',
					required_tools: [ 'vip-workflow/copy-edit' ],
				},
			} );

			// Its description is attached to the row rather than printed on it:
			// there is no popover to hold it, and the row's end is kept free so
			// a glance down the list finds the tool that is wrong.
			expect(
				screen.getByRole( 'button', { name: 'About Copy edit' } )
			).toBeEnabled();
			expect( screen.queryByText( 'Turned off' ) ).toBeNull();
			expect( screen.queryByText( 'Needs setup' ) ).toBeNull();
		} );

		it( 'says a tool it already carries has been turned off', () => {
			renderInspector( {
				transition: {
					to: 'review',
					required_tools: [ 'vip-workflow/copy-edit' ],
				},
				tools: [
					tool( 'vip-workflow/copy-edit', 'Copy edit', {
						enabled: false,
					} ),
				],
			} );

			expect( screen.getByText( 'Turned off' ) ).toBeInTheDocument();
		} );

		it( 'says a tool it already carries needs setting up', () => {
			renderInspector( {
				transition: {
					to: 'review',
					required_tools: [ 'vip-workflow/seo' ],
				},
				tools: [
					tool( 'vip-workflow/seo', 'SEO check', {
						availability: {
							available: false,
							groups: [
								{
									satisfy: 'all',
									requirements: [
										{
											id: 'openai',
											kind: 'missing_credential',
											sources: [ 'SEO check' ],
											reason: 'OpenAI needs an API key.',
										},
									],
								},
							],
						},
					} ),
				],
			} );

			expect( screen.getByText( 'Needs setup' ) ).toBeInTheDocument();
			// The requirement itself rides on the row's own explanation, which
			// is the only room a row without a popover has for it.
			expect(
				screen.getByRole( 'button', { name: 'About SEO check' } )
			).toBeEnabled();
		} );

		it( 'says setting up even when nothing names what is missing', async () => {
			// An `availability_callback` answering a bare `false` names no
			// requirement, which is the one case the structured text has
			// nothing to say about and the row falls back to its own sentence.
			renderInspector( {
				transition: {
					to: 'review',
					required_tools: [ 'vip-workflow/seo' ],
				},
				tools: [
					tool( 'vip-workflow/seo', 'SEO check', {
						availability: { available: false, groups: [] },
					} ),
				],
			} );

			expect( screen.getByText( 'Needs setup' ) ).toBeInTheDocument();

			// The explanation opens on focus as well as on hover, which is how
			// the trigger is reachable without a pointer in the first place.
			await act( async () => {
				fireEvent.focus(
					screen.getByRole( 'button', { name: 'About SEO check' } )
				);
			} );

			expect(
				screen.getByText( /not yet configured/ )
			).toBeInTheDocument();
		} );

		it( 'names an id nothing on the site answers to', () => {
			renderInspector( {
				transition: {
					to: 'review',
					required_tools: [ 'workflow-tool-gone/gone' ],
				},
			} );

			expect( rowLabels() ).toEqual( [ 'workflow-tool-gone/gone' ] );
			expect( screen.getByText( 'Missing' ) ).toBeInTheDocument();
		} );

		it( 'passes no verdict on an id until the tools have loaded', () => {
			// Before the fetch lands there is nothing to resolve against, and
			// calling every tool missing for the length of a request is a false
			// alarm, not a report.
			renderInspector( {
				transition: {
					to: 'review',
					required_tools: [ 'vip-workflow/copy-edit' ],
				},
				tools: [],
				toolsLoaded: false,
			} );

			expect( rowLabels() ).toEqual( [ 'vip-workflow/copy-edit' ] );
			expect( screen.queryByText( 'Missing' ) ).toBeNull();
		} );
	} );

	// ── Editing the list ─────────────────────────────────────────────

	it( 'removes the tool its row belongs to, leaving the rest in order', async () => {
		const onChange = jest.fn();
		renderInspector( {
			transition: {
				to: 'review',
				required_tools: [
					'vip-workflow/copy-edit',
					'vip-workflow/fact-check',
					'vip-workflow/seo',
				],
			},
			onChange,
		} );

		await act( async () => {
			fireEvent.click(
				screen.getAllByRole( 'button', { name: 'Remove tool' } )[ 1 ]
			);
		} );

		expect( onChange ).toHaveBeenCalledWith( {
			required_tools: [ 'vip-workflow/copy-edit', 'vip-workflow/seo' ],
		} );
	} );

	it( 'stores the order a drag leaves the rows in', () => {
		const onChange = jest.fn();
		renderInspector( {
			transition: {
				to: 'review',
				required_tools: [
					'vip-workflow/copy-edit',
					'vip-workflow/fact-check',
					'vip-workflow/seo',
				],
			},
			onChange,
		} );

		// A keyless list numbers its rows by position, which is what dnd-kit
		// needs the ids in a sortable context to be: unique.
		act( () => {
			mockDragEnd( { active: { id: '2' }, over: { id: '0' } } );
		} );

		expect( onChange ).toHaveBeenCalledWith( {
			required_tools: [
				'vip-workflow/seo',
				'vip-workflow/copy-edit',
				'vip-workflow/fact-check',
			],
		} );
	} );

	it( 'reports no change for a drag that ended where it started', () => {
		const onChange = jest.fn();
		renderInspector( {
			transition: {
				to: 'review',
				required_tools: [ 'vip-workflow/copy-edit' ],
			},
			onChange,
		} );

		act( () => {
			mockDragEnd( { active: { id: '0' }, over: { id: '0' } } );
		} );

		// Marking the sequence dirty for a drag the author abandoned would put
		// a save prompt in front of them for nothing.
		expect( onChange ).not.toHaveBeenCalled();
	} );
} );
