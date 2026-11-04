<?php
/**
 * Assignment Manager - handles workflow assignments.
 *
 * @package VIPWorkflows
 */

declare( strict_types=1 );

namespace VIPWorkflows\Workflow;

/**
 * Manages assignment storage and lifecycle.
 *
 * Used by StatusManager::transition().
 */
class AssignmentManager {


	/**
	 * Assignment status constants.
	 */
	public const STATUS_PENDING   = 'pending';
	public const STATUS_COMPLETED = 'completed';
	public const STATUS_EXPIRED   = 'expired';

	/**
	 * The most post IDs get_current_for_posts() puts in one query's IN list.
	 *
	 * A longer list is read in several queries, so a large page of posts
	 * never builds a statement past the server's packet size limit.
	 */
	public const CURRENT_FOR_POSTS_CHUNK = 500;

	// =========================================================================
	// Assignment CRUD
	// =========================================================================

	/**
	 * Create an assignment.
	 *
	 * @param int    $post_id       Post ID.
	 * @param string $meta_key      Assignment slot key (e.g., 'legal_reviewer').
	 * @param mixed  $value         Assigned value (user ID, role slug, agent ID).
	 * @param string $assignee_type Type of assignee (user, role, agent).
	 * @param array  $config        Optional config from sequence input.
	 */
	public function assign( int $post_id, string $meta_key, $value, string $assignee_type, array $config = array() ): void {
		$assignment = $this->build_assignment( $value, $assignee_type );

		update_post_meta( $post_id, $this->get_storage_key( $meta_key ), $assignment );

		$this->announce_assignment( $post_id, $meta_key, $assignment, $config );
	}

	/**
	 * The stored shape of a new, pending assignment.
	 *
	 * @param  mixed  $value         Assigned value (user ID, role slug, agent ID).
	 * @param  string $assignee_type Type of assignee (user, role, agent).
	 * @return array
	 */
	private function build_assignment( $value, string $assignee_type ): array {
		// Preserve ordering when multiple assignments occur within one second.
		return array(
			'value'       => $value,
			'type'        => $assignee_type,
			'status'      => self::STATUS_PENDING,
			'assigned_at' => current_time( 'Y-m-d H:i:s.u' ),
			'assigned_by' => get_current_user_id(),
		);
	}

	/**
	 * Run the side effects of a stored assignment: its on_assign actions and
	 * the created hook.
	 *
	 * @param int    $post_id    Post ID.
	 * @param string $meta_key   Assignment slot key.
	 * @param array  $assignment Assignment data as stored.
	 * @param array  $config     Sequence input config.
	 */
	private function announce_assignment( int $post_id, string $meta_key, array $assignment, array $config ): void {
		$this->trigger_assign_actions( $post_id, $meta_key, $assignment, $config );

		/**
		 * Fires when an assignment is created.
		 *
		 * @param int    $post_id    Post ID.
		 * @param string $meta_key   Assignment slot key.
		 * @param array  $assignment Assignment data.
		 * @param array  $config     Sequence input config.
		 */
		do_action( 'vip_workflows_assignment_created', $post_id, $meta_key, $assignment, $config );
	}

	/**
	 * Clear an assignment slot.
	 *
	 * The caller decides whether the slot may be empty. Transitions validate
	 * required assignments before committing any changes.
	 *
	 * A no-op, not an error, when the slot was never assigned: this is
	 * "reach a state with nothing here", not "undo a specific assignment".
	 *
	 * @param int    $post_id  Post ID.
	 * @param string $meta_key Assignment slot key.
	 */
	public function unassign( int $post_id, string $meta_key ): void {
		$storage_key = $this->get_storage_key( $meta_key );
		$existing    = get_post_meta( $post_id, $storage_key, true );

		if ( ! is_array( $existing ) ) {
			return;
		}

		delete_post_meta( $post_id, $storage_key );

		$this->announce_unassignment( $post_id, $meta_key, $existing );
	}

	/**
	 * Fire the removed hook for a cleared slot.
	 *
	 * @param int    $post_id  Post ID.
	 * @param string $meta_key Assignment slot key.
	 * @param array  $existing The assignment the slot held.
	 */
	private function announce_unassignment( int $post_id, string $meta_key, array $existing ): void {
		/**
		 * Fires when an assignment is cleared.
		 *
		 * @param int    $post_id           Post ID.
		 * @param string $meta_key          Assignment slot key.
		 * @param array  $former_assignment The assignment that was in the slot before it was cleared.
		 */
		do_action( 'vip_workflows_assignment_removed', $post_id, $meta_key, $existing );
	}

	/**
	 * Get an assignment.
	 *
	 * @param  int    $post_id  Post ID.
	 * @param  string $meta_key Assignment slot key.
	 * @return array|null Assignment data or null if not found.
	 */
	public function get( int $post_id, string $meta_key ): ?array {
		$storage_key = $this->get_storage_key( $meta_key );
		$assignment  = get_post_meta( $post_id, $storage_key, true );

		return is_array( $assignment ) ? $assignment : null;
	}

	/**
	 * Get all assignments for a post.
	 *
	 * @param  int $post_id Post ID.
	 * @return array Array of assignments keyed by meta_key.
	 */
	public function get_all( int $post_id ): array {
		global $wpdb;

		$prefix  = '_vip_workflows_assignment_';
		$results = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT meta_key, meta_value FROM {$wpdb->postmeta} WHERE post_id = %d AND meta_key LIKE %s",
				$post_id,
				$wpdb->esc_like( $prefix ) . '%'
			)
		);

		$assignments = array();
		foreach ( $results as $row ) {
			$key  = str_replace( $prefix, '', $row->meta_key );
			$data = maybe_unserialize( $row->meta_value );
			if ( is_array( $data ) ) {
				$assignments[ $key ] = $data;
			}
		}

		return $assignments;
	}

	/**
	 * The post's current assignment — whichever pending assignment, across
	 * every slot and every assignee type, was made most recently.
	 *
	 * A post can carry several assignment slots at once (one per transition
	 * that has asked for one), and only one deserves the "Assigned to"
	 * spotlight in the sidebar and the board. Picking "the first pending
	 * USER assignment found" — the previous rule — discarded every role or
	 * agent assignment outright and did not even track recency among users;
	 * a post with three assignments could show the oldest one forever.
	 *
	 * @param  int $post_id Post ID.
	 * @return array{meta_key: string, assignment: array}|null The slot key and its
	 *                      assignment, or null when nothing is pending.
	 */
	public function get_current( int $post_id ): ?array {
		return $this->pick_current( $this->get_all( $post_id ) );
	}

	/**
	 * The current assignment of each of many posts, read in one query per
	 * CURRENT_FOR_POSTS_CHUNK posts.
	 *
	 * The same rule as get_current(), for a list that would otherwise run one
	 * query per post.
	 *
	 * A chunk whose query fails fails the whole read. Treating its posts as
	 * having nothing pending would report every one of them unassigned.
	 *
	 * @param  int[] $post_ids Post IDs.
	 * @return array<int, array{meta_key: string, assignment: array}|null>|\WP_Error Each
	 *               post's current assignment, keyed by post ID, where a post with
	 *               nothing pending maps to null; or a 500 when any chunk's query fails.
	 */
	public function get_current_for_posts( array $post_ids ) {
		global $wpdb;

		$post_ids = array_values( array_unique( array_map( 'intval', $post_ids ) ) );
		if ( ! $post_ids ) {
			return array();
		}

		$prefix  = '_vip_workflows_assignment_';
		$by_post = array_fill_keys( $post_ids, array() );

		foreach ( array_chunk( $post_ids, self::CURRENT_FOR_POSTS_CHUNK ) as $chunk ) {
			$placeholders = implode( ', ', array_fill( 0, count( $chunk ), '%d' ) );

			// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare -- Same uncached read as get_all(), for many posts; $placeholders holds only %d tokens.
			$results = $wpdb->get_results(
				$wpdb->prepare(
					"SELECT post_id, meta_key, meta_value FROM {$wpdb->postmeta} WHERE post_id IN ( {$placeholders} ) AND meta_key LIKE %s",
					array_merge( $chunk, array( $wpdb->esc_like( $prefix ) . '%' ) )
				)
			);
			// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare

			if ( null === $results || '' !== $wpdb->last_error ) {
				// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
				error_log( '[VIP Workflows] Current assignments could not be read: assignment_read_failed' );
				return new \WP_Error(
					'assignment_read_failed',
					__( 'Assignments could not be read.', 'vip-workflows' ),
					array( 'status' => 500 )
				);
			}

			foreach ( $results as $row ) {
				$key  = str_replace( $prefix, '', $row->meta_key );
				$data = maybe_unserialize( $row->meta_value );
				if ( is_array( $data ) ) {
					$by_post[ (int) $row->post_id ][ $key ] = $data;
				}
			}
		}

		return array_map( array( $this, 'pick_current' ), $by_post );
	}

	/**
	 * The most recently made pending assignment among a post's slots.
	 *
	 * @param  array $assignments Assignments keyed by slot key, as get_all() returns them.
	 * @return array{meta_key: string, assignment: array}|null The slot key and its
	 *                      assignment, or null when nothing is pending.
	 */
	private function pick_current( array $assignments ): ?array {
		$current = null;

		foreach ( $assignments as $meta_key => $assignment ) {
			if ( self::STATUS_PENDING !== ( $assignment['status'] ?? null ) ) {
				continue;
			}

			$assigned_at = $assignment['assigned_at'] ?? '';
			if ( null === $current || $assigned_at > ( $current['assignment']['assigned_at'] ?? '' ) ) {
				$current = array(
					'meta_key'   => $meta_key,
					'assignment' => $assignment,
				);
			}
		}

		return $current;
	}

	/**
	 * Describe an assignment's stored value as the client-facing shape every
	 * route already serves an actor in.
	 *
	 * A user resolves through `Actor::from_user()` — the same shape a post's
	 * author or an event's actor gets. A role or an agent has no single
	 * person behind it, so each gets a parallel shape naming what it is
	 * rather than borrowing a person's. This is a display description of an
	 * assignment's target, not a claim about who acted — `Actor`'s own,
	 * narrower job, which is deliberately not asked to answer this.
	 *
	 * @param  string $assignee_type 'user', 'role', or 'agent'.
	 * @param  mixed  $value         The raw stored value.
	 * @return array|null The description, or null when it cannot be
	 *                     resolved (unknown type, deleted user, retired
	 *                     role/agent).
	 */
	public function describe_assignee( string $assignee_type, $value ): ?array {
		if ( 'user' === $assignee_type ) {
			return Actor::from_user( $value );
		}

		if ( 'role' === $assignee_type ) {
			$roles = wp_roles()->roles;
			if ( ! isset( $roles[ $value ]['name'] ) ) {
				return null;
			}

			return array(
				'id'           => 0,
				'type'         => 'role',
				'display_name' => translate_user_role( $roles[ $value ]['name'] ),
				'agent_actor'  => null,
				'avatar'       => null,
			);
		}

		if ( 'agent' === $assignee_type ) {
			$agents = ( new AgentRunner() )->get_registered_agents();
			if ( ! isset( $agents[ $value ] ) ) {
				return null;
			}

			return array(
				'id'           => 0,
				'type'         => 'agent',
				'display_name' => $agents[ $value ]['label'] ?? (string) $value,
				'agent_actor'  => (string) $value,
				'avatar'       => null,
			);
		}

		return null;
	}

	/**
	 * Mark an assignment as completed.
	 *
	 * @param int    $post_id  Post ID.
	 * @param string $meta_key Assignment slot key.
	 * @param array  $result   Optional result data from completion.
	 */
	public function mark_completed( int $post_id, string $meta_key, array $result = array() ): void {
		$assignment = $this->get( $post_id, $meta_key );
		if ( ! $assignment ) {
			return;
		}

		$assignment['status']       = self::STATUS_COMPLETED;
		$assignment['completed_at'] = current_time( 'mysql' );
		$assignment['completed_by'] = get_current_user_id();

		if ( ! empty( $result ) ) {
			$assignment['result'] = $result;
		}

		$storage_key = $this->get_storage_key( $meta_key );
		update_post_meta( $post_id, $storage_key, $assignment );

		/**
		 * Fires when an assignment is completed.
		 *
		 * @param int    $post_id    Post ID.
		 * @param string $meta_key   Assignment slot key.
		 * @param array  $assignment Updated assignment data.
		 */
		do_action( 'vip_workflows_assignment_completed', $post_id, $meta_key, $assignment );
	}

	/**
	 * Mark an assignment as expired (agent timeout).
	 *
	 * @param int    $post_id  Post ID.
	 * @param string $meta_key Assignment slot key.
	 * @param string $reason   Reason for expiration.
	 */
	public function mark_expired( int $post_id, string $meta_key, string $reason = '' ): void {
		$assignment = $this->get( $post_id, $meta_key );
		if ( ! $assignment ) {
			return;
		}

		$assignment['status']     = self::STATUS_EXPIRED;
		$assignment['expired_at'] = current_time( 'mysql' );
		$assignment['reason']     = $reason;

		$storage_key = $this->get_storage_key( $meta_key );
		update_post_meta( $post_id, $storage_key, $assignment );

		/**
		 * Fires when an assignment expires.
		 *
		 * @param int    $post_id    Post ID.
		 * @param string $meta_key   Assignment slot key.
		 * @param array  $assignment Updated assignment data.
		 */
		do_action( 'vip_workflows_assignment_expired', $post_id, $meta_key, $assignment );
	}

	/**
	 * Complete the person-facing assignments of the stage a post is leaving.
	 *
	 * A transition's user or role assignment names who works the stage that
	 * transition leads into, so it is done once the post moves on. Callers run
	 * this on every stage change, forward or backward, before the moving
	 * transition captures its own assignment. The one exception is a
	 * failed-agent revert: StatusManager skips this call for it, so the
	 * assignments survive the agent run that failed.
	 *
	 * Agent slots are left alone: AgentRunner completes or expires those when
	 * the agent finishes.
	 *
	 * @param int $post_id Post ID.
	 */
	public function complete_on_stage_exit( int $post_id ): void {
		$this->complete_pending_person_slots( $post_id, $this->get_all( $post_id ) );
	}

	/**
	 * Complete the named slots, for a stage the post left while they were
	 * being written.
	 *
	 * StatusManager::transition() calls this when a concurrent transition
	 * moved the post on between its stage write and its assignment write. The
	 * assignment belongs to a stage the post is no longer in, so it is done
	 * for the same reason complete_on_stage_exit() completes one. Only the
	 * named slots are touched: the transition that moved the post on may have
	 * written its own assignment for the stage it entered.
	 *
	 * @param int      $post_id   Post ID.
	 * @param string[] $meta_keys Assignment slot keys the transition wrote.
	 */
	public function complete_slots_for_left_stage( int $post_id, array $meta_keys ): void {
		$assignments = array();
		foreach ( $meta_keys as $meta_key ) {
			$assignment = $this->get( $post_id, $meta_key );
			if ( $assignment ) {
				$assignments[ $meta_key ] = $assignment;
			}
		}

		$this->complete_pending_person_slots( $post_id, $assignments );
	}

	/**
	 * Complete every pending user or role assignment in a set of slots.
	 *
	 * @param int   $post_id     Post ID.
	 * @param array $assignments Assignments keyed by slot key.
	 */
	private function complete_pending_person_slots( int $post_id, array $assignments ): void {
		foreach ( $assignments as $meta_key => $assignment ) {
			if ( self::STATUS_PENDING !== ( $assignment['status'] ?? null ) ) {
				continue;
			}

			if ( ! in_array( $assignment['type'] ?? null, array( 'user', 'role' ), true ) ) {
				continue;
			}

			$this->mark_completed( $post_id, (string) $meta_key );
		}
	}

	// =========================================================================
	// Transition input (used by StatusManager::transition())
	// =========================================================================

	/**
	 * Validate required assignment input before a transition has side effects.
	 *
	 * An existing assignment does not satisfy a required input: the caller must
	 * explicitly submit the assignee it wants to keep or select.
	 *
	 * @param  array $transition Transition config from sequence.
	 * @param  array $input_data User-provided input data.
	 * @return true|\WP_Error True when required assignments are supplied.
	 */
	public function validate_transition_input( array $transition, array $input_data ) {
		$inputs = $transition['inputs'] ?? array();

		if ( ! is_array( $inputs ) ) {
			return true;
		}

		foreach ( $inputs as $input_config ) {
			if ( ! is_array( $input_config ) || 'assignment' !== ( $input_config['type'] ?? '' ) || empty( $input_config['required'] ) ) {
				continue;
			}

			$meta_key = $input_config['meta_key'] ?? '';

			if ( empty( $input_data[ $meta_key ] ) ) {
				return new \WP_Error(
					'required_assignment_missing',
					sprintf(
						/* translators: %s: Assignment field label. */
						__( 'Choose an assignee for “%s” in the post editor before continuing.', 'vip-workflows' ),
						$input_config['label'] ?? $meta_key
					),
					array(
						'status'   => 422,
						'meta_key' => $meta_key,
					)
				);
			}
		}

		return true;
	}

	/**
	 * Reject input keys a transition does not declare.
	 *
	 * `input_data` arrives as a free-form map, and StatusManager stores it in
	 * transition meta and writes every key into the audit log as a labelled
	 * note. Only the transition's assignment input is collected, so only its
	 * keys are accepted: the assignee under `meta_key`, the optional
	 * `{meta_key}_notes`, and the `__name` label of each. Any other key, such
	 * as a retired free-text note or a key the transition never declared,
	 * fails the transition with a 400 naming the key, so a client learns
	 * that its data was not saved instead of losing it.
	 *
	 * @param  array|null $transition Transition config from sequence, or null when no authored edge applies.
	 * @param  array      $input_data User-provided input data.
	 * @return true|\WP_Error True when every key is declared, or a 400 naming the first undeclared key.
	 */
	public function check_transition_input_keys( ?array $transition, array $input_data ) {
		$allowed = array_flip( $this->get_declared_input_keys( $transition ) );

		foreach ( array_keys( $input_data ) as $key ) {
			if ( isset( $allowed[ $key ] ) ) {
				continue;
			}

			return new \WP_Error(
				'unknown_transition_input',
				sprintf(
					/* translators: %s: Input key submitted with the transition. */
					__( 'This transition doesn’t accept the “%s” input.', 'vip-workflows' ),
					(string) $key
				),
				array(
					'status' => 400,
					'key'    => (string) $key,
				)
			);
		}

		return true;
	}

	/**
	 * The input keys a transition declares.
	 *
	 * @param  array|null $transition Transition config from sequence, or null when no authored edge applies.
	 * @return string[] The assignee key, its notes key, and the `__name` label of each, for every assignment input.
	 */
	private function get_declared_input_keys( ?array $transition ): array {
		$inputs = $transition['inputs'] ?? array();

		if ( ! is_array( $inputs ) ) {
			return array();
		}

		$allowed = array();
		foreach ( $inputs as $input_config ) {
			if ( ! is_array( $input_config ) || 'assignment' !== ( $input_config['type'] ?? '' ) ) {
				continue;
			}

			$meta_key = $input_config['meta_key'] ?? '';
			if ( ! is_string( $meta_key ) || '' === $meta_key ) {
				continue;
			}

			$allowed[] = $meta_key;
			$allowed[] = $meta_key . '__name';
			$allowed[] = $meta_key . '_notes';
			$allowed[] = $meta_key . '_notes__name';
		}

		return $allowed;
	}

	/**
	 * The slots a transition's input will write, as they stand now.
	 *
	 * StatusManager::transition() reads this when it validates a self-edge and
	 * hands it back to process_transition_input(), which writes each slot only
	 * if it still holds the value read here.
	 *
	 * @param  int   $post_id    Post ID.
	 * @param  array $transition Transition config from sequence.
	 * @param  array $input_data User-provided input data.
	 * @return array<string, array|null> Each slot's assignment keyed by slot key,
	 *                                   null for a slot that holds none.
	 */
	public function get_transition_slots( int $post_id, array $transition, array $input_data ): array {
		$slots = array();

		foreach ( $this->get_written_inputs( $transition, $input_data ) as $meta_key => $input_config ) {
			$slots[ $meta_key ] = $this->get( $post_id, $meta_key );
		}

		return $slots;
	}

	/**
	 * Process assignment input from a transition.
	 *
	 * Called by StatusManager::transition() after validate_transition_input().
	 *
	 * A slot's key ABSENT from `$input_data` is left untouched — the caller
	 * (a REST client, an ability, a revert) simply had nothing to say about
	 * it, most commonly because the transition carries no assignment input
	 * at all. A slot's key PRESENT but empty is an explicit instruction to
	 * clear it — the one way an optional assignment popover has to submit
	 * "no one" after a prior assignment, which `array_key_exists()` is what
	 * tells apart from "nothing submitted".
	 *
	 * With `$expected`, every write is a compare-and-set: a slot is written
	 * only if it still holds what get_transition_slots() read. A slot that
	 * changed in between was written by a concurrent transition, so this
	 * one returns a 409 instead of overwriting it, and writes nothing.
	 * A transition assigns at most one slot (the cap
	 * Sequence::prepare_config_for_write() enforces), so a refusal leaves no
	 * other slot half-written.
	 *
	 * @param  int        $post_id    Post ID.
	 * @param  array      $transition Transition config from sequence.
	 * @param  array      $input_data User-provided input data.
	 * @param  array|null $expected   Slots as get_transition_slots() read them, or null to write unconditionally.
	 * @return string[]|\WP_Error The slot keys this call assigned (not the ones it cleared),
	 *                            or a 409 when a slot changed after `$expected` was read.
	 * @throws \LogicException When `$expected` has no entry for a slot the input writes.
	 */
	public function process_transition_input( int $post_id, array $transition, array $input_data, ?array $expected = null ) {
		$assigned = array();

		// A transition captures a list, and at most one entry in it assigns work —
		// the cap Sequence::prepare_config_for_write() enforces, so the loop finds
		// one slot or none. Walked as a list rather than reached for by index
		// because an assignment is not required to lead the list: a stored note can
		// sit ahead of it, and the note's position is not this method's business.
		foreach ( $this->get_written_inputs( $transition, $input_data ) as $meta_key => $input_config ) {
			$assignee_type  = $input_config['assignee_type'] ?? 'user';
			$assigned_value = $input_data[ $meta_key ];

			if ( null === $expected ) {
				if ( ! $assigned_value ) {
					$this->unassign( $post_id, $meta_key );
					continue;
				}

				$this->assign( $post_id, $meta_key, $assigned_value, $assignee_type, $input_config );
				$assigned[] = $meta_key;
				continue;
			}

			if ( ! array_key_exists( $meta_key, $expected ) ) {
				throw new \LogicException( sprintf( 'No expected value was read for assignment slot "%s".', esc_html( $meta_key ) ) );
			}

			$previous   = $expected[ $meta_key ];
			$assignment = $assigned_value ? $this->build_assignment( $assigned_value, $assignee_type ) : null;
			$written    = $this->compare_and_set( $post_id, $this->get_storage_key( $meta_key ), $previous, $assignment );

			if ( true !== $written ) {
				return $this->slot_write_error( $written, $meta_key, $input_config );
			}

			if ( null === $assignment ) {
				if ( null !== $previous ) {
					$this->announce_unassignment( $post_id, $meta_key, $previous );
				}
				continue;
			}

			$this->announce_assignment( $post_id, $meta_key, $assignment, $input_config );
			$assigned[] = $meta_key;
		}

		return $assigned;
	}

	/**
	 * The assignment inputs of a transition that its input data writes,
	 * keyed by slot key.
	 *
	 * @param  array $transition Transition config from sequence.
	 * @param  array $input_data User-provided input data.
	 * @return array<string, array> Input configs keyed by slot key.
	 */
	private function get_written_inputs( array $transition, array $input_data ): array {
		$inputs  = $transition['inputs'] ?? array();
		$written = array();

		if ( ! is_array( $inputs ) ) {
			return $written;
		}

		foreach ( $inputs as $input_config ) {
			if ( ! is_array( $input_config ) || 'assignment' !== ( $input_config['type'] ?? '' ) ) {
				continue;
			}

			$meta_key = $input_config['meta_key'] ?? null;
			if ( ! $meta_key || ! array_key_exists( $meta_key, $input_data ) ) {
				continue;
			}

			$written[ (string) $meta_key ] = $input_config;
		}

		return $written;
	}

	/**
	 * Write a slot only if it still holds the expected assignment.
	 *
	 * The UPDATE and DELETE carry the expected serialized value in their
	 * WHERE clause, the same conditional write update_post_meta() makes with
	 * a `$prev_value`. They are issued directly because update_post_meta()
	 * falls back to an unconditional insert when the row is gone, and
	 * delete_post_meta() deletes by the IDs it selected first. The new value
	 * is unslashed and serialized exactly as update_post_meta() stores it.
	 *
	 * A slot that held nothing is filled through add_post_meta() with
	 * `$unique`. That check is a read before the insert, so two writers can
	 * both pass it. The older row wins: a writer whose row is not the first
	 * for the slot deletes it and loses.
	 *
	 * @param  int        $post_id     Post ID.
	 * @param  string     $storage_key Full meta key of the slot.
	 * @param  array|null $expected    What the slot must hold, null for nothing.
	 * @param  array|null $assignment  What to write, null to clear the slot.
	 * @return true|string True when written, 'assignment_conflict' when the slot
	 *                     changed, or 'assignment_write_failed' on a database error.
	 */
	private function compare_and_set( int $post_id, string $storage_key, ?array $expected, ?array $assignment ) {
		global $wpdb;

		if ( null === $expected ) {
			if ( null === $assignment ) {
				// Clearing a slot that held nothing writes nothing. It only has to
				// be still empty.
				wp_cache_delete( $post_id, 'post_meta' );
				return is_array( get_post_meta( $post_id, $storage_key, true ) ) ? 'assignment_conflict' : true;
			}

			$meta_id = add_post_meta( $post_id, $storage_key, $assignment, true );
			if ( ! $meta_id ) {
				// Refused either because the slot is filled now, or by the database.
				wp_cache_delete( $post_id, 'post_meta' );
				return is_array( get_post_meta( $post_id, $storage_key, true ) ) ? 'assignment_conflict' : 'assignment_write_failed';
			}

			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Must see a row another request inserted just now.
			$first_id = (int) $wpdb->get_var(
				$wpdb->prepare(
					"SELECT MIN(meta_id) FROM {$wpdb->postmeta} WHERE post_id = %d AND meta_key = %s",
					$post_id,
					$storage_key
				)
			);

			if ( $first_id !== (int) $meta_id ) {
				delete_metadata_by_mid( 'post', (int) $meta_id );
				return 'assignment_conflict';
			}

			return true;
		}

		$where = array(
			'post_id'    => $post_id,
			'meta_key'   => $storage_key, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key -- One post's row, by post_id.
			'meta_value' => maybe_serialize( $expected ), // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value -- The compare half of the compare-and-set.
		);

		if ( null === $assignment ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- Conditional delete; the post meta cache is cleared below.
			$rows = $wpdb->delete( $wpdb->postmeta, $where );
		} else {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- Conditional update; the post meta cache is cleared below.
			$rows = $wpdb->update( $wpdb->postmeta, array( 'meta_value' => maybe_serialize( wp_unslash( $assignment ) ) ), $where ); // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value -- The value written.
		}

		wp_cache_delete( $post_id, 'post_meta' );

		if ( false === $rows ) {
			return 'assignment_write_failed';
		}

		return $rows > 0 ? true : 'assignment_conflict';
	}

	/**
	 * The error a refused slot write returns.
	 *
	 * @param  string $code         'assignment_conflict' or 'assignment_write_failed'.
	 * @param  string $meta_key     Assignment slot key.
	 * @param  array  $input_config The slot's input config.
	 * @return \WP_Error
	 */
	private function slot_write_error( string $code, string $meta_key, array $input_config ): \WP_Error {
		$label = $input_config['label'] ?? $meta_key;

		if ( 'assignment_conflict' === $code ) {
			return new \WP_Error(
				'assignment_conflict',
				sprintf(
					/* translators: %s: Assignment field label. */
					__( 'Someone else changed “%s” while your change was being applied. Reload and try again.', 'vip-workflows' ),
					$label
				),
				array(
					'status'   => 409,
					'meta_key' => $meta_key,
				)
			);
		}

		return new \WP_Error(
			'assignment_write_failed',
			sprintf(
				/* translators: %s: Assignment field label. */
				__( '“%s” could not be saved.', 'vip-workflows' ),
				$label
			),
			array(
				'status'   => 500,
				'meta_key' => $meta_key,
			)
		);
	}

	/**
	 * Validate supplied assignees before a transition changes any post state.
	 *
	 * StatusManager calls this before tools, publishing, and process_transition_input().
	 *
	 * Missing values and explicit empty selections are handled by the transition's
	 * required/optional input rules. Other values must identify a valid assignee.
	 *
	 * @param  array $transition Transition config from sequence.
	 * @param  array $input_data User-provided input data.
	 * @return true|\WP_Error True when all supplied assignees are valid.
	 */
	public function validate_transition_assignees( array $transition, array $input_data ) {
		$inputs = $transition['inputs'] ?? array();
		if ( ! is_array( $inputs ) ) {
			return true;
		}

		foreach ( $inputs as $input_config ) {
			if ( ! is_array( $input_config ) || 'assignment' !== ( $input_config['type'] ?? '' ) ) {
				continue;
			}

			$meta_key = $input_config['meta_key'] ?? null;
			if ( ! $meta_key || ! array_key_exists( $meta_key, $input_data ) ) {
				continue;
			}

			$value = $input_data[ $meta_key ];
			if ( null === $value || '' === $value ) {
				continue;
			}

			$assignee_type = $input_config['assignee_type'] ?? 'user';
			if ( $this->is_valid_assignee( $assignee_type, $value ) ) {
				continue;
			}

			switch ( $assignee_type ) {
				case 'user':
					/* translators: %s: Assignment field label. */
					$message = __( 'Choose an existing user for “%s” before continuing.', 'vip-workflows' );
					break;
				case 'role':
					/* translators: %s: Assignment field label. */
					$message = __( 'Choose a registered role for “%s” before continuing.', 'vip-workflows' );
					break;
				default:
					/* translators: %s: Assignment field label. */
					$message = __( 'Enter a valid assignee identifier for “%s” before continuing.', 'vip-workflows' );
			}

			return new \WP_Error(
				'invalid_assignee',
				sprintf( $message, $input_config['label'] ?? $meta_key ),
				array(
					'status'        => 422,
					'meta_key'      => $meta_key,
					'assignee_type' => $assignee_type,
				)
			);
		}

		return true;
	}

	// =========================================================================
	// Private Helpers
	// =========================================================================

	/**
	 * Whether an assignee value resolves to a real target for its type.
	 *
	 * @param  string $assignee_type Assignee type (user, role, agent, ...).
	 * @param  mixed  $value         Assignee value from the transition input.
	 * @return bool
	 */
	private function is_valid_assignee( string $assignee_type, $value ): bool {
		switch ( $assignee_type ) {
			case 'user':
				// Casting first would turn values such as "7invalid" into user 7.
				if ( ! ( is_int( $value ) || is_string( $value ) ) || ! preg_match( '/^[1-9][0-9]*$/D', (string) $value ) ) {
					return false;
				}
				$user_id = filter_var( $value, FILTER_VALIDATE_INT, array( 'options' => array( 'min_range' => 1 ) ) );
				return false !== $user_id && (bool) get_userdata( $user_id );
			case 'role':
				return is_string( $value ) && wp_roles()->is_role( $value );
			default:
				// Other types (e.g. agent) resolve through their registered
				// handler; require a non-empty string or integer identifier.
				return ( is_string( $value ) || is_int( $value ) ) && ! empty( $value ) && '' !== trim( (string) $value );
		}
	}

	/**
	 * Get the storage meta key for an assignment.
	 *
	 * @param  string $meta_key Assignment slot key.
	 * @return string Full meta key for storage.
	 */
	private function get_storage_key( string $meta_key ): string {
		return '_vip_workflows_assignment_' . sanitize_key( $meta_key );
	}

	/**
	 * Trigger actions when an assignment is created.
	 *
	 * @param int    $post_id    Post ID.
	 * @param string $meta_key   Assignment slot key.
	 * @param array  $assignment Assignment data.
	 * @param array  $config     Sequence input config.
	 */
	private function trigger_assign_actions( int $post_id, string $meta_key, array $assignment, array $config ): void {
		$on_assign = $config['on_assign'] ?? array();

		// Notifications.
		if ( ! empty( $on_assign['notify'] ) ) {
			/**
			 * Fires when an assignment needs notification.
			 *
			 * @param int    $post_id     Post ID.
			 * @param string $meta_key    Assignment slot key.
			 * @param array  $assignment  Assignment data.
			 * @param array  $notify_config Notification config.
			 */
			do_action( 'vip_workflows_assignment_notify', $post_id, $meta_key, $assignment, $on_assign['notify'] );
		}

		// Agent trigger.
		if ( 'agent' === $assignment['type'] ) {
			/**
			 * Fires when an agent is assigned (to queue the task).
			 *
			 * @param int    $post_id  Post ID.
			 * @param string $agent_id Agent ID.
			 * @param array  $config   Sequence input config.
			 */
			do_action( 'vip_workflows_agent_assigned', $post_id, $assignment['value'], $config );
		}

		/**
		 * Filter the per-assignee-type handlers run when an assignment is created.
		 *
		 * Keyed by assignee type (the `assignee_type` a sequence's assignment
		 * input stores). Each entry's only read key is `on_assign`: a callable
		 * receiving `( int $post_id, mixed $value, array $config )`. Nothing else
		 * in an entry is read, and the built-in types register no handler.
		 *
		 * This is not a list of allowed types: an assignment input stores any
		 * `assignee_type` string, whether or not it appears here.
		 *
		 * @param array $handlers Handlers keyed by assignee type.
		 */
		$handlers = apply_filters( 'vip_workflows_assignee_types', array() );
		$handler  = $handlers[ $assignment['type'] ]['on_assign'] ?? null;
		if ( is_callable( $handler ) ) {
			call_user_func( $handler, $post_id, $assignment['value'], $config );
		}
	}
}
