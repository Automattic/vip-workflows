/**
 * A stand-in for `@wordpress/editor`, for tests that open the pre-publish step.
 *
 * The real package pulls @wordpress/blocks, whose ESM-only dependencies Jest
 * cannot parse, so test files mock it. Most need only the store's name. The
 * pre-publish step (PrePublishConfirm) also renders the `PluginPrePublishPanel`
 * slot and core's visibility label, so this gives it a working slot — built
 * the way core builds it, from `createSlotFill` under core's name — and a
 * fixed label.
 *
 * Use it from a hoisted mock, which may only `require`:
 *
 *   jest.mock( '@wordpress/editor', () =>
 *       require( './helpers/editor-package' )
 *   );
 *
 * The test must render inside a `SlotFillProvider`.
 *
 * @package
 */

import { createSlotFill } from '@wordpress/components';

const { Fill, Slot } = createSlotFill( 'PluginPrePublishPanel' );

/**
 * Core's fill component, without its panel chrome.
 *
 * @param {Object}      props          Component props.
 * @param {JSX.Element} props.children What the plugin shows.
 * @return {JSX.Element} The fill.
 */
export function PluginPrePublishPanel( { children } ) {
	return <Fill>{ children }</Fill>;
}

PluginPrePublishPanel.Slot = Slot;

/**
 * Core's visibility label, fixed.
 *
 * @return {string} The label.
 */
export function PostVisibilityLabel() {
	return 'Public';
}

export const store = 'core/editor';
