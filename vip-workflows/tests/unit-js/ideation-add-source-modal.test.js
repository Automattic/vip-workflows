/**
 * Unit tests for what the Add source dialog says about audio and video.
 *
 * Audio and video are transcribed by OpenAI whatever provider the site chose,
 * so they need an OpenAI key. The upload mode always offers them. It says who
 * transcribes them when a key is set, and warns when none is that they will
 * upload but won't be transcribed.
 *
 * @package
 */

import {
	render,
	fireEvent,
	within,
	waitFor,
} from './helpers/render-wp-component';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

import apiFetch from '@wordpress/api-fetch';

import AddSourceModal from '../../src/admin/components/ideation/AddSourceModal';

/**
 * Open the dialog in upload mode.
 *
 * The modal renders into a portal, so queries run against the dialog itself.
 *
 * @return {HTMLElement} The dialog.
 */
function openUploadMode() {
	render(
		<AddSourceModal
			projectId={ 222 }
			onClose={ () => {} }
			onAdded={ () => {} }
		/>
	);

	const dialog = document.querySelector(
		'.vip-workflows-ideation-add-source-modal'
	);
	fireEvent.click(
		within( dialog ).getByRole( 'button', { name: 'Upload file' } )
	);
	return dialog;
}

/**
 * The `accept` list of the dialog's file input.
 *
 * @param {HTMLElement} dialog The dialog.
 * @return {string} The attribute value.
 */
const acceptOf = ( dialog ) =>
	dialog.querySelector( 'input[type="file"]' ).getAttribute( 'accept' );

afterEach( () => {
	delete window.vipWorkflowsIdeation;
} );

/*
 * FormFileUpload appends extra audio types to the list, so the dialog's own
 * list is checked as a prefix.
 */
const ALL_TYPES = 'image/*,audio/*,video/*,.pdf,.doc,.docx,.txt';

const WARNING =
	'OpenAI transcribes audio and video. OpenAI is not connected, so they won’t be transcribed.';

describe( 'add source — upload mode with an OpenAI key', () => {
	beforeEach( () => {
		window.vipWorkflowsIdeation = { transcriptionAvailable: true };
	} );

	it( 'offers audio and video and says OpenAI transcribes them', () => {
		const dialog = openUploadMode();

		expect(
			within( dialog ).getByText(
				'Upload images, PDFs, documents, audio or video.'
			)
		).toBeInTheDocument();
		expect(
			within( dialog ).getByText(
				'Audio and video files are sent to OpenAI to be transcribed.'
			)
		).toBeInTheDocument();
		expect(
			within( dialog ).queryByText( WARNING )
		).not.toBeInTheDocument();
		expect( acceptOf( dialog ).startsWith( ALL_TYPES ) ).toBe( true );
	} );
} );

describe( 'add source — upload mode without an OpenAI key', () => {
	beforeEach( () => {
		window.vipWorkflowsIdeation = { transcriptionAvailable: false };
	} );

	it( 'still offers audio and video, and warns they won’t be transcribed', () => {
		const dialog = openUploadMode();

		expect(
			within( dialog ).getByText(
				'Upload images, PDFs, documents, audio or video.'
			)
		).toBeInTheDocument();
		expect( within( dialog ).getByText( WARNING ) ).toBeInTheDocument();
		expect(
			within( dialog ).queryByText( /sent to OpenAI to be transcribed/ )
		).not.toBeInTheDocument();
		expect( acceptOf( dialog ).startsWith( ALL_TYPES ) ).toBe( true );
	} );

	it( 'uploads an audio file', async () => {
		const onAdded = jest.fn();
		apiFetch.mockResolvedValueOnce( { source_id: 'abc' } );
		render(
			<AddSourceModal
				projectId={ 222 }
				onClose={ () => {} }
				onAdded={ onAdded }
			/>
		);
		const dialog = document.querySelector(
			'.vip-workflows-ideation-add-source-modal'
		);
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Upload file' } )
		);
		fireEvent.change( dialog.querySelector( 'input[type="file"]' ), {
			target: {
				files: [
					new File( [ 'ID3' ], 'song.mp3', { type: 'audio/mpeg' } ),
				],
			},
		} );

		await waitFor( () => expect( onAdded ).toHaveBeenCalled() );
		expect( apiFetch ).toHaveBeenCalledWith(
			expect.objectContaining( {
				path: expect.stringContaining( '/sources/upload' ),
			} )
		);
	} );
} );

/*
 * `wp_localize_script()` casts top-level booleans to strings, so the page
 * receives `'1'` or `''`, never `true` or `false`.
 */
describe( 'add source — the value as wp_localize_script() sends it', () => {
	it( 'reads "1" as a key', () => {
		window.vipWorkflowsIdeation = { transcriptionAvailable: '1' };
		const dialog = openUploadMode();

		expect(
			within( dialog ).getByText(
				'Audio and video files are sent to OpenAI to be transcribed.'
			)
		).toBeInTheDocument();
		expect(
			within( dialog ).queryByText( WARNING )
		).not.toBeInTheDocument();
	} );

	it( 'reads "" as no key', () => {
		window.vipWorkflowsIdeation = { transcriptionAvailable: '' };
		const dialog = openUploadMode();

		expect( within( dialog ).getByText( WARNING ) ).toBeInTheDocument();
		expect( acceptOf( dialog ).startsWith( ALL_TYPES ) ).toBe( true );
	} );
} );

describe( 'add source — upload mode with no localized value', () => {
	it( 'warns, as if there were no key', () => {
		window.vipWorkflowsIdeation = {};
		const dialog = openUploadMode();

		expect( within( dialog ).getByText( WARNING ) ).toBeInTheDocument();
		expect( acceptOf( dialog ).startsWith( ALL_TYPES ) ).toBe( true );
	} );
} );
