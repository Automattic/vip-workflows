/**
 * Agents page: the screen's shape, and its availability requirements.
 *
 * The bug the requirement tests were written for: an agent whose dependencies
 * are unmet rendered one generic sentence naming no requirement and linking
 * nowhere. Web Researcher and Media Scout hit it on a fresh install, so an env
 * with no Tavily/YouTube credential is exactly the reproduction case.
 *
 * These assert the structured payload arrives from both routes, that the card
 * names the requirement and offers a destination, and — the rule that matters
 * most — that no requirement ever renders an anchor the user cannot act on.
 *
 * The screen was migrated to docs/guides/settings-standard.md, which changed
 * three things these tests depend on:
 *
 *   1. The origin groups became a two-tab strip (`Built-in` / `From plugins`),
 *      so a card is only on screen when its own tab is active. Panels are
 *      `keepMounted`, so the inactive panel's cards stay in the DOM — visible
 *      and present are no longer the same question, and every card lookup goes
 *      through `visitAgents( admin, agent.origin )`.
 *   2. The per-card Save became one Save in the page header.
 *   3. The `Setup needed` badge was deleted: it sat directly above a notice
 *      carrying the same fact, and the notice names *which* requirement is
 *      unmet, so the notice is what stayed.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

const CARD = '.vip-workflows-assistant-card';
const REQUIREMENTS = '.vip-workflows-assistant-card__requirements';
const HEADER_ACTIONS = '.vip-workflows-admin-page__actions';

/**
 * Fetch the agent list from the unified endpoint.
 *
 * @param {Object} requestUtils Playwright request utils.
 * @return {Promise<Array>} Agent entries.
 */
async function fetchAgents( requestUtils ) {
	return requestUtils.rest( { path: '/vip-workflows/v1/assistants' } );
}

/**
 * Open the Agents screen on the tab that holds a given origin.
 *
 * The active tab round-trips through the `tab` query param, and an entry's
 * `origin` (`built-in` | `plugin`) is exactly the tab value — so a test that
 * knows which agent it is after can land on that agent's panel directly rather
 * than clicking through.
 *
 * @param {Object} admin    Playwright admin utils.
 * @param {string} [origin] Agent origin, and therefore the tab to open.
 */
async function visitAgents( admin, origin = 'built-in' ) {
	await admin.visitAdminPage(
		'admin.php',
		`page=vip-workflows-agents&tab=${ origin }`
	);
}

/**
 * The screen's one Save, which lives in the page header beside the how-to.
 *
 * @param {Object} page Playwright page.
 * @return {Object} Locator for the header Save button.
 */
function headerSave( page ) {
	return page
		.locator( HEADER_ACTIONS )
		.getByRole( 'button', { name: 'Save' } );
}

test.describe( 'VIP Workflows — agent availability requirements', () => {
	test( 'the list endpoint carries the structured availability shape', async ( {
		requestUtils,
	} ) => {
		const agents = await fetchAgents( requestUtils );

		expect( Array.isArray( agents ) ).toBe( true );
		expect( agents.length ).toBeGreaterThan( 0 );

		for ( const agent of agents ) {
			// `groups` is always a list, never null — clients must not have to
			// distinguish "no requirements" from "key absent".
			expect( Array.isArray( agent.availability.groups ) ).toBe( true );
			expect( agent.availability.available ).toBe( agent.available );
			expect( [ 'available', 'partial', 'unavailable' ] ).toContain(
				agent.availability_state
			);
			expect( Array.isArray( agent.availability_sources ) ).toBe( true );
			// The screen groups by origin, so every entry has to name one.
			expect( [ 'built-in', 'plugin' ] ).toContain( agent.origin );

			if ( agent.available ) {
				expect( agent.availability.groups ).toHaveLength( 0 );
			}
		}
	} );

	test( 'the single-item route returns the same entry as the list', async ( {
		requestUtils,
	} ) => {
		const agents = await fetchAgents( requestUtils );
		const target = agents.find( ( a ) => ! a.available ) || agents[ 0 ];

		const single = await requestUtils.rest( {
			path: `/vip-workflows/v1/assistants/${ target.slug }`,
		} );

		expect( single.slug ).toBe( target.slug );
		expect( single.available ).toBe( target.available );
		expect( single.availability_state ).toBe( target.availability_state );
		expect( single.availability.groups ).toEqual(
			target.availability.groups
		);
	} );

	test( 'divides the agents into a built-in tab and a plugin tab', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const agents = await fetchAgents( requestUtils );
		const builtIn = agents.filter( ( a ) => 'built-in' === a.origin );
		const fromPlugins = agents.filter( ( a ) => 'built-in' !== a.origin );

		await visitAgents( admin );

		await expect(
			page.getByRole( 'tab', { name: 'Built-in' } )
		).toBeVisible();
		await expect(
			page.getByRole( 'tab', { name: 'From plugins' } )
		).toBeVisible();

		/*
		 * Only the active panel's cards are on screen. The inactive panel keeps
		 * its cards mounted so a reader's edits survive a tab switch, which is
		 * why this counts *visible* cards rather than cards in the DOM.
		 */
		await expect( page.locator( `${ CARD }:visible` ) ).toHaveCount(
			builtIn.length
		);

		await page.getByRole( 'tab', { name: 'From plugins' } ).click();

		await expect( page.locator( `${ CARD }:visible` ) ).toHaveCount(
			fromPlugins.length
		);

		if ( 0 === fromPlugins.length ) {
			// An empty origin says so rather than being filtered out: a strip
			// that varies per site can collapse to a single tab.
			await expect(
				page.getByText( 'No agent plugins are installed.' )
			).toBeVisible();
		}
	} );

	test( 'round-trips the active tab through the URL', async ( {
		admin,
		page,
	} ) => {
		await visitAgents( admin );

		await page.getByRole( 'tab', { name: 'From plugins' } ).click();

		await expect( page ).toHaveURL( /[?&]tab=plugin\b/ );

		// A reload lands back on the tab the URL names.
		await page.reload();

		await expect(
			page.getByRole( 'tab', { name: 'From plugins' } )
		).toHaveAttribute( 'aria-selected', 'true' );
	} );

	test( 'offers the how-to and exactly one Save, both in the page header', async ( {
		admin,
		page,
	} ) => {
		await visitAgents( admin );

		await expect(
			page.getByRole( 'button', { name: 'Add custom agents' } )
		).toBeVisible();

		// One Save for the whole screen, disabled until something is edited.
		await expect(
			page.getByRole( 'button', { name: 'Save' } )
		).toHaveCount( 1 );
		await expect( headerSave( page ) ).toBeDisabled();

		// The cards carry none of their own — not even in the inactive panel,
		// whose cards are mounted and would still match.
		await expect(
			page.locator( CARD ).getByRole( 'button', { name: 'Save' } )
		).toHaveCount( 0 );
	} );

	test( 'an unconfigured agent names its requirement and offers a destination', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const agents = await fetchAgents( requestUtils );
		const unconfigured = agents.find(
			( a ) => ! a.available && a.availability.groups.length > 0
		);

		test.skip(
			! unconfigured,
			'Every agent on this environment is fully configured.'
		);

		await visitAgents( admin, unconfigured.origin );

		const card = page.locator(
			`${ CARD }[data-assistant-slug="${ unconfigured.slug }"]`
		);
		await expect( card ).toBeVisible();

		const requirements = card.locator( REQUIREMENTS );
		await expect( requirements ).toBeVisible();

		// The named reason replaces the old generic dead-end sentence.
		const firstRequirement =
			unconfigured.availability.groups[ 0 ].requirements[ 0 ];
		await expect(
			requirements.getByText( firstRequirement.reason, { exact: false } )
		).toBeVisible();
		await expect(
			card.getByText(
				'This agent has required settings that are not yet configured.'
			)
		).toHaveCount( 0 );

		/*
		 * Said once. A `Setup needed` badge in the header was a second rendering
		 * of what this block already says, and it said less — the block names
		 * which requirement is unmet.
		 */
		await expect( card.getByText( /Setup needed/ ) ).toHaveCount( 0 );

		// The re-check control is present and usable.
		await expect(
			card.getByRole( 'button', { name: 'Retry' } )
		).toBeEnabled();
	} );

	test( 'a requirement anchor points where the payload said it would', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		/*
		 * Asserted against the destination the API declared, rather than against a
		 * hardcoded screen.
		 *
		 * The previous version searched for any admin-URL destination and required
		 * it to be Connectors, which held only while a missing credential was the
		 * one such requirement agents produced. Different requirements point at
		 * different screens on purpose — a missing key belongs at Connectors, an
		 * unresolved provider selection at the picker that writes the selection —
		 * so pinning one screen made the test a hostage to which requirement
		 * happened to be unmet on the environment. Narrowing it by kind instead
		 * only moved the problem: on a site with no credential at all, nothing
		 * produces a Connectors-linked requirement, and the test skips silently.
		 *
		 * What has to hold regardless is that the anchor goes where the payload
		 * said it would.
		 */
		const agents = await fetchAgents( requestUtils );

		const targets = agents.flatMap( ( agent ) =>
			agent.availability.groups.flatMap( ( group ) =>
				group.requirements
					.filter(
						( requirement ) =>
							'admin_url' === requirement.destination.kind
					)
					.map( ( requirement ) => ( {
						slug: agent.slug,
						origin: agent.origin,
						url: requirement.destination.url,
					} ) )
			)
		);

		// Grouped so each tab is opened once rather than per requirement.
		targets.sort( ( a, b ) => a.origin.localeCompare( b.origin ) );

		expect(
			targets.length,
			'No agent reported an admin-URL destination, so this test would prove nothing.'
		).toBeGreaterThan( 0 );

		/*
		 * Asserted on each target's own tab. The screen keeps the inactive tab's
		 * cards in the DOM, so a single visit finds every agent's anchor by
		 * selector and then fails `toBeVisible` on the first one belonging to the
		 * other tab — which is exactly how this read on a site whose only
		 * admin-URL requirement came from a plugin agent. An agent's `origin` is
		 * the tab value, so it names where its own card is on screen.
		 */
		let openTab = null;

		for ( const target of targets ) {
			if ( target.origin !== openTab ) {
				await visitAgents( admin, target.origin );
				openTab = target.origin;
			}

			const link = page
				.locator(
					`${ CARD }[data-assistant-slug="${ target.slug }"] ${ REQUIREMENTS } a`
				)
				.first();

			await expect( link ).toBeVisible();
			await expect( link ).toHaveAttribute( 'target', '_blank' );
			await expect( link ).toHaveAttribute( 'href', target.url );
		}
	} );

	/**
	 * The counterpart destination. A site with no AI provider resolvable reports
	 * that as its own requirement, and it has to point at the picker that writes
	 * the selection — Connectors holds keys, not the choice between them, so
	 * sending an administrator there would be a dead end.
	 */
	test( 'an unresolved provider selection links to VIP Workflows settings', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const agents = await fetchAgents( requestUtils );
		const withProviderRequirement = agents.find( ( a ) =>
			a.availability.groups.some( ( group ) =>
				group.requirements.some(
					( requirement ) =>
						'settings:ai-provider:none' === requirement.id
				)
			)
		);

		test.skip(
			! withProviderRequirement,
			'No agent on this environment reports an unresolved provider selection.'
		);

		await visitAgents( admin, withProviderRequirement.origin );

		const link = page
			.locator(
				`${ CARD }[data-assistant-slug="${ withProviderRequirement.slug }"] ${ REQUIREMENTS } a`
			)
			.first();

		await expect( link ).toBeVisible();
		await expect( link ).toHaveAttribute(
			'href',
			/page=vip-workflows-settings/
		);
	} );

	test( 'no requirement renders an anchor the user cannot act on', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		/*
		 * Derived from the API first: with no anchor-producing requirement
		 * anywhere, the locator matches nothing and the assertion below would
		 * pass without having tested anything.
		 *
		 * Two kinds of requirement produce an anchor, and they are mutually
		 * exclusive — see RequirementDestination in AgentRequirements.js:
		 *   - an `admin_url` destination renders its own link and returns early,
		 *     so it never also renders a credentials link;
		 *   - any other kind (`in_card`, `none`) renders a credentials link when
		 *     the destination carries a `credentials_url`.
		 * Counting only the first kind undercounts the DOM.
		 *
		 * The count spans both origins deliberately: `keepMounted` leaves the
		 * inactive panel's cards in the DOM, so every agent's anchors are
		 * reachable from one page load whichever tab is open.
		 */
		const agents = await fetchAgents( requestUtils );
		const anchorsFor = ( requirement ) => {
			const destination = requirement.destination;
			if ( ! destination ) {
				return 0;
			}
			if ( 'admin_url' === destination.kind && destination.url ) {
				return 1;
			}
			return destination.credentials_url ? 1 : 0;
		};
		const expectedAnchors = agents.reduce(
			( total, agent ) =>
				total +
				agent.availability.groups.reduce(
					( groupTotal, group ) =>
						groupTotal +
						group.requirements.reduce(
							( reqTotal, requirement ) =>
								reqTotal + anchorsFor( requirement ),
							0
						),
					0
				),
			0
		);

		test.skip(
			0 === expectedAnchors,
			'No agent on this environment reports an admin-URL destination.'
		);

		await visitAgents( admin );

		// The tab strip only renders once the list has loaded, so waiting on it
		// is what makes the count below a real assertion rather than a race. A
		// card cannot serve as that gate: with no built-in agents the first one
		// in the DOM sits in the hidden panel.
		await expect(
			page.getByRole( 'tab', { name: 'Built-in' } )
		).toBeVisible();

		const anchors = page.locator( `${ REQUIREMENTS } a` );
		await expect( anchors ).toHaveCount( expectedAnchors );

		// Every anchor inside a requirement block resolves somewhere real.
		const hrefs = await anchors.evaluateAll( ( elements ) =>
			elements.map( ( anchor ) => anchor.getAttribute( 'href' ) )
		);

		for ( const href of hrefs ) {
			expect( href ).toBeTruthy();
			expect( href ).not.toBe( '#' );
		}
	} );

	test( 're-checking does not leave the screen falsely dirty', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const agents = await fetchAgents( requestUtils );
		const unconfigured = agents.find( ( a ) => ! a.available && a.enabled );

		test.skip(
			! unconfigured,
			'Every agent on this environment is fully configured.'
		);

		await visitAgents( admin, unconfigured.origin );

		const card = page.locator(
			`${ CARD }[data-assistant-slug="${ unconfigured.slug }"]`
		);
		await expect( card ).toBeVisible();

		const save = headerSave( page );
		await expect( save ).toBeDisabled();

		await card.getByRole( 'button', { name: 'Retry' } ).click();
		await expect(
			card.getByRole( 'button', { name: 'Retry' } )
		).toBeEnabled();

		// Nothing changed, so the screen must not read as having unsaved edits.
		await expect( save ).toBeDisabled();
		await expect( page.getByText( 'Unsaved changes' ) ).toHaveCount( 0 );
	} );
} );
