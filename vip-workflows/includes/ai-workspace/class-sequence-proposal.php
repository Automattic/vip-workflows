<?php
/**
 * The `workflow` kind of WordPress AI Workspace proposal.
 *
 * @package VIPWorkflows
 */

declare( strict_types=1 );

namespace VIPWorkflows\AiWorkspace;

use VIPWorkflows\Sequences\Sequence;
use WordPress\AI\Experiments\AI_Workspace\Proposal_Kind;
use WP_Error;

/**
 * Proposes one workflow sequence in the AI Workspace and creates it, as a draft, once a person approves it.
 *
 * The AI Workspace never hands the model a tool that writes. A write happens
 * only through a proposal kind: the model calls the kind's propose ability,
 * the workspace stores the values and shows them on a card, and this class
 * writes them when the person approves. So:
 *
 * - **Validated when proposed.** The stages go through `validate-sequence`,
 *   the same dry run of the write gate the sequence editor and
 *   `create-sequence` pass, so the card never shows a sequence that can't be
 *   saved.
 * - **Created as a draft.** Approval creates the sequence through
 *   `create-sequence` with `status: draft`. Nothing is attached to content
 *   until someone activates it under Workflows → Sequences.
 * - **Capability re-checked at approval.** `manage_options` can be revoked
 *   between the proposal and the approval, and the approval is the request
 *   that writes.
 *
 * Load this file only after checking that the AI plugin's `Proposal_Kind`
 * interface exists. The AI plugin marks it internal, so this integration is
 * experimental and follows that interface as it changes.
 */
final class SequenceProposal implements Proposal_Kind {

	/**
	 * The kind name, stored on the proposal and read by the card.
	 */
	public const KIND = 'workflow';

	/**
	 * The capability a person needs to propose or create a sequence. Matches `create-sequence`.
	 */
	public const CAPABILITY = 'manage_options';

	/**
	 * The operation name the AI plugin records for this kind's writes.
	 */
	public const LOG_OPERATION = 'vip-workflows/create-sequence';

	/**
	 * The lifecycle state an approved sequence is created in.
	 */
	private const SEQUENCE_STATUS = 'draft';

	/**
	 * {@inheritDoc}
	 */
	public function name(): string {
		return self::KIND;
	}

	/**
	 * {@inheritDoc}
	 *
	 * One sequence per proposal, so the card has one thing to approve.
	 */
	public function max_items(): int {
		return 1;
	}

	/**
	 * {@inheritDoc}
	 */
	public function ability(): string {
		return ProposeSequence::ABILITY;
	}

	/**
	 * {@inheritDoc}
	 */
	public function capability(): string {
		return self::CAPABILITY;
	}

	/**
	 * {@inheritDoc}
	 */
	public function instruction(): string {
		return __( 'When the person asks you to design or set up an editorial workflow, call the workflow proposal tool with its name, its stages in order with the transitions between them, and the post types it applies to; nothing is created until the person approves it, it is saved as a draft sequence, and proposing it ends your turn.', 'vip-workflows' );
	}

	/**
	 * {@inheritDoc}
	 *
	 * A proposal creates a new sequence and changes nothing that exists.
	 */
	public function is_update(): bool {
		return false;
	}

	/**
	 * {@inheritDoc}
	 *
	 * The person asks for a different proposal rather than editing this one;
	 * the sequence editor is where a draft sequence is refined.
	 */
	public function accepts_edits(): bool {
		return false;
	}

	/**
	 * {@inheritDoc}
	 */
	public function log_operation(): string {
		return self::LOG_OPERATION;
	}

	/**
	 * Normalizes and validates one proposed sequence.
	 *
	 * The stages and post types are stored as JSON, because the AI plugin
	 * stores a kind's fields as strings.
	 *
	 * @param array<mixed> $item The raw item.
	 * @return array<string, string>|\WP_Error The stored fields, or an error written for the model to pass on.
	 */
	public function normalize_item( array $item ) {
		$name = isset( $item['name'] ) && is_string( $item['name'] ) ? sanitize_text_field( $item['name'] ) : '';

		if ( '' === trim( $name ) ) {
			return new WP_Error(
				'vip_workflows_proposal_missing_name',
				__( 'A proposed workflow needs a name.', 'vip-workflows' ),
				array( 'status' => 400 )
			);
		}

		if ( isset( $item['description'] ) && ! is_string( $item['description'] ) ) {
			return new WP_Error(
				'vip_workflows_proposal_invalid_description',
				__( 'A workflow description must be text.', 'vip-workflows' ),
				array( 'status' => 400 )
			);
		}

		$description = isset( $item['description'] ) ? sanitize_textarea_field( $item['description'] ) : '';

		$post_types = $item['post_types'] ?? null;

		if ( ! is_array( $post_types ) || array() === $post_types ) {
			return new WP_Error(
				'vip_workflows_proposal_missing_post_types',
				__( 'A proposed workflow needs at least one post type, such as "post", or it is not attached to any content.', 'vip-workflows' ),
				array( 'status' => 400 )
			);
		}

		$post_types = array_values( $post_types );

		foreach ( $post_types as $post_type ) {
			if ( ! is_string( $post_type ) || ! post_type_exists( $post_type ) ) {
				return new WP_Error(
					'vip_workflows_proposal_unknown_post_type',
					sprintf(
						/* translators: %s: comma-separated list of post type names. */
						__( 'A workflow can only apply to post types this site registers: %s.', 'vip-workflows' ),
						implode( ', ', get_post_types( array( 'show_ui' => true ) ) )
					),
					array( 'status' => 400 )
				);
			}
		}

		$statuses = $item['statuses'] ?? null;

		if ( ! is_array( $statuses ) || array() === $statuses ) {
			return new WP_Error(
				'vip_workflows_proposal_missing_statuses',
				__( 'A proposed workflow needs its stages.', 'vip-workflows' ),
				array( 'status' => 400 )
			);
		}

		$statuses = array_values( $statuses );

		include_once dirname( __DIR__ ) . '/abilities/tools/validate-sequence.php';

		$validation = \VIPWorkflows\Abilities\Tools\execute_validate_sequence(
			array(
				'type'   => Sequence::TYPE_WORKFLOW,
				'config' => array(
					'statuses'   => $statuses,
					'post_types' => $post_types,
				),
			)
		);

		if ( is_wp_error( $validation ) ) {
			return $validation;
		}

		if ( true !== $validation['valid'] ) {
			return new WP_Error(
				'vip_workflows_proposal_invalid_sequence',
				sprintf(
					/* translators: %s: the validation errors, separated by spaces. */
					__( 'The proposed workflow is not valid: %s', 'vip-workflows' ),
					implode( ' ', $validation['errors'] )
				),
				array( 'status' => 400 )
			);
		}

		return array(
			'name'        => $name,
			'description' => $description,
			'statuses'    => (string) wp_json_encode( $statuses ),
			'post_types'  => (string) wp_json_encode( $post_types ),
		);
	}

	/**
	 * Returns the fields the card shows for one stored item.
	 *
	 * The AI plugin renders any create kind it has no card of its own for as a
	 * generic create card, which reads `title`, `post_type`, `status`,
	 * `excerpt` and `content`. The stages, in order, are the content.
	 *
	 * @param array<string, mixed> $item The stored item.
	 * @return array<string, mixed> The presented fields.
	 */
	public function present_item( array $item ): array {
		$labels = array();

		foreach ( $this->decoded( $item, 'statuses' ) as $stage ) {
			$labels[] = (string) $stage['label'];
		}

		return array(
			'title'     => $this->field( $item, 'name' ),
			'post_type' => self::KIND,
			'status'    => self::SEQUENCE_STATUS,
			'excerpt'   => $this->field( $item, 'description' ),
			'content'   => implode( ' → ', $labels ),
		);
	}

	/**
	 * Writes the selected items of an approved proposal.
	 *
	 * @param array<string, mixed> $proposal The stored proposal.
	 * @param array<int, string>   $selected The item keys the person approved.
	 * @param callable|null        $on_item  Optional. Receives each item's outcome once it is done.
	 * @return array{items: list<array<string, mixed>>, created: int, updated: int, unchanged: int, stale: int, locked: int, failed: int, denied: int, duplicate: int, deselected: int} The per-item outcomes and their counts.
	 */
	public function write( array $proposal, array $selected, ?callable $on_item = null ): array {
		$counts   = array_fill_keys( Proposal_Kind::OUTCOMES, 0 );
		$outcomes = array();

		foreach ( $proposal['items'] as $item ) {
			$outcome = in_array( $item['key'], $selected, true )
				? $this->write_item( $item )
				: $this->outcome( $item, 'deselected', 0, '', '' );

			++$counts[ $outcome['outcome'] ];
			$outcomes[] = $outcome;

			if ( null !== $on_item ) {
				$on_item( $outcome );
			}
		}

		return array_merge( array( 'items' => $outcomes ), $counts );
	}

	/**
	 * Creates one approved sequence.
	 *
	 * @param array<string, mixed> $item The stored item.
	 * @return array<string, mixed> The item outcome.
	 */
	private function write_item( array $item ): array {
		// phpcs:ignore WordPress.WP.Capabilities.Undetermined -- The capability is the literal manage_options, held in a constant.
		if ( ! current_user_can( self::CAPABILITY ) ) {
			return $this->outcome( $item, 'denied', 0, 'cannot_manage_options', __( 'You no longer have permission to create workflows.', 'vip-workflows' ) );
		}

		include_once dirname( __DIR__ ) . '/abilities/tools/create-sequence.php';

		$result = \VIPWorkflows\Abilities\Tools\execute_create_sequence(
			array(
				'name'        => $this->field( $item, 'name' ),
				'description' => $this->field( $item, 'description' ),
				'type'        => Sequence::TYPE_WORKFLOW,
				'status'      => self::SEQUENCE_STATUS,
				'statuses'    => $this->decoded( $item, 'statuses' ),
				'post_types'  => $this->decoded( $item, 'post_types' ),
			)
		);

		if ( is_wp_error( $result ) ) {
			return $this->outcome( $item, 'failed', 0, (string) $result->get_error_code(), $result->get_error_message() );
		}

		return $this->outcome( $item, 'created', $result['sequence_id'], '', '' );
	}

	/**
	 * Builds one item outcome, in the shape the AI plugin's other kinds report.
	 *
	 * @param array<string, mixed> $item          The stored item.
	 * @param string               $outcome       One of {@see Proposal_Kind::OUTCOMES}.
	 * @param int                  $sequence_id   The created sequence ID, or 0.
	 * @param string               $error_code    The error code, when there is one.
	 * @param string               $error_message The error message, when there is one.
	 * @return array<string, mixed> The outcome.
	 */
	private function outcome( array $item, string $outcome, int $sequence_id, string $error_code, string $error_message ): array {
		return array(
			'key'           => $item['key'],
			'title'         => $this->field( $item, 'name' ),
			'post_type'     => self::KIND,
			'status'        => self::SEQUENCE_STATUS,
			'outcome'       => $outcome,
			'post_id'       => $sequence_id,
			'edit_link'     => $sequence_id > 0 ? self::edit_link( $sequence_id ) : '',
			'error_code'    => $error_code,
			'error_message' => $error_message,
		);
	}

	/**
	 * Returns the sequence editor URL for one sequence.
	 *
	 * @param int $sequence_id The sequence ID.
	 * @return string The URL.
	 */
	public static function edit_link( int $sequence_id ): string {
		return admin_url( 'admin.php?page=vip-workflows-sequences#/edit/' . $sequence_id );
	}

	/**
	 * Reads a string field the store kept.
	 *
	 * @param array<string, mixed> $item  The stored item.
	 * @param string               $field The field.
	 * @return string The value.
	 */
	private function field( array $item, string $field ): string {
		return (string) $item[ $field ];
	}

	/**
	 * Decodes a JSON field this kind stored.
	 *
	 * @param array<string, mixed> $item  The stored item.
	 * @param string               $field The field.
	 * @return array<int, mixed> The decoded list.
	 * @throws \UnexpectedValueException When the stored field is not JSON, which is a data integrity bug.
	 */
	private function decoded( array $item, string $field ): array {
		$decoded = json_decode( $this->field( $item, $field ), true );

		if ( ! is_array( $decoded ) ) {
			throw new \UnexpectedValueException( sprintf( 'Stored workflow proposal field "%s" is not a JSON list.', $field ) );
		}

		return $decoded;
	}
}
