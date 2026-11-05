/**
 * Stages the editor refuses to save, for the suites that press Save on them.
 *
 * The one transition captures an assignment and names no key, which the server
 * refuses as `invalid_assignment_key`. The fault belongs to the transition, so
 * the error targets the edge rather than the stage, and the refused-save notice
 * offers "Show transition".
 *
 * @package
 */

export const FAULTED_STAGES = [
	{
		key: 'draft',
		label: 'Draft',
		color: '#C36EFF',
		status: 'draft',
		region_entry: true,
		is_terminal: false,
		transitions: [
			{
				to: 'legal',
				label: 'Send to legal',
				inputs: [ { type: 'assignment', meta_key: '' } ],
			},
		],
	},
	{
		key: 'legal',
		label: 'Legal',
		color: '#C36EFF',
		status: 'draft',
		region_entry: false,
		is_terminal: true,
		transitions: [],
	},
];
