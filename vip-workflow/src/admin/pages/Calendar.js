/**
 * Calendar Page Component
 *
 * Mac Calendar-style view of all posts by date.
 * Uses react-big-calendar for day/week/month views.
 *
 * @package
 */

import {
	useState,
	useEffect,
	useCallback,
	useMemo,
	useRef,
} from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import {
	Spinner,
	Button,
	Modal,
	SelectControl,
	__experimentalToggleGroupControl as ToggleGroupControl,
	__experimentalToggleGroupControlOption as ToggleGroupControlOption,
} from '@wordpress/components';
import { Badge, Stack, Text } from '@wordpress/ui';
import { DataViews } from '@wordpress/dataviews/wp';
import { useDispatch } from '@wordpress/data';
import { store as noticesStore } from '@wordpress/notices';
import {
	Icon,
	calendar,
	chevronLeft,
	chevronRight,
	pencil as editIcon,
	external as externalIcon,
	replace as workflowIcon,
	published,
	scheduled,
	drafts,
	pending,
	lock,
} from '@wordpress/icons';
import apiFetch from '@wordpress/api-fetch';
import { Calendar as BigCalendar, dateFnsLocalizer } from 'react-big-calendar';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';
import {
	format,
	parse,
	startOfWeek,
	getDay,
	addMonths,
	subMonths,
	startOfMonth,
	endOfMonth,
	startOfYear,
	endOfYear,
	addYears,
	subYears,
	eachMonthOfInterval,
	eachDayOfInterval,
	isSameMonth,
	isSameDay,
} from 'date-fns';
import { enUS } from 'date-fns/locale';

import 'react-big-calendar/lib/css/react-big-calendar.css';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';

import AdminPage from '../components/AdminPage';
import StatusBadge from '../components/StatusBadge';
import { AuthorCell } from '../../common/DataViewCells';
import { ModalActions } from '../../common/ModalActions';
import { ModalBody } from '../../common/ModalBody';
// `date-fns` stays for everything react-big-calendar needs it for — the grid's
// own arithmetic, the `yyyy-MM-dd` keys and query params, and the toolbar's
// month/week labels, which are the widget's furniture rather than a post's
// metadata. Anything that states *a post's* time reads the site's clock here.
import { formatDateTime, formatTime } from '../../common/datetime';

import './Calendar.css';

const DnDCalendar = withDragAndDrop( BigCalendar );

// Configure date-fns localizer for react-big-calendar.
const locales = { 'en-US': enUS };
const localizer = dateFnsLocalizer( {
	format,
	parse,
	startOfWeek: () => startOfWeek( new Date(), { weekStartsOn: 0 } ),
	getDay,
	locales,
} );

/**
 * The wall-clock string behind one of this screen's `Date` objects.
 *
 * react-big-calendar has no timezone: it lays out and reports plain `Date`s on
 * whatever clock the browser is running. So every `Date` in this file is a
 * *site* wall-clock time wearing the browser's timezone — the grid parses
 * `post_date` (which the route sends in the site's own time, with no offset)
 * through `new Date()`, and posts a drop back through `format()` the same way.
 * Reader and server therefore agree on the wall clock whatever timezone the
 * browser is in, which is what a newsroom calendar wants.
 *
 * The site-clock helpers in `common/datetime.js` read a timestamp as an
 * instant, so handing one of these `Date`s straight to them converts it a
 * second time: on a Tokyo site opened from New York, a chip in the 3pm slot
 * renders "Aug 15 04:00" in the modal above it. Unwinding to the wall-clock
 * string first — the same one `persistReschedule` already sends — puts the two
 * back on the same clock.
 *
 * @param {Date} date A date from the calendar grid.
 * @return {string} Site wall-clock timestamp, as the REST layer writes them.
 */
function siteWallClock( date ) {
	return format( date, "yyyy-MM-dd'T'HH:mm:ss" );
}

/**
 * Post Preview Modal Component.
 *
 * @param {Object}   props         Component props.
 * @param {Object}   props.post    Post data.
 * @param {Function} props.onClose Close callback.
 * @return {JSX.Element} Modal component.
 */
function PostPreviewModal( { post, onClose } ) {
	if ( ! post ) {
		return null;
	}

	return (
		<Modal
			title={ post.title }
			onRequestClose={ onClose }
			className="vip-workflow-calendar-post-modal vip-workflow-modal--truncate-title"
			size="medium"
		>
			<ModalBody>
				<Stack align="center" gap="sm" wrap>
					<StatusBadge color={ post.status_color }>
						{ post.status_label }
					</StatusBadge>
					{ post.is_scheduled && (
						<Badge intent="informational">
							{ __( 'Scheduled', 'vip-workflow' ) }
						</Badge>
					) }
				</Stack>

				<AuthorCell
					actor={ post.author }
					size="sm"
					variant="body-md"
					className="vip-workflow-calendar-post-modal__meta-row"
				/>

				<Stack
					align="center"
					gap="sm"
					className="vip-workflow-calendar-post-modal__meta-row"
				>
					<Text>
						{ formatDateTime( siteWallClock( post.start ) ) }
					</Text>
				</Stack>

				{ post.excerpt && (
					<Text render={ <p /> }>{ post.excerpt }</Text>
				) }

				{ post.workflow && (
					<Stack
						align="center"
						gap="sm"
						className="vip-workflow-calendar-post-modal__meta-row"
					>
						<Icon icon={ workflowIcon } size={ 20 } />
						<Text>{ post.workflow.sequence_name }</Text>
					</Stack>
				) }
			</ModalBody>

			<ModalActions>
				{ post.is_published && post.view_url && (
					<Button
						__next40pxDefaultSize
						variant="secondary"
						href={ post.view_url }
						target="_blank"
					>
						{ __( 'Open', 'vip-workflow' ) }
					</Button>
				) }
				<Button
					__next40pxDefaultSize
					variant="primary"
					href={ post.edit_url }
					target="_blank"
				>
					{ __( 'Edit', 'vip-workflow' ) }
				</Button>
			</ModalActions>
		</Modal>
	);
}

// Canonical icons for the core post statuses. A post managed by a workflow
// sequence shares the single workflow icon, keyed off its `workflow` payload
// rather than post_status (which now only ever holds core visibility values).
const CORE_STATUS_ICONS = {
	publish: published,
	future: scheduled,
	draft: drafts,
	pending,
	private: lock,
};

/**
 * Pick the status icon for a post: the workflow icon for a workflow-managed post,
 * else the core icon for its built-in status.
 *
 * @param {Object} post Post/event data.
 * @return {Object} An `@wordpress/icons` icon.
 */
function getStatusIcon( post ) {
	if ( post.workflow ) {
		return workflowIcon;
	}
	return CORE_STATUS_ICONS[ post.post_status ] ?? drafts;
}

/**
 * Day Posts Modal for Year View.
 *
 * Shows all posts for a given day with edit/view links.
 *
 * @param {Object}   props           Component props.
 * @param {Date}     props.date      The day.
 * @param {Array}    props.posts     Posts for that day.
 * @param {Function} props.onClose   Close callback.
 * @param {Function} props.onGoToDay Switch to day view for this day.
 * @return {JSX.Element} Modal component.
 */
function DayPostsModal( { date: dayDate, posts, onClose, onGoToDay } ) {
	const sorted = useMemo(
		() =>
			[ ...posts ].sort(
				( a, b ) => new Date( a.start ) - new Date( b.start )
			),
		[ posts ]
	);

	const [ view, setView ] = useState( {
		type: 'activity',
		titleField: 'title',
		mediaField: 'status',
		fields: [ 'time' ],
		showMedia: true,
	} );

	const fields = useMemo(
		() => [
			{
				id: 'title',
				label: __( 'Title', 'vip-workflow' ),
				enableHiding: false,
				getValue: ( { item } ) => item.title,
			},
			{
				id: 'time',
				label: __( 'Time', 'vip-workflow' ),
				getValue: ( { item } ) => item.start,
				render: ( { item } ) =>
					formatTime( siteWallClock( item.start ) ),
			},
			{
				id: 'status',
				label: __( 'Status', 'vip-workflow' ),
				getValue: ( { item } ) => item.status_label,
				render: ( { item } ) => (
					// wpds-allow R7 -- inline-flex glyph wrapper; Stack's stylesheet is `display: flex` (block-level), which would reflow the feed's media slot
					<span
						className="vip-workflow-calendar-day-posts__status-icon"
						title={ item.status_label }
						aria-label={ item.status_label }
					>
						<Icon icon={ getStatusIcon( item ) } />
					</span>
				),
			},
		],
		[]
	);

	const actions = useMemo(
		() => [
			{
				id: 'edit',
				label: __( 'Edit', 'vip-workflow' ),
				isPrimary: false,
				icon: editIcon,
				callback: ( items ) => {
					if ( items[ 0 ]?.edit_url ) {
						window.open( items[ 0 ].edit_url, '_blank' );
					}
				},
			},
			{
				id: 'view',
				label: __( 'Open', 'vip-workflow' ),
				isPrimary: false,
				icon: externalIcon,
				isEligible: ( item ) => item.is_published && !! item.view_url,
				callback: ( items ) => {
					if ( items[ 0 ]?.view_url ) {
						window.open( items[ 0 ].view_url, '_blank' );
					}
				},
			},
		],
		[]
	);

	const paginationInfo = useMemo(
		() => ( { totalItems: sorted.length, totalPages: 1 } ),
		[ sorted.length ]
	);

	return (
		<Modal
			title={ format( dayDate, 'EEEE, MMMM d, yyyy' ) }
			headerActions={
				<Button
					__next40pxDefaultSize
					icon={ calendar }
					label={ __( 'View in day view', 'vip-workflow' ) }
					showTooltip
					onClick={ onGoToDay }
				/>
			}
			onRequestClose={ onClose }
			className="vip-workflow-calendar-day-posts-modal"
			size="medium"
		>
			<DataViews
				data={ sorted }
				fields={ fields }
				view={ view }
				onChangeView={ setView }
				actions={ actions }
				paginationInfo={ paginationInfo }
				defaultLayouts={ { activity: {} } }
				getItemId={ ( item ) => String( item.id ) }
				isItemClickable={ ( item ) => !! item.edit_url }
				onClickItem={ ( item ) => {
					if ( item.edit_url ) {
						window.open( item.edit_url, '_blank' );
					}
				} }
			>
				<DataViews.Layout />
			</DataViews>
		</Modal>
	);
}

/**
 * Custom Year View Component.
 *
 * Shows 12 months with post counts per day.
 *
 * @param {Object}   props             Component props.
 * @param {Date}     props.date        Current date.
 * @param {Array}    props.events      Events array.
 * @param {Function} props.onSelectDay Day select callback (receives date + events array).
 * @return {JSX.Element} Year view component.
 */
function YearView( { date, events, onSelectDay } ) {
	const months = eachMonthOfInterval( {
		start: startOfYear( date ),
		end: endOfYear( date ),
	} );

	// Group events by date for quick lookup.
	const eventsByDate = useMemo( () => {
		const map = {};
		events.forEach( ( event ) => {
			const dateKey = format( new Date( event.start ), 'yyyy-MM-dd' );
			if ( ! map[ dateKey ] ) {
				map[ dateKey ] = [];
			}
			map[ dateKey ].push( event );
		} );
		return map;
	}, [ events ] );

	return (
		<div className="vip-workflow-calendar-year-view">
			{ /* wpds-allow R7 -- responsive CSS grid (display:grid); not expressible as a Stack */ }
			<div className="vip-workflow-calendar-year-view__grid">
				{ months.map( ( month ) => {
					const monthStart = startOfMonth( month );
					const monthEnd = endOfMonth( month );
					const days = eachDayOfInterval( {
						start: monthStart,
						end: monthEnd,
					} );

					// Get first day of week offset.
					const firstDayOfWeek = getDay( monthStart );

					return (
						<Stack
							key={ format( month, 'yyyy-MM' ) }
							direction="column"
							gap="md"
							className="vip-workflow-calendar-year-view__month"
						>
							<Text
								variant="heading-md"
								className="vip-workflow-calendar-year-view__month-header"
							>
								{ format( month, 'MMMM' ) }
							</Text>
							{ /* wpds-allow R7 -- 7-column CSS grid (display:grid); not expressible as a Stack */ }
							<div className="vip-workflow-calendar-year-view__weekdays">
								{ [ 'S', 'M', 'T', 'W', 'T', 'F', 'S' ].map(
									( day, i ) => (
										<span key={ i }>{ day }</span>
									)
								) }
							</div>
							{ /* wpds-allow R7 -- 7-column CSS grid (display:grid); not expressible as a Stack */ }
							<div className="vip-workflow-calendar-year-view__days">
								{ /* Empty cells for offset */ }
								{ Array.from( { length: firstDayOfWeek } ).map(
									( _, i ) => (
										<Stack
											key={ `empty-${ i }` }
											render={ <span /> }
											align="center"
											justify="center"
											className="vip-workflow-calendar-year-view__day vip-workflow-calendar-year-view__day--empty"
										/>
									)
								) }
								{ days.map( ( day ) => {
									const dateKey = format( day, 'yyyy-MM-dd' );
									const dayEvents =
										eventsByDate[ dateKey ] || [];
									const hasEvents = dayEvents.length > 0;
									const isToday = isSameDay(
										day,
										new Date()
									);

									// Column direction: the count stacks
									// under the date instead of overhanging
									// the cell as a badge, so it stays
									// inside this day's own grid track
									// however dense the month is. No gap
									// prop — the two line boxes are sized
									// to fill the cell (see Calendar.css).
									return (
										<Stack
											key={ dateKey }
											render={ <span /> }
											direction="column"
											align="center"
											justify="center"
											className={ `vip-workflow-calendar-year-view__day ${
												hasEvents
													? 'vip-workflow-calendar-year-view__day--has-events'
													: ''
											} ${
												isToday
													? 'vip-workflow-calendar-year-view__day--today'
													: ''
											}` }
											role="button"
											tabIndex={ 0 }
											onClick={ () =>
												hasEvents &&
												onSelectDay( day, dayEvents )
											}
											onKeyDown={ ( e ) => {
												if (
													e.key === 'Enter' ||
													e.key === ' '
												) {
													e.preventDefault();
													if ( hasEvents ) {
														onSelectDay(
															day,
															dayEvents
														);
													}
												}
											} }
											title={
												hasEvents
													? `${
															dayEvents.length
													  } post${
															dayEvents.length > 1
																? 's'
																: ''
													  }`
													: ''
											}
										>
											{ format( day, 'd' ) }
											{ hasEvents && (
												// wpds-allow R7 -- count pill: flex centring plus its own fill/type/radius chrome, none of which Stack or Text exposes as a prop
												<span className="vip-workflow-calendar-year-view__day-count">
													{ dayEvents.length }
												</span>
											) }
										</Stack>
									);
								} ) }
							</div>
						</Stack>
					);
				} ) }
			</div>
		</div>
	);
}

/**
 * Reschedule Confirmation Modal.
 *
 * @param {Object}   props           Component props.
 * @param {Object}   props.event     Event being rescheduled.
 * @param {Date}     props.newDate   Target date.
 * @param {string}   props.type      'publish' or 'schedule'.
 * @param {Function} props.onConfirm Confirm callback.
 * @param {Function} props.onCancel  Cancel callback.
 * @return {JSX.Element} Confirmation modal.
 */
function RescheduleModal( { event, newDate, type, onConfirm, onCancel } ) {
	const formattedDate = formatDateTime( siteWallClock( newDate ) );

	return (
		<Modal
			title={
				type === 'publish'
					? __( 'Publish Post?', 'vip-workflow' )
					: __( 'Schedule Post?', 'vip-workflow' )
			}
			onRequestClose={ onCancel }
			className="vip-workflow-calendar-reschedule-modal"
			size="small"
		>
			<Text variant="body-md" render={ <p /> }>
				{ type === 'publish'
					? `"${ event.title }" will be published and publicly available as of ${ formattedDate }.`
					: `"${ event.title }" will be unpublished and scheduled for ${ formattedDate }. It won't be visible until then.` }
			</Text>
			<ModalActions>
				<Button
					__next40pxDefaultSize
					variant="tertiary"
					onClick={ onCancel }
				>
					{ __( 'Cancel', 'vip-workflow' ) }
				</Button>
				<Button
					__next40pxDefaultSize
					variant="primary"
					onClick={ onConfirm }
				>
					{ type === 'publish'
						? __( 'Publish', 'vip-workflow' )
						: __( 'Schedule', 'vip-workflow' ) }
				</Button>
			</ModalActions>
		</Modal>
	);
}

/**
 * Main Calendar Page Component.
 *
 * @return {JSX.Element} Calendar page.
 */
const VALID_VIEWS = [ 'day', 'week', 'month', 'year' ];

function getInitialParams() {
	const params = new URLSearchParams( window.location.search );
	const urlView = params.get( 'calview' );
	const urlDate = params.get( 'date' );

	const initialView = VALID_VIEWS.includes( urlView ) ? urlView : 'month';
	let initialDate = new Date();
	if ( urlDate ) {
		const parsed = new Date( urlDate + 'T12:00:00' );
		if ( ! isNaN( parsed.getTime() ) ) {
			initialDate = parsed;
		}
	}
	return { initialView, initialDate };
}

export default function Calendar() {
	const { initialView, initialDate } = useMemo( getInitialParams, [] );
	const [ events, setEvents ] = useState( [] );
	const [ loading, setLoading ] = useState( true );
	const [ currentDate, setCurrentDate ] = useState( initialDate );
	const [ view, setView ] = useState( initialView );
	const [ filter, setFilter ] = useState( 'all' );
	const [ selectedEvent, setSelectedEvent ] = useState( null );
	const [ selectedDay, setSelectedDay ] = useState( null );
	const [ pendingDrop, setPendingDrop ] = useState( null );
	const { createSuccessNotice, createErrorNotice } =
		useDispatch( noticesStore );
	const isFirstRender = useRef( true );

	useEffect( () => {
		if ( isFirstRender.current ) {
			isFirstRender.current = false;
			return;
		}
		const url = new URL( window.location );
		url.searchParams.set( 'calview', view );
		if ( view === 'day' ) {
			url.searchParams.set( 'date', format( currentDate, 'yyyy-MM-dd' ) );
		} else if ( view === 'week' ) {
			const weekMonday = startOfWeek( currentDate, { weekStartsOn: 0 } );
			url.searchParams.set( 'date', format( weekMonday, 'yyyy-MM-dd' ) );
		} else {
			url.searchParams.delete( 'date' );
		}
		window.history.replaceState( {}, '', url );
	}, [ view, currentDate ] );

	/**
	 * Calculate date range based on current view and date.
	 */
	const getDateRange = useCallback( () => {
		let start, end;

		switch ( view ) {
			case 'day':
				start = format( currentDate, 'yyyy-MM-dd' );
				end = format( currentDate, 'yyyy-MM-dd' );
				break;
			case 'week':
				const weekStart = startOfWeek( currentDate, {
					weekStartsOn: 0,
				} );
				start = format( weekStart, 'yyyy-MM-dd' );
				end = format(
					new Date( weekStart.getTime() + 6 * 24 * 60 * 60 * 1000 ),
					'yyyy-MM-dd'
				);
				break;
			case 'year':
				start = format( startOfYear( currentDate ), 'yyyy-MM-dd' );
				end = format( endOfYear( currentDate ), 'yyyy-MM-dd' );
				break;
			case 'month':
			default:
				// Fetch a bit extra for month view (shows partial weeks).
				const monthStart = startOfMonth( currentDate );
				const monthEnd = endOfMonth( currentDate );
				start = format(
					startOfWeek( monthStart, { weekStartsOn: 0 } ),
					'yyyy-MM-dd'
				);
				end = format(
					new Date( monthEnd.getTime() + 7 * 24 * 60 * 60 * 1000 ),
					'yyyy-MM-dd'
				);
		}

		return { start, end };
	}, [ currentDate, view ] );

	/**
	 * Fetch calendar data from API.
	 */
	const fetchData = useCallback( async () => {
		setLoading( true );

		try {
			const { start, end } = getDateRange();
			const response = await apiFetch( {
				path: `/vip-workflow/v1/workflow/calendar?start=${ start }&end=${ end }&filter=${ filter }`,
			} );

			// Transform events for react-big-calendar.
			const transformedEvents = response.events.map( ( event ) => ( {
				...event,
				start: new Date( event.start ),
				end: new Date( event.end ),
			} ) );

			setEvents( transformedEvents );
		} catch ( error ) {
			console.error( 'Failed to fetch calendar data:', error );
		} finally {
			setLoading( false );
		}
	}, [ getDateRange, filter ] );

	useEffect( () => {
		fetchData();
	}, [ fetchData ] );

	/**
	 * Handle navigation (prev/next/today).
	 *
	 * @param {string} action Navigation action.
	 */
	const handleNavigate = ( action ) => {
		let newDate;

		switch ( action ) {
			case 'PREV':
				if ( view === 'year' ) {
					newDate = subYears( currentDate, 1 );
				} else if ( view === 'month' ) {
					newDate = subMonths( currentDate, 1 );
				} else if ( view === 'week' ) {
					newDate = new Date(
						currentDate.getTime() - 7 * 24 * 60 * 60 * 1000
					);
				} else {
					newDate = new Date(
						currentDate.getTime() - 24 * 60 * 60 * 1000
					);
				}
				break;
			case 'NEXT':
				if ( view === 'year' ) {
					newDate = addYears( currentDate, 1 );
				} else if ( view === 'month' ) {
					newDate = addMonths( currentDate, 1 );
				} else if ( view === 'week' ) {
					newDate = new Date(
						currentDate.getTime() + 7 * 24 * 60 * 60 * 1000
					);
				} else {
					newDate = new Date(
						currentDate.getTime() + 24 * 60 * 60 * 1000
					);
				}
				break;
			case 'TODAY':
			default:
				newDate = new Date();
		}

		setCurrentDate( newDate );
	};

	/**
	 * Handle event selection.
	 *
	 * @param {Object} event Selected event.
	 */
	const handleSelectEvent = ( event ) => {
		setSelectedEvent( event );
	};

	/**
	 * Persist a date change to WordPress and update local state.
	 *
	 * @param {Object} event   The calendar event.
	 * @param {Date}   newDate The target date/time.
	 */
	const persistReschedule = async ( event, newDate ) => {
		const now = new Date();
		const isFuture = newDate > now;
		const newStatus = isFuture ? 'future' : 'publish';
		const dateStr = siteWallClock( newDate );

		const originalEvents = [ ...events ];

		setEvents( ( prev ) =>
			prev.map( ( e ) =>
				e.id === event.id
					? {
							...e,
							start: newDate,
							end: newDate,
							post_status: newStatus,
							is_scheduled: isFuture,
							is_published: ! isFuture,
					  }
					: e
			)
		);

		try {
			await apiFetch( {
				path: `/wp/v2/posts/${ event.id }`,
				method: 'POST',
				data: { date: dateStr, status: newStatus },
			} );

			const when = formatDateTime( dateStr );
			const label = isFuture
				? sprintf(
						/* translators: %s: the date and time the post is now scheduled for. */
						__( 'Scheduled for %s', 'vip-workflow' ),
						when
				  )
				: sprintf(
						/* translators: %s: the date and time the post went live. */
						__( 'Published (%s)', 'vip-workflow' ),
						when
				  );
			createSuccessNotice( label, { type: 'snackbar' } );
		} catch ( err ) {
			setEvents( originalEvents );
			createErrorNotice(
				err.message ||
					__( 'Failed to reschedule post.', 'vip-workflow' ),
				{ type: 'snackbar' }
			);
		}
	};

	/**
	 * Handle event drop from drag-and-drop.
	 *
	 * @param {Object} dropInfo       Drop info from react-big-calendar.
	 * @param {Object} dropInfo.event The dropped calendar event.
	 * @param {Date}   dropInfo.start The new start date/time.
	 */
	const handleEventDrop = ( { event, start } ) => {
		const now = new Date();
		const wasPublished =
			event.post_status === 'publish' || event.is_published;
		const wasScheduled =
			event.post_status === 'future' || event.is_scheduled;
		const willBeFuture = start > now;
		const willBePast = ! willBeFuture;

		const crossesBoundary =
			( wasPublished && willBeFuture ) || ( wasScheduled && willBePast );

		if ( crossesBoundary ) {
			setPendingDrop( {
				event,
				newDate: start,
				type: willBePast ? 'publish' : 'schedule',
			} );
		} else {
			persistReschedule( event, start );
		}
	};

	const confirmDrop = () => {
		if ( pendingDrop ) {
			persistReschedule( pendingDrop.event, pendingDrop.newDate );
			setPendingDrop( null );
		}
	};

	const cancelDrop = () => {
		setPendingDrop( null );
	};

	/**
	 * Get current view title.
	 */
	const getViewTitle = () => {
		switch ( view ) {
			case 'day':
				return format( currentDate, 'EEEE, MMMM d, yyyy' );
			case 'week':
				const weekStart = startOfWeek( currentDate, {
					weekStartsOn: 0,
				} );
				const weekEnd = new Date(
					weekStart.getTime() + 6 * 24 * 60 * 60 * 1000
				);
				if ( isSameMonth( weekStart, weekEnd ) ) {
					return `${ format( weekStart, 'MMMM d' ) } – ${ format(
						weekEnd,
						'd, yyyy'
					) }`;
				}
				return `${ format( weekStart, 'MMM d' ) } – ${ format(
					weekEnd,
					'MMM d, yyyy'
				) }`;
			case 'year':
				return format( currentDate, 'yyyy' );
			case 'month':
			default:
				return format( currentDate, 'MMMM yyyy' );
		}
	};

	const renderCalendarBody = () => {
		if ( loading ) {
			return (
				<Stack
					align="center"
					justify="center"
					gap="md"
					className="vip-workflow-calendar-loading"
				>
					<Spinner />
					<span>{ __( 'Loading calendar…', 'vip-workflow' ) }</span>
				</Stack>
			);
		}

		if ( view === 'year' ) {
			return (
				<YearView
					date={ currentDate }
					events={ events }
					onSelectDay={ ( day, dayEvents ) =>
						setSelectedDay( {
							date: day,
							posts: dayEvents,
						} )
					}
				/>
			);
		}

		return (
			<DnDCalendar
				localizer={ localizer }
				events={ events }
				view={ view }
				date={ currentDate }
				onNavigate={ setCurrentDate }
				onView={ setView }
				onSelectEvent={ handleSelectEvent }
				onEventDrop={ handleEventDrop }
				views={ [ 'month', 'week', 'day' ] }
				toolbar={ false }
				popup
				selectable={ false }
				resizable={ false }
				step={ 15 }
				timeslots={ 4 }
				dayLayoutAlgorithm="no-overlap"
				scrollToTime={ new Date( 1970, 0, 1, 8, 0, 0 ) }
				eventPropGetter={ ( event ) => ( {
					// rbc copies this onto the .rbc-event box everywhere it
					// renders an event — the grid, the drag preview, and the
					// "+N more" popup it portals to <body>. Calendar.css hangs
					// the chip styling off it precisely because that popup
					// escapes the .vip-workflow-calendar-body wrapper the rest
					// of the .rbc-* overrides are scoped under.
					className: 'vip-workflow-calendar-event',
					style: {
						'--vip-workflow-calendar-event-color':
							event.status_color,
					},
				} ) }
				dayPropGetter={ ( date ) => {
					const isToday = isSameDay( date, new Date() );
					return {
						className: isToday
							? 'vip-workflow-calendar-day--today'
							: '',
					};
				} }
			/>
		);
	};

	const actions = (
		<>
			<Stack align="center" gap="xs">
				<Button
					__next40pxDefaultSize
					icon={ chevronLeft }
					label={ __( 'Previous', 'vip-workflow' ) }
					showTooltip
					onClick={ () => handleNavigate( 'PREV' ) }
				/>
				<Button
					__next40pxDefaultSize
					variant="secondary"
					onClick={ () => handleNavigate( 'TODAY' ) }
				>
					{ __( 'Today', 'vip-workflow' ) }
				</Button>
				<Button
					__next40pxDefaultSize
					icon={ chevronRight }
					label={ __( 'Next', 'vip-workflow' ) }
					showTooltip
					onClick={ () => handleNavigate( 'NEXT' ) }
				/>
			</Stack>
			<SelectControl
				__next40pxDefaultSize
				value={ filter }
				options={ [
					{
						label: __( 'All Posts', 'vip-workflow' ),
						value: 'all',
					},
					{
						label: __( 'Published Only', 'vip-workflow' ),
						value: 'published',
					},
				] }
				onChange={ setFilter }
				__nextHasNoMarginBottom
			/>
			<Stack>
				<ToggleGroupControl
					label={ __( 'Calendar view', 'vip-workflow' ) }
					hideLabelFromVision
					value={ view }
					onChange={ setView }
					isBlock
					__nextHasNoMarginBottom
					__next40pxDefaultSize
				>
					<ToggleGroupControlOption
						value="day"
						label={ __( 'Day', 'vip-workflow' ) }
					/>
					<ToggleGroupControlOption
						value="week"
						label={ __( 'Week', 'vip-workflow' ) }
					/>
					<ToggleGroupControlOption
						value="month"
						label={ __( 'Month', 'vip-workflow' ) }
					/>
					<ToggleGroupControlOption
						value="year"
						label={ __( 'Year', 'vip-workflow' ) }
					/>
				</ToggleGroupControl>
			</Stack>
		</>
	);

	return (
		<AdminPage
			fullBleed
			breadcrumbs={ [
				{
					label: __( 'Workflows', 'vip-workflow' ),
					href: 'admin.php?page=vip-workflow',
				},
				{
					label: __( 'Calendar', 'vip-workflow' ),
					href: 'admin.php?page=vip-workflow-calendar',
				},
			] }
			title={ getViewTitle() }
			actions={ actions }
		>
			<Stack
				direction="column"
				className="vip-workflow-calendar-container"
			>
				{ /* Calendar Body. Stays a plain block wrapper: it only supplies
				     the flex sizing and the clip, while react-big-calendar's
				     .rbc-calendar is itself a height:100% flex column, so a
				     <Stack> here would nest a second, redundant flex context
				     around a component that lays itself out. */ }
				{ /* wpds-allow R7 -- clip/size frame around react-big-calendar, which owns its own flex layout */ }
				<div className="vip-workflow-calendar-body">
					{ renderCalendarBody() }
				</div>
			</Stack>

			{ /* Post Preview Modal */ }
			{ selectedEvent && (
				<PostPreviewModal
					post={ selectedEvent }
					onClose={ () => setSelectedEvent( null ) }
				/>
			) }

			{ /* Year View Day Posts Modal */ }
			{ selectedDay && (
				<DayPostsModal
					date={ selectedDay.date }
					posts={ selectedDay.posts }
					onClose={ () => setSelectedDay( null ) }
					onGoToDay={ () => {
						setCurrentDate( selectedDay.date );
						setView( 'day' );
						setSelectedDay( null );
					} }
				/>
			) }

			{ /* Reschedule Confirmation Modal */ }
			{ pendingDrop && (
				<RescheduleModal
					event={ pendingDrop.event }
					newDate={ pendingDrop.newDate }
					type={ pendingDrop.type }
					onConfirm={ confirmDrop }
					onCancel={ cancelDrop }
				/>
			) }
		</AdminPage>
	);
}
