import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(
	path.dirname( fileURLToPath( import.meta.url ) ),
	'../..'
);

function defaultMountedPlugins() {
	const wpEnv = JSON.parse(
		readFileSync( path.join( ROOT, '.wp-env.json' ), 'utf8' )
	);

	return new Set(
		wpEnv.plugins.filter( ( plugin ) => plugin.startsWith( './' ) )
	);
}

function pluginForAbility( abilityId ) {
	return `./${ abilityId.split( '/', 1 )[ 0 ] }`;
}

test( 'shipped demos use only abilities mounted in the default environment', () => {
	const mountedPlugins = defaultMountedPlugins();
	const demosDirectory = path.join( ROOT, 'docs/demos' );
	const missingDependencies = [];

	for ( const filename of readdirSync( demosDirectory ).filter( ( name ) =>
		name.endsWith( '.json' )
	) ) {
		const demo = JSON.parse(
			readFileSync( path.join( demosDirectory, filename ), 'utf8' )
		);
		const abilityIds = [];

		for ( const status of demo.config.statuses ) {
			if ( status.agent?.ability_id ) {
				abilityIds.push( status.agent.ability_id );
			}

			for ( const transition of status.transitions ?? [] ) {
				abilityIds.push( ...( transition.required_tools ?? [] ) );
			}
		}

		for ( const abilityId of abilityIds ) {
			const plugin = pluginForAbility( abilityId );

			if ( ! mountedPlugins.has( plugin ) ) {
				missingDependencies.push( `${ filename }: ${ abilityId }` );
			}
		}
	}

	assert.deepEqual(
		missingDependencies,
		[],
		'Shipped demos must import in the default wp-env environment.'
	);
} );

test( 'default seed content uses only assistants mounted in the default environment', () => {
	const mountedPlugins = defaultMountedPlugins();
	const seed = readFileSync(
		path.join( ROOT, 'tools/vip-workflows-content.xml' ),
		'utf8'
	);
	const assistantIds = new Set();
	const statusesPattern =
		/<wp:meta_key><!\[CDATA\[_vip_ideation_assistant_statuses\]\]><\/wp:meta_key>\s*<wp:meta_value><!\[CDATA\[(.*?)\]\]><\/wp:meta_value>/gs;
	const resultPattern =
		/<wp:meta_key><!\[CDATA\[_vip_ideation_asst_([^\]]+)\]\]><\/wp:meta_key>/g;

	for ( const match of seed.matchAll( statusesPattern ) ) {
		for ( const assistantId of Object.keys( JSON.parse( match[ 1 ] ) ) ) {
			assistantIds.add( assistantId );
		}
	}

	for ( const match of seed.matchAll( resultPattern ) ) {
		assistantIds.add( match[ 1 ].replace( '__', '/' ) );
	}

	const missingDependencies = [ ...assistantIds ]
		.filter(
			( assistantId ) =>
				! mountedPlugins.has( pluginForAbility( assistantId ) )
		)
		.sort();

	assert.deepEqual(
		missingDependencies,
		[],
		'Default seed content must not restore assistants absent from wp-env.'
	);
} );
