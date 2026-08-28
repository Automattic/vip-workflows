<?php
/**
 * What a transition captures: the list shape, its cap, and the conversion onto it.
 *
 * A transition used to capture exactly one thing, held in a singular `input`
 * whose `none` type meant "captures nothing". It now captures any number, held
 * in `inputs` — and because this plugin keeps no read-time fallbacks, the
 * conversion has to happen on write, for every path that writes, or the inputs
 * an author configured stop being collected without a word.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use VIPWorkflow\Sequences\Sequence;

/**
 * Tests for transition capture inputs.
 */
class TransitionInputsTest extends TestCase
{
    /**
     * A config with one stage holding one transition carrying the given keys.
     *
     * @param  array $transition_extra What the transition declares beyond its target.
     * @return array A config the write gate will accept.
     */
    private function config_with_transition( array $transition_extra ): array
    {
        return array(
            'statuses' => array(
                array(
                    'key'         => 'draft',
                    'label'       => 'Draft',
                    'status'      => 'draft',
                    'transitions' => array( array_merge( array( 'to' => 'review' ), $transition_extra ) ),
                ),
                array( 'key' => 'review', 'label' => 'Review', 'status' => 'pending' ),
            ),
        );
    }

    /**
     * The transition the gate produced, for the config above.
     *
     * @param  array $config A config to run through the write gate.
     * @return array The first stage's first transition.
     */
    private function gated_transition( array $config ): array
    {
		$normalized = Sequence::prepare_config_for_write( $config );

        return $normalized['statuses'][0]['transitions'][0];
    }

    // =========================================================================
    // The conversion
    // =========================================================================

    /**
     * The whole point: a stored singular input becomes a one-element list, and
     * the key it lived under is gone rather than left alongside.
     */
    public function test_gate_converts_a_singular_input_into_a_one_element_list(): void
    {
        $transition = $this->gated_transition(
            $this->config_with_transition( array(
                'input' => array(
                    'type'      => 'textarea',
                    'note_id'   => 'n1',
                    'note_name' => 'Editor note',
                    'required'  => true,
                ),
            ) )
        );

        $this->assertArrayNotHasKey( 'input', $transition, 'The singular key does not survive the gate.' );
        $this->assertCount( 1, $transition['inputs'] );
        $this->assertSame(
            array(
                'type'      => 'textarea',
                'note_id'   => 'n1',
                'note_name' => 'Editor note',
                'required'  => true,
            ),
            $transition['inputs'][0],
            'The input itself is carried across untouched.'
        );
    }

    /**
     * `none` was the absence of an input wearing the costume of a choice. It
     * becomes no inputs at all — and the transition says nothing rather than
     * carrying an empty list for every reader to interpret.
     */
    public function test_gate_turns_a_none_input_into_no_inputs(): void
    {
        $transition = $this->gated_transition(
            $this->config_with_transition( array( 'input' => array( 'type' => 'none' ) ) )
        );

        $this->assertArrayNotHasKey( 'input', $transition );
        $this->assertArrayNotHasKey( 'inputs', $transition, 'Capturing nothing is said by saying nothing.' );
    }

    /**
     * An input object with no type at all is the same statement as `none` — the
     * default the old reader applied when the key was missing.
     */
    public function test_gate_turns_a_typeless_input_into_no_inputs(): void
    {
        $transition = $this->gated_transition(
            $this->config_with_transition( array( 'input' => array( 'required' => true ) ) )
        );

        $this->assertArrayNotHasKey( 'inputs', $transition );
    }

    /**
     * An empty list is dropped too, so the editor sending `inputs: []` for a
     * transition that captures nothing stores the same thing as a transition
     * that never mentioned inputs.
     */
    public function test_gate_drops_an_empty_list(): void
    {
        $transition = $this->gated_transition(
            $this->config_with_transition( array( 'inputs' => array() ) )
        );

        $this->assertArrayNotHasKey( 'inputs', $transition );
    }

    /**
     * A transition that never mentioned an input comes back byte-identical.
     *
     * This is what keeps the stored-config replay migration a no-op on rows that
     * need nothing — and what keeps the shipped fixture satisfying the gate
     * without normalization.
     */
    public function test_gate_leaves_a_transition_with_no_input_untouched(): void
    {
        $transition = $this->gated_transition(
            $this->config_with_transition( array( 'label' => 'Send to review' ) )
        );

        $this->assertSame( array( 'to' => 'review', 'label' => 'Send to review' ), $transition );
    }

    /**
     * Replaying an already-converted config changes nothing. The migration runner
     * re-runs a migration after any failure, and fresh installs run every
     * migration against already-current data, so this has to hold.
     */
    public function test_the_conversion_is_idempotent(): void
    {
        $config = $this->config_with_transition( array(
            'input' => array( 'type' => 'textarea', 'note_id' => 'n1', 'note_name' => 'Note' ),
        ) );

		$once  = Sequence::prepare_config_for_write( $config );
		$twice = Sequence::prepare_config_for_write( $once );

        $this->assertSame( $once, $twice, 'A second replay changes nothing.' );
    }

    /**
     * A config carrying both keys cannot come from any write path this plugin
     * owns — only from hand-written import JSON — and the two disagree about what
     * the transition captures. There is nothing to infer, so it is refused.
     */
    public function test_gate_refuses_a_transition_declaring_both_keys(): void
    {
        $this->expectException( \InvalidArgumentException::class );
        $this->expectExceptionMessage( 'declares both "input" and "inputs"' );

		Sequence::prepare_config_for_write(
            $this->config_with_transition( array(
                'input'  => array( 'type' => 'textarea' ),
                'inputs' => array( array( 'type' => 'textarea' ) ),
            ) )
        );
    }

    /**
     * `inputs` naming something that is not a list of objects is malformed
     * config, not something to read past.
     */
    public function test_gate_refuses_inputs_that_is_not_a_list(): void
    {
        $this->expectException( \InvalidArgumentException::class );
        $this->expectExceptionMessage( 'must declare "inputs" as an array' );

		Sequence::prepare_config_for_write(
            $this->config_with_transition( array( 'inputs' => 'a note' ) )
        );
    }

    /**
     * And neither is a list with a scalar in it.
     */
    public function test_gate_refuses_an_input_that_is_not_an_object(): void
    {
        $this->expectException( \InvalidArgumentException::class );
        $this->expectExceptionMessage( 'Every capture input on stage "draft" must be an object' );

		Sequence::prepare_config_for_write(
            $this->config_with_transition( array( 'inputs' => array( 'a note' ) ) )
        );
    }

    // =========================================================================
    // The cap
    // =========================================================================

    /**
     * Notes are unbounded. A transition can ask for as many as its author wants,
     * in the order they arranged them.
     */
    public function test_gate_accepts_any_number_of_notes(): void
    {
        $transition = $this->gated_transition(
            $this->config_with_transition( array(
                'inputs' => array(
                    array( 'type' => 'textarea', 'note_id' => 'n1', 'note_name' => 'Why' ),
                    array( 'type' => 'textarea', 'note_id' => 'n2', 'note_name' => 'What changed' ),
                    array( 'type' => 'textarea', 'note_id' => 'n3', 'note_name' => 'Who checked' ),
                ),
            ) )
        );

        $this->assertCount( 3, $transition['inputs'] );
        $this->assertSame(
            array( 'Why', 'What changed', 'Who checked' ),
            array_column( $transition['inputs'], 'note_name' ),
            'The authored order is the stored order.'
        );
    }

    /**
     * One assignment alongside any number of notes is fine, and the assignment
     * does not have to lead the list.
     */
    public function test_gate_accepts_one_assignment_among_notes(): void
    {
        $transition = $this->gated_transition(
            $this->config_with_transition( array(
                'inputs' => array(
                    array( 'type' => 'textarea', 'note_id' => 'n1', 'note_name' => 'Why' ),
                    array( 'type' => 'assignment', 'meta_key' => 'legal_reviewer' ),
                    array( 'type' => 'textarea', 'note_id' => 'n2', 'note_name' => 'Notes' ),
                ),
            ) )
        );

        $this->assertCount( 3, $transition['inputs'] );
        $this->assertSame( 'assignment', $transition['inputs'][1]['type'] );
    }

    /**
     * Two assignments name no single slot — and the slot is what
     * `requires_assignment` gates on and what AssignmentManager fills. Collapsing
     * one would discard an assignment an author configured, so the write is
     * refused instead.
     */
    public function test_gate_refuses_two_assignment_inputs_on_one_transition(): void
    {
        $this->expectException( \InvalidArgumentException::class );
        $this->expectExceptionMessage( 'declares 2 assignment inputs' );

		Sequence::prepare_config_for_write(
            $this->config_with_transition( array(
                'inputs' => array(
                    array( 'type' => 'assignment', 'meta_key' => 'legal_reviewer' ),
                    array( 'type' => 'assignment', 'meta_key' => 'copy_editor' ),
                ),
            ) )
        );
    }

    /**
     * The cap is per transition, not per stage: two transitions leaving the same
     * stage may each assign, so long as they name different slots.
     */
    public function test_gate_allows_one_assignment_on_each_of_two_transitions(): void
    {
		$normalized = Sequence::prepare_config_for_write( array(
            'statuses' => array(
                array(
                    'key'         => 'draft',
                    'label'       => 'Draft',
                    'status'      => 'draft',
                    'transitions' => array(
                        array(
                            'to'     => 'legal',
                            'inputs' => array( array( 'type' => 'assignment', 'meta_key' => 'legal_reviewer' ) ),
                        ),
                        array(
                            'to'     => 'copy',
                            'inputs' => array( array( 'type' => 'assignment', 'meta_key' => 'copy_editor' ) ),
                        ),
                    ),
                ),
                array( 'key' => 'legal', 'label' => 'Legal', 'status' => 'pending' ),
                array( 'key' => 'copy', 'label' => 'Copy', 'status' => 'pending' ),
            ),
        ) );

        $transitions = $normalized['statuses'][0]['transitions'];

        $this->assertSame( 'legal_reviewer', $transitions[0]['inputs'][0]['meta_key'] );
        $this->assertSame( 'copy_editor', $transitions[1]['inputs'][0]['meta_key'] );
    }

    // =========================================================================
    // The import boundary
    // =========================================================================

    /**
     * normalize_input_shape() is the same conversion, reachable on its own for
     * the one caller that needs it before the full gate runs: import, which
     * validates assignment slots and mints fresh keys on raw exported JSON.
     */
    public function test_normalize_input_shape_converts_without_the_rest_of_the_gate(): void
    {
		$config = Sequence::normalize_input_shape( array(
            'statuses' => array(
                array(
                    'key'         => 'draft',
                    'transitions' => array(
                        array( 'to' => 'review', 'input' => array( 'type' => 'assignment', 'meta_key' => 'legal_reviewer' ) ),
                    ),
                ),
            ),
        ) );

        $transition = $config['statuses'][0]['transitions'][0];

        $this->assertArrayNotHasKey( 'input', $transition );
        $this->assertSame( 'legal_reviewer', $transition['inputs'][0]['meta_key'] );
    }

    /**
     * Deliberately narrow: it converts inputs and touches nothing else, so a
     * config that has not yet met the write gate keeps everything the gate is
     * still going to have an opinion about.
     */
    public function test_normalize_input_shape_leaves_everything_else_alone(): void
    {
        $before = array(
            'statuses' => array(
                array(
                    'key'         => 'Draft Stage',
                    'label'       => 'Draft',
                    'transitions' => array( array( 'to' => 'Review Stage', 'label' => 'Go' ) ),
                ),
            ),
        );

		$this->assertSame( $before, Sequence::normalize_input_shape( $before ) );
    }
}
