/**
 * What changed between two DataViews filter lists, in terms safe to record.
 *
 * Only applied filters count: DataViews adds a filter as soon as one is
 * picked from the menu, before it has a value, and that is not a filter yet.
 * Values are never returned — they name people, stages and terms.
 */

/**
 * Whether a filter value actually filters anything.
 *
 * @param {*} value A DataViews filter value.
 * @return {boolean} True when the filter narrows the list.
 */
function isApplied( value ) {
	if ( Array.isArray( value ) ) {
		return value.length > 0;
	}

	return value !== undefined && value !== null && value !== '';
}

/**
 * Applied filters keyed by field, each reduced to a comparable string.
 *
 * @param {Array} filters DataViews filters.
 * @return {Map<string, string>} Field to serialized operator and value.
 */
function appliedByField( filters = [] ) {
	return new Map(
		filters
			.filter( ( filter ) => isApplied( filter.value ) )
			.map( ( filter ) => [
				filter.field,
				JSON.stringify( [ filter.operator, filter.value ] ),
			] )
	);
}

/**
 * Describe how the applied filters changed.
 *
 * @param {Array} previous Filters before the change.
 * @param {Array} next     Filters after the change.
 * @return {{field: string, filter_count: number}|null} The field that changed
 *         (`multiple` when more than one did, as on a reset) and how many
 *         filters now apply; null when the applied filters are the same.
 */
export function describeFilterChange( previous, next ) {
	const before = appliedByField( previous );
	const after = appliedByField( next );

	const changed = new Set(
		[ ...before.keys(), ...after.keys() ].filter(
			( field ) => before.get( field ) !== after.get( field )
		)
	);

	if ( changed.size === 0 ) {
		return null;
	}

	return {
		field: changed.size === 1 ? [ ...changed ][ 0 ] : 'multiple',
		filter_count: after.size,
	};
}
