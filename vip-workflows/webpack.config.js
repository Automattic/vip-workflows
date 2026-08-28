const defaultConfig = require( '@wordpress/scripts/config/webpack.config' );
const CopyWebpackPlugin = require( 'copy-webpack-plugin' );
const path = require( 'path' );

const dataviewsStyle = path.join(
	path.dirname( require.resolve( '@wordpress/dataviews/package.json' ) ),
	'build-style'
);

// WPDS design tokens stylesheet — declares every `--wpds-*` custom property on
// `:root`. Same externalization caveat as DataViews below (a `@wordpress/*`
// request, so it can't be imported from JS); copy it in and enqueue it (see
// class-admin.php).
const wpdsTokens = require.resolve( '@wordpress/theme/design-tokens.css' );

module.exports = {
	...defaultConfig,
	// Every build entry the plugin ships. `admin` and `editor` are the roots of
	// their own page trees, so they stay in `src/admin/` and `src/editor/`. The
	// two below have no page tree of their own — they exist only to be built and
	// enqueued by PHP — so they live together in `src/entries/`, which keeps
	// build entries out of the shared `src/common/` and `src/styles/`
	// directories. Entry names are the built filenames PHP enqueues by; do not
	// change them.
	entry: {
		admin: path.resolve( __dirname, 'src/admin/index.js' ),
		editor: path.resolve( __dirname, 'src/editor/index.js' ),
		// The shared workflow side-effect decision table and copy. Built as its
		// own entry because the classic list-table surfaces (Quick Edit, Bulk
		// Edit) consume it through the `vipWorkflowSideEffect` global from an
		// inline script that cannot import — see class-posts-columns.php, which
		// enqueues build/side-effect.js off build/side-effect.asset.php.
		'side-effect': path.resolve(
			__dirname,
			'src/entries/confirm-workflow-side-effect.js'
		),
		// Styles for the classic wp-admin screens (Dashboard widget, posts
		// columns). A CSS-only entry: those screens load none of our bundles, so
		// there is no JS for the stylesheet to ride in on, but it still has to be
		// built rather than served raw from src/ — the build is what minifies it
		// and injects the PostCSS token fallbacks that raw src/ CSS never gets.
		'classic-admin': path.resolve(
			__dirname,
			'src/entries/classic-admin.css'
		),
	},
	output: {
		path: path.resolve( __dirname, 'build' ),
		filename: '[name].js',
	},
	plugins: [
		...defaultConfig.plugins,
		// DataViews ships its own stylesheet, but the dependency-extraction
		// plugin externalizes every `@wordpress/*` request (CSS included), so it
		// cannot be imported from JS. Copy the matching styles for the pinned
		// package version into build/ and enqueue them (see class-admin.php).
		new CopyWebpackPlugin( {
			patterns: [
				{
					from: path.join( dataviewsStyle, 'style.css' ),
					to: 'dataviews.css',
				},
				{
					from: path.join( dataviewsStyle, 'style-rtl.css' ),
					to: 'dataviews-rtl.css',
				},
				// WPDS design tokens (direction-agnostic, no RTL variant).
				{
					from: wpdsTokens,
					to: 'wpds-design-tokens.css',
				},
			],
		} ),
	],
	performance: {
		// The admin shell and its lazily-loaded page chunks legitimately exceed
		// webpack's 244 KiB default budget. Raise the ceiling so normal bundle
		// sizes build quietly, while a genuine regression past ~585 KiB still
		// warns.
		maxEntrypointSize: 600000,
		maxAssetSize: 600000,
	},
};
