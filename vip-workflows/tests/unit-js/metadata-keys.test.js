/**
 * Unit tests for metadata key utilities.
 *
 * Guards the Sequence editor field-key input contract: underscores are valid
 * metadata key characters and must remain visible while typing.
 */

import { sanitizeMetadataKey } from '../../src/admin/utils/metadata-keys';

describe( 'sanitizeMetadataKey', () => {
	it( 'preserves underscores while typing field keys', () => {
		expect( sanitizeMetadataKey( 'review_' ) ).toBe( 'review_' );
		expect( sanitizeMetadataKey( 'review_notes' ) ).toBe( 'review_notes' );
	} );

	it( 'matches the server key character set', () => {
		expect( sanitizeMetadataKey( 'Review Notes!' ) ).toBe(
			'review_notes_'
		);
		expect( sanitizeMetadataKey( 'review-notes' ) ).toBe( 'review_notes' );
	} );
} );
