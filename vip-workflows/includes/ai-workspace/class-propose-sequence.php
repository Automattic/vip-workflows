<?php
/**
 * The `vip-workflows/propose-sequence` ability.
 *
 * @package VIPWorkflows
 */

declare( strict_types=1 );

namespace VIPWorkflows\AiWorkspace;

use WordPress\AI\Experiments\AI_Workspace\Proposal_Store;
use WordPress\AI\Experiments\AI_Workspace\Turn_Context;
use WP_Error;

/**
 * Registers the ability the AI Workspace model calls to propose a workflow sequence.
 *
 * It writes nothing. It stores the proposed sequence with the AI plugin's
 * proposal store, which shows it to the person on an approval card, and
 * {@see SequenceProposal::write()} creates it once they approve. It is hidden
 * from REST and MCP, and refuses outside an AI Workspace turn, because a
 * proposal only means something where the person who approves it is.
 * `create-sequence` stays the MCP path for creating a sequence directly.
 */
final class ProposeSequence {

	/**
	 * The ability name.
	 */
	public const ABILITY = 'vip-workflows/propose-sequence';

	/**
	 * Registers the ability. Runs on `wp_abilities_api_init`.
	 *
	 * @return void
	 */
	public static function register(): void {
		wp_register_ability(
			self::ABILITY,
			array(
				'label'               => __( 'Propose workflow', 'vip-workflows' ),
				'description'         => __( 'Records one proposed editorial workflow (a VIP Workflows sequence) for the person to review. This writes nothing: it stores the exact name, description, stages and post types you propose and returns a proposal identifier, and the person must approve them before the sequence is created, as a draft. Give every stage a key, a label and a status region (draft, pending, private or publish), and the transitions out of it; the stages are checked with the same rules as the sequence editor.', 'vip-workflows' ),
				'category'            => 'vip-workflows',
				'input_schema'        => self::input_schema(),
				'output_schema'       => self::output_schema(),
				'execute_callback'    => array( self::class, 'execute' ),
				'permission_callback' => array( self::class, 'check_permission' ),
				'meta'                => array(
					'show_in_commands'    => false,
					'transition_eligible' => false,
					'annotations'         => array(
						'readonly'    => false,
						'destructive' => false,
						'idempotent'  => false,
						'open_world'  => false,
					),
					// MCP exposure reads `mcp.public`, not `show_in_rest`; both are off.
					'show_in_rest'        => false,
					'mcp'                 => array( 'public' => false ),
				),
			)
		);
	}

	/**
	 * Permission callback.
	 *
	 * @return bool Whether the current user may propose a sequence.
	 */
	public static function check_permission(): bool {
		return current_user_can( SequenceProposal::CAPABILITY );
	}

	/**
	 * Stores the proposal.
	 *
	 * @param array<string, mixed> $input The ability input, already checked against the input schema.
	 * @return array<string, mixed>|\WP_Error The stored proposal summary, or an error.
	 */
	public static function execute( array $input ) {
		if ( ! Turn_Context::is_active() ) {
			return new WP_Error(
				'vip_workflows_workspace_context_required',
				__( 'Workflows can only be proposed inside an AI Workspace conversation, where a person can approve them.', 'vip-workflows' ),
				array( 'status' => 403 )
			);
		}

		$proposal = ( new Proposal_Store() )->create(
			get_current_user_id(),
			Turn_Context::get_conversation_id(),
			array( $input ),
			SequenceProposal::KIND
		);

		if ( is_wp_error( $proposal ) ) {
			return $proposal;
		}

		$item = $proposal['items'][0];

		return array(
			'proposal_id'           => $proposal['id'],
			'item_count'            => 1,
			'expires'               => $proposal['expires'],
			'confirmation_required' => true,
			'items'                 => array(
				array(
					'key'  => $item['key'],
					'name' => $item['name'],
				),
			),
			'note'                  => __( 'Nothing has been created. The person now sees the stored workflow and chooses whether to create it as a draft sequence. Do not claim the workflow exists, and do not propose it again unless they ask.', 'vip-workflows' ),
		);
	}

	/**
	 * The input schema: the fields of `create-sequence` a proposal carries.
	 *
	 * The stage schema is `create-sequence`'s own, so the two never drift.
	 *
	 * @return array<string, mixed> The schema.
	 * @throws \LogicException When create-sequence is not registered, which is a load-order bug.
	 */
	private static function input_schema(): array {
		include_once dirname( __DIR__ ) . '/abilities/tools/create-sequence.php';

		$create = wp_get_ability( 'vip-workflows/create-sequence' );

		if ( null === $create ) {
			throw new \LogicException( 'vip-workflows/create-sequence must be registered before vip-workflows/propose-sequence.' );
		}

		$properties = $create->get_input_schema()['properties'];

		return array(
			'type'                 => 'object',
			'additionalProperties' => false,
			'required'             => array( 'name', 'statuses', 'post_types' ),
			'properties'           => array(
				'name'        => $properties['name'],
				'description' => $properties['description'],
				'statuses'    => $properties['statuses'],
				'post_types'  => array(
					'type'        => 'array',
					'description' => __( 'Post types the workflow applies to, such as "post". At least one.', 'vip-workflows' ),
					'items'       => array( 'type' => 'string' ),
					'minItems'    => 1,
				),
			),
		);
	}

	/**
	 * The output schema.
	 *
	 * @return array<string, mixed> The schema.
	 */
	private static function output_schema(): array {
		return array(
			'type'                 => 'object',
			'additionalProperties' => false,
			'properties'           => array(
				'proposal_id'           => array( 'type' => 'string' ),
				'item_count'            => array( 'type' => 'integer' ),
				'expires'               => array( 'type' => 'integer' ),
				'confirmation_required' => array( 'type' => 'boolean' ),
				'items'                 => array(
					'type'  => 'array',
					'items' => array(
						'type'       => 'object',
						'properties' => array(
							'key'  => array( 'type' => 'string' ),
							'name' => array( 'type' => 'string' ),
						),
					),
				),
				'note'                  => array( 'type' => 'string' ),
			),
		);
	}
}
