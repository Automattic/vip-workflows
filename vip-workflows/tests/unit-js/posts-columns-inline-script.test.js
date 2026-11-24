/**
 * Unit tests for the Quick Edit / Bulk Edit preflight in the posts list.
 *
 * The preflight is the inline script `PostsColumns::enqueue_quick_edit_assets()`
 * adds to `inline-edit-post`. These tests read that script out of the PHP
 * source, run it against a posts-list DOM with the real shared module on
 * `window.vipWorkflowsSideEffect`, and drive it the way wp-admin does: Quick
 * Edit through `inlineEditPost.save()`, Bulk Edit through a click on
 * `#bulk_edit`.
 *
 * They pin how a trashed post is judged, which must match
 * `PublishBoundaryGuard::resolve_veto()`: leaving the Trash for `draft` is
 * never refused, and leaving it for another non-publish status skips the
 * publish-boundary check and follows only the transition rules, even when the
 * post's stage is in the publish region.
 */

const fs = require( 'fs' );
const path = require( 'path' );

const SOURCE = path.resolve(
	__dirname,
	'../../includes/admin/class-posts-columns.php'
);

const STRINGS = {
	bulkVetoPublish: 'PUBLISH %1$s/%2$s: %3$s',
	bulkVetoUnpublish: 'UNPUBLISH %1$s/%2$s: %3$s',
	bulkRefused: 'REFUSED %1$s/%2$s: %3$s',
	bulkWarn: 'WARN %1$s/%2$s: %3$s',
	guardUnavailable: 'UNAVAILABLE',
	stageMisconfigured: 'MISCONFIGURED',
	quickEditWorking: 'Working…',
	quickEditNoMoves: 'No moves.',
	quickEditLoadError: 'Load error.',
	quickEditFailed: 'Failed.',
};

/**
 * The inline script as PHP would print it, with the heredoc's interpolations
 * and escapes resolved.
 *
 * @param {Object} guard The `guard` object PHP embeds.
 * @return {string} JavaScript source.
 */
function inlineScript( guard ) {
	const php = fs.readFileSync( SOURCE, 'utf8' );
	const match = php.match( /\$script = <<<JS\n([\s\S]*?)\nJS;/ );
	if ( ! match ) {
		throw new Error( 'The Quick Edit inline script was not found.' );
	}

	return match[ 1 ]
		.split( '{$api_url}' )
		.join( 'http://example.test/wp-json/vip-workflows/v1' )
		.split( '{$nonce}' )
		.join( 'nonce' )
		.split( '{$guard}' )
		.join( JSON.stringify( guard ) )
		.split( '{$default_color}' )
		.join( '#cccccc' )
		.split( '\\$' )
		.join( '$' );
}

/**
 * One posts-list row carrying the workflow row data, plus its Quick Edit row.
 *
 * @param {Object}   row                  Row fields.
 * @param {number}   row.id               Post ID.
 * @param {string}   row.title            Post title.
 * @param {string}   row.postStatus       Committed core status.
 * @param {string}   row.stageRegion      The stage's region.
 * @param {string[]} [row.refusedRegions] Regions the server refuses.
 * @return {string} Markup.
 */
function rowMarkup( {
	id,
	title,
	postStatus,
	stageRegion,
	refusedRegions = [],
} ) {
	const entryStages = JSON.stringify( {
		draft: 'Draft A',
		pending: 'Review',
		publish: 'Published',
	} ).replace( /"/g, '&quot;' );
	const refused = JSON.stringify( refusedRegions ).replace( /"/g, '&quot;' );

	return `
		<tr id="post-${ id }">
			<th><input type="checkbox" name="post[]" value="${ id }" checked></th>
			<td>
				<a class="row-title">${ title }</a>
				<input type="hidden" class="vip-workflows-data" data-workflow="1" data-orphaned="" data-sequence-id="1" data-sequence-name="Desk" data-stage-region="${ stageRegion }" data-seated-region="${ stageRegion }" data-entry-stages="${ entryStages }" data-post-status="${ postStatus }" data-refused-regions="${ refused }" />
			</td>
		</tr>
		<tr id="edit-${ id }">
			<td>
				<select name="_status">
					<option value="draft">Draft</option>
					<option value="pending">Pending</option>
					<option value="publish">Published</option>
				</select>
			</td>
		</tr>`;
}

describe( 'posts list preflight for trashed posts', () => {
	let origSave;
	let listeners;

	function load( rows ) {
		document.body.innerHTML = `
			<table><tbody id="the-list">${ rows
				.map( rowMarkup )
				.join( '' ) }</tbody></table>
			<div id="bulk-edit">
				<select name="_status">
					<option value="-1">— No Change —</option>
					<option value="draft">Draft</option>
					<option value="pending">Pending</option>
					<option value="future">Scheduled</option>
				</select>
				<button type="button" id="bulk_edit">Update</button>
			</div>`;

		// The script listens on `document`, which outlives each test, so its
		// listeners are recorded here and removed after the test.
		const add = document.addEventListener;
		document.addEventListener = ( ...args ) => {
			listeners.push( args );
			return add.apply( document, args );
		};
		try {
			new Function(
				inlineScript( { canBypass: false, strings: STRINGS } )
			)();
		} finally {
			document.addEventListener = add;
		}
	}

	function quickEdit( id, status ) {
		document.querySelector( `#edit-${ id } select[name="_status"]` ).value =
			status;
		return window.inlineEditPost.save( id );
	}

	function bulkEdit( status ) {
		document.querySelector( '#bulk-edit select[name="_status"]' ).value =
			status;
		document.getElementById( 'bulk_edit' ).click();
	}

	beforeEach( () => {
		jest.resetModules();
		require( '../../src/entries/side-effect' );

		listeners = [];

		origSave = jest.fn( () => 'saved' );
		window.inlineEditPost = {
			edit: jest.fn(),
			save: origSave,
			getId: jest.fn(),
		};
		window.jQuery = jest.fn();
		window.alert = jest.fn();
		window.confirm = jest.fn( () => true );
	} );

	afterEach( () => {
		listeners.forEach( ( args ) =>
			document.removeEventListener( ...args )
		);
		delete window.vipWorkflowsSideEffect;
		delete window.inlineEditPost;
		delete window.jQuery;
		document.body.innerHTML = '';
	} );

	it( 'lets Quick Edit restore a publish-stage post from the Trash to draft', () => {
		load( [
			{
				id: 1,
				title: 'Old Story',
				postStatus: 'trash',
				stageRegion: 'publish',
			},
		] );

		expect( quickEdit( 1, 'draft' ) ).toBe( 'saved' );
		expect( window.alert ).not.toHaveBeenCalled();
		expect( window.confirm ).not.toHaveBeenCalled();
		expect( origSave ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'refuses a Quick Edit out of the Trash with the transition-rules message, not the publish veto', () => {
		load( [
			{
				id: 1,
				title: 'Old Story',
				postStatus: 'trash',
				stageRegion: 'publish',
				refusedRegions: [ 'pending' ],
			},
		] );

		expect( quickEdit( 1, 'pending' ) ).toBe( false );
		expect( origSave ).not.toHaveBeenCalled();
		expect( window.alert ).toHaveBeenCalledWith(
			window.vipWorkflowsSideEffect.getStatusChangeRefusedMessage( {
				title: 'Old Story',
				workflowName: 'Desk',
				stageLabel: 'Review',
			} )
		);
	} );

	it( 'confirms rather than refuses a Quick Edit out of the Trash the user can make', () => {
		load( [
			{
				id: 1,
				title: 'Old Story',
				postStatus: 'trash',
				stageRegion: 'publish',
			},
		] );

		expect( quickEdit( 1, 'pending' ) ).toBe( 'saved' );
		expect( window.alert ).not.toHaveBeenCalled();
		expect( window.confirm ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'still holds a Quick Edit on a live post to the publish boundary', () => {
		load( [
			{
				id: 1,
				title: 'Live Story',
				postStatus: 'publish',
				stageRegion: 'publish',
			},
		] );

		expect( quickEdit( 1, 'draft' ) ).toBe( false );
		expect( window.alert ).toHaveBeenCalledWith(
			window.vipWorkflowsSideEffect.getPublishVetoMessage( {
				title: 'Live Story',
				workflowName: 'Desk',
				targetStatus: 'draft',
			} )
		);
	} );

	// Core hides Scheduled in Bulk Edit, but a programmatic `_status=future`
	// sends no date, so core writes `publish` again for a live post: the save
	// changes no status, and the preflight must not report it as scheduling.
	it( 'does not stop a Bulk Edit to Scheduled over a live post, which changes nothing', () => {
		load( [
			{
				id: 1,
				title: 'Live Story',
				postStatus: 'publish',
				stageRegion: 'publish',
			},
		] );

		bulkEdit( 'future' );

		expect( window.alert ).not.toHaveBeenCalled();
		expect( window.confirm ).not.toHaveBeenCalled();
	} );

	it( 'lets Bulk Edit restore trashed posts to draft whatever their stage', () => {
		load( [
			{
				id: 1,
				title: 'Old Story',
				postStatus: 'trash',
				stageRegion: 'publish',
			},
			{
				id: 2,
				title: 'Unplaced Story',
				postStatus: 'trash',
				stageRegion: '',
			},
		] );

		bulkEdit( 'draft' );

		expect( window.alert ).not.toHaveBeenCalled();
		expect( window.confirm ).not.toHaveBeenCalled();
	} );

	it( 'names only the refused trashed posts in a Bulk Edit to pending', () => {
		load( [
			{
				id: 1,
				title: 'Refused Story',
				postStatus: 'trash',
				stageRegion: 'publish',
				refusedRegions: [ 'pending' ],
			},
			{
				id: 2,
				title: 'Allowed Story',
				postStatus: 'trash',
				stageRegion: 'publish',
			},
		] );

		bulkEdit( 'pending' );

		expect( window.alert ).toHaveBeenCalledTimes( 1 );
		expect( window.alert ).toHaveBeenCalledWith(
			'REFUSED 1/2: Refused Story'
		);
	} );
} );
