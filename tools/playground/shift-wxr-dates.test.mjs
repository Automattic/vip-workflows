import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(
	path.dirname( fileURLToPath( import.meta.url ) ),
	'shift-wxr-dates.php'
);

/**
 * Runs vip_workflows_shift_wxr_dates() through the PHP CLI.
 *
 * @param {string} wxr WXR document.
 * @param {string} now Site-local time, as Y-m-d H:i:s.
 * @return {string} The shifted document.
 */
function shift( wxr, now ) {
	const code = `require ${ JSON.stringify(
		SCRIPT
	) }; echo vip_workflows_shift_wxr_dates( stream_get_contents( STDIN ), new DateTimeImmutable( ${ JSON.stringify(
		now
	) } ) );`;
	return execFileSync( 'php', [ '-r', code ], {
		input: wxr,
		encoding: 'utf8',
	} );
}

function postDate( date ) {
	return `<wp:post_date><![CDATA[${ date }]]></wp:post_date>`;
}

function postDateGmt( date ) {
	return `<wp:post_date_gmt><![CDATA[${ date }]]></wp:post_date_gmt>`;
}

test( 'moves the newest post to today, keeping the spacing between posts', () => {
	const wxr = [
		postDate( '2026-01-05 14:00:00' ),
		postDateGmt( '2026-01-05 21:00:00' ),
		postDate( '2026-01-15 11:45:00' ),
	].join( '\n' );

	assert.equal(
		shift( wxr, '2026-10-20 18:00:00' ),
		[
			postDate( '2026-10-10 14:00:00' ),
			postDateGmt( '2026-10-10 21:00:00' ),
			postDate( '2026-10-20 11:45:00' ),
		].join( '\n' )
	);
} );

test( 'never dates a post after the current time', () => {
	const wxr = postDate( '2026-01-15 11:45:00' );

	assert.equal(
		shift( wxr, '2026-10-20 09:00:00' ),
		postDate( '2026-10-19 11:45:00' )
	);
} );

test( 'produces valid dates across month ends', () => {
	const wxr = [
		postDate( '2026-01-31 10:00:00' ),
		postDate( '2026-02-01 10:00:00' ),
	].join( '\n' );

	assert.equal(
		shift( wxr, '2026-11-30 12:00:00' ),
		[
			postDate( '2026-11-29 10:00:00' ),
			postDate( '2026-11-30 10:00:00' ),
		].join( '\n' )
	);
} );

test( 'leaves unset dates alone and ignores them when choosing the shift', () => {
	const wxr = [
		postDate( '2026-01-15 11:45:00' ),
		postDate( '0000-00-00 00:00:00' ),
		postDateGmt( '0000-00-00 00:00:00' ),
	].join( '\n' );

	assert.equal(
		shift( wxr, '2026-10-20 18:00:00' ),
		[
			postDate( '2026-10-20 11:45:00' ),
			postDate( '0000-00-00 00:00:00' ),
			postDateGmt( '0000-00-00 00:00:00' ),
		].join( '\n' )
	);
} );

test( 'rejects a WXR document with no post dates', () => {
	assert.throws(
		() => shift( '<rss></rss>', '2026-10-20 18:00:00' ),
		/no wp:post_date values/
	);
} );
