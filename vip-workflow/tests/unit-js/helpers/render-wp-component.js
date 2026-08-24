/**
 * Shared harness for React Testing Library unit tests of components built on the
 * WordPress components library, under jsdom.
 *
 * Importing this module:
 *   - registers the jest-dom matchers (toBeInTheDocument, etc.)
 *   - installs jsdom polyfills for browser APIs the WordPress components rely on
 *     (window.matchMedia, ResizeObserver) that jsdom does not implement.
 *
 * It re-exports the RTL primitives (render, screen, fireEvent, act, within,
 * waitFor, …) so a test only needs a single import.
 *
 * Two constraints this harness CANNOT solve for you — handle them per-test:
 *
 *   1. Heavy WP module imports. A component that imports the WordPress data,
 *      core-data, or editor packages at module scope pulls untransformed ESM
 *      (parsel-js via block-editor) that Jest fails to parse. Mock those modules
 *      in the test file with jest.mock(...) (hoisted), stubbing only what the
 *      component uses. See chat-history.test.js.
 *
 *   2. Popovers still cannot be opened (DropdownMenu, Popover, and anything
 *      built on them): they measure the viewport, which jsdom does not lay out,
 *      and the jest-console preset fails the test on the resulting
 *      console.error. Assert on the rendered control + its attributes instead
 *      and cover those flows with e2e. Inline suggestion lists — ComboboxControl
 *      and FormTokenField, which render into the DOM rather than a popover —
 *      are fine to open here (see the scrollIntoView polyfill below).
 *
 * @package
 */

import '@testing-library/jest-dom';

/**
 * Install jsdom stubs for browser APIs @wordpress/components relies on.
 *
 * Idempotent and safe to call repeatedly. Runs automatically on import so a
 * test only needs to import from this module; exported as well for tests that
 * want to be explicit in a beforeAll.
 */
export function installWpJsdomPolyfills() {
	if ( ! window.matchMedia ) {
		window.matchMedia = () => ( {
			matches: false,
			media: '',
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => false,
		} );
	}

	if ( ! global.ResizeObserver ) {
		global.ResizeObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {}
		};
	}

	// jsdom implements no layout, so it ships no scrollIntoView. Suggestion
	// lists (ComboboxControl, FormTokenField) call it on the highlighted item
	// as they render, and the resulting TypeError takes the list down.
	if ( ! Element.prototype.scrollIntoView ) {
		Element.prototype.scrollIntoView = () => {};
	}
}

installWpJsdomPolyfills();

export * from '@testing-library/react';
