/**
 * Sequences List Component
 *
 * Editorial and Phase sequences (one tab each), rendered as a grid of cards by
 * the shared `<CardGridView>` — DataViews free composition, with each sequence
 * drawn as a `<SummaryCard>`. The Jobs tab renders through the same pair, so a
 * list card looks and behaves the same on both screens.
 *
 * @package
 */

import { useState, useEffect, useCallback } from '@wordpress/element';
import {
	DropZone,
	Spinner,
	Notice,
	Button,
	Modal,
	TextControl,
} from '@wordpress/components';
import { Tabs, Badge, Stack, Text } from '@wordpress/ui';
import { useDispatch } from '@wordpress/data';
import { store as noticesStore } from '@wordpress/notices';
import apiFetch from '@wordpress/api-fetch';
import { __, _n, sprintf } from '@wordpress/i18n';
import { plus } from '@wordpress/icons';

import { ModalActions } from '../../common/ModalActions';
import AdminPage from './AdminPage';
import { CardGridView } from './CardGridView';
import { SummaryCard } from './SummaryCard';

import './SequencesList.css';

const BREADCRUMBS = [
	{
		label: __( 'Workflows', 'vip-workflows' ),
		href: 'admin.php?page=vip-workflows',
	},
	{ label: __( 'Sequences', 'vip-workflows' ) },
];
const TITLE = __( 'Sequences', 'vip-workflows' );
const SUBTITLE = __(
	'Sequences define workflow stages and transitions for your content types.',
	'vip-workflows'
);

// No sequence facet is worth filtering on, so these fields exist only to power
// DataViews' search (and the default name sort); the cards themselves render
// straight from the item. Declaring no filter is also what keeps the shared
// view's filter chrome off this screen.
const SEARCH_FIELDS = [
	{
		id: 'name',
		label: __( 'Name', 'vip-workflows' ),
		enableGlobalSearch: true,
		// Not a column anyone can hide: the card decides its own anatomy, so
		// there is nothing for a Properties toggle to switch off. Saying so is
		// also what keeps that section out of the view options entirely.
		enableHiding: false,
		getValue: ( { item } ) => item.name,
	},
	{
		id: 'description',
		label: __( 'Description', 'vip-workflows' ),
		enableGlobalSearch: true,
		// Searchable, not sortable: alphabetising sequences by their blurb
		// orders them by nothing anyone is looking for.
		enableSorting: false,
		enableHiding: false,
		getValue: ( { item } ) => item.description || '',
	},
];

export function SequencesList() {
	const [ sequences, setSequences ] = useState( [] );
	const [ loading, setLoading ] = useState( true );
	const [ error, setError ] = useState( null );
	const [ availablePostTypes, setAvailablePostTypes ] = useState( [] );
	const [ showImportModal, setShowImportModal ] = useState( false );
	const [ activeTab, setActiveTab ] = useState( 'workflow' );
	const { createErrorNotice } = useDispatch( noticesStore );

	const fetchSequences = useCallback( () => {
		setLoading( true );
		apiFetch( { path: '/vip-workflows/v1/sequences' } )
			.then( ( response ) => {
				setSequences( response || [] );
				setLoading( false );
			} )
			.catch( ( err ) => {
				setError( err.message );
				setLoading( false );
			} );
	}, [] );

	// Fetch available post types to flag stale references on each card.
	useEffect( () => {
		apiFetch( { path: '/wp/v2/types' } ).then( ( types ) => {
			setAvailablePostTypes( Object.keys( types ) );
		} );
	}, [] );

	useEffect( () => {
		fetchSequences();
	}, [ fetchSequences ] );

	const handleExport = useCallback(
		async ( id, name ) => {
			try {
				const data = await apiFetch( {
					path: `/vip-workflows/v1/sequences/${ id }/export`,
				} );

				const jsonString = JSON.stringify( data, null, 2 );
				const blob = new Blob( [ jsonString ], {
					type: 'application/json',
				} );
				const url = URL.createObjectURL( blob );
				const link = document.createElement( 'a' );
				link.href = url;
				link.download = `${ name
					.toLowerCase()
					.replace( /\s+/g, '-' ) }-sequence.json`;
				document.body.appendChild( link );
				link.click();
				document.body.removeChild( link );
				URL.revokeObjectURL( url );
			} catch ( err ) {
				createErrorNotice(
					__( 'Failed to export sequence:', 'vip-workflows' ) +
						err.message,
					{ type: 'snackbar' }
				);
			}
		},
		[ createErrorNotice ]
	);

	// Both tabs offer the same two verbs; only Edit's destination differs.
	// Edit is the card's primary — editing is what the card is for — and
	// lands rightmost in the row; Export stays the ghost before it: a
	// low-stakes utility, not a second real action.
	const sequenceActions = ( item, editHash ) => [
		{
			id: 'export',
			label: __( 'Export', 'vip-workflows' ),
			variant: 'tertiary',
			onClick: () => handleExport( item.id, item.name ),
		},
		{
			id: 'edit',
			label: __( 'Edit', 'vip-workflows' ),
			variant: 'primary',
			onClick: () => {
				window.location.hash = editHash;
			},
		},
	];

	const renderWorkflowCard = ( item ) => {
		const hasTypes = item.post_types && availablePostTypes.length > 0;
		const stale = hasTypes
			? item.post_types.filter(
					( pt ) => ! availablePostTypes.includes( pt )
			  )
			: [];
		const validCount = hasTypes
			? item.post_types.filter( ( pt ) =>
					availablePostTypes.includes( pt )
			  ).length
			: ( item.post_types || [] ).length;
		const noValid = validCount === 0 && availablePostTypes.length > 0;

		const badges = [
			item.status !== 'active' && (
				<Badge key="draft" intent="draft">
					{ __( 'Draft', 'vip-workflows' ) }
				</Badge>
			),
			stale.length > 0 && (
				<Badge key="stale" intent="high">
					{ __( 'Invalid post types', 'vip-workflows' ) }
				</Badge>
			),
			noValid && (
				<Badge key="novalid" intent="high">
					{ __( 'No valid post types', 'vip-workflows' ) }
				</Badge>
			),
		].filter( Boolean );

		return (
			<SummaryCard
				key={ item.id }
				title={ item.name }
				badges={ badges }
				description={ item.description }
				actions={ sequenceActions( item, `#/edit/${ item.id }` ) }
			/>
		);
	};

	const renderPhaseCard = ( item ) => {
		const ideation = ( item.config?.phases || [] ).find(
			( p ) => p.key === 'ideation'
		);
		const count = ideation?.transitions?.length || 0;
		const badges = [
			item.status !== 'active' && (
				<Badge key="draft" intent="draft">
					{ __( 'Draft', 'vip-workflows' ) }
				</Badge>
			),
		].filter( Boolean );

		return (
			<SummaryCard
				key={ item.id }
				title={ item.name }
				badges={ badges }
				description={ item.description }
				meta={ sprintf(
					/* translators: %d: number of ideation transitions */
					_n(
						'%d ideation transition',
						'%d ideation transitions',
						count,
						'vip-workflows'
					),
					count
				) }
				actions={ sequenceActions( item, `#/edit-phase/${ item.id }` ) }
			/>
		);
	};

	if ( loading ) {
		return (
			<AdminPage
				breadcrumbs={ BREADCRUMBS }
				title={ TITLE }
				subtitle={ SUBTITLE }
			>
				<Stack
					className="vip-workflows-loading"
					align="center"
					gap="sm"
				>
					<Spinner />
					{ __( 'Loading sequences…', 'vip-workflows' ) }
				</Stack>
			</AdminPage>
		);
	}

	if ( error ) {
		return (
			<AdminPage
				breadcrumbs={ BREADCRUMBS }
				title={ TITLE }
				subtitle={ SUBTITLE }
			>
				<Notice status="error" isDismissible={ false }>
					{ error }
				</Notice>
			</AdminPage>
		);
	}

	const workflowSequences = sequences.filter(
		( bp ) => bp.type === 'workflow' || ! bp.type
	);
	const phaseSequences = sequences.filter( ( bp ) => bp.type === 'phase' );

	const tabs = [
		{
			name: 'workflow',
			title: sprintf(
				/* translators: %d: count of editorial sequences */
				__( 'Editorial Sequences (%d)', 'vip-workflows' ),
				workflowSequences.length
			),
		},
	];

	// Phase sequences are an ideation-owned surface.
	if ( window.vipWorkflowsAdmin?.experiments?.ideation ) {
		tabs.push( {
			name: 'phase',
			title: sprintf(
				/* translators: %d: count of phase sequences */
				__( 'Phase Sequences (%d)', 'vip-workflows' ),
				phaseSequences.length
			),
		} );
	}

	// The add/import actions belong to the Editorial Sequences tab; the Phase
	// tab has none. Surfaced in the AdminPage header and swapped with the tab.
	// Secondary first, primary last — the standard's order rule holds in the
	// page header too, so the leading verb sits rightmost in the group.
	const actions =
		activeTab === 'workflow' ? (
			<>
				<Button
					variant="secondary"
					onClick={ () => setShowImportModal( true ) }
				>
					{ __( 'Import sequence', 'vip-workflows' ) }
				</Button>
				<Button
					variant="primary"
					icon={ plus }
					href="#/new?type=workflow"
				>
					{ __( 'New editorial sequence', 'vip-workflows' ) }
				</Button>
			</>
		) : null;

	return (
		<AdminPage
			breadcrumbs={ BREADCRUMBS }
			title={ TITLE }
			subtitle={ SUBTITLE }
			actions={ actions }
		>
			<Stack direction="column" gap="lg">
				<Tabs.Root
					className="vip-workflows-tabs"
					value={ activeTab }
					onValueChange={ setActiveTab }
				>
					<Tabs.List>
						{ tabs.map( ( tab ) => (
							<Tabs.Tab key={ tab.name } value={ tab.name }>
								{ tab.title }
							</Tabs.Tab>
						) ) }
					</Tabs.List>
					{ tabs.map( ( tab ) => (
						<Tabs.Panel key={ tab.name } value={ tab.name }>
							<div className="vip-workflows-sequences-tab-content">
								{ tab.name === 'workflow' &&
									( workflowSequences.length === 0 ? (
										<div className="vip-workflows-sequences-empty">
											<Text
												variant="body-md"
												render={ <p /> }
											>
												{ __(
													'No editorial sequences yet.',
													'vip-workflows'
												) }
											</Text>
											<Button
												variant="primary"
												href="#/new?type=workflow"
											>
												{ __(
													'New sequence',
													'vip-workflows'
												) }
											</Button>
										</div>
									) : (
										<SequencesView
											items={ workflowSequences }
											renderCard={ renderWorkflowCard }
										/>
									) ) }
								{ tab.name === 'phase' &&
									( phaseSequences.length === 0 ? (
										<div className="vip-workflows-sequences-empty">
											<Text
												variant="body-md"
												render={ <p /> }
											>
												{ __(
													'No phase sequence found. One should be created automatically.',
													'vip-workflows'
												) }
											</Text>
										</div>
									) : (
										<SequencesView
											items={ phaseSequences }
											renderCard={ renderPhaseCard }
										/>
									) ) }
							</div>
						</Tabs.Panel>
					) ) }
				</Tabs.Root>
				{ showImportModal && (
					<ImportSequenceModal
						onClose={ () => setShowImportModal( false ) }
						onSuccess={ fetchSequences }
						allSequences={ sequences }
					/>
				) }
			</Stack>
		</AdminPage>
	);
}

/**
 * The shared card grid, bound to what every sequence tab has in common: the same
 * search fields, page size, alphabetical order and search label.
 *
 * @param {Object}   props            Props.
 * @param {Array}    props.items      Sequence rows.
 * @param {Function} props.renderCard Renders a card for an item.
 * @return {JSX.Element} View.
 */
function SequencesView( { items, renderCard } ) {
	return (
		<CardGridView
			items={ items }
			fields={ SEARCH_FIELDS }
			renderCard={ renderCard }
			searchLabel={ __( 'Search sequences', 'vip-workflows' ) }
			perPage={ 12 }
			sort={ { field: 'name', direction: 'asc' } }
			getItemId={ ( item ) => String( item.id ) }
			// Only reachable through the search box — a tab with no sequences
			// at all never renders this view. Without it a search that matches
			// nothing leaves the panel holding a search box and nothing else.
			empty={
				<Text variant="body-md" render={ <p /> }>
					{ __( 'No sequences match your search.', 'vip-workflows' ) }
				</Text>
			}
		/>
	);
}

/**
 * The name to offer for an imported sequence.
 *
 * A sequence carries its name in the file, and two sequences answering to the
 * same name are indistinguishable in the list — so a name already taken is
 * suffixed with the first counter that is free.
 *
 * @param {string} preferred The name the file carries.
 * @param {Array}  existing  Sequences already stored.
 * @return {string} A name no stored sequence is using.
 */
function uniqueImportName( preferred, existing ) {
	const taken = existing.map( ( bp ) => bp.name.toLowerCase() );
	let candidate = preferred;
	let counter = 2;

	while ( taken.includes( candidate.toLowerCase() ) ) {
		candidate = `${ preferred } ${ counter }`;
		counter++;
	}

	return candidate;
}

function ImportSequenceModal( { onClose, onSuccess, allSequences } ) {
	const [ sequenceJson, setSequenceJson ] = useState( null );
	const [ name, setName ] = useState( '' );
	const [ error, setError ] = useState( null );
	const [ importing, setImporting ] = useState( false );

	// The single import path. Browsing and dropping both hand the file here, so
	// a dropped file is read, parsed and named exactly as a browsed one is —
	// and anything that is not sequence JSON fails on the same message either
	// way, rather than growing a second kind of error.
	const readSequenceFile = ( file ) => {
		// A file the reader turns away takes the place of whatever it was
		// dropped on top of, so the form cannot go on offering to import an
		// earlier file the notice has already reported as rejected.
		const reject = ( message ) => {
			setSequenceJson( null );
			setName( '' );
			setError( message );
		};

		const reader = new FileReader();
		reader.onload = ( e ) => {
			try {
				const json = JSON.parse( e.target.result );
				setSequenceJson( json );
				setName( uniqueImportName( json.name || '', allSequences ) );
				setError( null );
			} catch ( err ) {
				reject( __( 'Invalid JSON file.', 'vip-workflows' ) );
			}
		};
		// A drop can carry something the reader cannot open at all — a folder,
		// or a file that moved mid-drag — which the browse control could never
		// hand over. Say so, rather than leaving the modal looking as though
		// the drop never happened.
		reader.onerror = () =>
			reject( __( 'That file could not be read.', 'vip-workflows' ) );
		reader.readAsText( file );
	};

	const handleFileUpload = ( event ) => {
		const file = event.target.files?.[ 0 ];
		if ( ! file ) {
			return;
		}

		readSequenceFile( file );
	};

	// A drop can carry several files at once. An import takes one sequence, the
	// same as the browse control, so the first file dropped is the one read.
	const handleFilesDrop = ( files ) => {
		readSequenceFile( files[ 0 ] );
	};

	const handleImport = async () => {
		if ( ! sequenceJson ) {
			setError(
				__( 'Please upload a sequence JSON file.', 'vip-workflows' )
			);
			return;
		}

		if ( ! name.trim() ) {
			setError(
				__( 'Please enter a name for the sequence.', 'vip-workflows' )
			);
			return;
		}

		setImporting( true );
		setError( null );

		try {
			await apiFetch( {
				path: '/vip-workflows/v1/sequences/import',
				method: 'POST',
				data: {
					sequence_json: sequenceJson,
					name: name.trim(),
				},
			} );

			onSuccess();
			onClose();
		} catch ( err ) {
			setError( err.message );
			setImporting( false );
		}
	};

	return (
		<Modal
			title={ __( 'Import sequence', 'vip-workflows' ) }
			onRequestClose={ onClose }
			className="vip-workflows-import-modal"
			size="medium"
			headerActions={
				<DropZone
					label={ __(
						'Drop the sequence JSON file to import it',
						'vip-workflows'
					) }
					onFilesDrop={ handleFilesDrop }
				/>
			}
		>
			{ /* The body and header each need a drop zone. Modal renders the
			     title bar outside this positioned container, so its headerActions
			     target above covers the part this body target cannot reach. */ }
			<DropZone
				label={ __(
					'Drop the sequence JSON file to import it',
					'vip-workflows'
				) }
				onFilesDrop={ handleFilesDrop }
			/>

			{ error && (
				<Notice status="error" isDismissible={ false }>
					{ error }
				</Notice>
			) }

			{ /* One column Stack owns the body's rhythm. ModalActions stays
			     outside it because the footer supplies its own gap above. */ }
			<Stack direction="column" gap="lg">
				<Stack direction="column" gap="sm">
					<label htmlFor="sequence-file-upload">
						{ __( 'Upload Sequence JSON:', 'vip-workflows' ) }
					</label>
					{ /* Drawn as a box so the place to aim at is legible
					     before any drag starts. The box is the affordance
					     only; the <DropZone> above takes the drop. */ }
					<div className="vip-workflows-import-modal__drop-target">
						<Stack direction="column" gap="xs" align="flex-start">
							<input
								id="sequence-file-upload"
								type="file"
								accept=".json"
								onChange={ handleFileUpload }
							/>
							<Text variant="body-sm">
								{ __(
									'…or drop a sequence JSON file here.',
									'vip-workflows'
								) }
							</Text>
						</Stack>
					</div>
				</Stack>

				{ sequenceJson && (
					<>
						<div className="vip-workflows-import-modal__type-preview">
							<strong>
								{ __( 'Sequence Type:', 'vip-workflows' ) }
							</strong>{ ' ' }
							{ sequenceJson.type || 'unknown' }
						</div>

						<TextControl
							__next40pxDefaultSize
							__nextHasNoMarginBottom
							label={ __( 'Sequence Name', 'vip-workflows' ) }
							value={ name }
							onChange={ setName }
							help={ __(
								'Enter a unique name for this sequence.',
								'vip-workflows'
							) }
						/>
					</>
				) }
			</Stack>

			{ sequenceJson && (
				<ModalActions>
					<Button
						variant="tertiary"
						onClick={ onClose }
						disabled={ importing }
					>
						{ __( 'Cancel', 'vip-workflows' ) }
					</Button>
					<Button
						variant="primary"
						onClick={ handleImport }
						isBusy={ importing }
						disabled={ importing }
					>
						{ importing
							? __( 'Importing…', 'vip-workflows' )
							: __( 'Import sequence', 'vip-workflows' ) }
					</Button>
				</ModalActions>
			) }
		</Modal>
	);
}
