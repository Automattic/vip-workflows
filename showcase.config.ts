/**
 * Showcase manifest — presentation captures of the sequence graph editor.
 *
 * Targets the already-running wp-env dev site (port 8888) rather than booting
 * a Playground: the dev site carries the imported "Multimedia Production" demo
 * sequence (docs/demos/multimedia-sequence.json, sequence id 7) the captures
 * show. Each entry logs in itself — the capture runner opens a fresh browser
 * context per entry, so no session is shared between them.
 */

const WP = 'http://localhost:8888';
const EDITOR = '/wp-admin/admin.php?page=vip-workflow-sequences#/edit/7';

/** Log in as admin, then open the Multimedia Production sequence. */
const openEditor = [
	{ fill: [ '#user_login', 'admin' ] as [ string, string ] },
	{ fill: [ '#user_pass', 'password' ] as [ string, string ] },
	{ click: '#wp-submit' },
	{ waitFor: '#wpadminbar' },
	{ goto: EDITOR },
	{ waitFor: '.react-flow__node[data-id="enrich"]' },
	{ wait: 1600 }, // dagre layout + fitView settle
];

const fitView = [
	{ click: '.react-flow__controls-fitview' },
	{ wait: 700 },
];

export default {
	project: 'VIP Workflow',
	defaults: {
		// Determinism contract: two runs must produce byte-identical PNGs.
		// Wait actions advance this frozen clock in step with real time, so
		// the app's queued timers (React Flow's deferred viewport moves, the
		// mount-time fit) drain during the pauses the setup already takes —
		// not all at once after the last action.
		freezeTime: '2026-01-15T09:00:00Z',
		// The admin bar avatar is fetched from Gravatar, so it is not ours to
		// reproduce; every full-chrome capture includes it.
		mask: [ '#wp-admin-bar-my-account .avatar' ],
	},
	viewports: {
		mobile: { width: 600, height: 900 },
	},
	targets: {
		wpenv: {
			kind: 'vite',
			command: 'tail -f /dev/null',
			url: WP,
			readyTimeout: 15_000,
		},
	},
	entries: [
		{
			kind: 'screen',
			id: 'sequence-canvas',
			title: 'Sequence canvas — statuses as places',
			description:
				'The Multimedia Production demo sequence. Post status regions are sections of the canvas; a stage’s status is where it sits.',
			target: 'wpenv',
			viewport: 'desktop',
			path: '/wp-login.php',
			setup: [
				...openEditor,
				{ click: 'button[aria-label="Collapse panel"]' },
				{ wait: 400 },
				...fitView,
			],
			callouts: [
				{
					selector:
						'.react-flow__node[data-id="__wf_region_pending__"]',
					kind: 'box',
					label: 'Status regions drawn as sections of the canvas — dragging a stage into one sets its status',
				},
				{
					selector: '.react-flow__node[data-id="rights"]',
					label: 'The region’s entry checkpoint docks on the boundary line — where core-driven status changes land',
				},
				{
					selector: '.wf-inspector',
					label: 'The inspector collapses to a floating title bar, handing the canvas to the author',
				},
			],
		},
		{
			kind: 'screen',
			id: 'canvas-detail',
			title: 'Edges are planned together',
			description:
				'Zoomed into the review cluster: bundled edges route around stages, AI stages (purple) branch by outcome, and the checkpoint stage straddles the region border.',
			target: 'wpenv',
			viewport: 'desktop',
			path: '/wp-login.php',
			setup: [
				...openEditor,
				{ click: 'button[aria-label="Collapse panel"]' },
				{ wait: 400 },
				...fitView,
				{ click: '.react-flow__controls-zoomin' },
				{ wait: 200 },
				{ click: '.react-flow__controls-zoomin' },
				{ wait: 200 },
				{ click: '.react-flow__controls-zoomin' },
				{ wait: 600 },
			],
			callouts: [
				{
					selector: '.react-flow__edge[data-id="desk->enrich"]',
					kind: 'box',
					label: 'Reciprocal edges bundle and route around the stages in their way instead of through them',
				},
				{
					selector: '.react-flow__node[data-id="verify"]',
					kind: 'box',
					label: 'An AI stage (purple) exits by outcome — pass, fail, and error each route separately',
				},
				{
					selector:
						'[data-id="rights"] .wf-stage-node__flag--checkpoint',
					label: 'The checkpoint flag on the stage docked at the region border',
				},
			],
		},
		{
			kind: 'screen',
			id: 'region-detail',
			title: 'A status region',
			description:
				'The pending band: a full-width section of the canvas with its label pill, holding the stages whose posts are in that status.',
			target: 'wpenv',
			viewport: 'desktop',
			path: '/wp-login.php',
			setup: [
				...openEditor,
				{ click: 'button[aria-label="Collapse panel"]' },
				{ wait: 400 },
				...fitView,
			],
			clip: '.wf-region-bands__section[data-region="pending"]',
			callouts: [
				{
					selector: 'button[data-region="pending"]',
					label: 'The region label — status name and stage count; right-click it for region actions',
				},
				{
					selector: '.react-flow__node[data-id="rights"]',
					label: 'The entry checkpoint stage, docked across the region’s top border',
				},
			],
		},
		{
			kind: 'screen',
			id: 'checkpoint-slot',
			title: 'The checkpoint slot',
			description:
				'A freshly added status region has no entry checkpoint yet — the empty slot on its border is where you drag a stage to make it one.',
			target: 'wpenv',
			viewport: 'desktop',
			path: '/wp-login.php',
			setup: [
				...openEditor,
				{ click: 'button[aria-label="Collapse panel"]' },
				{ wait: 400 },
				{ rightClick: '.react-flow__pane' },
				{ waitFor: '.wf-canvas-menu' },
				{ click: '.wf-canvas-menu__item' },
				{ waitFor: '.components-modal__frame' },
				{ click: '.components-modal__frame .components-button.is-primary' },
				{ wait: 400 },
				...fitView,
			],
			clip: '.wf-region-bands__section[data-region="private"]',
			callouts: [
				{
					// Scoped to the region node: the slot renders for every
					// region without an entry checkpoint, and a bare
					// `.wf-region__slot` would match more than one the moment
					// a second region is added.
					selector:
						'.react-flow__node[data-id="__wf_region_private__"] .wf-region__slot',
					label: 'The empty entry-checkpoint slot, straddling the band’s top border',
				},
			],
		},
		{
			kind: 'screen',
			id: 'canvas-menu',
			title: 'The canvas menu',
			description:
				'Right-click the canvas (or a region label) for canvas actions — adding a post status region lives here.',
			target: 'wpenv',
			viewport: 'desktop',
			path: '/wp-login.php',
			setup: [
				...openEditor,
				{ click: 'button[aria-label="Collapse panel"]' },
				{ wait: 400 },
				{ rightClick: '.react-flow__pane' },
				{ waitFor: '.wf-canvas-menu' },
				{ wait: 300 },
			],
			clip: '.wf-canvas-menu',
			callouts: [
				{
					selector: '.wf-canvas-menu__item',
					label: 'Opens the Add post status dialog; disabled once all four statuses are on the canvas',
				},
			],
		},
		{
			kind: 'screen',
			id: 'add-status-modal',
			title: 'Adding a post status region',
			description:
				'The dialog behind the menu item: pick one of the core statuses the workflow can write, and an empty group for it lands on the canvas.',
			target: 'wpenv',
			viewport: 'desktop',
			path: '/wp-login.php',
			setup: [
				...openEditor,
				{ rightClick: '.react-flow__pane' },
				{ waitFor: '.wf-canvas-menu' },
				{ click: '.wf-canvas-menu__item' },
				{ waitFor: '.components-modal__frame' },
				{ wait: 400 },
			],
			// The universal animation-kill CSS blanks the modal header's paint
			// (text and close button) in Chromium; the dialog is static anyway.
			capture: { reducedMotion: false },
			clip: '.components-modal__frame',
		},
		{
			kind: 'flow',
			id: 'ai-stage-states',
			title: 'An AI stage exits by outcome',
			description:
				'The AI Claim Verification stage node in its two working states: hovering reveals the three outcome handles; selecting it lights every exit in its outcome color.',
			target: 'wpenv',
			viewport: 'desktop',
			start: '/wp-login.php',
			// The handle reveal is an opacity transition, which the universal
			// animation-kill CSS strips — leaving the handles stuck at their
			// initial opacity: 0. Same workaround as add-status-modal.
			capture: { reducedMotion: false },
			// Clipping to the canvas keeps the node in its edge context while
			// cropping away the admin chrome — a component-states board, not
			// two screenshots.
			clip: '.wf-canvas__viewport',
			layout: { columns: 2, connector: 'none' },
			steps: [
				{
					caption: 'Hovered — the three outcome handles reveal',
					actions: [
						...openEditor,
						{ click: 'button[aria-label="Collapse panel"]' },
						{ wait: 400 },
						...fitView,
						// Six zoom steps from the fitted view: zooming centers
						// on the viewport, so each step also drifts the verify
						// node toward the top edge — at seven it leaves the
						// canvas. Six lands it large and fully in frame, exits
						// pointing down into open canvas.
						{ click: '.react-flow__controls-zoomin' },
						{ wait: 200 },
						{ click: '.react-flow__controls-zoomin' },
						{ wait: 200 },
						{ click: '.react-flow__controls-zoomin' },
						{ wait: 200 },
						{ click: '.react-flow__controls-zoomin' },
						{ wait: 200 },
						{ click: '.react-flow__controls-zoomin' },
						{ wait: 200 },
						{ click: '.react-flow__controls-zoomin' },
						{ wait: 600 },
						// The outcome handles sit at opacity 0 and are revealed
						// by `.wf-stage-node:hover` (SequenceGraphEditor.css) —
						// that is the inner node, not React Flow's
						// `.react-flow__node` wrapper, so hover the element the
						// selector actually names.
						{
							hover: '.react-flow__node[data-id="verify"] .wf-stage-node',
						},
						{ wait: 300 },
					],
					callouts: [
						{
							selector:
								'[data-id="verify"] .wf-stage-node__handle--pass',
							label: 'On pass',
							placement: 'bottom',
						},
						{
							selector:
								'[data-id="verify"] .wf-stage-node__handle--fail',
							label: 'On fail',
							placement: 'bottom',
						},
						{
							selector:
								'[data-id="verify"] .wf-stage-node__handle--error',
							label: 'On error',
							placement: 'bottom',
						},
					],
				},
				{
					caption: 'Selected — every exit lights in its outcome color',
					actions: [
						{ click: '.react-flow__node[data-id="verify"]' },
						{ wait: 300 },
						// Park the pointer on the admin bar (outside the clip)
						// so the hover-revealed handles fade back out and the
						// frame shows selection alone.
						{ hover: '#wpadminbar' },
						{ wait: 400 },
					],
					callouts: [
						{
							selector:
								'.react-flow__edge[data-id="verify:pass->rights"]',
							label: 'Outgoing edges highlight while the stage is selected — outcome routes in their own colors',
							placement: 'bottom',
						},
					],
				},
			],
		},
		{
			kind: 'screen',
			id: 'stage-inspector',
			title: 'Stage inspector — reads the canvas back',
			description:
				'Selecting the AI Claim Verification stage. Status and checkpoint are no longer form fields; the inspector states what the node’s position already says.',
			target: 'wpenv',
			viewport: 'admin',
			path: '/wp-login.php',
			setup: [
				...openEditor,
				{ click: '.react-flow__node[data-id="verify"]' },
				{ wait: 600 },
			],
			callouts: [
				{
					selector: '.wf-inspector',
					kind: 'box',
					label: 'The inspector is a floating, collapsible card — Placement is read back in prose, not restated as inputs',
				},
			],
		},
		{
			kind: 'screen',
			id: 'inspector-mobile',
			title: 'Small screens — the inspector docks',
			description:
				'Below tablet width the inspector docks across the bottom and collapses to a summary.',
			target: 'wpenv',
			viewport: 'mobile',
			path: '/wp-login.php',
			setup: [
				...openEditor,
				{ click: '.react-flow__node[data-id="verify"]' },
				{ wait: 600 },
			],
			callouts: [
				{
					selector: '.wf-inspector',
					kind: 'box',
					label: 'Docked bottom sheet with the same sections, collapsed to summaries',
				},
			],
		},
	],
};
