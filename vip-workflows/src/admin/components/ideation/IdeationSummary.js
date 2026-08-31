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

	let generateLabel = __( 'Generate summary', 'vip-workflows' );
	if ( generating ) {
		generateLabel = __( 'Generating…', 'vip-workflows' );
	} else if ( summary ) {
		generateLabel = __( 'Regenerate', 'vip-workflows' );
	}

	const renderBody = () => {
		if ( loading ) {
			return (
				<Stack align="center" gap="sm">
					<Spinner />
					<Text variant="body-sm">
						{ __( 'Loading…', 'vip-workflows' ) }
					</Text>
				</Stack>
			);
		}

		if ( summary ) {
			return (
				<Stack direction="column" gap="md">
					<div className="vip-workflows-ideation-summary__content">
						<Stack
							justify="flex-end"
							className="vip-workflows-ideation-summary__actions"
						>
							<Button
								icon={ copy }
								size="small"
								variant="tertiary"
								onClick={ () => handleCopy( fullText ) }
							>
								{ copiedText
									? __( 'Copied!', 'vip-workflows' )
									: __( 'Copy', 'vip-workflows' ) }
							</Button>
						</Stack>
						{ /* wpds-allow R7 -- rendered summary body with custom line-height; no matching Text variant */ }
						<MarkdownText
							text={ summary }
							className="vip-workflows-ideation-summary__text"
						/>
						{ keyPoints && keyPoints.length > 0 && (
							// wpds-allow R7 -- section with top divider (border/padding); not a pure flex container
							<div className="vip-workflows-ideation-summary__keypoints">
								<Text
									variant="body-sm"
									className="vip-workflows-ideation-summary__keypoints-label"
								>
									{ __( 'Key Points', 'vip-workflows' ) }
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
				className="vip-workflows-ideation-summary__empty"
			>
				{ hasPinnedSources
					? __(
							'No summary yet. Click "Generate summary" to create one from your pinned sources.',
							'vip-workflows'
					  )
					: __(
							'Pin some sources first, then generate a summary.',
							'vip-workflows'
					  ) }
			</Text>
		);
	};

	return (
		<Card.Root className="vip-workflows-ideation-summary">
			<Card.Header>
				<Card.Title>
					{ __( 'Project Summary', 'vip-workflows' ) }
				</Card.Title>
				<Button
					variant="secondary"
					onClick={ onGenerate }
					isBusy={ generating }
					disabled={ generating || loading || ! hasPinnedSources }
					className="vip-workflows-ideation-summary__generate"
				>
					{ generateLabel }
				</Button>
			</Card.Header>
			<Card.Content>{ renderBody() }</Card.Content>
		</Card.Root>
	);
}
