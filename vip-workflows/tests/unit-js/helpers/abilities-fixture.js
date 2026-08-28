/**
 * The one description of the abilities response, for every JS suite that reads one.
 *
 * `GET /vip-workflow/v1/abilities` had no schema and no shared fixture, so each
 * suite hand-built its own partial copy of the response — and a partial copy cannot
 * contradict the code it stands in for. Three bugs shipped behind a green suite
 * because of it: a fixture that set `name` to the human name let thirty tests pass
 * over a screen of raw ability ids; fixtures that omitted `enabled` and `icon` hid a
 * card list that vanished when filtered and dashicon slugs rendered as literal text.
 * Every one was found by looking at the screen.
 *
 * Keys and their presence rules come from tests/fixtures/abilities-response-contract.json,
 * which is the same file the PHP schema and the real endpoint's output are pinned to
 * (tests/phpunit/Unit/AbilitiesResponseContractTest.php and
 * tests/phpunit/Integration/AbilitiesResponseShapeTest.php). Nothing here restates
 * the key list, so a key added to the endpoint without a default below turns the
 * suite red rather than quietly going missing from every fixture at once.
 *
 * Three variants, because the endpoint really does emit three different key sets:
 *
 *   - `vipAbility()` — a `VIPWorkflow\Abilities\Ability`, which every VIP agent is.
 *     Carries every key except the request-scoped ones. This is the default; reach
 *     for it unless a test is specifically about one of the others.
 *   - `plainAbility()` — a third-party plain `WP_Ability`, which has no icon,
 *     messages, display order or `available` mirror.
 *   - `abilityRequiredForTransition()` — a row from a `post_id`-scoped request,
 *     which adds `required_for`.
 *
 * `name` is derived from `id` rather than defaulted independently, so no caller can
 * reintroduce the label-in-`name` bug by overriding one and forgetting the other.
 *
 * @package
 */

const contract = require( '../../fixtures/abilities-response-contract.json' );

/**
 * Keys the contract assigns a given presence rule.
 *
 * @param {...string} rules Presence rules to collect.
 * @return {string[]} Matching keys, in contract order.
 */
function keysWithPresence( ...rules ) {
	return Object.keys( contract.keys ).filter( ( key ) =>
		rules.includes( contract.keys[ key ].presence )
	);
}

const ALWAYS_KEYS = keysWithPresence( 'always' );
const ABILITY_SUBCLASS_KEYS = keysWithPresence( 'ability_subclass' );
const REQUEST_PARAM_KEYS = keysWithPresence( 'request_param' );

const DEFAULT_ID = 'vip-workflow/web-researcher';

/**
 * A realistic value for every key the endpoint can emit.
 *
 * Deliberately realistic rather than minimal: `icon` is a dashicon slug because
 * that is what the endpoint sends and rendering it as text was the bug, and
 * `enabled` is present because a consumer that filters on it cannot be tested by a
 * fixture that lacks it. `name` is absent — it is derived from `id` below.
 */
const DEFAULTS = {
	id: DEFAULT_ID,
	label: 'Web Researcher',
	description: 'Searches the open web for relevant reporting.',
	category: 'research',
	schema: {},
	meta: { supports: [] },
	enabled: true,
	show_in_commands: false,
	availability: { available: true, groups: [] },
	check_modes: [],
	icon: 'search',
	thinking_message: 'Searching the web…',
	success_message: 'Found relevant sources.',
	display_order: 100,
	available: true,
	required_for: [],
};

/**
 * Build one response row over a given key set.
 *
 * @param {string[]} keys      Keys this variant carries.
 * @param {Object}   overrides Field overrides.
 * @return {Object} Ability response row.
 */
function build( keys, overrides = {} ) {
	const row = {};

	for ( const key of keys ) {
		row[ key ] = DEFAULTS[ key ];
	}

	const built = { ...row, ...overrides };

	/*
	 * `name` and `id` are one value in the response, so `name` follows `id` instead
	 * of being defaulted separately — overriding the id alone cannot leave a fixture
	 * whose identifier keys disagree. An explicit `name` override still wins, which
	 * is what lets the guard reconstruct the historical bad shape on purpose.
	 */
	if ( keys.includes( 'name' ) && ! ( 'name' in overrides ) ) {
		built.name = built.id;
	}

	return built;
}

/**
 * A `VIPWorkflow\Abilities\Ability` row — the shape every VIP agent produces.
 *
 * @param {Object} overrides Field overrides.
 * @return {Object} Ability response row.
 */
export function vipAbility( overrides = {} ) {
	return build( [ ...ALWAYS_KEYS, ...ABILITY_SUBCLASS_KEYS ], overrides );
}

/**
 * A third-party plain `WP_Ability` row, carrying only the always-present keys.
 *
 * @param {Object} overrides Field overrides.
 * @return {Object} Ability response row.
 */
export function plainAbility( overrides = {} ) {
	return build( ALWAYS_KEYS, overrides );
}

/**
 * A row from a `post_id`-scoped request, which adds `required_for`.
 *
 * @param {Object} overrides Field overrides.
 * @return {Object} Ability response row.
 */
export function abilityRequiredForTransition( overrides = {} ) {
	return build(
		[ ...ALWAYS_KEYS, ...ABILITY_SUBCLASS_KEYS, ...REQUEST_PARAM_KEYS ],
		overrides
	);
}

/**
 * A turned-off agent. The endpoint lists these rather than filtering them out,
 * which is what makes a consumer's filtering testable at all.
 *
 * @param {Object} overrides Field overrides.
 * @return {Object} Ability response row.
 */
export function disabledVipAbility( overrides = {} ) {
	return vipAbility( { enabled: false, available: false, ...overrides } );
}

/**
 * Key sets, exported for the guard that pins them against the contract.
 */
export const abilityKeys = {
	always: ALWAYS_KEYS,
	abilitySubclass: ABILITY_SUBCLASS_KEYS,
	requestParam: REQUEST_PARAM_KEYS,
};

export const abilitiesResponseContract = contract;

/**
 * Every way a candidate row fails to describe something the endpoint could send.
 *
 * Both directions are faults: a key the endpoint always sends but the fixture lacks
 * (a consumer reading it cannot be tested), and a key the endpoint never sends
 * (a consumer is being tested against a field that will not be there). The
 * `ability_subclass` keys are required of the `vip` variant even though the endpoint
 * may omit them, because omitting them is what hid the icon bug — the presence rule
 * describes when the *endpoint* omits a key, not permission for a fixture to.
 *
 * @param {Object} row       Candidate response row.
 * @param {string} [variant] 'vip' (default), 'plain', or 'requiredFor'.
 * @return {string[]} Problems found; empty when the row conforms.
 */
export function validateAbilityFixture( row, variant = 'vip' ) {
	const expected = {
		vip: [ ...ALWAYS_KEYS, ...ABILITY_SUBCLASS_KEYS ],
		plain: ALWAYS_KEYS,
		requiredFor: [
			...ALWAYS_KEYS,
			...ABILITY_SUBCLASS_KEYS,
			...REQUEST_PARAM_KEYS,
		],
	}[ variant ];

	if ( ! expected ) {
		throw new Error( `Unknown ability fixture variant "${ variant }".` );
	}

	const problems = [];
	const present = Object.keys( row );

	for ( const key of expected ) {
		if ( ! present.includes( key ) ) {
			problems.push(
				`missing "${ key }" — the endpoint sends it (${ contract.keys[ key ].presence }): ${ contract.keys[ key ].why }`
			);
		}
	}

	for ( const key of present ) {
		if ( ! contract.keys[ key ] ) {
			problems.push(
				`unknown key "${ key }" — no abilities response contains it`
			);
			continue;
		}
		if ( ! expected.includes( key ) ) {
			problems.push(
				`"${ key }" is not sent for the "${ variant }" variant (${ contract.keys[ key ].presence })`
			);
		}
	}

	const { identityKeys, abilityIdPattern, labelKeys } = contract.invariants;
	const pattern = new RegExp( abilityIdPattern );

	// The identifier keys are built from one `get_name()` call, so a fixture where
	// they disagree — or where one holds a human name — describes no real response.
	const identityValues = identityKeys.keys
		.filter( ( key ) => key in row )
		.map( ( key ) => row[ key ] );

	for ( const key of identityKeys.keys ) {
		if ( key in row && ! pattern.test( String( row[ key ] ) ) ) {
			problems.push(
				`"${ key }" is "${ row[ key ] }", which is not an ability identifier — ${ contract.invariants.abilityIdPatternWhy }`
			);
		}
	}

	if ( new Set( identityValues ).size > 1 ) {
		problems.push(
			`${ identityKeys.keys
				.map( ( key ) => `${ key }="${ row[ key ] }"` )
				.join( ', ' ) } — ${ identityKeys.why }`
		);
	}

	for ( const key of labelKeys.keys ) {
		if ( key in row && identityValues.includes( row[ key ] ) ) {
			problems.push(
				`"${ key }" is the identifier — ${ labelKeys.why }`
			);
		}
	}

	return problems;
}
