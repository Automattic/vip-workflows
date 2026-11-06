/**
 * Where the Summary rows go when core's Summary panel cannot show them.
 *
 * The Workflow row and the metadata rows live in the document sidebar's Summary
 * panel, through `PluginPostStatusInfo`. That slot is not always rendered:
 *
 * - `removeEditorPanel( 'post-status' )` removes it. Core's classic Summary and
 *   its DataForm Summary both skip the slot while that panel is removed. It is
 *   a programmatic removal only: Preferences → Panels offers no switch for the
 *   Summary panel, and `toggleEditorPanelEnabled( 'post-status' )` changes
 *   nothing that either Summary reads.
 * - Some Gutenberg plugin releases ship an experimental DataForm Summary for
 *   posts and pages (`window.__experimentalDataFormInspector`) that draws no
 *   `PluginPostStatusInfo` slot. Later releases draw the slot, and the
 *   stabilized Summary draws it too.
 *
 * Without the rows, an author cannot assign or remove a workflow or fill a
 * required field, which can block a publish move or strand an orphaned post
 * without its only recovery control. So the workflow sidebar carries the same
 * rows, the same component, in those configurations.
 *
 * Whether the rows are mounted in the Summary panel is read from the fill
 * itself: `SummaryRowsFill` counts itself in the editor store while it is
 * mounted. That alone cannot answer the question, because the document sidebar
 * and the workflow sidebar share one complementary area: while the workflow
 * sidebar is open the Summary panel is never mounted, so "not mounted now"
 * would put a second copy in the sidebar for every author. The fallback is
 * therefore drawn only where the slot cannot render, and never while the fill
 * is mounted:
 *
 * - the `post-status` panel is removed (reactive: a plugin may remove it after
 *   load), or
 * - the experimental DataForm Summary is active for this post type and the fill
 *   has not mounted once this session. An experiment build that does draw the
 *   slot mounts the fill the first time the document sidebar opens, and the
 *   fallback is withdrawn from then on.
 *
 * Both answers are synchronous store and window reads, so there is no load-time
 * flash of a second copy.
 *
 * @package
 */

import { useLayoutEffect } from '@wordpress/element';
import { useDispatch, useSelect } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { Stack, Text } from '@wordpress/ui';
import { __ } from '@wordpress/i18n';

import { STORE_NAME } from '../store';
import { WorkflowSummaryRows } from './WorkflowSummaryRows';

/**
 * The post types core draws the experimental DataForm Summary for.
 */
const DATAFORM_SUMMARY_POST_TYPES = [ 'post', 'page' ];

/**
 * The Summary rows as mounted inside core's Summary panel, counted in the store
 * while they are.
 *
 * A layout effect, so the count moves in the same commit the rows appear in.
 *
 * @return {JSX.Element} The rows.
 */
export function SummaryRowsFill() {
	const { mountSummaryRows, unmountSummaryRows } = useDispatch( STORE_NAME );

	useLayoutEffect( () => {
		mountSummaryRows();
		return () => unmountSummaryRows();
	}, [ mountSummaryRows, unmountSummaryRows ] );

	return <WorkflowSummaryRows />;
}

/**
 * Whether the workflow sidebar has to carry the Summary rows itself.
 *
 * @return {boolean} True where core's Summary panel cannot show them.
 */
export function useSummaryRowsFallback() {
	return useSelect( ( select ) => {
		const s = select( STORE_NAME );

		// Never two copies: while the fill is mounted, it is the one.
		if ( s.areSummaryRowsMounted() ) {
			return false;
		}

		if ( select( editorStore ).isEditorPanelRemoved( 'post-status' ) ) {
			return true;
		}

		return (
			!! window?.__experimentalDataFormInspector &&
			DATAFORM_SUMMARY_POST_TYPES.includes( s.getPostType() ) &&
			! s.haveSummaryRowsMounted()
		);
	}, [] );
}

/**
 * The Summary rows in the workflow sidebar, where the Summary panel cannot
 * show them. Renders nothing otherwise.
 *
 * @return {JSX.Element|null} The section, or null.
 */
export function SummaryRowsFallback() {
	const needed = useSummaryRowsFallback();

	if ( ! needed ) {
		return null;
	}

	return (
		<Stack
			render={
				<section aria-labelledby="vip-workflows-sidebar-details" />
			}
			className="vip-workflows-sidebar__details"
			direction="column"
			gap="md"
		>
			<Text
				variant="heading-sm"
				render={ <h3 id="vip-workflows-sidebar-details" /> }
				className="vip-workflows-eyebrow"
			>
				{ __( 'Details', 'vip-workflows' ) }
			</Text>
			<WorkflowSummaryRows grouped={ false } />
		</Stack>
	);
}
