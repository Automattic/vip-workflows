/**
 * Unit tests for describeFilterChange, which decides when My Work's filters
 * changed enough to record, and what to record about it.
 */

import { describeFilterChange } from '../../src/admin/utils/filter-change';

const author = ( value ) => ( { field: 'author', operator: 'isAny', value } );
const stage = ( value ) => ( {
	field: 'status_label',
	operator: 'isAny',
	value,
} );

describe( 'describeFilterChange', () => {
	it( 'ignores a filter picked from the menu that has no value yet', () => {
		expect(
			describeFilterChange( [], [ author( undefined ) ] )
		).toBeNull();
		expect( describeFilterChange( [], [ author( [] ) ] ) ).toBeNull();
	} );

	it( 'ignores a view change that leaves the filters alone', () => {
		expect(
			describeFilterChange( [ author( [ 3 ] ) ], [ author( [ 3 ] ) ] )
		).toBeNull();
		expect( describeFilterChange( undefined, undefined ) ).toBeNull();
	} );

	it( 'reports a filter being applied, with the count now applied', () => {
		expect(
			describeFilterChange(
				[ author( [ 3 ] ) ],
				[ author( [ 3 ] ), stage( [ 'Review' ] ) ]
			)
		).toEqual( { field: 'status_label', filter_count: 2 } );
	} );

	it( 'reports a changed value or operator on the same field', () => {
		expect(
			describeFilterChange( [ author( [ 3 ] ) ], [ author( [ 3, 4 ] ) ] )
		).toEqual( { field: 'author', filter_count: 1 } );
		expect(
			describeFilterChange(
				[ author( [ 3 ] ) ],
				[ { ...author( [ 3 ] ), operator: 'isNone' } ]
			)
		).toEqual( { field: 'author', filter_count: 1 } );
	} );

	it( 'reports a filter being removed', () => {
		expect(
			describeFilterChange(
				[ author( [ 3 ] ), stage( [ 'Review' ] ) ],
				[ stage( [ 'Review' ] ) ]
			)
		).toEqual( { field: 'author', filter_count: 1 } );
	} );

	it( 'reports a reset of several filters as multiple', () => {
		expect(
			describeFilterChange(
				[ author( [ 3 ] ), stage( [ 'Review' ] ) ],
				[]
			)
		).toEqual( { field: 'multiple', filter_count: 0 } );
	} );

	it( 'never returns a filter value', () => {
		const change = describeFilterChange( [], [ stage( [ 'Secret' ] ) ] );

		expect( JSON.stringify( change ) ).not.toContain( 'Secret' );
	} );
} );
