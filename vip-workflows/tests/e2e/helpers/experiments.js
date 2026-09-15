/**
 * Run an assertion with an experiment enabled, restoring its previous state.
 *
 * @param {Object}   requestUtils Authenticated request utilities.
 * @param {string}   id           Experiment ID.
 * @param {Function} callback     Assertions to run while enabled.
 */
async function withEnabledExperiment( requestUtils, id, callback ) {
	const path = '/vip-workflows/v1/settings/experiments';
	const experiments = await requestUtils.rest( { path } );
	const experiment = experiments.find( ( item ) => item.id === id );
	if ( ! experiment ) {
		throw new Error( `Experiment "${ id }" is not registered.` );
	}

	try {
		if ( ! experiment.enabled ) {
			await requestUtils.rest( {
				path,
				method: 'POST',
				data: { id, enabled: true },
			} );
		}
		await callback();
	} finally {
		if ( ! experiment.enabled ) {
			await requestUtils.rest( {
				path,
				method: 'POST',
				data: { id, enabled: false },
			} );
		}
	}
}

module.exports = { withEnabledExperiment };
