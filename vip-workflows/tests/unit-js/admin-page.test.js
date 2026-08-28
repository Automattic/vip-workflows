/**
 * Unit tests for the AdminPage scaffold.
 *
 * AdminPage reproduces WordPress core's @wordpress/admin-ui `Page` +
 * `Breadcrumbs` pattern by hand: the header is a single inline row whose
 * breadcrumb trail's final item is the page `<h1>`. These guard the branching
 * that's easy to regress: parent crumbs render as links while the current page
 * renders as the heading, the title-only (trail-less) path, the default/omitted
 * icon, the optional actions/subtitle slots, and the `constrained` column.
 *
 * Rendered under jsdom via React Testing Library and asserted against the
 * resulting `container.innerHTML`. (@wordpress/element's `renderToString` is a
 * lightweight serializer that can't render the hook-based @wordpress/ui `Text`
 * the header uses — it throws "Invalid hook call" on it; a real jsdom render
 * can.)
 */

import { render } from './helpers/render-wp-component';
import AdminPage from '../../src/admin/components/AdminPage';

const renderToString = ( ui ) => render( ui ).container.innerHTML;
const occurrences = ( html, needle ) => html.split( needle ).length - 1;

describe( 'AdminPage breadcrumbs', () => {
	it( 'renders parent entries as links and the current page as the heading', () => {
		const html = renderToString(
			<AdminPage
				breadcrumbs={ [
					{ label: 'Workflows', href: 'admin.php?page=vip-workflow' },
					{ label: 'Settings' },
				] }
			>
				body
			</AdminPage>
		);

		// Parent entry: a link with its href.
		expect( html ).toContain( 'vip-workflow-admin-page__breadcrumb-link' );
		expect( html ).toContain( 'href="admin.php?page=vip-workflow"' );
		expect( html ).toContain( '>Workflows<' );

		// Current page: the trail's final item is the page <h1>, not a link.
		expect( html ).toContain( '<h1' );
		expect( html ).toContain( 'vip-workflow-admin-page__title' );
		expect( html ).toContain( '>Settings<' );

		// One separator between the parent link and the heading.
		expect(
			occurrences( html, 'vip-workflow-admin-page__breadcrumb-separator' )
		).toBe( 1 );
	} );

	it( 'uses an explicit title as the heading over the current crumb label', () => {
		const html = renderToString(
			<AdminPage
				breadcrumbs={ [
					{ label: 'Workflows', href: 'admin.php?page=vip-workflow' },
					{ label: 'ignored-current' },
				] }
				title="Explicit Title"
			>
				body
			</AdminPage>
		);

		// The heading is the explicit title; the hrefless current crumb's own
		// label is not rendered as a second heading.
		expect( html ).toContain( '>Explicit Title<' );
		expect( html ).not.toContain( '>ignored-current<' );
	} );

	it( 'renders a trail-less title as a standalone heading (no breadcrumb nav)', () => {
		const html = renderToString(
			<AdminPage title="Coming Soon">body</AdminPage>
		);

		// With no parent links there is no breadcrumb nav — just the page <h1>.
		expect( html ).not.toContain( 'vip-workflow-admin-page__breadcrumbs' );
		expect( html ).toContain( 'vip-workflow-admin-page__title' );
		expect( html ).toContain( '>Coming Soon<' );
	} );
} );

describe( 'AdminPage icon', () => {
	it( 'omits the icon slot when no icon prop is passed', () => {
		// The breadcrumb root is text-only by default; an icon only appears
		// when a caller explicitly passes one.
		const html = renderToString(
			<AdminPage
				breadcrumbs={ [
					{ label: 'Workflows', href: 'admin.php?page=vip-workflow' },
					{ label: 'Settings' },
				] }
			>
				body
			</AdminPage>
		);
		expect( html ).not.toContain( 'vip-workflow-admin-page__icon' );
	} );

	it( 'renders the icon slot when an icon is passed', () => {
		const html = renderToString(
			<AdminPage
				breadcrumbs={ [
					{ label: 'Workflows', href: 'admin.php?page=vip-workflow' },
					{ label: 'Settings' },
				] }
				icon={ <svg className="test-icon" /> }
			>
				body
			</AdminPage>
		);
		expect( html ).toContain( 'vip-workflow-admin-page__icon' );
		expect( html ).toContain( 'test-icon' );
	} );

	it( 'omits the icon slot when icon is explicitly null', () => {
		const html = renderToString(
			<AdminPage
				breadcrumbs={ [
					{ label: 'Workflows', href: 'admin.php?page=vip-workflow' },
					{ label: 'Settings' },
				] }
				icon={ null }
			>
				body
			</AdminPage>
		);
		// The breadcrumb trail still renders (a parent link is present), but
		// with no icon.
		expect( html ).toContain( 'vip-workflow-admin-page__breadcrumbs' );
		expect( html ).not.toContain( 'vip-workflow-admin-page__icon' );
	} );
} );

describe( 'AdminPage content column', () => {
	it( 'is full-width by default', () => {
		const html = renderToString(
			<AdminPage breadcrumbs={ [ { label: 'Settings' } ] }>
				body
			</AdminPage>
		);
		expect( html ).toContain( 'vip-workflow-admin-page__content' );
		expect( html ).not.toContain( 'is-constrained' );
	} );

	it( 'caps the content column when constrained', () => {
		const html = renderToString(
			<AdminPage breadcrumbs={ [ { label: 'Settings' } ] } constrained>
				body
			</AdminPage>
		);
		expect( html ).toContain( 'is-constrained' );
	} );
} );

describe( 'AdminPage optional slots', () => {
	it( 'omits actions and subtitle when not provided', () => {
		const html = renderToString(
			<AdminPage breadcrumbs={ [ { label: 'Settings' } ] }>
				body
			</AdminPage>
		);
		expect( html ).not.toContain( 'vip-workflow-admin-page__actions' );
		expect( html ).not.toContain( 'vip-workflow-admin-page__subtitle' );
	} );

	it( 'renders actions and subtitle when provided', () => {
		const html = renderToString(
			<AdminPage
				breadcrumbs={ [ { label: 'Settings' } ] }
				subtitle="Configure things."
				actions={ <button>Save</button> }
			>
				body
			</AdminPage>
		);
		expect( html ).toContain( 'vip-workflow-admin-page__actions' );
		expect( html ).toContain( '>Save<' );
		expect( html ).toContain( 'vip-workflow-admin-page__subtitle' );
		expect( html ).toContain( 'Configure things.' );
	} );
} );
