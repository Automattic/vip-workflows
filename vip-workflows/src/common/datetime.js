/**
 * Dates and times, on the site's clock and in the site's format.
 *
 * Every timestamp this plugin shows is about a post or a workflow object — when
 * a stage was entered, when an idea was last touched, when a job next runs — so
 * every one of them belongs to the newsroom, not to whoever happens to be
 * reading. That is one decision, and it used to be made fourteen different ways.
 *
 * Three clocks were running. `dateI18n` reads the site's timezone and locale,
 * which is right. `toLocaleDateString()` reads the *browser's* timezone and
 * locale, which meant a post modified at 23:30 UTC showed yesterday's date in
 * the Audit Log and today's on a Kanban card, on one screen, for one reader.
 * `date-fns` reads the browser's clock too, and its localizer is built with
 * `enUS` only, so its patterns never localised at all. This module is the one
 * clock; nothing outside it should reach for the other two.
 *
 * It also holds no format strings, which is the second half of the fix. The
 * plugin used to override the format with `'M j, Y \a\t g:i A'`, copy-pasted
 * into four files — a US pattern imposed on every install in every locale.
 *
 * **Only two of the four formats WordPress serves are actually the site's.**
 * `wp_default_packages_inline_scripts()` builds `getSettings().formats` as:
 *
 *     'time'                => get_option( 'time_format', __( 'g:i a' ) ),
 *     'date'                => get_option( 'date_format', __( 'F j, Y' ) ),
 *     'datetime'            => __( 'F j, Y g:i a' ),
 *     'datetimeAbbreviated' => __( 'M j, Y g:i a' ),
 *
 * `date` and `time` are settings an administrator chose. `datetime` and
 * `datetimeAbbreviated` read no option at all — they are translatable literals.
 * Reaching for `formats.datetime` would therefore have swapped one hard-coded
 * US pattern for another, and left this module's long form disagreeing with its
 * own short one on any install that had configured either setting: a due date
 * reading `2026-08-14` beside a modal reading `August 14, 2026 3:45 pm`. So the
 * long form is composed from the two real settings, which on a default install
 * produces exactly what core's literal would have.
 *
 * There is deliberately no abbreviated form. No site setting expresses one, so
 * it could only be another literal; the one caller that wanted a shorter string
 * takes the long one and agrees with every other surface instead.
 *
 * `getSettings()` is read per call rather than once at module scope. The
 * settings arrive from an inline script, and reading them at import time binds
 * whatever was there when the bundle evaluated.
 *
 * **Everything here takes an instant, not a wall clock.** A timestamp string
 * with no offset — what every route in this plugin serves — is read as the
 * site's own time, which is what makes these correct by default. A `Date` is
 * read as the instant it holds, so it is only safe to pass one that genuinely
 * means that instant. A `Date` built by parsing a site-local string with
 * `new Date()` does *not*: it carries the site's wall clock wearing the
 * browser's timezone, and formatting it here converts it a second time. The
 * calendar grid is the one place that produces such dates, and it unwinds them
 * to a string before calling in (see `siteWallClock` in `admin/pages/Calendar.js`).
 *
 * **A rendering is two things, and only one of them is for a person.** Every
 * date the plugin drew was a bare string in a text node, so a reader saw "Due
 * today" and a machine — a screen reader offering to read the date out, an
 * extension turning a deadline into a calendar entry, anything parsing the
 * page — saw a sentence it had no way to resolve. `<Timestamp>` draws both
 * halves at once: the site's own wording inside a `<time>` whose `dateTime`
 * names the same instant in ISO 8601.
 *
 * That attribute is emphatically *not* the visible string, and it is not
 * `new Date( value ).toISOString()` either — that reads a site-local stamp on
 * the browser's clock and then converts it, which moves the instant by the
 * difference between the two zones. It is `machineDateTime()`, which puts the
 * site's wall clock beside the site's own offset, so the moment survives being
 * read anywhere.
 *
 * The attribute also has to be no more precise than the wording it stands
 * behind. A deadline drawn as "Overdue" or "Due tomorrow" is a claim about a
 * *day*, and dressing it as `T00:00:00+09:00` invents a midnight the card never
 * said — so `<Timestamp dateOnly>` emits the day alone, on the site's clock like
 * everything else here.
 *
 * @package
 */

import { dateI18n, getDate, getSettings } from '@wordpress/date';
import { Text } from '@wordpress/ui';

/**
 * Whether a value is worth formatting at all.
 *
 * An absent timestamp is common and not an error — a post with no due date, an
 * idea never updated since creation — and every caller wants the same answer
 * for it: render nothing, and let the surrounding layout collapse the slot.
 *
 * @param {*} value Candidate timestamp.
 * @return {boolean} True when there is a value to format.
 */
function hasValue( value ) {
	return value !== '' && value !== null && value !== undefined;
}

/**
 * Format a timestamp with one of the site's own formats.
 *
 * @param {string|Date} value  Timestamp — ISO 8601, a MySQL datetime, or a Date.
 * @param {string}      format A `dateI18n` format string.
 * @return {string} The formatted string, or '' when there is nothing to format.
 */
function formatWith( value, format ) {
	if ( ! hasValue( value ) ) {
		return '';
	}

	return dateI18n( format, getDate( value ) );
}

/**
 * The format this site writes a date and a time in, together.
 *
 * Exported because `@wordpress/dataviews` takes a format *string* rather than a
 * renderer for its `datetime` field type: a column declares
 * `format: { datetime: siteDateTimeFormat() }` so it reads the same as every
 * other timestamp in the plugin. Left to itself the field type falls back to
 * `formats.datetime`, which is core's literal and not this site's setting.
 *
 * @return {string} A `dateI18n` format string, e.g. "F j, Y g:i a".
 */
export function siteDateTimeFormat() {
	const { date, time } = getSettings().formats;

	return `${ date } ${ time }`;
}

/**
 * A date, in the format this site writes dates in (Settings → General).
 *
 * @param {string|Date} value Timestamp.
 * @return {string} e.g. "August 14, 2026", or '' for an absent value.
 */
export function formatDate( value ) {
	return formatWith( value, getSettings().formats.date );
}

/**
 * A time of day, in the format this site writes times in (Settings → General).
 *
 * @param {string|Date} value Timestamp.
 * @return {string} e.g. "3:45 pm", or '' for an absent value.
 */
export function formatTime( value ) {
	return formatWith( value, getSettings().formats.time );
}

/**
 * A date and time together, both halves in the site's own format.
 *
 * @param {string|Date} value Timestamp.
 * @return {string} e.g. "August 14, 2026 3:45 pm", or '' for an absent value.
 */
export function formatDateTime( value ) {
	return formatWith( value, siteDateTimeFormat() );
}

/**
 * The same instant, written for a machine rather than for a reader.
 *
 * ISO 8601 with the site's offset on it — `2026-08-14T15:45:00+09:00` — which
 * is what a `<time datetime>` is for. The offset is the whole point: without
 * one the string would name a wall clock and not a moment, and every consumer
 * would have to guess whose clock it was.
 *
 * `c` is the format WordPress and PHP both spell ISO 8601 with, so this stays a
 * format lookup like every other function here rather than a second way of
 * building a date.
 *
 * @param {string|Date} value Timestamp.
 * @return {string} e.g. "2026-08-14T15:45:00+09:00", or '' for an absent value.
 */
export function machineDateTime( value ) {
	return formatWith( value, 'c' );
}

/**
 * Which calendar day a timestamp falls on here — `2026-08-14`.
 *
 * Two jobs, one string. It is the key `isSameDay` and `daysUntil` reduce a
 * moment to, which cannot be the site's `date_format`: an administrator may
 * configure a format with no day in it (`F Y`), and a fortnight would then
 * collapse to one date and swallow the end of every range on the site. And it
 * is the `dateTime` a `<time>` carries when what it wraps is a *day* — see
 * `<Timestamp dateOnly>`.
 *
 * `Y-m-d` is a valid ISO 8601 date and a valid `datetime` attribute, so the one
 * key serves both without either borrowing the other's format.
 *
 * @param {string|Date} value Timestamp.
 * @return {string} e.g. "2026-08-14", or '' for an absent value.
 */
export function machineDate( value ) {
	return formatWith( value, 'Y-m-d' );
}

/**
 * A timestamp a person can read and a machine can parse.
 *
 * The visible text is `children` when a caller has its own wording for the
 * moment — a countdown, a relative diff, a range — and the site's long form
 * when it has not. Either way the `dateTime` attribute carries the instant, so
 * a card that says "Overdue" still tells anything reading the page *when*.
 *
 * `variant` is opt-in for the same reason it is on `<AuthorCell>`: inside a
 * DataViews cell or a layout that already sets a type scale, imposing one here
 * would override it; on a card or in a row that sets none, the caller names it
 * and the text stops inheriting whatever happens to be nearby.
 *
 * `dateOnly` is for the callers whose wording is about a *day* rather than an
 * instant. A Kanban deadline reads "Overdue", "Due today", "Due tomorrow",
 * "3 days" — every branch of it counts calendar days and none of them names an
 * hour — so an attribute of `2026-08-14T00:00:00+09:00` would assert a midnight
 * the card never claimed, and anything reading the page would take a deadline
 * for a minute past midnight. The day alone says exactly what the card says.
 *
 * @param {Object}      props             Props.
 * @param {string|Date} props.value       The moment being shown. Nothing is drawn without one.
 * @param {boolean}     [props.dateOnly]  True when the wording names a day, not an instant.
 * @param {string}      [props.variant]   A `<Text>` variant. Omit inside a layout that sets its own type.
 * @param {string}      [props.className] Extra class for the call site's own styling.
 * @param {*}           [props.children]  The visible wording. Defaults to the site's long form.
 * @return {JSX.Element|null} A `<time>` element.
 */
export function Timestamp( {
	value,
	dateOnly = false,
	variant,
	className,
	children,
} ) {
	if ( ! hasValue( value ) ) {
		return null;
	}

	const text =
		children ??
		( dateOnly ? formatDate( value ) : formatDateTime( value ) );
	const machine = dateOnly ? machineDate( value ) : machineDateTime( value );

	if ( variant ) {
		return (
			<Text
				variant={ variant }
				render={ <time className={ className } dateTime={ machine } /> }
			>
				{ text }
			</Text>
		);
	}

	return (
		<time className={ className } dateTime={ machine }>
			{ text }
		</time>
	);
}

/**
 * A timestamp from an outside source, which may name a day rather than a moment.
 *
 * Discovery providers announce events, and an event announced *for a day* has no
 * hour: the provider still has to put something in the field, so it sends
 * midnight UTC and flags the time half as meaningless (Foresight sends
 * `startDateInUtc` alongside `startDateHasTime`).
 *
 * Those two cases must be read differently, which is the whole reason this
 * exists. A real moment is an instant and converts to the newsroom's clock like
 * any other. A day is a *label* that happens to be encoded as midnight UTC —
 * converting it moves it, and every newsroom west of Greenwich sees an event
 * announced for the 14th listed on the 13th. So a day is rendered in UTC, which
 * reads it back exactly as the source wrote it.
 *
 * @param {string|Date} value     Timestamp from the provider.
 * @param {boolean}     [hasTime] Whether the time half means anything.
 * @return {string} The rendering, or '' for an absent value.
 */
export function formatPartialDate( value, hasTime = false ) {
	if ( ! hasValue( value ) ) {
		return '';
	}

	if ( hasTime ) {
		return formatDateTime( value );
	}

	return dateI18n( getSettings().formats.date, getDate( value ), true );
}

/**
 * Whether two timestamps fall on the same day, in the newsroom's timezone.
 *
 * A date range that begins and ends on one day is that day, so the callers that
 * draw one collapse it to a single string. The question has to be asked on the
 * site's clock — two timestamps hours apart in UTC can be one day in the
 * newsroom, which is the day the reader is being shown — but it must not be
 * asked by comparing the two *rendered* dates: `date_format` is an
 * administrator's setting, and one that omits the day (`F Y`) would report a
 * fortnight as a single date and swallow the end of every range on the site.
 * So the comparison runs on a fixed day key that nothing configurable touches.
 *
 * @param {string|Date} a First timestamp.
 * @param {string|Date} b Second timestamp.
 * @return {boolean} True when both name the same calendar day here.
 */
export function isSameDay( a, b ) {
	if ( ! hasValue( a ) || ! hasValue( b ) ) {
		return false;
	}

	return machineDate( a ) === machineDate( b );
}

/**
 * Whether one timestamp is strictly earlier than another.
 *
 * For the surfaces that compare two moments rather than show one — "did this
 * check run before the last edit?" — which still has to be asked on the
 * newsroom's clock, because that is the clock both moments were written on.
 *
 * It matters that this reads the timestamps the same way the formatters do.
 * The obvious shortcut is `new Date( a ) < new Date( b )`, and on most days it
 * agrees: two site-local strings both read in the browser's timezone are both
 * wrong by the same offset, and the offset cancels. It stops cancelling when
 * the browser observes daylight saving and the site does not, or observes it on
 * other dates — an hour that does not exist in the reader's timezone is shifted
 * forward when parsed, an hour that happens twice is ambiguous, and inside
 * those windows the two operands move by different amounts and the comparison
 * inverts. `getDate()` reads both on the site's clock, where the hour means
 * what it says.
 *
 * An absent end answers false, as it does for `isSameDay`: a check that has
 * never run and a post that has never been edited are both ordinary, and
 * neither puts one moment before another. A malformed timestamp is not
 * ordinary and is not handled here — it is a data integrity bug at whatever
 * wrote it.
 *
 * Strictly earlier, so two equal moments answer false.
 *
 * @param {string|Date} a First timestamp.
 * @param {string|Date} b Second timestamp.
 * @return {boolean} True when `a` is earlier than `b`.
 */
export function isBefore( a, b ) {
	return compareTimestamps( a, b ) < 0;
}

/**
 * Order two timestamps on the site's clock.
 *
 * Negative when `a` is the earlier moment, positive when it is the later one,
 * and zero when they are the same moment or when either is absent — the same
 * answer `isBefore` gives for a check that has never run.
 *
 * @param {string|Date} a First timestamp.
 * @param {string|Date} b Second timestamp.
 * @return {number} Ordering of `a` against `b`.
 */
function compareTimestamps( a, b ) {
	if ( ! hasValue( a ) || ! hasValue( b ) ) {
		return 0;
	}

	return getDate( a ).getTime() - getDate( b ).getTime();
}

/**
 * A `@wordpress/dataviews` sort comparator over timestamps.
 *
 * Exported for the same reason `siteDateTimeFormat` is: a DataViews column
 * declares `sort: sortByTimestamp` so its ordering reads the timestamps the way
 * the rest of the plugin does. Left to itself the `datetime` field type sorts on
 * `new Date( a ) - new Date( b )`, which reads an offsetless site-local stamp on
 * the *browser's* clock. On most days both ends move by the same offset and the
 * comparison survives it; inside a daylight-saving window the site does not
 * observe, or observes on other dates, they move by different amounts — an hour
 * that does not exist in the reader's zone is shifted forward, an hour that
 * happens twice is ambiguous — and the ordering inverts.
 *
 * @param {string|Date} a         First timestamp.
 * @param {string|Date} b         Second timestamp.
 * @param {string}      direction 'asc' or 'desc'.
 * @return {number} Ordering of `a` against `b`.
 */
export function sortByTimestamp( a, b, direction ) {
	return 'desc' === direction
		? compareTimestamps( b, a )
		: compareTimestamps( a, b );
}

/**
 * How many whole days from today until a timestamp, on the newsroom's clock.
 *
 * For the copy that counts in days rather than stating a date — "Due today",
 * "Due tomorrow", "Overdue". Those are claims about *calendar days*, so they
 * have to be measured in calendar days: subtracting two instants and dividing
 * by 86,400,000 answers a different question, and a deadline twenty hours away
 * comes back as "tomorrow" when it is this evening.
 *
 * Both ends are reduced to their day here and compared as UTC midnights, so the
 * arithmetic is exact whole days with no daylight-saving drift — the offset
 * cancels because neither key carries one.
 *
 * @param {string|Date} value Timestamp.
 * @return {number|null} Whole days ahead; negative for the past, null if absent.
 */
export function daysUntil( value ) {
	if ( ! hasValue( value ) ) {
		return null;
	}

	const midnight = ( stamp ) =>
		Date.parse( `${ machineDate( stamp ) }T00:00:00Z` );
	const MS_PER_DAY = 24 * 60 * 60 * 1000;

	return Math.round(
		( midnight( value ) - midnight( new Date() ) ) / MS_PER_DAY
	);
}
