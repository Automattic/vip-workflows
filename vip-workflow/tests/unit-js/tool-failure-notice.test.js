/**
 * ToolFailureNotice — which explanation a failed tool shows.
 *
 * A tool refused for
 * unmet requirements must explain what is missing, not repeat the executor's
 * deliberately generic placeholder.
 *
 * @package
 */

import '@testing-library/jest-dom';
import { render, within } from '@testing-library/react';

/*
 * Queries are scoped to the render container on purpose. @wordpress/components'
 * Notice mirrors its text into an aria-live region appended to document.body,
 * so an unscoped screen.getByText() finds the same string twice and throws.
 */

import { ToolFailureNotice } from '../../src/editor/components/ToolResultModals';

describe( 'ToolFailureNotice', () => {
	const requirementGroups = [
		{
			satisfy: 'all',
			requirements: [
				{
					id: 'credentials:parsely',
					kind: 'dependency',
					sources: [ 'Parse.ly' ],
					admin_reason:
						'Parse.ly is missing its Site ID or API Secret.',
					user_message:
						'Parse.ly is not connected. Ask an administrator to finish setting it up.',
				},
			],
		},
	];

	it( 'shows the generic error when the ability reported no requirements', () => {
		const { container } = render(
			<ToolFailureNotice
				error="Ability is not configured."
				requirementGroups={ [] }
				toolLabel="Smart Linking"
			/>
		);

		expect(
			within( container ).getByText( 'Ability is not configured.' )
		).toBeInTheDocument();
	} );

	it( 'explains what is missing when requirements are present', () => {
		const { container } = render(
			<ToolFailureNotice
				error="Ability is not configured."
				requirementGroups={ requirementGroups }
				toolLabel="Smart Linking"
			/>
		);

		// The specific reason reaches the reader.
		expect(
			within( container ).getAllByText( /Parse\.ly/ ).length
		).toBeGreaterThan( 0 );
	} );

	it( 'does not fall back to the placeholder once it has something better to say', () => {
		const { container } = render(
			<ToolFailureNotice
				error="Ability is not configured."
				requirementGroups={ requirementGroups }
				toolLabel="Smart Linking"
			/>
		);

		expect(
			within( container ).queryByText( 'Ability is not configured.' )
		).not.toBeInTheDocument();
	} );

	it( 'treats an omitted requirementGroups prop as no requirements', () => {
		const { container } = render(
			<ToolFailureNotice
				error="Something went wrong."
				toolLabel="Smart Linking"
			/>
		);

		expect(
			within( container ).getByText( 'Something went wrong.' )
		).toBeInTheDocument();
	} );
} );
