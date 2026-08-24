/**
 * Shared DataViews helpers.
 *
 * @package
 */

/**
 * Build `{ value, label }` filter elements from the distinct values of a field
 * across a set of DataViews items.
 *
 * @param {Array}  items Items to scan.
 * @param {string} key   Item property to collect.
 * @return {Array} Element descriptors.
 */
export function toElements( items, key ) {
	const values = new Set();
	items.forEach( ( item ) => {
		if ( item[ key ] ) {
			values.add( item[ key ] );
		}
	} );
	return [ ...values ].map( ( value ) => ( { value, label: value } ) );
}
