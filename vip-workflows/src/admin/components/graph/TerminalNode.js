/**
 * TerminalNode — the synthetic Start / End markers that bookend the flow.
 *
 * Start has a single source handle: drag from it to set the entry stage, and
 * the edge to that stage departs from it too — the pipeline pins it there
 * rather than routing a port (`pinToStartHandle`), so the one exit Start draws
 * is the one its edge leaves by. End is its own drop target — like a stage
 * node, the whole pill accepts a dropped connection (see `StageNode`) and that
 * marks the source stage a flow exit. They aren't stored stages and aren't
 * selectable; the actual data lives in stage order (`statuses[0]` = entry) and
 * the `is_terminal` flag.
 *
 * @package
 */

import { memo } from '@wordpress/element';
import { Handle, Position, useConnection } from '@xyflow/react';
import { __ } from '@wordpress/i18n';
import '../../../common/terminal-pill.css';

function TerminalNodeComponent( { data } ) {
	const isStart = data.kind === 'start';
	const connecting = useConnection( ( c ) => c.inProgress );
	const className = [
		// The pill's look is the shared class; `wf-terminal-node` carries what
		// the canvas adds (cursor, handles, drop sheet).
		'wf-terminal-pill',
		'wf-terminal-node',
		`wf-terminal-node--${ data.kind }`,
		connecting && 'is-connecting',
	]
		.filter( Boolean )
		.join( ' ' );
	return (
		<div className={ className }>
			{ ! isStart && (
				<Handle
					type="target"
					position={ Position.Top }
					className="wf-terminal-node__drop"
				/>
			) }
			{ /* wpds-allow R7 -- uppercase micro-type on the Start/End pill; the class also carries letter-spacing and colour, which <Text> has no prop for, and its stylesheet is out of this sweep's scope */ }
			<span className="wf-terminal-pill__label">
				{ isStart
					? __( 'Start', 'vip-workflow' )
					: __( 'End', 'vip-workflow' ) }
			</span>
			{ isStart && (
				<Handle
					type="source"
					position={ Position.Bottom }
					className="wf-terminal-node__handle"
				/>
			) }
		</div>
	);
}

export default memo( TerminalNodeComponent );
