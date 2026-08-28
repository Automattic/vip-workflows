/**
 * Unit tests for the shared requirement renderer.
 *
 * Two things are pinned here, both of which the two consuming surfaces depend on
 * behaving identically:
 *
 *   - `groupKey()` has to agree with the server's collapse decision. The server
 *     treats group membership as a set and collapses two groups with the same
 *     members in any order (`AssistantRegistry::aggregate_availability()`); a key
 *     that stayed order-sensitive would make that collapse look like a remount.
 *   - the component renders both message registers. The user register carries
 *     `message` where the admin register carries `reason`, so reading only one of
 *     them renders a blank row for every editor — which is exactly why the
 *     ideation panel used to carry a second implementation.
 *
 * @package
 */

import { render, screen, within } from './helpers/render-wp-component';

import {
	AgentRequirements,
	groupKey,
	requirementText,
} from '../../src/common/AgentRequirements';

const req = ( id ) => ( {
	id,
	kind: 'missing_credential',
	reason: `${ id }.`,
} );

describe( 'groupKey', () => {
	it( 'is the same for two any-groups with reordered members', () => {
		expect(
			groupKey( {
				satisfy: 'any',
				requirements: [
					req( 'credential:tavily' ),
					req( 'credential:youtube' ),
				],
			} )
		).toBe(
			groupKey( {
				satisfy: 'any',
				requirements: [
					req( 'credential:youtube' ),
					req( 'credential:tavily' ),
				],
			} )
		);
	} );

	it( 'still distinguishes groups with different members', () => {
		expect(
			groupKey( {
				satisfy: 'any',
				requirements: [
					req( 'credential:tavily' ),
					req( 'credential:youtube' ),
				],
			} )
		).not.toBe(
			groupKey( {
				satisfy: 'any',
				requirements: [
					req( 'credential:tavily' ),
					req( 'credential:vimeo' ),
				],
			} )
		);
	} );

	it( 'still distinguishes groups that differ only in satisfaction mode', () => {
		const requirements = [ req( 'credential:tavily' ) ];

		expect( groupKey( { satisfy: 'any', requirements } ) ).not.toBe(
			groupKey( { satisfy: 'all', requirements } )
		);
	} );

	it( 'tolerates a group with no requirements array', () => {
		expect( groupKey( { satisfy: 'all' } ) ).toBe( 'all|' );
	} );
} );

describe( 'AgentRequirements', () => {
	it( 'renders the user register, which carries message instead of reason', () => {
		const { container } = render(
			<AgentRequirements
				groups={ [
					{
						satisfy: 'all',
						requirements: [
							{
								id: 'credential:tavily',
								kind: 'missing_credential',
								message:
									'Tavily is not connected. Ask an administrator to connect it.',
							},
						],
					},
				] }
				ownerLabel="Web Researcher"
			/>
		);

		expect(
			screen.getByText( /Ask an administrator to connect it\./ )
		).toBeInTheDocument();

		// The user register never carries a destination, so nothing to link to.
		expect( container.querySelector( 'a[href]' ) ).not.toBeInTheDocument();
	} );

	it( 'prefers reason when the admin register supplied one', () => {
		render(
			<AgentRequirements
				groups={ [
					{
						satisfy: 'all',
						requirements: [
							{
								id: 'credential:tavily',
								kind: 'missing_credential',
								reason: 'Tavily is not connected.',
								message: 'Ask an administrator.',
							},
						],
					},
				] }
				ownerLabel="Web Researcher"
			/>
		);

		expect(
			screen.getByText( 'Tavily is not connected.' )
		).toBeInTheDocument();
		expect(
			screen.queryByText( 'Ask an administrator.' )
		).not.toBeInTheDocument();
	} );

	it( 'omits the lead-in for an any-group of one', () => {
		// Aggregation can reduce an any-group to a single row, and "at least one
		// of" in front of one item reads as a bug.
		render(
			<AgentRequirements
				groups={ [
					{
						satisfy: 'any',
						requirements: [ req( 'credential:tavily' ) ],
					},
				] }
				ownerLabel="Media Scout"
			/>
		);

		expect(
			screen.queryByText( 'Configure at least one of:' )
		).not.toBeInTheDocument();
		expect( screen.getByText( 'credential:tavily.' ) ).toBeInTheDocument();
	} );

	/*
	 * The credentials link and the destination answer different questions — where
	 * to type a value versus where to go and get one — and the in-card case is the
	 * one where the answers differ. So the hint has to survive alongside the link,
	 * and the link has to be visibly external rather than looking like another
	 * in-app destination.
	 */
	describe( 'credentials link', () => {
		const inCard = ( credentialsUrl ) => ( {
			satisfy: 'all',
			requirements: [
				{
					id: 'settings:foresight-news',
					kind: 'missing_credential',
					reason: 'Foresight News sign-in details are missing.',
					destination: {
						kind: 'in_card',
						url: '',
						label: '',
						hint: 'Complete the email and password fields below.',
						credentials_url: credentialsUrl,
					},
				},
			],
		} );

		it( 'renders an external link beside the hint when a URL is present', () => {
			const { container } = render(
				<AgentRequirements
					groups={ [ inCard( 'https://foresightnews.com' ) ] }
					ownerLabel="Foresight News"
				/>
			);

			const link = container.querySelector( 'a[href]' );

			expect( link ).toHaveAttribute(
				'href',
				'https://foresightnews.com'
			);
			expect( link ).toHaveTextContent(
				'Where to get these credentials'
			);
			expect( link ).toHaveAttribute( 'target', '_blank' );
			expect( link ).toHaveAttribute( 'rel', 'noopener noreferrer' );

			// The fields are still where the values get typed, so the hint must
			// not be displaced by the link.
			expect(
				within( container ).getByText(
					'Complete the email and password fields below.'
				)
			).toBeInTheDocument();
		} );

		it( 'renders no link when the requirement names no URL', () => {
			const { container } = render(
				<AgentRequirements
					groups={ [ inCard( '' ) ] }
					ownerLabel="Foresight News"
				/>
			);

			expect(
				container.querySelector( 'a[href]' )
			).not.toBeInTheDocument();
			expect(
				within( container ).getByText(
					'Complete the email and password fields below.'
				)
			).toBeInTheDocument();
		} );

		it( 'renders no link when the destination key is absent entirely', () => {
			// Every requirement predating this field serializes without it, and a
			// bare `false` availability serializes no destination at all.
			const { container } = render(
				<AgentRequirements
					groups={ [
						{
							satisfy: 'all',
							requirements: [ req( 'credential:tavily' ) ],
						},
					] }
					ownerLabel="Web Researcher"
				/>
			);

			expect(
				container.querySelector( 'a[href]' )
			).not.toBeInTheDocument();
		} );
	} );

	it( 'keeps the lead-in for an any-group of two', () => {
		render(
			<AgentRequirements
				groups={ [
					{
						satisfy: 'any',
						requirements: [
							req( 'credential:tavily' ),
							req( 'credential:youtube' ),
						],
					},
				] }
				ownerLabel="Media Scout"
			/>
		);

		expect(
			screen.getByText( 'Configure at least one of:' )
		).toBeInTheDocument();
	} );
} );

/**
 * The same requirements as one line, for the places with no room for a block.
 *
 * A menu entry saying why a tool cannot be added, and the tooltip on a row that
 * already carries it, both need the reasons and can hold none of the links — a
 * destination anchor inside either is one nobody can reach.
 */
describe( 'requirementText', () => {
	it( 'is empty when nothing is unmet, so a caller can print it unguarded', () => {
		expect( requirementText( [] ) ).toBe( '' );
	} );

	it( 'reads whichever register the server chose', () => {
		expect(
			requirementText( [
				{
					satisfy: 'all',
					requirements: [
						{ id: 'a', message: 'Ask an administrator.' },
					],
				},
			] )
		).toBe( 'Ask an administrator.' );
	} );

	it( 'runs an all-group together, since every one of them is needed', () => {
		expect(
			requirementText( [
				{
					satisfy: 'all',
					requirements: [
						req( 'credential:tavily' ),
						req( 'credential:youtube' ),
					],
				},
			] )
		).toBe( 'credential:tavily. credential:youtube.' );
	} );

	it( 'says an any-group is a choice, not two demands', () => {
		expect(
			requirementText( [
				{
					satisfy: 'any',
					requirements: [
						req( 'credential:tavily' ),
						req( 'credential:youtube' ),
					],
				},
			] )
		).toBe( 'Needs one of: credential:tavily.; credential:youtube.' );
	} );

	it( 'drops the lead-in when aggregation left an any-group holding one', () => {
		expect(
			requirementText( [
				{
					satisfy: 'any',
					requirements: [ req( 'credential:tavily' ) ],
				},
			] )
		).toBe( 'credential:tavily.' );
	} );
} );
