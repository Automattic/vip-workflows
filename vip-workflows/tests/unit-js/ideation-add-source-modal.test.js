/**
 * Unit tests for what the Add source dialog says about audio and video.
 *
 * Audio and video are transcribed by OpenAI whatever provider the site chose,
 * so they need an OpenAI key. The upload mode says who transcribes them when a
 * key is set, and when none is, it neither offers them in the file picker nor
 * leaves the editor guessing why.
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
		expect( acceptOf( dialog ) ).toContain( 'audio/*' );
		expect( acceptOf( dialog ) ).toContain( 'video/*' );
	} );
} );

describe( 'add source — upload mode without an OpenAI key', () => {
	beforeEach( () => {
		window.vipWorkflowsIdeation = { transcriptionAvailable: false };
	} );

	it( 'leaves audio and video out of the picker and says why', () => {
		const dialog = openUploadMode();

		expect(
			within( dialog ).getByText( 'Upload images, PDFs or documents.' )
		).toBeInTheDocument();
		expect(
			within( dialog ).getByText(
				'Audio and video need an OpenAI key, which is used for transcription.'
			)
		).toBeInTheDocument();
		expect(
			within( dialog ).queryByText( /sent to OpenAI to be transcribed/ )
		).not.toBeInTheDocument();
		expect( acceptOf( dialog ) ).not.toMatch( /audio|video/ );
		// Images, PDFs and documents are offered exactly as before.
		expect( acceptOf( dialog ) ).toBe( 'image/*,.pdf,.doc,.docx,.txt' );
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
		expect( acceptOf( dialog ) ).toContain( 'audio/*' );
	} );

	it( 'reads "" as no key', () => {
		window.vipWorkflowsIdeation = { transcriptionAvailable: '' };
		const dialog = openUploadMode();

		expect(
			within( dialog ).getByText(
				'Audio and video need an OpenAI key, which is used for transcription.'
			)
		).toBeInTheDocument();
		expect( acceptOf( dialog ) ).not.toMatch( /audio|video/ );
	} );
} );

describe( 'add source — upload mode with no localized value', () => {
	it( 'behaves as if there were no key', () => {
		window.vipWorkflowsIdeation = {};
		const dialog = openUploadMode();

		expect(
			within( dialog ).getByText(
				'Audio and video need an OpenAI key, which is used for transcription.'
			)
		).toBeInTheDocument();
		expect( acceptOf( dialog ) ).not.toMatch( /audio|video/ );
	} );
} );

// A key removed in another tab leaves the picker available until reload.
// The server's specific refusal must still reach the editor.
it( 'shows the server refusal when a key is removed after page load', async () => {
	window.vipWorkflowsIdeation = { transcriptionAvailable: '1' };
	const message =
		'OpenAI transcribes audio and video. OpenAI is not connected. Ask an administrator to connect it.';
	apiFetch.mockRejectedValueOnce( {
		code: 'rest_transcription_unavailable',
		message,
		data: { status: 422 },
	} );
	const dialog = openUploadMode();
	fireEvent.change( dialog.querySelector( 'input[type="file"]' ), {
		target: {
			files: [
				new File( [ 'ID3' ], 'song.mp3', { type: 'audio/mpeg' } ),
			],
		},
	} );
	await waitFor( () =>
		expect( within( dialog ).getByText( message ) ).toBeInTheDocument()
	);
} );
