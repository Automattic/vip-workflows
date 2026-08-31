/**
 * Settings page.
 *
 * One tab per topic, and one save model for the whole screen. See
 * docs/guides/settings-standard.md.
 *
 * The screen used to run three save models at once — General and the AI model
 * saved inside their own card, Prompts saved in a bar below all of its cards, and
 * Experiments wrote on every toggle and reloaded. A screen is either
 * staged-and-saved or immediate-apply, never half of each, and three of the four
 * panels hold text and select fields that cannot be applied on the keystroke. So
 * the whole screen stages its edits and one Save in the footer commits them.
 *
 * Each panel reports two things upward — whether it has unsaved work, and how to
 * save it — exactly as a tool card does on the Tools screen. The panel owns its
 * own requests; this page owns the decision to make them.
 *
 * The panels stay mounted (`keepMounted`). Base UI unmounts a hidden panel by
 * default, which on a staged screen would silently throw away everything the
 * reader typed the moment they looked at another tab.
 *
 * @package
 */

import { useState, useRef, useCallback } from '@wordpress/element';
import { Button, Notice } from '@wordpress/components';
import { Stack, Tabs } from '@wordpress/ui';
import { useDispatch } from '@wordpress/data';
import { store as noticesStore } from '@wordpress/notices';
import { __, sprintf } from '@wordpress/i18n';
import AdminPage from '../components/AdminPage';
import { SettingsFooter } from '../components/SettingsFooter';
import { GeneralSettings } from '../components/GeneralSettings';
import { AiModelSettings } from '../components/AiModelSettings';
import { ExperimentsSettings } from '../components/ExperimentsSettings';
import { PromptsSettings } from '../components/PromptsSettings';

/**
 * Settings page component.
 *
 * @return {JSX.Element} Settings page.
 */
export default function Settings() {
	const tabs = [
		{
			name: 'general',
			title: __( 'General', 'vip-workflows' ),
		},
		{
			name: 'ai-services',
			title: __( 'AI services', 'vip-workflows' ),
		},
		{
			name: 'prompts',
			title: __( 'Prompts', 'vip-workflows' ),
		},
		{
			name: 'experiments',
			title: __( 'Experiments', 'vip-workflows' ),
			// Enabling or disabling an experiment registers or removes
			// server-side menus and REST routes, so the page cannot show the
			// result of saving one without reloading.
			reloadOnSave: true,
		},
	];

	const requestedTab = new URLSearchParams( window.location.search ).get(
		'tab'
	);
	const [ activeTab, setActiveTab ] = useState(
		tabs.some( ( tab ) => tab.name === requestedTab )
			? requestedTab
			: 'general'
	);

	const [ dirtyPanels, setDirtyPanels ] = useState( [] );
	const [ saving, setSaving ] = useState( false );
	const [ error, setError ] = useState( null );
	const saveHandlers = useRef( {} );
	const { createSuccessNotice } = useDispatch( noticesStore );

	// Returning `prev` untouched when nothing moved is what keeps a panel's
	// dirty-reporting effect from re-rendering the page on every keystroke.
	const handleDirtyChange = useCallback( ( id, isDirty ) => {
		setDirtyPanels( ( prev ) => {
			const listed = prev.includes( id );
			if ( isDirty === listed ) {
				return prev;
			}
			return isDirty
				? [ ...prev, id ]
				: prev.filter( ( entry ) => entry !== id );
		} );
	}, [] );

	const registerSave = useCallback( ( id, fn ) => {
		saveHandlers.current[ id ] = fn;
	}, [] );

	const handleTabChange = ( value ) => {
		setActiveTab( value );
		const url = new URL( window.location.href );
		url.searchParams.set( 'tab', value );
		window.history.replaceState( {}, '', url );
	};

	const handleSave = async () => {
		setSaving( true );
		setError( null );

		const failures = [];
		for ( const id of dirtyPanels ) {
			try {
				await saveHandlers.current[ id ]();
			} catch ( err ) {
				// Named defensively: a throw inside the catch would escape
				// handleSave entirely, stranding the button in isBusy with no
				// notice and skipping every panel after this one.
				const title =
					tabs.find( ( tab ) => tab.name === id )?.title || id;
				failures.push( `${ title }: ${ err.message }` );
			}
		}

		setSaving( false );

		if ( failures.length > 0 ) {
			setError(
				sprintf(
					/* translators: %s: semicolon-separated list of tab names and their errors. */
					__(
						'Some settings could not be saved: %s',
						'vip-workflows'
					),
					failures.join( '; ' )
				)
			);
			return;
		}

		const needsReload = tabs.some(
			( tab ) => tab.reloadOnSave && dirtyPanels.includes( tab.name )
		);

		if ( needsReload ) {
			// The reloaded page is the feedback here; a snackbar would flash
			// away with it. The active tab rides along so the reader lands back
			// where they were.
			const url = new URL( window.location.href );
			url.searchParams.set( 'tab', activeTab );
			window.location.assign( url.toString() );
			return;
		}

		createSuccessNotice( __( 'Settings saved.', 'vip-workflows' ), {
			type: 'snackbar',
		} );
	};

	const panelProps = {
		onDirtyChange: handleDirtyChange,
		registerSave,
	};

	return (
		<AdminPage
			breadcrumbs={ [
				{
					label: __( 'Workflows', 'vip-workflows' ),
					href: 'admin.php?page=vip-workflows',
				},
				{ label: __( 'Settings', 'vip-workflows' ) },
			] }
			title={ __( 'Settings', 'vip-workflows' ) }
			subtitle={ __(
				'Configure workflow settings and preferences.',
				'vip-workflows'
			) }
			constrained
		>
			<Stack direction="column" gap="lg">
				{ error && (
					<Notice
						status="error"
						isDismissible
						onRemove={ () => setError( null ) }
					>
						{ error }
					</Notice>
				) }

				<Tabs.Root
					className="vip-workflows-tabs"
					value={ activeTab }
					onValueChange={ handleTabChange }
				>
					<Tabs.List>
						{ tabs.map( ( tab ) => (
							<Tabs.Tab key={ tab.name } value={ tab.name }>
								{ tab.title }
							</Tabs.Tab>
						) ) }
					</Tabs.List>
					{ tabs.map( ( tab ) => (
						<Tabs.Panel
							key={ tab.name }
							value={ tab.name }
							keepMounted
						>
							{ tab.name === 'general' && (
								<GeneralSettings { ...panelProps } />
							) }
							{ tab.name === 'ai-services' && (
								<AiModelSettings { ...panelProps } />
							) }
							{ tab.name === 'prompts' && (
								<PromptsSettings { ...panelProps } />
							) }
							{ tab.name === 'experiments' && (
								<ExperimentsSettings { ...panelProps } />
							) }
						</Tabs.Panel>
					) ) }
				</Tabs.Root>

				<SettingsFooter>
					<Button
						variant="primary"
						onClick={ handleSave }
						isBusy={ saving }
						disabled={ saving || dirtyPanels.length === 0 }
					>
						{ __( 'Save', 'vip-workflows' ) }
					</Button>
				</SettingsFooter>
			</Stack>
		</AdminPage>
	);
}
