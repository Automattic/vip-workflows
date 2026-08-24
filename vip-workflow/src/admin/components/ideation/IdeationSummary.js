/**
 * Ideation Summary Component.
 *
 * Displays the project-level summary at the bottom of the workspace,
 * with the ability to generate or regenerate it from pinned sources.
 */

import { __ } from '@wordpress/i18n';
import { Button, Spinner } from '@wordpress/components';
import { Card, Stack, Text } from '@wordpress/ui';
import { copy } from '@wordpress/icons';
import { useState } from '@wordpress/element';

import { MarkdownText } from '../markdown';

import './IdeationSummary.css';

export default function IdeationSummary( {
	summary,
	keyPoints,
	loading,
	generating,
	onGenerate,
	hasPinnedSources,
} ) {
	const [ copiedText, setCopiedText ] = useState( null );

	const handleCopy = ( text ) => {
		navigator.clipboard.writeText( text );
		setCopiedText( text );
		setTimeout( () => setCopiedText( null ), 2000 );
	};

	const fullText = [
		summary || '',
		...( keyPoints || [] ).map( ( p ) => `- ${ p }` ),
	].join( '\n\n' );

	let generateLabel = __( 'Generate summary', 'vip-workflow' );
	if ( generating ) {
		generateLabel = __( 'Generating…', 'vip-workflow' );
	} else if ( summary ) {
		generateLabel = __( 'Regenerate', 'vip-workflow' );
	}

	const renderBody = () => {
		if ( loading ) {
			return (
				<Stack align="center" gap="sm">
					<Spinner />
					<Text variant="body-sm">
						{ __( 'Loading…', 'vip-workflow' ) }
					</Text>
				</Stack>
			);
		}

		if ( summary ) {
			return (
				<Stack direction="column" gap="md">
					<div className="vip-workflow-ideation-summary__content">
						<Stack
							justify="flex-end"
							className="vip-workflow-ideation-summary__actions"
						>
							<Button
								icon={ copy }
								size="small"
								variant="tertiary"
								onClick={ () => handleCopy( fullText ) }
							>
								{ copiedText
									? __( 'Copied!', 'vip-workflow' )
									: __( 'Copy', 'vip-workflow' ) }
							</Button>
						</Stack>
						{ /* wpds-allow R7 -- rendered summary body with custom line-height; no matching Text variant */ }
						<MarkdownText
							text={ summary }
							className="vip-workflow-ideation-summary__text"
						/>
						{ keyPoints && keyPoints.length > 0 && (
							// wpds-allow R7 -- section with top divider (border/padding); not a pure flex container
							<div className="vip-workflow-ideation-summary__keypoints">
								<Text
									variant="body-sm"
									className="vip-workflow-ideation-summary__keypoints-label"
								>
									{ __( 'Key Points', 'vip-workflow' ) }
								</Text>
								<ul>
									{ keyPoints.map( ( point, i ) => (
										<li key={ i }>{ point }</li>
									) ) }
								</ul>
							</div>
						) }
					</div>
				</Stack>
			);
		}

		return (
			<Text
				variant="body-sm"
				className="vip-workflow-ideation-summary__empty"
			>
				{ hasPinnedSources
					? __(
							'No summary yet. Click "Generate summary" to create one from your pinned sources.',
							'vip-workflow'
					  )
					: __(
							'Pin some sources first, then generate a summary.',
							'vip-workflow'
					  ) }
			</Text>
		);
	};

	return (
		<Card.Root className="vip-workflow-ideation-summary">
			<Card.Header>
				<Card.Title>
					{ __( 'Project Summary', 'vip-workflow' ) }
				</Card.Title>
				<Button
					variant="secondary"
					onClick={ onGenerate }
					isBusy={ generating }
					disabled={ generating || loading || ! hasPinnedSources }
					className="vip-workflow-ideation-summary__generate"
				>
					{ generateLabel }
				</Button>
			</Card.Header>
			<Card.Content>{ renderBody() }</Card.Content>
		</Card.Root>
	);
}
