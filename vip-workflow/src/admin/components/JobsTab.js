/**
 * Jobs Tab
 *
 * Configure background jobs registered with the workflow system.
 *
 * Rendered as a grid of `<SummaryCard>`s through the shared `<CardGridView>` —
 * the same card and the same panel the Sequences screen draws, so a list card
 * means one thing across the admin. The screen previously drew two hand-rolled
 * card grids under two headings — "System Jobs" (jobs with no settings) and
 * "Plugin Jobs" (jobs with settings). They are one view here, not two, because
 * the split is a single boolean off one dataset: two views would mean two view
 * states, two search boxes and two paginations on one screen. A `source` facet
 * carries the same distinction as a filter the reader can apply on demand, and
 * as a badge on each card so a job's origin is legible without filtering at all.
 *
 * Note that `source` is derived from `has_settings`, which is exactly the
 * discriminator the two headings used. It says "this job is configurable", not
 * literally "this job came from a plugin" — the labels are inherited from the
 * headings they replace rather than newly claimed here.
 *
 * Two pieces of scaffolding dissolved when the screen moved off the built-in
 * grid layout, and both were there to work around it:
 *
 * - Run Now was a DataViews *field* (`run_action`) rather than an action,
 *   because the built-in grid routes every action — `isPrimary` included — into
 *   a "…" menu that is `opacity: 0` until the card is hovered. Composing the
 *   card ourselves means there is no such menu, and the screen's primary verb is
 *   simply a button in the actions row.
 * - That field carried the label "Actions", which the built-in grid printed as a
 *   visible label/value row beside the control ("Actions  [Run Now]") and which
 *   duplicated the "…" toggle's accessible name. There is no label row to fill
 *   now, and nothing should reintroduce one.
 *
 * Settings moved the same way, from a DataViews action with a `RenderModal` to a
 * second button on the card, so its open/closed state is held here.
 *
 * The dataset is small and fully loaded from one endpoint, so search / filtering
 * / pagination run client-side, the pattern the other list screens use.
 *
 * @package
 */

import { useState, useEffect, useCallback } from '@wordpress/element';
import { Button, Spinner, Notice, Modal } from '@wordpress/components';
import { Badge, Stack, Text } from '@wordpress/ui';
import apiFetch from '@wordpress/api-fetch';
import { __, sprintf } from '@wordpress/i18n';
import { applyFilters } from '@wordpress/hooks';

import { ModalActions } from '../../common/ModalActions';
import { ModalBody } from '../../common/ModalBody';
import { getSaveButtonLabel } from '../utils/save-button-label';
import { CardGridView } from './CardGridView';
import { SummaryCard } from './SummaryCard';

import './JobsTab.css';

const SOURCE_LABELS = {
	system: __( 'System', 'vip-workflow' ),
	plugin: __( 'Plugin', 'vip-workflow' ),
};

const SOURCE_ELEMENTS = Object.entries( SOURCE_LABELS ).map(
	( [ value, label ] ) => ( { value, label } )
);

const PER_PAGE = 20;

// No sort: the scheduler returns jobs in registration order — core services
// first, then whatever plugins added — which is the order the two headings used
// to impose. Re-sorting client-side would discard it.
const REGISTRATION_ORDER = {};

// The single definition of the distinction the two headings used to draw, read
// by both the Source filter and the badge on the card so the two can't disagree.
const jobSource = ( job ) => ( job.has_settings ? 'plugin' : 'system' );

// The card renders straight from the job, so a field earns its place only by
// powering the search box or the Source filter. `interval_text` is neither — it
// is the card's meta line — and is read off the item in the card. Nothing here
// closes over component state, so the list is a module constant: CardGridView
// memoizes on its identity.
const FIELDS = [
	{
		id: 'name',
		type: 'text',
		label: __( 'Job', 'vip-workflow' ),
		enableGlobalSearch: true,
		enableHiding: false,
	},
	{
		id: 'description',
		type: 'text',
		label: __( 'Description', 'vip-workflow' ),
		enableGlobalSearch: true,
		filterBy: false,
		enableSorting: false,
		enableHiding: false,
	},
	{
		id: 'source',
		label: __( 'Source', 'vip-workflow' ),
		elements: SOURCE_ELEMENTS,
		// The one facet worth narrowing by, and the reason this screen asks the
		// shared view for filter chrome at all. `isPrimary` keeps the filter bar
		// open rather than behind the funnel.
		filterBy: { operators: [ 'isAny' ], isPrimary: true },
		// Narrow by it, don't order by it: sorting a list into two blocks says
		// less than the badge on every card already does. Name is the only
		// ordering worth offering beside registration order.
		enableSorting: false,
		enableHiding: false,
		getValue: ( { item } ) => jobSource( item ),
	},
];

/**
 * Jobs configuration tab.
 *
 * @return {JSX.Element} Jobs grid.
 */
export function JobsTab() {
	const [ jobs, setJobs ] = useState( [] );
	const [ loading, setLoading ] = useState( true );
	const [ error, setError ] = useState( null );
	// The job whose settings dialog is open, held as an *id* rather than as the
	// job object the card handed over. DataViews used to hold this while
	// Settings was one of its actions; composing the card means the screen
	// holds it instead.
	//
	// It has to be the id: every save and every run calls `fetchJobs()`, which
	// replaces the whole `jobs` array, and a captured object would go on
	// describing the job as it was *before* — a stale title on a dialog that is
	// still open, and a stale `job` handed to anything listening on
	// `vipWorkflow.jobSettingsComponent`. Re-finding the job each render is
	// what keeps the open dialog on the saved state, and what closes it if the
	// job stops being registered while it is open.
	const [ settingsJobId, setSettingsJobId ] = useState( null );
	const settingsJob = jobs.find( ( job ) => job.id === settingsJobId );

	const fetchJobs = useCallback( async () => {
		try {
			const response = await apiFetch( {
				path: '/vip-workflow/v1/jobs',
			} );
			setJobs( response.jobs );
		} catch ( err ) {
			setError( err.message );
		} finally {
			setLoading( false );
		}
	}, [] );

	// Fetch jobs on mount.
	useEffect( () => {
		fetchJobs();
	}, [ fetchJobs ] );

	const runJob = useCallback(
		async ( jobId ) => {
			try {
				await apiFetch( {
					path: `/vip-workflow/v1/jobs/${ jobId }/run`,
					method: 'POST',
				} );
				// Refresh to update last run time.
				fetchJobs();
			} catch ( err ) {
				setError( err.message );
			}
		},
		[ fetchJobs ]
	);

	const renderJobCard = ( job ) => {
		// Run Now is the card's primary — it is what an author opens this
		// screen to press — and lands rightmost in the row (dismiss/utility
		// first, primary last). Settings is the auxiliary verb beside it, and
		// only exists for a job that has any — the eligibility the DataViews
		// action used to declare.
		const actions = [
			job.has_settings && {
				id: 'settings',
				label: __( 'Settings', 'vip-workflow' ),
				variant: 'tertiary',
				onClick: () => setSettingsJobId( job.id ),
			},
			{
				id: 'run',
				label: __( 'Run now', 'vip-workflow' ),
				variant: 'primary',
				onClick: () => runJob( job.id ),
			},
		].filter( Boolean );

		return (
			<SummaryCard
				key={ job.id }
				title={ job.name }
				badges={ [
					<Badge key="source">
						{ SOURCE_LABELS[ jobSource( job ) ] }
					</Badge>,
				] }
				description={ job.description }
				meta={ sprintf(
					/* translators: %s: how often the job runs, e.g. "Every hour" */
					__( 'Schedule: %s', 'vip-workflow' ),
					job.interval_text
				) }
				actions={ actions }
			/>
		);
	};

	if ( loading ) {
		return (
			<Stack
				className="vip-workflow-jobs-loading"
				align="center"
				gap="md"
			>
				<Spinner />
				<span>{ __( 'Loading jobs…', 'vip-workflow' ) }</span>
			</Stack>
		);
	}

	return (
		<div className="vip-workflow-jobs-tab">
			{ error && (
				<Notice
					status="error"
					isDismissible
					onRemove={ () => setError( null ) }
				>
					{ error }
				</Notice>
			) }

			<CardGridView
				items={ jobs }
				fields={ FIELDS }
				renderCard={ renderJobCard }
				searchLabel={ __( 'Search jobs', 'vip-workflow' ) }
				perPage={ PER_PAGE }
				sort={ REGISTRATION_ORDER }
				getItemId={ ( item ) => item.id }
				// Reads true both when nothing is registered and when a search
				// or filter excludes everything.
				empty={
					<Text variant="body-md" render={ <p /> }>
						{ __( 'No jobs found.', 'vip-workflow' ) }
					</Text>
				}
			/>

			{ settingsJob && (
				<JobSettingsModal
					job={ settingsJob }
					closeModal={ () => setSettingsJobId( null ) }
					onSaved={ fetchJobs }
					onError={ setError }
				/>
			) }
		</div>
	);
}

/**
 * Settings modal for a configurable job.
 *
 * Owns its own draft of the settings so that typing in the form does not
 * re-render (and therefore remount) the grid behind it. The saved values come
 * straight off the job payload, which always carries `settings` for a job that
 * has them.
 *
 * `job` is re-derived from the refreshed list on every render, so the title and
 * the descriptor passed on to `vipWorkflow.jobSettingsComponent` follow the
 * saved state while the dialog stays open. The draft does not: it is seeded
 * from `job.settings` once and then left alone, because it belongs to the
 * reader and re-seeding it from a later payload would throw away whatever they
 * had typed since.
 *
 * The dialog itself is here too. It used to be supplied by DataViews, which
 * wrapped an action's `RenderModal` in a `<Modal>` titled from `modalHeader`;
 * with Settings now a button on the card, the same dialog is opened directly.
 *
 * @param {Object}   props            Component props.
 * @param {Object}   props.job        Job descriptor.
 * @param {Function} props.closeModal Closes the modal.
 * @param {Function} props.onSaved    Called after a successful save, to refresh the list.
 * @param {Function} props.onError    Called with a message when a save fails.
 * @return {JSX.Element} The dialog.
 */
function JobSettingsModal( { job, closeModal, onSaved, onError } ) {
	const [ settings, setSettings ] = useState( job.settings );
	const [ saving, setSaving ] = useState( false );
	const [ saveStatus, setSaveStatus ] = useState( null );

	const updateSetting = ( field, value ) =>
		setSettings( ( prev ) => ( { ...prev, [ field ]: value } ) );

	const save = async () => {
		setSaving( true );
		setSaveStatus( null );

		try {
			await apiFetch( {
				path: `/vip-workflow/v1/jobs/${ job.id }/settings`,
				method: 'POST',
				data: settings,
			} );
			setSaveStatus( 'success' );
			onSaved();
		} catch ( err ) {
			setSaveStatus( 'error' );
			onError( err.message );
		} finally {
			setSaving( false );
		}
	};

	return (
		// The title is whatever plugin registered the job, so it opts into the
		// house truncation rule — the WPDS header is a fixed-height bar and a
		// long name would clip rather than ellipse. See docs/guides/modal-standard.md.
		<Modal
			title={ job.name }
			onRequestClose={ closeModal }
			size="medium"
			className="vip-workflow-modal--truncate-title"
		>
			<ModalBody>
				<Text
					variant="body-md"
					render={ <p /> }
					className="vip-workflow-description"
				>
					{ job.description }
				</Text>
				<JobSettingsForm
					job={ job }
					settings={ settings }
					onUpdate={ updateSetting }
				/>
			</ModalBody>
			<ModalActions>
				<Button variant="tertiary" onClick={ closeModal }>
					{ __( 'Close', 'vip-workflow' ) }
				</Button>
				<Button
					variant="primary"
					onClick={ save }
					isBusy={ saving }
					disabled={ saving }
				>
					{ getSaveButtonLabel(
						saving,
						saveStatus,
						__( 'Save', 'vip-workflow' )
					) }
				</Button>
			</ModalActions>
		</Modal>
	);
}

/**
 * Dynamic settings form for a job.
 *
 * Third-party plugins can register their settings UI via the 'vipWorkflow.jobSettingsComponent' filter.
 *
 * @param {Object}   props          Component props.
 * @param {Object}   props.job      Job descriptor (includes its `id`).
 * @param {Object}   props.settings Current settings values for the job.
 * @param {Function} props.onUpdate Callback to update a settings field: ( field, value ).
 * @return {JSX.Element} The job settings form.
 */
function JobSettingsForm( { job, settings, onUpdate } ) {
	// Allow plugins to provide their own settings component.
	const PluginComponent = applyFilters(
		'vipWorkflow.jobSettingsComponent',
		null,
		job.id,
		{ job, settings, onUpdate }
	);

	if ( PluginComponent ) {
		return PluginComponent;
	}

	// Generic fallback for jobs without custom settings UI.
	return (
		<div className="job-settings">
			<Text
				variant="body-sm"
				render={ <p /> }
				className="vip-workflow-description"
			>
				{ __( 'This job has configurable settings.', 'vip-workflow' ) }
			</Text>
		</div>
	);
}

export default JobsTab;
