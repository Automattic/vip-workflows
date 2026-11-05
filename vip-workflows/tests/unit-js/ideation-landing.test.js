/**
 * The Ideation landing renders inside the shared AdminPage scaffold.
 *
 * The project's canonical content width is a custom property declared on
 * `.vip-workflows-admin-page`, so a screen only inherits it by rendering inside
 * that scaffold. The landing used to render outside it and cap its own column
 * at a different width; these guard that it now sits in the constrained
 * column, and that the scaffold's header is the page's only `<h1>`.
 *
 * @package
 */

import { render, screen } from './helpers/render-wp-component';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

// The landing's data-driven sections and the workspace are covered by their
// own tests; stub them so this one exercises only the page structure.
jest.mock( '../../src/admin/components/ideation/IdeationWorkspace', () =>
	jest.fn( () => null )
);
jest.mock( '../../src/admin/components/ideation/StoryDiscovery', () =>
	jest.fn( () => null )
);
jest.mock( '../../src/admin/components/ideation/RecentProjects', () =>
	jest.fn( () => null )
);

// eslint-disable-next-line import/first
import Ideation from '../../src/admin/pages/Ideation';

describe( 'Ideation landing', () => {
	it( 'renders the landing column inside the constrained AdminPage content', () => {
		const { container } = render(
			<Ideation route={ {} } onNavigate={ () => {} } />
		);

		const landing = container.querySelector(
			'.vip-workflows-ideation-landing'
		);
		expect( landing ).not.toBeNull();
		expect(
			landing.closest(
				'.vip-workflows-admin-page .vip-workflows-admin-page__content-inner.is-constrained'
			)
		).not.toBeNull();
	} );

	it( 'leaves the page heading to the scaffold header', () => {
		render( <Ideation route={ {} } onNavigate={ () => {} } /> );

		const pageHeadings = screen.getAllByRole( 'heading', { level: 1 } );
		expect( pageHeadings ).toHaveLength( 1 );
		expect( pageHeadings[ 0 ] ).toHaveTextContent( 'Ideation' );

		// The seed prompt stays as the landing's hero, one level down.
		expect(
			screen.getByRole( 'heading', {
				level: 2,
				name: 'What’s the story?',
			} )
		).toBeInTheDocument();
	} );
} );
