/**
 * Unit tests for the shared date/time formatting.
 *
 * Fourteen formats on three clocks became one module, and the whole point of it
 * is that it decides nothing itself: the format is the site's and the clock is
 * the site's. These pin that — a test that asserted a literal output string
 * would be re-asserting the very hard-coding this replaced, so each one instead
 * checks that the module asked WordPress and passed the answer through.
 */

import { getSettings, setSettings } from '@wordpress/date';

import { render } from './helpers/render-wp-component';
import {
	Timestamp,
	daysUntil,
	formatDate,
	formatDateTime,
	formatPartialDate,
	formatTime,
	isBefore,
	isSameDay,
	machineDate,
	machineDateTime,
	siteDateTimeFormat,
	sortByTimestamp,
} from '../../src/common/datetime';

// The package's own defaults, so only what a test is actually varying differs
// from a real install — `l10n` in particular carries the month and weekday
// names moment needs, and hand-rolling it here would be inventing a locale.
const DEFAULTS = getSettings();

// A site that writes dates unlike the US default the plugin used to hard-code,
// so a format taken from settings is visibly not the old constant. Tokyo also
// puts the site a day ahead of UTC for a late-evening timestamp, which is what
// makes the timezone assertion below meaningful.
//
// `datetime` and `datetimeAbbreviated` are set to a deliberately wrong value —
// the year alone. WordPress fills those two from translatable literals rather
// than from any option (only `date` and `time` read `get_option`), so nothing
// here may use them. Any regression to reading one turns "2026-08-14 15:45"
// into "2026" and fails loudly rather than quietly rendering core's US default.
const IGNORED = 'Y';
const TOKYO = {
	...DEFAULTS,
	formats: {
		date: 'Y-m-d',
		time: 'H:i',
		datetime: IGNORED,
		datetimeAbbreviated: IGNORED,
	},
	timezone: { ...DEFAULTS.timezone, offset: 9, string: 'Asia/Tokyo' },
};

describe( 'datetime', () => {
	beforeEach( () => {
		setSettings( TOKYO );
	} );

	afterEach( () => {
		setSettings( DEFAULTS );
	} );

	it( 'writes a date in the format the site is configured for', () => {
		expect( formatDate( '2026-08-14T06:45:00Z' ) ).toBe( '2026-08-14' );
	} );

	it( 'writes a time in the format the site is configured for', () => {
		expect( formatTime( '2026-08-14T06:45:00Z' ) ).toBe( '15:45' );
	} );

	it( 'writes a date and time together', () => {
		expect( formatDateTime( '2026-08-14T06:45:00Z' ) ).toBe(
			'2026-08-14 15:45'
		);
	} );

	it( 'composes the long form from the two settings that are real', () => {
		// The load-bearing one. `formats.datetime` is a translatable literal in
		// core — it reads no option — so a module that used it would impose one
		// hard-coded pattern on every install, and would disagree with its own
		// `formatDate` the moment an administrator changed `date_format`.
		// TOKYO sets it to the year alone precisely so that reading it fails.
		expect( siteDateTimeFormat() ).toBe( 'Y-m-d H:i' );
		expect( formatDateTime( '2026-08-14T06:45:00Z' ) ).not.toBe( '2026' );
	} );

	it( 'keeps the long form and the date agreeing on any site', () => {
		// The split this replaced: a due date rendered from `date_format` next
		// to a modal rendered from core's literal, on one screen.
		const stamp = '2026-08-14T06:45:00Z';

		expect(
			formatDateTime( stamp ).startsWith( formatDate( stamp ) )
		).toBe( true );

		setSettings( {
			...TOKYO,
			formats: { ...TOKYO.formats, date: 'd/m/Y', time: 'g:ia' },
		} );

		expect( formatDateTime( stamp ) ).toBe( '14/08/2026 3:45pm' );
	} );

	it( 'reads the site clock, not the browser clock', () => {
		// 23:30 UTC on the 14th is already the 15th in Tokyo. This is the bug
		// the module exists to close: the same instant used to render as two
		// different days depending on which surface drew it.
		expect( formatDate( '2026-08-14T23:30:00Z' ) ).toBe( '2026-08-15' );
	} );

	it( 'follows the site when its settings change', () => {
		setSettings( {
			...TOKYO,
			formats: { ...TOKYO.formats, date: 'd/m/Y' },
		} );

		expect( formatDate( '2026-08-14T06:45:00Z' ) ).toBe( '14/08/2026' );
	} );

	it( 'reads a MySQL datetime as well as an ISO string', () => {
		// Rows come off the workflow-events table as `Y-m-d H:i:s`, which is
		// not reliably parseable by `new Date()` — the reason several call
		// sites grew their own parsers.
		expect( formatDate( '2026-08-14 06:45:00' ) ).toBe( '2026-08-14' );
	} );

	it( 'reads an offsetless timestamp as the site wall clock it is', () => {
		// The whole reason a caller may hand a string rather than a `Date`: a
		// timestamp with no offset is the newsroom's own time and must survive
		// unshifted. The calendar depends on this — react-big-calendar reports
		// drops as browser-clock `Date`s, so it unwinds them to exactly this
		// form before asking for a rendering (see `siteWallClock` there).
		expect( formatDateTime( '2026-08-14T15:00:00' ) ).toBe(
			'2026-08-14 15:00'
		);
	} );

	it( 'draws nothing for a timestamp that is not there', () => {
		// An absent due date, an idea never updated. Every caller wants the
		// same answer, so the surrounding layout can collapse the slot.
		[ '', null, undefined ].forEach( ( empty ) => {
			expect( formatDate( empty ) ).toBe( '' );
			expect( formatTime( empty ) ).toBe( '' );
			expect( formatDateTime( empty ) ).toBe( '' );
		} );
	} );

	describe( 'formatPartialDate', () => {
		// A newsroom west of Greenwich, where converting a midnight-UTC day
		// label lands it on the day before.
		const NEW_YORK = {
			...TOKYO,
			timezone: {
				...DEFAULTS.timezone,
				offset: -4,
				string: 'America/New_York',
			},
		};

		it( 'keeps a day-only value on the day the source named', () => {
			setSettings( NEW_YORK );

			// Foresight announces an event for the 14th and sends midnight UTC
			// with `startDateHasTime` false. Read as an instant that is 8pm on
			// the 13th in New York, and the card listed the wrong day.
			expect( formatPartialDate( '2026-08-14T00:00:00Z', false ) ).toBe(
				'2026-08-14'
			);
		} );

		it( 'converts a value that really is a moment', () => {
			setSettings( NEW_YORK );

			// With a genuine time, the instant is the point — a 06:45 UTC
			// start is 02:45 in New York, and that is what a reader wants.
			expect( formatPartialDate( '2026-08-14T06:45:00Z', true ) ).toBe(
				'2026-08-14 02:45'
			);
		} );

		it( 'treats a missing flag as a day, not a midnight', () => {
			setSettings( NEW_YORK );

			expect( formatPartialDate( '2026-08-14T00:00:00Z' ) ).toBe(
				'2026-08-14'
			);
		} );

		it( 'draws nothing for an absent value', () => {
			expect( formatPartialDate( null, true ) ).toBe( '' );
			expect( formatPartialDate( undefined, false ) ).toBe( '' );
		} );
	} );

	describe( 'daysUntil', () => {
		it( 'counts calendar days, not twenty-four-hour blocks', () => {
			// The bug this replaced: a deadline later today sat 20 hours out,
			// and `ceil( 20h / 24h )` reported 1 — "Due tomorrow" for an
			// evening deadline.
			const soon = new Date( Date.now() + 20 * 60 * 60 * 1000 );
			const answer = daysUntil( soon );

			// Either today or tomorrow depending on the hour the suite runs,
			// but never more than one day out for a 20-hour horizon.
			expect( answer ).toBeLessThanOrEqual( 1 );
			expect( answer ).toBeGreaterThanOrEqual( 0 );
		} );

		it( 'is zero for now and negative for the past', () => {
			expect( daysUntil( new Date() ) ).toBe( 0 );
			expect( daysUntil( new Date( Date.now() - 3 * 86400000 ) ) ).toBe(
				-3
			);
		} );

		it( 'is null for an absent deadline', () => {
			expect( daysUntil( null ) ).toBeNull();
			expect( daysUntil( '' ) ).toBeNull();
		} );
	} );

	describe( 'isSameDay', () => {
		it( 'answers on the site clock, not on UTC', () => {
			// These two fall either side of midnight UTC — the 14th and the
			// 15th there — but both are the 15th in Tokyo, which is the day a
			// reader of this site is being shown.
			expect(
				isSameDay( '2026-08-14T23:30:00Z', '2026-08-15T10:00:00Z' )
			).toBe( true );
		} );

		it( 'separates two genuinely different days', () => {
			expect(
				isSameDay( '2026-08-14T06:45:00Z', '2026-08-20T06:45:00Z' )
			).toBe( false );
		} );

		it( 'does not depend on the format the site writes dates in', () => {
			// The reason this is not `formatDate(a) === formatDate(b)`: an
			// administrator may configure a format with no day in it, and a
			// fortnight would then collapse to one date and swallow the end of
			// every range on the site.
			setSettings( {
				...TOKYO,
				formats: { ...TOKYO.formats, date: 'F Y' },
			} );

			expect( formatDate( '2026-08-05T00:00:00Z' ) ).toBe(
				formatDate( '2026-08-20T00:00:00Z' )
			);
			expect(
				isSameDay( '2026-08-05T00:00:00Z', '2026-08-20T00:00:00Z' )
			).toBe( false );
		} );

		it( 'is false when either end is missing', () => {
			expect( isSameDay( '2026-08-14T06:45:00Z', null ) ).toBe( false );
			expect( isSameDay( undefined, '2026-08-14T06:45:00Z' ) ).toBe(
				false
			);
		} );
	} );

	describe( 'isBefore', () => {
		it( 'orders two site-local timestamps', () => {
			// The shape the transition rail asks in: a stored check result
			// (`current_time( 'mysql' )`) against the editor's `modified`, both
			// site-local wall clock with no offset on either.
			expect(
				isBefore( '2026-08-14 09:00:00', '2026-08-14T10:00:00' )
			).toBe( true );
			expect(
				isBefore( '2026-08-14 11:00:00', '2026-08-14T10:00:00' )
			).toBe( false );
		} );

		it( 'is false for the same moment written two ways', () => {
			// Strictly earlier, so equality is not "before" — a check that ran
			// on the same second as the last edit is not stale.
			expect(
				isBefore( '2026-08-14 10:00:00', '2026-08-14T10:00:00' )
			).toBe( false );
		} );

		it( 'reads both ends on the site clock', () => {
			// An offsetless string is the site's wall clock, so in Tokyo this
			// pair is 09:00 and 10:00 JST — 00:00 and 01:00 UTC. Read on the
			// browser's clock instead they would still be an hour apart, which
			// is why the assertion that matters is the mixed one below.
			expect(
				isBefore( '2026-08-14 09:00:00', '2026-08-14T01:30:00Z' )
			).toBe( true );

			// 09:00 JST is 00:00 UTC, so an explicit UTC stamp half an hour
			// earlier really is earlier — something a comparison that ignored
			// the offset on one end and not the other would get backwards.
			expect(
				isBefore( '2026-08-13T23:30:00Z', '2026-08-14 09:00:00' )
			).toBe( true );
		} );

		it( 'is false when either end is missing', () => {
			// A check that has never run, or a post never edited since it was
			// created. Both ordinary; neither is "before" the other.
			expect( isBefore( null, '2026-08-14T10:00:00' ) ).toBe( false );
			expect( isBefore( '2026-08-14T10:00:00', undefined ) ).toBe(
				false
			);
			expect( isBefore( '', '2026-08-14T10:00:00' ) ).toBe( false );
		} );
	} );

	describe( 'sortByTimestamp', () => {
		it( 'orders a pair either way round', () => {
			const earlier = '2026-08-14 09:00:00';
			const later = '2026-08-14 10:00:00';

			expect( sortByTimestamp( earlier, later, 'asc' ) ).toBeLessThan(
				0
			);
			expect( sortByTimestamp( earlier, later, 'desc' ) ).toBeGreaterThan(
				0
			);
		} );

		it( 'reads both ends on the site clock', () => {
			// What the DataViews `datetime` type does not: its comparator is
			// `new Date( a ) - new Date( b )`, which reads the offsetless end on
			// the browser's clock and the explicit one as written.
			//
			// The assertion is an exact tie rather than an ordering, because an
			// ordering is not discriminating. Any pair far enough apart comes
			// out the same way round under either comparator on almost every
			// runner, so such a test passes with the bug present wherever CI
			// happens to sit. A tie only holds when both ends were read on the
			// same clock: 09:00 in Tokyo *is* midnight UTC, so the site's clock
			// answers 0 in every timezone a runner could be in, while the
			// browser's answers 0 only from UTC+9.
			//
			// Asserted twice, from two site timezones, so no single runner zone
			// can flatter the wrong reading — a machine cannot be at UTC+9 and
			// UTC-4 at once.
			expect(
				sortByTimestamp(
					'2026-08-14 09:00:00',
					'2026-08-14T00:00:00Z',
					'asc'
				)
			).toBe( 0 );

			setSettings( {
				...TOKYO,
				timezone: {
					...DEFAULTS.timezone,
					offset: -4,
					string: 'America/New_York',
				},
			} );

			expect(
				sortByTimestamp(
					'2026-08-14 09:00:00',
					'2026-08-14T13:00:00Z',
					'desc'
				)
			).toBe( 0 );
		} );

		it( 'leaves a pair it cannot order alone', () => {
			// Zero, not NaN: a sort handed NaN is free to do anything with it,
			// where zero means "these two keep the order they came in".
			expect(
				sortByTimestamp( null, '2026-08-14 09:00:00', 'asc' )
			).toBe( 0 );
			expect( sortByTimestamp( '2026-08-14 09:00:00', '', 'desc' ) ).toBe(
				0
			);
		} );
	} );

	describe( 'machineDateTime', () => {
		it( 'writes the site wall clock beside the site offset', () => {
			// The one that holds the line, and the reason it asserts a literal
			// string rather than a parsed instant. `new Date( value
			// ).toISOString()` — the obvious wrong implementation — answers
			// `2026-08-14T06:45:00.000Z` here: a different string on every
			// runner only in what it says the offset was, so only an exact
			// comparison catches it from every timezone.
			expect( machineDateTime( '2026-08-14T06:45:00Z' ) ).toBe(
				'2026-08-14T15:45:00+09:00'
			);
		} );

		it( 'denotes the instant an offsetless stamp actually means', () => {
			// `new Date( '2026-08-14 15:45:00' )` reads the newsroom's wall
			// clock as the *browser's*, and `.toISOString()` then converts it a
			// second time — so the attribute would name a different moment on
			// every reader's machine and the visible text's moment on nobody's.
			//
			// Comparing parsed instants is what a consumer of the attribute
			// actually does, so it is worth pinning; note that it is the weaker
			// of the two checks, since a runner sitting in the site's own
			// timezone makes the wrong implementation look right. The literal
			// above is the one that fails everywhere.
			expect(
				Date.parse( machineDateTime( '2026-08-14 15:45:00' ) )
			).toBe( Date.parse( '2026-08-14T06:45:00Z' ) );
		} );

		it( 'follows the site to another timezone', () => {
			setSettings( {
				...TOKYO,
				timezone: {
					...DEFAULTS.timezone,
					offset: -4,
					string: 'America/New_York',
				},
			} );

			expect( machineDateTime( '2026-08-14T06:45:00Z' ) ).toBe(
				'2026-08-14T02:45:00-04:00'
			);
		} );

		it( 'draws nothing for an absent value', () => {
			expect( machineDateTime( null ) ).toBe( '' );
			expect( machineDateTime( '' ) ).toBe( '' );
		} );
	} );

	describe( 'machineDate', () => {
		it( 'names the day on the site clock, not the browser one', () => {
			// 23:30 UTC on the 14th is already the 15th in Tokyo, and the day a
			// day-precision label stands behind has to be the day the reader
			// was shown.
			expect( machineDate( '2026-08-14T23:30:00Z' ) ).toBe(
				'2026-08-15'
			);
		} );

		it( 'ignores the format an administrator configured', () => {
			// It is an attribute, not a rendering: `date_format` may omit the
			// day entirely (`F Y`), which would make the attribute name a month.
			setSettings( {
				...TOKYO,
				formats: { ...TOKYO.formats, date: 'F Y' },
			} );

			expect( machineDate( '2026-08-14T06:45:00Z' ) ).toBe(
				'2026-08-14'
			);
		} );

		it( 'draws nothing for an absent value', () => {
			expect( machineDate( null ) ).toBe( '' );
			expect( machineDate( '' ) ).toBe( '' );
		} );
	} );

	describe( 'Timestamp', () => {
		const time = ( ui ) => render( ui ).container.querySelector( 'time' );

		it( 'writes the site long form inside a <time>', () => {
			const element = time( <Timestamp value="2026-08-14T06:45:00Z" /> );

			expect( element.textContent ).toBe( '2026-08-14 15:45' );
			expect( element.getAttribute( 'datetime' ) ).toBe(
				'2026-08-14T15:45:00+09:00'
			);
		} );

		it( 'keeps a caller wording and still carries the instant', () => {
			// The case that matters most: a Kanban card says "Overdue" and never
			// says the date, so without the attribute the moment is nowhere on
			// the page at all — nothing to announce, nothing to put in a
			// calendar, nothing to parse.
			const element = time(
				<Timestamp value="2026-08-14T06:45:00Z">Overdue</Timestamp>
			);

			expect( element.textContent ).toBe( 'Overdue' );
			expect( Date.parse( element.getAttribute( 'datetime' ) ) ).toBe(
				Date.parse( '2026-08-14T06:45:00Z' )
			);
		} );

		it( 'says only the day when the wording is about a day', () => {
			// A Kanban deadline counts calendar days in every branch and names
			// no hour, so an attribute of `2026-08-14T00:00:00+09:00` would
			// assert a midnight the card never claimed — and anything turning
			// the card into a calendar entry would book a deadline of 00:00.
			const element = time(
				<Timestamp value="2026-08-14T23:30:00Z" dateOnly>
					Due tomorrow
				</Timestamp>
			);

			expect( element.textContent ).toBe( 'Due tomorrow' );
			// The 15th in Tokyo, where the reader is, not the 14th in UTC.
			expect( element.getAttribute( 'datetime' ) ).toBe( '2026-08-15' );
		} );

		it( 'falls back to the site date, not the long form, for a day', () => {
			const element = time(
				<Timestamp value="2026-08-14T06:45:00Z" dateOnly />
			);

			expect( element.textContent ).toBe( '2026-08-14' );
		} );

		it( 'carries the class whether or not it sets the type', () => {
			// `variant` routes the text through <Text>, which is a different
			// element tree; the call site's own class has to survive both.
			[ undefined, 'body-sm' ].forEach( ( variant ) => {
				const element = time(
					<Timestamp
						value="2026-08-14T06:45:00Z"
						variant={ variant }
						className="cell"
					/>
				);

				expect( element ).toHaveClass( 'cell' );
			} );
		} );

		it( 'draws nothing at all for an absent moment', () => {
			// Not an empty <time>: an element with no datetime and no text is a
			// claim about a moment that is not there, and the surrounding
			// layout should collapse the slot instead.
			expect( time( <Timestamp value={ null } /> ) ).toBeNull();
			expect(
				time( <Timestamp value="">Overdue</Timestamp> )
			).toBeNull();
		} );
	} );
} );
