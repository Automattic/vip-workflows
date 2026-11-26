<?php
/**
 * WordPress AI Workspace integration.
 *
 * @package VIPWorkflows
 */

declare( strict_types=1 );

namespace VIPWorkflows\AiWorkspace;

use VIPWorkflows\ModuleInterface;

/**
 * Lets the WordPress AI plugin's AI Workspace propose a workflow sequence for a person to approve.
 *
 * It adds the `workflow` proposal kind and its propose ability, and does
 * nothing unless the AI plugin's proposal interface exists. That interface is
 * internal to the AI plugin, so this integration is experimental.
 */
final class AIWorkspace implements ModuleInterface {

	/**
	 * The AI plugin interface a proposal kind implements.
	 */
	private const PROPOSAL_KIND_INTERFACE = '\WordPress\AI\Experiments\AI_Workspace\Proposal_Kind';

	/**
	 * {@inheritDoc}
	 */
	public function get_id(): string {
		return 'ai-workspace';
	}

	/**
	 * {@inheritDoc}
	 */
	public function init(): void {
		add_filter( 'wpai_workspace_proposal_kinds', array( $this, 'add_proposal_kind' ) );
		// After core's own abilities (priority 10), whose create-sequence schema the propose ability reuses.
		add_action( 'wp_abilities_api_init', array( $this, 'register_ability' ), 11 );
	}

	/**
	 * Whether the AI plugin's proposal interface is loaded.
	 *
	 * @return bool
	 */
	public static function is_available(): bool {
		return interface_exists( self::PROPOSAL_KIND_INTERFACE );
	}

	/**
	 * Adds the `workflow` kind to the AI Workspace's proposal kinds.
	 *
	 * @param mixed $kinds The kinds.
	 * @return mixed The kinds, with this one added.
	 */
	public function add_proposal_kind( $kinds ) {
		if ( ! is_array( $kinds ) || ! self::is_available() ) {
			return $kinds;
		}

		$kinds[] = new SequenceProposal();

		return $kinds;
	}

	/**
	 * Registers the propose ability while the AI Workspace can store proposals.
	 *
	 * @return void
	 */
	public function register_ability(): void {
		if ( ! self::is_available() ) {
			return;
		}

		ProposeSequence::register();
	}
}
