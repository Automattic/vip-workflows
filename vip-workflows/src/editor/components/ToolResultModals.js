/**
 * Tool Result Modals
 *
 * Shared modal components for displaying tool results.
 *
 * @package
 */

import { Modal, Button, Icon, Notice } from '@wordpress/components';
import { Badge, Link, Stack, Text } from '@wordpress/ui';
import { published, cancelCircleFilled } from '@wordpress/icons';
import { __ } from '@wordpress/i18n';

import { ModalActions } from '../../common/ModalActions';
import { AgentRequirements } from '../../common/AgentRequirements';
import { resolveToolResult } from '../../common/resolve-tool-result';

import './ToolResultModals.css';

/**
 * The failure notice for a tool that did not run.
 *
 * Two different failures reach this spot and they deserve different answers.
 * A tool that ran and errored has a real message worth showing. A tool that was
 * refused for unmet requirements has only `AbilityExecutor`'s deliberately
 * generic placeholder — "Ability is not configured." — because the stored row
 * must not freeze either audience's wording. For that case the wording is
 * derived here from the ability's live availability, which is what the executor
 * always intended and what the Agents card already does.
 *
 * Falls back to the generic line when an ability's callback returned a bare
 * `false`: no requirements means there is genuinely nothing more to say.
 *
 * @param {Object} props                   Component props.
 * @param {string} props.error             The stored error line.
 * @param {Array}  props.requirementGroups Serialized requirement groups from live availability.
 * @param {string} props.toolLabel         The tool's own name, to suppress self-referential attribution.
 * @return {JSX.Element} The rendered failure notice.
 */
export function ToolFailureNotice( {
	error,
	requirementGroups = [],
	toolLabel,
} ) {
	if ( requirementGroups.length > 0 ) {
		return (
			<Notice status="error" isDismissible={ false }>
				<AgentRequirements
					groups={ requirementGroups }
					ownerLabel={ toolLabel }
				/>
			</Notice>
		);
	}

	return (
		<Notice status="error" isDismissible={ false }>
			{ error }
		</Notice>
	);
}

/**
 * Check Results Modal Component - for Check-type tools.
 *
 * @param {Object}   props                   Component props.
 * @param {Object}   props.result            Tool result with summary, output, and error fields.
 * @param {string}   props.toolLabel         Display label shown as the modal title.
 * @param {Function} props.onClose           Callback invoked to close the modal.
 * @param {Array}    props.requirementGroups Live availability groups, when the tool was refused.
 * @return {JSX.Element} The rendered check results modal.
 */
export function CheckResultsModal( {
	result,
	toolLabel,
	onClose,
	requirementGroups = [],
} ) {
	const { summary, output = {}, error } = result;
	const { score, status, issues = [], suggestions = [] } = output;

	/*
	 * An absent status used to render as "Fail", so an ability that returned
	 * findings without a verdict was reported as failing. Absence of a verdict is
	 * not a negative verdict — it is the same guess-from-absence that produced the
	 * bugs in the helper modal.
	 */
	const statusLabels = {
		pass: __( 'Pass', 'vip-workflows' ),
		warning: __( 'Warning', 'vip-workflows' ),
		fail: __( 'Fail', 'vip-workflows' ),
	};
	const statusLabel =
		statusLabels[ status ] || __( 'No verdict', 'vip-workflows' );

	// Map the overall status to a Badge intent.
	let statusIntent = 'neutral';
	if ( status === 'pass' ) {
		statusIntent = 'stable';
	} else if ( status === 'warning' ) {
		statusIntent = 'medium';
	} else if ( status === 'fail' ) {
		statusIntent = 'high';
	}

	// Map the score color to a tone modifier class.
	let scoreToneClass = '';
	if ( status === 'pass' ) {
		scoreToneClass = 'vip-workflows-results-modal__score--pass';
	} else if ( status === 'warning' ) {
		scoreToneClass = 'vip-workflows-results-modal__score--warning';
	} else if ( status === 'fail' ) {
		scoreToneClass = 'vip-workflows-results-modal__score--fail';
	}

	return (
		<Modal
			title={ toolLabel }
			onRequestClose={ onClose }
			className="vip-workflows-results-modal vip-workflows-modal--truncate-title"
			size="large"
		>
			{ error ? (
				<ToolFailureNotice
					error={ error }
					requirementGroups={ requirementGroups }
					toolLabel={ toolLabel }
				/>
			) : (
				<Stack direction="column" gap="md">
					<Stack direction="row" align="center" gap="lg">
						{ typeof score === 'number' && (
							<div
								className={ `vip-workflows-results-modal__score ${ scoreToneClass }` }
							>
								{ score }
								<Text
									variant="body-md"
									className="vip-workflows-results-modal__score-total"
								>
									/100
								</Text>
							</div>
						) }
						<Badge intent={ statusIntent }>{ statusLabel }</Badge>
					</Stack>

					{ summary && (
						<Text className="vip-workflows-results-modal__summary">
							{ summary }
						</Text>
					) }

					{ issues.length > 0 && (
						<Stack direction="column" gap="sm">
							<Text variant="heading-sm" render={ <h4 /> }>
								{ __( 'Results', 'vip-workflows' ) }
							</Text>
							<Stack direction="column" gap="md">
								{ issues.map( ( issue, i ) => {
									// Check if issue has structured data (rule + status).
									const hasStructuredData =
										issue.rule && issue.status;

									if ( hasStructuredData ) {
										// Structured issue format.
										const isPass =
											issue.status === 'passed';
										const isFail =
											issue.status === 'failed';

										let explanation = issue.message || '';
										if (
											isFail &&
											issue.examples &&
											issue.examples.length > 0
										) {
											explanation +=
												' → Found: ' +
												issue.examples
													.map(
														( ex ) => `"${ ex }"`
													)
													.join( ', ' );
										}

										let issueToneClass = '';
										if ( isPass ) {
											issueToneClass =
												'vip-workflows-results-modal__issue--pass';
										} else if ( isFail ) {
											issueToneClass =
												'vip-workflows-results-modal__issue--fail';
										}

										return (
											<Stack
												key={ i }
												className={ `vip-workflows-results-modal__issue ${ issueToneClass }` }
												direction="column"
												gap="sm"
											>
												<Stack
													direction="row"
													align="center"
													gap="sm"
												>
													<Icon
														icon={
															isPass
																? published
																: cancelCircleFilled
														}
														size={ 20 }
													/>
													{ /* wpds-allow R7 -- 11px heading type without the uppercase that <Text variant="heading-sm"> forces; a rule id is quoted verbatim. */ }
													<span className="vip-workflows-results-modal__issue-rule">
														{ issue.rule }
													</span>
													<Badge
														intent={
															isPass
																? 'stable'
																: 'high'
														}
													>
														{ isPass
															? __(
																	'Passed',
																	'vip-workflows'
															  )
															: __(
																	'Failed',
																	'vip-workflows'
															  ) }
													</Badge>
												</Stack>
												{ explanation && (
													<Text
														variant="body-sm"
														className="vip-workflows-results-modal__issue-explanation"
													>
														{ explanation }
													</Text>
												) }
											</Stack>
										);
									}

									// Fallback: simple text display for unstructured issues.
									return (
										// wpds-allow R7 -- unstructured issue text on a tinted surface; <Text> exposes neither background nor radius.
										<div
											key={ i }
											className="vip-workflows-results-modal__issue-text"
										>
											{ issue.message || issue }
										</div>
									);
								} ) }
							</Stack>
						</Stack>
					) }

					{ suggestions.length > 0 && (
						<Stack direction="column" gap="sm">
							<Text variant="heading-sm" render={ <h4 /> }>
								{ __( 'Suggestions', 'vip-workflows' ) }
							</Text>
							<Stack
								className="vip-workflows-results-modal__suggestions"
								direction="column"
								gap="sm"
								render={ <ul /> }
							>
								{ suggestions.map( ( sug, i ) => (
									<Text
										key={ i }
										variant="body-md"
										render={ <li /> }
									>
										{ sug.message || sug }
									</Text>
								) ) }
							</Stack>
						</Stack>
					) }
				</Stack>
			) }

			<ModalActions>
				<Button variant="primary" onClick={ onClose }>
					{ __( 'Close', 'vip-workflows' ) }
				</Button>
			</ModalActions>
		</Modal>
	);
}

/**
 * Helper Result Modal Component - for Helper-type tools that generate content.
 *
 * @param {Object}   props                   Component props.
 * @param {Object}   props.result            Tool result with output, summary, and error fields.
 * @param {string}   props.toolLabel         Display label shown as the modal title.
 * @param {Function} props.onClose           Callback invoked to close the modal.
 * @param {Function} props.onApply           Callback invoked with the generated content to apply it.
 * @param {Function} props.onRegenerate      Callback invoked to regenerate the content.
 * @param {boolean}  props.applying          Whether the apply action is in progress.
 * @param {boolean}  props.regenerating      Whether the regenerate action is in progress.
 * @param {Array}    props.requirementGroups Live availability groups, when the tool was refused.
 * @param {?string}  props.resultType        The ability's declared `result_type` — 'value', 'list' or 'report'. Unset falls back to inference, so tools written before the contract are unaffected.
 * @return {JSX.Element} The rendered helper result modal.
 */
export function HelperResultModal( {
	result,
	toolLabel,
	onClose,
	onApply,
	onRegenerate,
	applying,
	regenerating,
	requirementGroups = [],
	resultType,
} ) {
	/*
	 * What the ability says it returned, rather than what its output keys hint
	 * at. See resolve-tool-result.js for why: probing keys in priority order is
	 * what rendered an empty modal for a successful run and what set a post title
	 * to "5 suggested headlines."
	 *
	 * An ability that declares no `result_type` resolves exactly as it did
	 * before, so nothing written prior to this contract changes behaviour.
	 */
	const resolved = resolveToolResult( { result, resultType } );

	const { summary, items: suggestions, error } = resolved;

	// Only a single-value result has something the footer can apply. A list is
	// chosen from per row and has no whole-result value.
	const applicableValue = resolved.value;

	let body;

	if ( error ) {
		body = (
			<ToolFailureNotice
				error={ error }
				requirementGroups={ requirementGroups }
				toolLabel={ toolLabel }
			/>
		);
	} else if ( suggestions.length > 0 ) {
		body = (
			<Stack direction="column" gap="md">
				{ summary && (
					<Text className="vip-workflows-results-modal__summary">
						{ result.summary }
					</Text>
				) }
				<Stack
					className="vip-workflows-results-modal__suggestions"
					direction="column"
					gap="sm"
					render={ <ul /> }
				>
					{ suggestions.map( ( sug, i ) => {
						// Rows arrive normalized, each carrying whether it is a
						// bare value a field can be set to. See
						// resolve-tool-result.js.
						const { label, meta, href } = sug;
						const applicable = onApply && sug.applicable;

						return (
							<Stack
								key={ i }
								className="vip-workflows-results-modal__suggestion"
								direction="row"
								align="flex-start"
								justify="space-between"
								gap="md"
								render={ <li /> }
							>
								<Stack
									className="vip-workflows-results-modal__suggestion-body"
									direction="column"
									gap="xs"
								>
									<Text
										variant="body-md"
										className="vip-workflows-results-modal__suggestion-label"
									>
										{ label }
									</Text>
									{ meta && (
										// wpds-allow R7 -- truncating secondary line (ellipsis + nowrap); <Text> exposes no truncation prop, so the same CSS would remain.
										<span className="vip-workflows-results-modal__suggestion-meta">
											{ href ? (
												<Link
													href={ href }
													openInNewTab
													rel="noopener noreferrer"
												>
													{ meta }
												</Link>
											) : (
												meta
											) }
										</span>
									) }
								</Stack>
								{ applicable && (
									<Button
										variant="link"
										size="small"
										className="vip-workflows-results-modal__suggestion-apply"
										// The row's value, not the row. Rows are
										// objects now, and applying one would
										// write `[object Object]` into a field.
										onClick={ () => onApply( label ) }
										disabled={ applying }
									>
										{ __( 'Use this', 'vip-workflows' ) }
									</Button>
								) }
							</Stack>
						);
					} ) }
				</Stack>
			</Stack>
		);
	} else {
		body = (
			// wpds-allow R7 -- generated-content panel: a tinted surface with a brand accent bar; <Stack> draws neither and <Text> has no surface props.
			<div className="vip-workflows-results-modal__generated">
				{ resolved.value }
			</div>
		);
	}

	return (
		<Modal
			title={ toolLabel }
			onRequestClose={ onClose }
			className="vip-workflows-results-modal vip-workflows-modal--truncate-title"
			size="large"
		>
			{ body }

			<ModalActions>
				<Button variant="tertiary" onClick={ onClose }>
					{ __( 'Cancel', 'vip-workflows' ) }
				</Button>
				<Button
					variant="secondary"
					onClick={ onRegenerate }
					isBusy={ regenerating }
					disabled={ regenerating || applying }
				>
					{ __( 'Regenerate', 'vip-workflows' ) }
				</Button>
				{ applicableValue && ! error && onApply && (
					<Button
						variant="primary"
						onClick={ () => onApply( applicableValue ) }
						isBusy={ applying }
						disabled={ applying || regenerating }
					>
						{ __( 'Use this', 'vip-workflows' ) }
					</Button>
				) }
			</ModalActions>
		</Modal>
	);
}
