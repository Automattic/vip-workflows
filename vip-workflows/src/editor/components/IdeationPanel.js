/**
 * Ideation Panel
 *
 * Shows what a post was commissioned from, in the workflow sidebar directly
 * under the stage.
 *
 * A post that came out of ideation arrives in the editor stripped of the
 * material that justified it — the article it was started from and the research
 * the desk kept are on another screen. In practice that means the writer starts
 * from a headline and goes looking for the reporting again.
 *
 * Two things get shown, and deliberately not more. The source article is the
 * thing being written about, so it leads. Under it go only the items somebody
 * chose: pinned cards, and sources added by hand. The rest of a project is
 * assistant output that nobody has ruled on, and reprinting it here would turn
 * the sidebar into a second set of search results.
 *
 * Renders nothing at all for a post with no ideation project, which is most
 * posts.
 */

import { useState, useEffect } from '@wordpress/element';
import { ExternalLink } from '@wordpress/components';
import { Card, Text } from '@wordpress/ui';
import apiFetch from '@wordpress/api-fetch';
import { __ } from '@wordpress/i18n';

/**
 * The ideation research for the post being edited.
 *
 * @param {Object} props        Component props.
 * @param {number} props.postId Post being edited.
 * @return {Object|null} Element, or null when there is nothing to show.
 */
export function IdeationPanel( { postId } ) {
	const [ ideation, setIdeation ] = useState( null );

	useEffect( () => {
		if ( ! postId ) {
			return;
		}

		let cancelled = false;

		apiFetch( {
			path: `/vip-workflow/v1/workflow/post/${ postId }/ideation`,
		} )
			.then( ( response ) => {
				if ( ! cancelled ) {
					setIdeation( response );
				}
			} )
			.catch( () => {
				/*
				 * Silent. This panel is supplementary — it is not worth an error
				 * notice over the editor for research that failed to load, and the
				 * post is entirely editable without it.
				 */
				if ( ! cancelled ) {
					setIdeation( null );
				}
			} );

		return () => {
			cancelled = true;
		};
	}, [ postId ] );

	if ( ! ideation?.project_id ) {
		return null;
	}

	const { source, items = [] } = ideation;

	// A project with neither is a project with nothing to say here.
	if ( ! source && ! items.length ) {
		return null;
	}

	return (
		<div className="vip-workflow-panel__section vip-workflow-ideation">
			<div className="vip-workflow-panel__section-title">
				{ __( 'From Ideation', 'vip-workflow' ) }
			</div>

			{ source && (
				<Card.Root className="vip-workflow-ideation__source">
					<Card.Header>
						<Card.Title>
							{ source.url ? (
								<ExternalLink href={ source.url }>
									{ source.title }
								</ExternalLink>
							) : (
								source.title
							) }
						</Card.Title>
					</Card.Header>
					<Card.Content>
						{ source.excerpt && (
							<Text
								variant="body-sm"
								className="vip-workflow-ideation__source-excerpt"
							>
								{ source.excerpt }
							</Text>
						) }
						{ ( source.domain || source.provider ) && (
							<Text
								variant="body-sm"
								className="vip-workflow-ideation__meta"
							>
								{ source.domain || source.provider }
							</Text>
						) }
					</Card.Content>
				</Card.Root>
			) }

			{ items.length > 0 && (
				<ul className="vip-workflow-ideation__items">
					{ items.map( ( item ) => (
						<li
							key={ item.id }
							className={ `vip-workflow-ideation__item${
								item.pinned
									? ' vip-workflow-ideation__item--pinned'
									: ''
							}` }
						>
							<Text
								variant="body-sm"
								className="vip-workflow-ideation__item-title"
							>
								{ item.url ? (
									<ExternalLink href={ item.url }>
										{ item.title }
									</ExternalLink>
								) : (
									item.title
								) }
							</Text>
							{ ( item.domain || item.uploaded ) && (
								<Text
									variant="body-sm"
									className="vip-workflow-ideation__meta"
								>
									{ item.uploaded
										? __( 'Uploaded', 'vip-workflow' )
										: item.domain }
								</Text>
							) }
							{ item.excerpt && (
								<Text
									variant="body-sm"
									className="vip-workflow-ideation__item-excerpt"
								>
									{ item.excerpt }
								</Text>
							) }
						</li>
					) ) }
				</ul>
			) }

			{ ideation.url && (
				<ExternalLink
					href={ ideation.url }
					className="vip-workflow-ideation__workspace"
				>
					{ __( 'Open in Ideation', 'vip-workflow' ) }
				</ExternalLink>
			) }
		</div>
	);
}
