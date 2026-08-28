/**
 * Unit tests for InstallSkillButton after the Assistants->Agents rename.
 *
 * Locks the user-facing wiring of the skill-type key rename: the `agent` type
 * renders the "Research Agent" download label, the legacy `assistant` key no
 * longer resolves to "Research Assistant", and the button is hidden when no
 * skill content is localized for the type. JSZip is only touched on click, so
 * it is mocked away for these render-level assertions.
 */

import { render, screen } from './helpers/render-wp-component';

import InstallSkillButton from '../../src/admin/components/InstallSkillButton';

jest.mock( 'jszip', () => jest.fn() );

afterEach( () => {
	delete window.vipWorkflowAdmin;
	jest.clearAllMocks();
} );

describe( 'InstallSkillButton', () => {
	it( 'renders the "Research Agent" download label for the agent skill type', () => {
		window.vipWorkflowAdmin = { skills: { agent: '# SKILL' } };

		render( <InstallSkillButton skillType="agent" /> );

		expect(
			screen.getByRole( 'button', {
				name: /Download Research Agent skill/i,
			} )
		).toBeInTheDocument();
	} );

	it( 'renders nothing when no skill content is localized for the type', () => {
		window.vipWorkflowAdmin = { skills: {} };

		const { container } = render(
			<InstallSkillButton skillType="agent" />
		);

		expect( container ).toBeEmptyDOMElement();
		expect( screen.queryByRole( 'button' ) ).not.toBeInTheDocument();
	} );

	it( 'no longer maps the legacy "assistant" type to the Research Assistant label', () => {
		// Pre-rename callers used skillType="assistant"; that key was removed, so
		// the label must not resolve to "Research Assistant" any more.
		window.vipWorkflowAdmin = { skills: { assistant: '# SKILL' } };

		render( <InstallSkillButton skillType="assistant" /> );

		expect(
			screen.queryByRole( 'button', { name: /Research Assistant/i } )
		).not.toBeInTheDocument();
	} );
} );
