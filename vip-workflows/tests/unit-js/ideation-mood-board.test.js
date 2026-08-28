/**
 * Unit tests for the ideation board's per-agent sections.
 *
 * Two rules are pinned here.
 *
 * A section is keyed by the ability id its cards carry, so its heading names the
 * agent that found them. It has to read the abilities response's `label` — the
 * human name — and not its `name`, which is the ability *identifier*
 * (`WP_Ability::get_name()`). The old `a.name || a.label || a.id` precedence let
 * `name` win every time, which put `VIP-WORKFLOWS/WEB-RESEARCHER` above a section on
 * the most prominent surface in the workspace.
 *
 * And a section exists for every agent, not only the ones that can still be run.
 * `enabled` answers whether an agent may be started — not how it is named, and not
 * whether what it already collected is worth showing. Filtering the abilities list
 * on it made all three answers the same one: a turned-off agent's cards were
 * grouped into a section that was then never in the render order, so rows that were
 * present in the database, counted, and possibly pinned rendered nowhere at all.
 *
 * `Text variant="heading-sm"` uppercases the heading in CSS, which jsdom does not
 * apply, so these assert the underlying text.
 *
 * @package
 */

import { render, screen, within } from './helpers/render-wp-component';

import MoodBoard from '../../src/admin/components/ideation/MoodBoard';

import { disabledVipAbility, vipAbility } from './helpers/abilities-fixture';

const ABILITY = 'vip-workflows/web-researcher';
const OFF_ABILITY = 'workflow-discovery-foresight/foresight-research';
const MEDIA_ABILITY = 'vip-workflows/media-scout';

/*
 * The abilities response comes from the shared builder in
 * ./helpers/abilities-fixture, generated from
 * tests/fixtures/abilities-response-contract.json and guarded in both directions by
 * ./abilities-response-contract.test.js. Hand-built fixtures that put the human name
 * in `name`, or left `enabled` or `icon` out, are exactly what let three bugs ship —
 * `/vip-workflows/v1/abilities` returns every one of those keys for every ability,
 * turned-off ones included.
 */
const ENABLED_ABILITY = vipAbility( {
	id: ABILITY,
	label: 'Web Researcher',
	icon: 'search',
} );

const TURNED_OFF_ABILITY = disabledVipAbility( {
	id: OFF_ABILITY,
	label: 'Foresight News',
	icon: 'book-alt',
} );

const RESEARCH_ABILITIES = [ ENABLED_ABILITY ];

const CARD = {
	source_id: 'src-1',
	ability_id: ABILITY,
	title: 'Modifying the Bears Ears National Monument',
	url: 'https://example.test/one',
	card_status: 'default',
};

const OFF_CARD = {
	source_id: 'src-2',
	ability_id: OFF_ABILITY,
	title: 'Interior Department budget hearing',
	url: 'https://example.test/two',
	card_status: 'default',
};

/**
 * Render the board with one agent-attributed card.
 *
 * @param {Object} extraProps Additional board props to merge in.
 * @return {Object} Render result.
 */
function renderBoard( extraProps = {} ) {
	return render(
		<MoodBoard
			cards={ [ CARD ] }
			dismissedCards={ [] }
			pinnedIds={ [] }
			projectId={ 222 }
			researchAbilities={ RESEARCH_ABILITIES }
			onPin={ () => {} }
			onDismiss={ () => {} }
			onUnpin={ () => {} }
			onRestore={ () => {} }
			onDelete={ () => {} }
			{ ...extraProps }
		/>
	);
}

/**
 * The rendered section headings.
 *
 * @param {HTMLElement} container Render container.
 * @return {string[]} Heading text.
 */
function sectionTitles( container ) {
	return Array.from(
		container.querySelectorAll( '.vip-workflows-ideation-section__title' )
	).map( ( node ) => node.textContent );
}

/**
 * The section whose heading reads `title`.
 *
 * @param {HTMLElement} container Render container.
 * @param {string}      title     Heading text.
 * @return {HTMLElement|null} The section element.
 */
function sectionByTitle( container, title ) {
	const heading = Array.from(
		container.querySelectorAll( '.vip-workflows-ideation-section__title' )
	).find( ( node ) => node.textContent === title );

	return heading
		? heading.closest( '.vip-workflows-ideation-section' )
		: null;
}

describe( 'ideation board — section headings name the agent', () => {
	it( 'titles an agent section with the agent name', () => {
		const { container } = renderBoard();

		expect( sectionTitles( container ) ).toContain( 'Web Researcher' );
	} );

	it( 'renders no raw ability id as a section heading', () => {
		const { container } = renderBoard();

		expect( sectionTitles( container ) ).not.toContain( ABILITY );
		sectionTitles( container ).forEach( ( title ) => {
			expect( title ).not.toMatch( /\// );
		} );
	} );

	it( 'renders no raw ability id anywhere on the board chrome', () => {
		const { container } = renderBoard();

		expect( container.textContent ).not.toMatch(
			/vip-workflows\/web-researcher/
		);
	} );

	it( 'still shows the card the section groups', () => {
		renderBoard();

		expect(
			screen.getByText( 'Modifying the Bears Ears National Monument' )
		).toBeInTheDocument();
	} );
} );

describe( 'ideation board — an agent an administrator turned off', () => {
	/**
	 * Render the board with one card from each of a live and a turned-off agent.
	 *
	 * @param {Object} extraProps Additional board props to merge in.
	 * @return {Object} Render result.
	 */
	function renderMixedBoard( extraProps = {} ) {
		return renderBoard( {
			cards: [ CARD, OFF_CARD ],
			researchAbilities: [ ENABLED_ABILITY, TURNED_OFF_ABILITY ],
			onFindSimilar: () => {},
			...extraProps,
		} );
	}

	it( 'renders its cards', () => {
		renderMixedBoard();

		expect(
			screen.getByText( 'Interior Department budget hearing' )
		).toBeInTheDocument();
	} );

	it( 'gives them a section named after the agent', () => {
		const { container } = renderMixedBoard();

		expect( sectionTitles( container ) ).toContain( 'Foresight News' );
		expect( container.textContent ).not.toMatch(
			/workflow-discovery-foresight/
		);
	} );

	it( 'counts them in that section', () => {
		const { container } = renderMixedBoard();

		expect(
			sectionByTitle( container, 'Foresight News' ).querySelector(
				'.vip-workflows-ideation-section__count'
			)
		).toHaveTextContent( '1' );
	} );

	it( 'marks the section as inactive', () => {
		const { container } = renderMixedBoard();

		expect(
			sectionByTitle( container, 'Foresight News' )
		).toHaveTextContent( 'Turned off' );
	} );

	it( 'leaves a live agent’s section unmarked', () => {
		const { container } = renderMixedBoard();

		expect(
			sectionByTitle( container, 'Web Researcher' )
		).not.toHaveTextContent( 'Turned off' );
	} );

	it( 'offers no re-run on its cards', () => {
		const { container } = renderMixedBoard();

		expect(
			sectionByTitle( container, 'Foresight News' ).querySelector(
				'[aria-label="Find similar"]'
			)
		).toBeNull();
	} );

	it( 'still offers a re-run on a live agent’s cards', () => {
		const { container } = renderMixedBoard();

		expect(
			sectionByTitle( container, 'Web Researcher' ).querySelector(
				'[aria-label="Find similar"]'
			)
		).not.toBeNull();
	} );

	it( 'drops its section entirely when it found nothing', () => {
		// Nothing to show and nothing to run: a heading on its own would only be
		// noise about an agent the reader cannot act on.
		const { container } = renderBoard( {
			researchAbilities: [ ENABLED_ABILITY, TURNED_OFF_ABILITY ],
		} );

		expect( sectionTitles( container ) ).not.toContain( 'Foresight News' );
	} );

	it( 'withholds image generation from a turned-off media agent', () => {
		renderBoard( {
			cards: [
				{
					source_id: 'src-3',
					ability_id: MEDIA_ABILITY,
					source_type: 'image',
					title: 'Bears Ears at dawn',
					card_status: 'default',
				},
			],
			researchAbilities: [
				disabledVipAbility( {
					id: MEDIA_ABILITY,
					label: 'Media Scout',
					icon: 'format-image',
				} ),
			],
			onGenerateImage: () => {},
		} );

		expect(
			screen.queryByRole( 'button', { name: /Generate AI image/ } )
		).not.toBeInTheDocument();
	} );

	it( 'still offers image generation from a live media agent', () => {
		renderBoard( {
			cards: [
				{
					source_id: 'src-3',
					ability_id: MEDIA_ABILITY,
					source_type: 'image',
					title: 'Bears Ears at dawn',
					card_status: 'default',
				},
			],
			researchAbilities: [
				vipAbility( {
					id: MEDIA_ABILITY,
					label: 'Media Scout',
					icon: 'format-image',
				} ),
			],
			onGenerateImage: () => {},
		} );

		expect(
			screen.getByRole( 'button', { name: /Generate AI image/ } )
		).toBeInTheDocument();
	} );

	describe( 'section icons', () => {
		/**
		 * The icon slot of the section headed by the given agent.
		 *
		 * Every section has a `__icon`, and the board draws other svgs besides
		 * (the add control, each card's actions) — so both the positive and the
		 * negative assertion have to name the section they mean.
		 *
		 * @param {HTMLElement} container Render container.
		 * @param {string}      label     The agent's label.
		 * @return {HTMLElement|null} The section's icon slot.
		 */
		const iconSlot = ( container, label = 'Web Researcher' ) => {
			const heading = within( container ).getByText( label );
			return heading
				.closest( '.vip-workflows-ideation-section__header' )
				?.querySelector( '.vip-workflows-ideation-section__icon' );
		};

		/*
		 * An assistant's `icon` is a slug, meaningless as text. Rendering it raw
		 * printed "search WEB RESEARCHER" beside every heading. Asserting on the
		 * drawn element rather than the absence of the word is what makes this
		 * bite: a slug that stops rendering entirely would also satisfy a "not
		 * visible" assertion.
		 */
		it( 'draws a section icon rather than printing its slug', () => {
			const { container } = renderBoard();

			expect(
				iconSlot( container )?.querySelector( 'svg' )
			).toBeInTheDocument();
		} );

		it( 'never prints an icon slug as text beside the heading', () => {
			renderBoard();

			expect(
				screen.queryByText( /\bsearch\b/ )
			).not.toBeInTheDocument();
		} );

		it( 'renders no dashicon font element', () => {
			// The slug used to become `<span class="dashicons dashicons-search">`,
			// a second icon system beside the design system's own.
			const { container } = renderBoard();

			expect( container.querySelector( '.dashicons' ) ).toBeNull();
		} );

		it( 'renders nothing for a slug outside the vocabulary', () => {
			// Including an emoji, which used to pass straight through. The map is
			// an allow-list, so an unrecognised value draws nothing rather than
			// guessing — and a typo is visible as a missing icon, not a tofu box.
			const { container } = renderBoard( {
				researchAbilities: [
					{ ...ENABLED_ABILITY, icon: '\u{1F50D}' },
				],
			} );

			// No icon to draw means no icon slot at all, rather than an empty box
			// holding space for one.
			expect( iconSlot( container ) ).toBeFalsy();
			expect(
				screen.queryByText( /\u{1F50D}/u )
			).not.toBeInTheDocument();
		} );
	} );
} );
