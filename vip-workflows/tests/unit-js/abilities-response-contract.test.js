/**
 * The guard over the shared abilities-response fixture.
 *
 * Three bugs shipped this week behind a green suite because the JS fixture for
 * `GET /vip-workflows/v1/abilities` did not match what the endpoint returns. None was
 * caught by a test; each was caught by looking at the screen. What they have in
 * common is not a missing assertion — it is that no test could distinguish a correct
 * fixture from an invented one, so the fixture was free to encode the bug's own
 * assumption.
 *
 * This file removes that freedom, in both directions: a key the endpoint sends that
 * the fixture lacks is a fault, and a key the endpoint never sends is a fault too.
 * The key list is not restated here — it comes from
 * tests/fixtures/abilities-response-contract.json, the same file
 * tests/phpunit/Unit/AbilitiesResponseContractTest.php pins the PHP schema to and
 * tests/phpunit/Integration/AbilitiesResponseShapeTest.php pins the real endpoint's
 * output to. Drift has to break one of the three.
 *
 * The last describe block is the acceptance criterion: each of the three historical
 * fixtures, reconstructed, and rejected.
 *
 * @package
 */

import {
	abilitiesResponseContract as contract,
	abilityKeys,
	abilityRequiredForTransition,
	disabledVipAbility,
	plainAbility,
	validateAbilityFixture,
	vipAbility,
} from './helpers/abilities-fixture';

describe( 'abilities response contract', () => {
	it( 'assigns every key a known presence rule and a reason', () => {
		const keys = Object.keys( contract.keys );
		expect( keys.length ).toBeGreaterThan( 0 );

		const rules = Object.keys( contract.presenceRules );

		for ( const key of keys ) {
			expect( rules ).toContain( contract.keys[ key ].presence );
			expect( contract.keys[ key ].why ).toBeTruthy();
		}
	} );

	it( 'partitions its keys across the three presence rules', () => {
		const partitioned = [
			...abilityKeys.always,
			...abilityKeys.abilitySubclass,
			...abilityKeys.requestParam,
		];

		expect( partitioned.sort() ).toEqual(
			Object.keys( contract.keys ).sort()
		);
		// A vacuous partition would let every assertion below pass.
		expect( abilityKeys.always.length ).toBeGreaterThan( 0 );
		expect( abilityKeys.abilitySubclass.length ).toBeGreaterThan( 0 );
		expect( abilityKeys.requestParam.length ).toBeGreaterThan( 0 );
	} );

	it( 'names the keys the three bugs turned on', () => {
		// Not decoration. If a rename quietly drops one of these from the contract,
		// the guard would still pass while no longer guarding the thing it was
		// written for.
		expect( abilityKeys.always ).toContain( 'name' );
		expect( abilityKeys.always ).toContain( 'enabled' );
		expect( abilityKeys.abilitySubclass ).toContain( 'icon' );
	} );
} );

describe( 'the shared fixture builder', () => {
	it( 'builds a VIP ability carrying every non-request-scoped key', () => {
		expect( Object.keys( vipAbility() ).sort() ).toEqual(
			[ ...abilityKeys.always, ...abilityKeys.abilitySubclass ].sort()
		);
		expect( validateAbilityFixture( vipAbility() ) ).toEqual( [] );
	} );

	it( 'builds a plain ability carrying exactly the always-present keys', () => {
		expect( Object.keys( plainAbility() ).sort() ).toEqual(
			[ ...abilityKeys.always ].sort()
		);
		expect( validateAbilityFixture( plainAbility(), 'plain' ) ).toEqual(
			[]
		);
	} );

	it( 'builds a post-scoped row carrying the request-scoped keys too', () => {
		const row = abilityRequiredForTransition();

		expect( Object.keys( row ).sort() ).toEqual(
			[
				...abilityKeys.always,
				...abilityKeys.abilitySubclass,
				...abilityKeys.requestParam,
			].sort()
		);
		expect( validateAbilityFixture( row, 'requiredFor' ) ).toEqual( [] );
	} );

	// A contract key with no default would otherwise reach a component as
	// `undefined`, which is a shape the endpoint never sends either.
	it( 'gives every key a defined value', () => {
		for ( const [ key, value ] of Object.entries(
			abilityRequiredForTransition()
		) ) {
			expect( value ).toBeDefined();
			expect( key ).toBeTruthy();
		}
	} );

	it( 'moves the identifier keys together when the id is overridden', () => {
		const row = vipAbility( { id: 'workflow-x/scout', label: 'Scout' } );

		expect( row.name ).toBe( 'workflow-x/scout' );
		expect( validateAbilityFixture( row ) ).toEqual( [] );
	} );

	it( 'builds a turned-off agent that still carries every key', () => {
		const row = disabledVipAbility();

		expect( row.enabled ).toBe( false );
		expect( validateAbilityFixture( row ) ).toEqual( [] );
	} );

	it( 'rejects a row carrying a key no abilities response contains', () => {
		const problems = validateAbilityFixture(
			vipAbility( { tooltip: 'invented' } )
		);

		expect( problems ).toHaveLength( 1 );
		expect( problems[ 0 ] ).toMatch( /unknown key "tooltip"/ );
	} );

	it( 'rejects a request-scoped key on a row that did not ask for one', () => {
		const problems = validateAbilityFixture(
			vipAbility( { required_for: [] } )
		);

		expect( problems ).toHaveLength( 1 );
		expect( problems[ 0 ] ).toMatch( /"required_for" is not sent/ );
	} );

	it( 'rejects an ability-subclass key on the plain variant', () => {
		const problems = validateAbilityFixture(
			plainAbility( { icon: 'search' } ),
			'plain'
		);

		expect( problems ).toHaveLength( 1 );
		expect( problems[ 0 ] ).toMatch( /"icon" is not sent/ );
	} );
} );

/*
 * The acceptance criterion. Each block reconstructs the fixture shape that actually
 * shipped, and asserts the guard rejects it — naming the key, so the failure tells
 * the next person what the endpoint really sends rather than only that something is
 * wrong.
 */
describe( 'the three fixtures that shipped bugs', () => {
	it( 'rejects a label stored in `name` (raw ability ids on screen)', () => {
		// `{ id: ABILITY, name: 'Web Researcher' }`. No endpoint returns this:
		// `name` is the identifier, `label` is the human name. Thirty tests stayed
		// green over a panel rendering `vip-workflows/web-researcher` to the reader.
		const problems = validateAbilityFixture(
			vipAbility( { name: 'Web Researcher' } )
		);

		expect( problems.join( '\n' ) ).toMatch(
			/"name" is "Web Researcher", which is not an ability identifier/
		);
		expect( problems.join( '\n' ) ).toMatch( /id="vip-workflows/ );
	} );

	it( 'rejects a fixture with `enabled` omitted (collected cards vanished)', () => {
		// Filtering on `enabled` made a disabled agent's collected cards disappear.
		// Nothing could see it, because no fixture carried the key being filtered on.
		const row = vipAbility();
		delete row.enabled;

		const problems = validateAbilityFixture( row );

		expect( problems ).toHaveLength( 1 );
		expect( problems[ 0 ] ).toMatch( /^missing "enabled"/ );
		expect( problems[ 0 ] ).toMatch( /always/ );
	} );

	it( 'rejects a fixture with `icon` omitted (dashicon slugs as literal text)', () => {
		// The endpoint sends `icon: 'search'` for every VIP agent, and the board
		// rendered the slug as text. A fixture with no icon cannot show that.
		const row = vipAbility();
		delete row.icon;

		const problems = validateAbilityFixture( row );

		expect( problems ).toHaveLength( 1 );
		expect( problems[ 0 ] ).toMatch( /^missing "icon"/ );
		expect( problems[ 0 ] ).toMatch( /ability_subclass/ );
	} );

	// The plain variant is the one row that legitimately has no icon. It must stay
	// legitimate, or the guard above would just be banning a real response shape.
	it( 'still accepts the plain ability that genuinely has no icon', () => {
		expect( validateAbilityFixture( plainAbility(), 'plain' ) ).toEqual(
			[]
		);
	} );
} );
