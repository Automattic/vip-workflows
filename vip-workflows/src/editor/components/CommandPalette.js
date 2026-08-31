/**
 * Command Palette Integration
 *
 * Registers workflow tools as commands in the WordPress command palette (⌘K).
 *
 * @package
 */

import {
	useEffect,
	useState,
	useCallback,
	createPortal,
} from '@wordpress/element';
import { useSelect, useDispatch } from '@wordpress/data';
import { store as noticesStore } from '@wordpress/notices';
import apiFetch from '@wordpress/api-fetch';
import { __, sprintf } from '@wordpress/i18n';
import { CheckResultsModal, HelperResultModal } from './ToolResultModals';
import { settleAppliedField } from '../../common/settle-applied-field';
import { STORE_NAME } from '../store';

/**
 * Command Palette component.
 *
 * Registers workflow tools as commands.
 */
export function CommandPalette() {
	const { postId } = useSelect( ( select ) => {
		const s = select( STORE_NAME );
		return {
			postId: s.getPostId(),
		};
	}, [] );
	const { createSuccessNotice, createErrorNotice } =
		useDispatch( noticesStore );
	const [ modalResult, setModalResult ] = useState( null );
	const [ modalTool, setModalTool ] = useState( null );
	const [ applying, setApplying ] = useState( false );
	const [ regenerating, setRegenerating ] = useState( false );
	const [ isRunning, setIsRunning ] = useState( false );
	const [ runningToolLabel, setRunningToolLabel ] = useState( '' );

	const runTool = useCallback(
		async ( tool ) => {
			if ( ! postId ) {
				createErrorNotice( __( 'No post selected.', 'vip-workflows' ), {
					type: 'snackbar',
				} );
				return null;
			}

			try {
				const result = await apiFetch( {
					path: `/vip-workflows/v1/abilities/${ tool.id }/run`,
					method: 'POST',
					data: { post_id: postId },
				} );
				return result;
			} catch ( error ) {
				return {
					error:
						error.message ||
						__( 'Error running tool.', 'vip-workflows' ),
				};
			}
		},
		[ postId, createErrorNotice ]
	);

	// Generic handler for applying tool results to post fields.
	// The field to apply is defined in tool meta.apply_field (e.g., 'excerpt', 'title').
	const handleApplyField = async ( value ) => {
		if ( ! value || ! modalTool?.meta?.apply_field ) {
			return;
		}

		const field = modalTool.meta.apply_field;
		setApplying( true );

		try {
			const { editPost } = window.wp.data.dispatch( 'core/editor' );
			await editPost( { [ field ]: value } );

			// Best-effort flourish; see settleAppliedField for why it cannot throw.
			settleAppliedField( field );

			createSuccessNotice(
				sprintf(
					// translators: %s: the post field name that was applied (e.g. Excerpt, Title).
					__(
						'%s applied! Save the post to keep it.',
						'vip-workflows'
					),
					field.charAt( 0 ).toUpperCase() + field.slice( 1 )
				),
				{ type: 'snackbar' }
			);
			setModalResult( null );
			setModalTool( null );
		} catch ( error ) {
			createErrorNotice(
				error.message || __( 'Failed to apply.', 'vip-workflows' ),
				{ type: 'snackbar' }
			);
		} finally {
			setApplying( false );
		}
	};

	const handleRegenerate = async () => {
		if ( ! modalTool ) {
			return;
		}

		setRegenerating( true );
		createSuccessNotice( __( 'Regenerating…', 'vip-workflows' ), {
			type: 'snackbar',
		} );

		const result = await runTool( modalTool );
		if ( result ) {
			setModalResult( result );
		}
		setRegenerating( false );
	};

	useEffect( () => {
		if ( ! window.wp?.data?.dispatch( 'core/commands' ) ) {
			return;
		}

		const { registerCommand, unregisterCommand } =
			window.wp.data.dispatch( 'core/commands' );
		if ( ! registerCommand ) {
			return;
		}

		const registeredCommands = [];

		apiFetch( { path: '/vip-workflows/v1/abilities' } )
			.then( ( abilities ) => {
				const commandAbilities = abilities.filter(
					( a ) =>
						a.meta?.show_in_commands &&
						a.show_in_commands !== false &&
						a.meta?.type !== 'agent'
				);

				commandAbilities.forEach( ( tool ) => {
					const cmdName = `vip-workflows-cmd-${ tool.id.replace(
						'/',
						'-'
					) }`;
					registeredCommands.push( cmdName );

					registerCommand( {
						name: cmdName,
						label: sprintf(
							// translators: %s: the tool name.
							__( 'Run %s', 'vip-workflows' ),
							tool.label
						),
						callback: async ( { close } ) => {
							// Close command palette immediately
							if ( close ) {
								close();
							}

							// Show snackbar notification
							createSuccessNotice(
								sprintf(
									// translators: %s: the tool name.
									__( 'Running %s…', 'vip-workflows' ),
									tool.label
								),
								{ type: 'snackbar', isDismissible: true }
							);

							// Show blocking overlay
							setIsRunning( true );
							setRunningToolLabel( tool.label );

							const result = await runTool( tool );

							// Hide overlay
							setIsRunning( false );

							if ( result ) {
								setModalTool( tool );
								setModalResult( result );
							}
						},
					} );
				} );
			} )
			.catch( ( err ) => {
				console.warn(
					'Failed to fetch abilities for command palette:',
					err
				);
			} );

		return () => {
			if ( unregisterCommand ) {
				registeredCommands.forEach( ( name ) => {
					try {
						unregisterCommand( name );
					} catch ( e ) {
						// Ignore errors during cleanup.
					}
				} );
			}
		};
	}, [ postId, createSuccessNotice, createErrorNotice, runTool ] );

	const isHelper = modalTool?.meta?.type === 'helper';
	const canApply = Boolean( modalTool?.meta?.apply_field );

	const closeModal = () => {
		setModalResult( null );
		setModalTool( null );
	};

	return (
		<>
			{ /* Blocking overlay while tool is running - use portal to render at body level */ }
			{ isRunning &&
				createPortal(
					<div
						style={ {
							position: 'fixed',
							top: 0,
							left: 0,
							right: 0,
							bottom: 0,
							background: 'rgba(0, 0, 0, 0.6)',
							zIndex: 999999,
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							backdropFilter: 'blur(2px)',
						} }
					>
						<div
							style={ {
								background: '#fff',
								padding: '32px 48px',
								borderRadius: '8px',
								boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)',
								display: 'flex',
								flexDirection: 'column',
								alignItems: 'center',
								gap: '16px',
							} }
						>
							<div
								className="components-spinner"
								style={ { margin: 0 } }
							/>
							<div
								className="vip-workflows-command-palette-running-title"
								style={ {
									color: '#1e1e1e',
								} }
							>
								{ sprintf(
									// translators: %s: the tool name.
									__( 'Running %s…', 'vip-workflows' ),
									runningToolLabel
								) }
							</div>
							<div
								className="vip-workflows-command-palette-running-detail"
								style={ {
									color: '#757575',
								} }
							>
								{ __(
									'Please wait, this may take a moment.',
									'vip-workflows'
								) }
							</div>
						</div>
					</div>,
					document.body
				) }

			{ modalResult && isHelper && (
				<HelperResultModal
					result={ modalResult }
					toolLabel={ modalTool?.label || modalTool?.name || '' }
					onClose={ closeModal }
					onApply={ canApply ? handleApplyField : null }
					onRegenerate={ handleRegenerate }
					applying={ applying }
					regenerating={ regenerating }
					requirementGroups={ modalTool?.availability?.groups || [] }
					resultType={ modalTool?.meta?.result_type }
				/>
			) }
			{ modalResult && ! isHelper && (
				<CheckResultsModal
					result={ modalResult }
					toolLabel={ modalTool?.label || modalTool?.name || '' }
					onClose={ closeModal }
					requirementGroups={ modalTool?.availability?.groups || [] }
				/>
			) }
		</>
	);
}
