/**
 * Unit tests for the ideation workspace header.
 *
 * Three things are pinned here.
 *
 * **Labels come from the server.** The header iterates the stored assistant map,
 * so it must name every entry in it — including one whose plugin has since been
 * deactivated, which no live abilities response contains. It previously built its
 * labels from the research-abilities response, a different population, and rendered
 * the raw ability id for anything missing from it.
 *
 * **Status tone.** `unavailable` is a configuration state the reader may have no
 * way to fix — agent execution is gated on `edit_posts` while the credential screen
 * needs `manage_options` — so it must not be styled as a failure the reader caused.
 * `failed` is a real error and must keep that styling. Both previously shared one
 * `high`-intent arm.
 *
 * WPDS `Badge` renders its `intent` prop as a hashed CSS-module class ending in
 * `is-<intent>-intent`, which is the only observable signal for the tone; the
 * assertions match that suffix rather than the unstable hash prefix.
 *
 * **Header scope.** Topics and the news angle belong to the board's tag-cloud card
 * and the Analysis panel, which carry both in full; the header's clipped copies
 * crowded out the seed text and are gone.
 *
 * @package
 */

import { render, screen, within } from './helpers/render-wp-component';

import TopBar from '../../src/admin/components/ideation/TopBar';

const ABILITY = 'vip-workflows/web-researcher';

/**
 * Render the top bar over a given assistants map.
 *
 * @param {Object} assistants Stored assistant map, as the ideation state returns it.
 * @param {Object} state      Extra ideation state keys to merge in.
 * @return {Object} Render result.
 */
function renderTopBar( assistants, state = {} ) {
	return render(
		<TopBar
			state={ {
				seed: 'A seed',
				assistants,
				...state,
			} }
			onBack={ () => {} }
			onDelete={ () => {} }
			onCreateDraft={ () => {} }
			creatingDraft={ false }
			runningQuery={ null }
		/>
	);
}

/**
 * Render the top bar with one assistant in a given status.
 *
 * @param {string} status Assistant status.
 * @param {Object} extra  Extra keys on the stored assistant result.
 * @return {Object} Render result.
 */
function renderStatus( status, extra = {} ) {
	return renderTopBar( {
		[ ABILITY ]: { status, label: 'Web Researcher', ...extra },
	} );
}

/**
 * The status badge's class list.
 *
 * @param {HTMLElement} container Render container.
 * @return {string} Class list.
 */
function statusBadgeClasses( container ) {
	const badge = container.querySelector(
		'.vip-workflows-ideation-topbar__assistant-status'
	);

	expect( badge ).toBeInTheDocument();

	return badge.className;
}

describe( 'ideation top bar — assistant labels', () => {
	it( 'names an assistant the abilities response does not contain', () => {
		// The exact regression: a stored assistant whose plugin was deactivated
		// after its run. Nothing live can name it, so the server resolved the
		// label and sent it beside the status.
		renderTopBar( {
			'workflow-discovery-foresight/foresight-research': {
				status: 'completed',
				label: 'Foresight Research',
			},
		} );

		expect( screen.getByText( 'Foresight Research' ) ).toBeInTheDocument();
	} );

	it( 'renders no raw ability id anywhere in the header', () => {
		const { container } = renderTopBar( {
			'workflow-discovery-foresight/foresight-research': {
				status: 'completed',
				label: 'Foresight Research',
			},
			'vip-workflows/seed-analyst': {
				status: 'completed',
				label: 'Seed Analyst',
			},
		} );

		expect( container.textContent ).not.toMatch(
			/workflow-discovery-foresight\/foresight-research/
		);
		expect( container.textContent ).not.toMatch(
			/vip-workflows\/seed-analyst/
		);
	} );

	it( 'names the Seed Analyst, which is no research ability at all', () => {
		renderTopBar( {
			'vip-workflows/seed-analyst': {
				status: 'completed',
				label: 'Seed Analyst',
			},
		} );

		expect( screen.getByText( 'Seed Analyst' ) ).toBeInTheDocument();
	} );
} );

describe( 'ideation top bar — assistant status tone', () => {
	it( 'renders an unavailable assistant in a neutral tone', () => {
		const { container } = renderStatus( 'unavailable' );

		expect( statusBadgeClasses( container ) ).toMatch( /is-none-intent/ );
	} );

	it( 'does not render an unavailable assistant as a failure', () => {
		const { container } = renderStatus( 'unavailable' );

		expect( statusBadgeClasses( container ) ).not.toMatch(
			/is-high-intent/
		);
	} );

	it( 'still renders a genuine failure in the error tone', () => {
		const { container } = renderStatus( 'failed' );

		expect( statusBadgeClasses( container ) ).toMatch( /is-high-intent/ );
	} );

	it( 'keeps the informational tone while running', () => {
		const { container } = renderStatus( 'running' );

		expect( statusBadgeClasses( container ) ).toMatch(
			/is-informational-intent/
		);
	} );

	it( 'keeps the stable tone when a completed agent reports a count', () => {
		const { container } = renderStatus( 'completed', { card_count: 12 } );

		expect( statusBadgeClasses( container ) ).toMatch( /is-stable-intent/ );
		expect( screen.getByText( '12 found' ) ).toBeInTheDocument();
	} );

	it( 'drops the redundant word for a completed agent that found nothing, but keeps it for assistive technology', () => {
		const { container } = renderStatus( 'completed' );

		expect(
			container.querySelector(
				'.vip-workflows-ideation-topbar__assistant-status'
			)
		).not.toBeInTheDocument();
		expect( screen.getByText( 'done' ) ).toBeInTheDocument();
	} );
} );

describe( 'ideation top bar — agent chips are not controls', () => {
	it( 'renders no interactive element among the agent statuses', () => {
		const { container } = renderTopBar( {
			[ ABILITY ]: { status: 'completed', label: 'Web Researcher' },
			'vip-workflows/media-scout': {
				status: 'completed',
				label: 'Media Scout',
				card_count: 12,
			},
		} );

		const agents = container.querySelector(
			'.vip-workflows-ideation-topbar__assistants'
		);

		expect( agents ).toBeInTheDocument();
		expect(
			agents.querySelectorAll(
				'button, a, input, [role="button"], [tabindex]'
			)
		).toHaveLength( 0 );
	} );
} );

describe( 'ideation top bar — an unavailable agent names its requirement', () => {
	const unavailable = {
		'workflow-discovery-foresight/foresight-research': {
			status: 'unavailable',
			label: 'Foresight Research',
			availability: {
				available: false,
				groups: [
					{
						satisfy: 'all',
						requirements: [
							{
								id: 'settings:foresight-news',
								kind: 'missing_credential',
								sources: [ 'Foresight Research' ],
								message:
									'Foresight News is not connected. Ask an administrator to connect it.',
							},
						],
					},
				],
			},
		},
	};

	it( 'states what is unconfigured rather than only that it is unavailable', () => {
		const { container } = renderTopBar( unavailable );

		const unmet = container.querySelector(
			'.vip-workflows-ideation-topbar__assistant-unmet'
		);

		expect( unmet ).toBeInTheDocument();
		expect(
			within( unmet ).getByText(
				'Foresight News is not connected. Ask an administrator to connect it.'
			)
		).toBeInTheDocument();
	} );

	it( 'leaks no admin destination into an editor-facing surface', () => {
		const { container } = renderTopBar( unavailable );

		// The user register carries `message` and omits both `reason` and
		// `destination`, so there is nothing here that could render a link to a
		// `manage_options` screen. Assert the absence, since widening the register
		// server-side is the mistake this surface must not invite.
		expect( container.querySelectorAll( 'a' ) ).toHaveLength( 0 );
		expect( container.textContent ).not.toMatch( /wp-admin/ );
	} );

	it( 'points an administrator at no destination either, because none is here', () => {
		// The register follows the reader, so an administrator opening ideation gets
		// the admin register — including an `in_card` destination whose fields live
		// on the Agents screen and a sign-up link that belongs beside them. The
		// requirement is still named; the destination is not.
		const { container } = renderTopBar( {
			'workflow-discovery-foresight/foresight-research': {
				status: 'unavailable',
				label: 'Foresight Research',
				availability: {
					available: false,
					groups: [
						{
							satisfy: 'all',
							requirements: [
								{
									id: 'settings:foresight-news',
									kind: 'missing_credential',
									sources: [ 'Foresight Research' ],
									reason: 'Foresight News sign-in details are missing.',
									destination: {
										kind: 'in_card',
										url: '',
										label: '',
										hint: 'Complete the email and password fields below.',
										credentials_url:
											'https://www.foresightnews.com/register',
									},
								},
							],
						},
					],
				},
			},
		} );

		expect(
			screen.getByText( 'Foresight News sign-in details are missing.' )
		).toBeInTheDocument();
		expect( container.textContent ).not.toMatch( /fields below/ );
		expect( container.textContent ).not.toMatch(
			/Where to get these credentials/
		);
		expect( container.querySelectorAll( 'a' ) ).toHaveLength( 0 );
	} );
} );

describe( 'ideation top bar — header scope', () => {
	it( 'renders neither the extracted topics nor the news angle', () => {
		const { container } = renderTopBar(
			{ [ ABILITY ]: { status: 'completed', label: 'Web Researcher' } },
			{
				seed_analysis: {
					tags: [ 'public lands', 'antiquities act' ],
					news_angle: 'A boundary review is expected this autumn.',
				},
			}
		);

		expect( container.textContent ).not.toMatch( /public lands/ );
		expect( container.textContent ).not.toMatch( /antiquities act/ );
		expect( container.textContent ).not.toMatch( /boundary review/ );
	} );

	it( 'still renders the seed', () => {
		renderTopBar( {
			[ ABILITY ]: { status: 'completed', label: 'Web Researcher' },
		} );

		expect( screen.getByText( 'A seed' ) ).toBeInTheDocument();
	} );
} );
