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
import { Icon } from '@wordpress/components';
import { Stack } from '@wordpress/ui';
import { caution } from '@wordpress/icons';
import { __, sprintf } from '@wordpress/i18n';
import '../../../common/terminal-pill.css';

function TerminalNodeComponent( { data } ) {
	const { kind, blockers = [] } = data;
	const isStart = kind === 'start';
	const connecting = useConnection( ( c ) => c.inProgress );
	// Red means "blocks Save", here as on a stage. End holds the flow's own
	// blocker — nothing joined to it, so nothing ends the sequence — because
	// joining a stage to End is the fix. Start never carries one.
	const hasBlocker = blockers.length > 0;
	const flagLines = blockers.map( ( message ) =>
		sprintf(
			/* translators: %s: a fault that stops the sequence from saving. */
			__( 'Blocks Save: %s', 'vip-workflows' ),
			message
		)
	);
	const className = [
		// The pill's look is the shared class; `wf-terminal-node` carries what
		// the canvas adds (cursor, handles, drop sheet, fault tone).
		'wf-terminal-pill',
		'wf-terminal-node',
		`wf-terminal-node--${ kind }`,
		connecting && 'is-connecting',
		hasBlocker && 'is-error',
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
			<Stack render={ <span /> } align="center" gap="xs">
				{ /* wpds-allow R7 -- uppercase micro-type on the Start/End pill; the class also carries letter-spacing and colour, which <Text> has no prop for, and its stylesheet is out of this sweep's scope */ }
				<span className="wf-terminal-pill__label">
					{ isStart
						? __( 'Start', 'vip-workflows' )
						: __( 'End', 'vip-workflows' ) }
				</span>
				{ /* The same flag a blocked stage shows, so the fault is said
				     in words as well as hue. */ }
				{ hasBlocker && (
					<Stack
						render={ <span /> }
						align="center"
						title={ flagLines.join( '\n' ) }
						role="img"
						aria-label={ flagLines.join( ' ' ) }
					>
						<Icon
							icon={ caution }
							size={ 16 }
							className="wf-terminal-node__flag"
						/>
					</Stack>
				) }
			</Stack>
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
