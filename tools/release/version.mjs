import { pathToFileURL } from 'node:url';

const versionPattern =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta)\.([1-9]\d*))?$/;

export function parseVersion( version ) {
	const match = versionPattern.exec( version );
	if ( ! match ) {
		throw new Error(
			`Invalid release version: ${ version }. Expected X.Y.Z, X.Y.Z-alpha.N, or X.Y.Z-beta.N (N starts at 1).`
		);
	}
	return {
		core: match.slice( 1, 4 ).map( BigInt ),
		channel: match[ 4 ],
		number: match[ 5 ] ? BigInt( match[ 5 ] ) : 0n,
	};
}

function compareVersions( left, right ) {
	const ranks = { alpha: 0, beta: 1, stable: 2 };
	const leftParts = [
		...left.core,
		ranks[ left.channel ?? 'stable' ],
		left.number,
	];
	const rightParts = [
		...right.core,
		ranks[ right.channel ?? 'stable' ],
		right.number,
	];
	for ( let index = 0; index < leftParts.length; index++ ) {
		if ( leftParts[ index ] < rightParts[ index ] ) return -1;
		if ( leftParts[ index ] > rightParts[ index ] ) return 1;
	}
	return 0;
}

export function nextVersion( currentVersion, releaseType ) {
	const current = parseVersion( currentVersion );
	const core = [ ...current.core ];
	let next;
	if ( releaseType === 'alpha' || releaseType === 'beta' ) {
		// Continue the current prerelease; start the next patch from stable.
		if ( ! current.channel ) core[ 2 ]++;
		const number =
			current.channel === releaseType ? current.number + 1n : 1n;
		next = `${ core.join( '.' ) }-${ releaseType }.${ number }`;
	} else if ( [ 'major', 'minor', 'patch' ].includes( releaseType ) ) {
		// Match npm's stable bumps: patch promotes a prerelease to stable.
		const index = { major: 0, minor: 1, patch: 2 }[ releaseType ];
		if (
			! current.channel ||
			core.slice( index + 1 ).some( ( part ) => part !== 0n )
		) {
			core[ index ]++;
		}
		for ( let reset = index + 1; reset < core.length; reset++ )
			core[ reset ] = 0n;
		next = core.join( '.' );
	} else {
		// Exact versions allow starting a new major/minor prerelease series.
		next = releaseType;
	}
	if ( compareVersions( parseVersion( next ), current ) <= 0 ) {
		throw new Error(
			`Release version ${ next } must be newer than ${ currentVersion }.`
		);
	}
	return next;
}

if (
	process.argv[ 1 ] &&
	import.meta.url === pathToFileURL( process.argv[ 1 ] ).href
) {
	try {
		const [ current, type ] = process.argv.slice( 2 );
		if ( process.argv.length !== 4 )
			throw new Error(
				'Expected a current version and release type/version.'
			);
		console.log(
			current === '--prerelease'
				? Boolean( parseVersion( type ).channel )
				: nextVersion( current, type )
		);
	} catch ( error ) {
		console.error( error.message );
		process.exitCode = 1;
	}
}
