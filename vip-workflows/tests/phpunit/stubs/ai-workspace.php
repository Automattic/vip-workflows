<?php
/**
 * The WordPress AI plugin's AI Workspace proposal interface, for tests.
 *
 * The AI plugin is not loaded in the test environments. This copies the
 * signatures of its `Proposal_Kind` interface, so `SequenceProposal` can be
 * loaded and driven the way the AI plugin's proposal controller drives it.
 * Keep it in step with the AI plugin's interface when that changes.
 *
 * @package VIPWorkflows\Tests
 */

declare( strict_types=1 );

namespace WordPress\AI\Experiments\AI_Workspace;

if ( ! interface_exists( Proposal_Kind::class, false ) ) {
    interface Proposal_Kind
    {
        public const OUTCOMES = array( 'created', 'updated', 'unchanged', 'stale', 'locked', 'failed', 'denied', 'duplicate', 'deselected' );

        public const SNAPSHOT_FIELD = 'snapshot';

        public function name(): string;

        public function max_items(): int;

        public function ability(): string;

        public function capability(): string;

        public function instruction(): string;

        public function is_update(): bool;

        public function accepts_edits(): bool;

        public function normalize_item( array $item );

        public function present_item( array $item ): array;

        public function write( array $proposal, array $selected, ?callable $on_item = null ): array;

        public function log_operation(): string;
    }
}
