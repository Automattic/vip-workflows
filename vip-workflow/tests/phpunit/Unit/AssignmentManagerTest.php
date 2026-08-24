<?php
/**
 * AssignmentManager unit tests.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflow\Workflow\AssignmentManager;

class AssignmentManagerTest extends TestCase
{
    private AssignmentManager $manager;

    protected function setUp(): void
    {
        parent::setUp();
        $this->manager = new AssignmentManager();
    }

    // -------------------------------------------------------------------------
    // process_transition_input — finding the assignment in a list of inputs
    // -------------------------------------------------------------------------

    /**
     * Capture every assignment the manager writes, instead of touching post meta.
     *
     * @param array $written Filled with what was written, as [ storage_key => assignment ].
     */
    private function capture_assignments( array &$written ): void
    {
        Functions\when('current_time')->justReturn('2026-01-01 00:00:00');
        Functions\when('get_current_user_id')->justReturn(1);
        Functions\when('update_post_meta')->alias(
            function ($post_id, $key, $value) use (&$written) {
                $written[$key] = $value;
                return true;
            }
        );
    }

    /**
     * A transition captures a list, and the assignment need not lead it. Reaching
     * for `inputs[0]` would find whichever note the author happened to put first
     * and write no assignment at all.
     */
    public function test_process_transition_input_finds_an_assignment_after_a_note(): void
    {
        $written = array();
        $this->capture_assignments($written);

        $this->manager->process_transition_input(
            42,
            array(
                'to'     => 'review',
                'inputs' => array(
                    array( 'type' => 'textarea', 'note_id' => 'n1', 'note_name' => 'Why' ),
                    array( 'type' => 'assignment', 'meta_key' => 'legal_reviewer', 'assignee_type' => 'user' ),
                ),
            ),
            array(
                'wfp_n1_why'     => 'Because.',
                'legal_reviewer' => 7,
            )
        );

        $this->assertCount(1, $written, 'One assignment written — a note is not one.');

        $assignment = reset($written);
        $this->assertSame(7, $assignment['value']);
        $this->assertSame('user', $assignment['type']);
    }

    /**
     * A transition that captures only notes assigns nothing.
     */
    public function test_process_transition_input_writes_nothing_without_an_assignment(): void
    {
        $written = array();
        $this->capture_assignments($written);

        $this->manager->process_transition_input(
            42,
            array(
                'to'     => 'review',
                'inputs' => array( array( 'type' => 'textarea', 'note_id' => 'n1', 'note_name' => 'Why' ) ),
            ),
            array( 'wfp_n1_why' => 'Because.' )
        );

        $this->assertSame(array(), $written);
    }

    /**
     * A transition carrying no inputs at all is not an error — most transitions
     * capture nothing, and the key is absent rather than empty.
     */
    public function test_process_transition_input_tolerates_a_transition_with_no_inputs(): void
    {
        $written = array();
        $this->capture_assignments($written);

        $this->manager->process_transition_input(42, array( 'to' => 'review' ), array());

        $this->assertSame(array(), $written);
    }

    /**
     * An assignment nobody supplied a value for is skipped rather than written
     * empty — the writer dismissed the picker, and a slot holding nothing would
     * satisfy no gate while looking like it had been filled.
     */
    public function test_process_transition_input_skips_an_assignment_with_no_value(): void
    {
        $written = array();
        $this->capture_assignments($written);

        $this->manager->process_transition_input(
            42,
            array(
                'to'     => 'review',
                'inputs' => array( array( 'type' => 'assignment', 'meta_key' => 'legal_reviewer' ) ),
            ),
            array()
        );

        $this->assertSame(array(), $written);
    }

    // -------------------------------------------------------------------------
    // user_satisfies_requirement — no assignment
    // -------------------------------------------------------------------------

    public function test_returns_false_when_assignment_missing(): void
    {
        Functions\when('get_post_meta')->justReturn(false);

        $this->assertFalse(
            $this->manager->user_satisfies_requirement(1, 1, [ 'meta_key' => 'ai_check', 'match' => 'completed' ])
        );
    }

    // -------------------------------------------------------------------------
    // user_satisfies_requirement — 'completed' match mode (agent gate)
    // -------------------------------------------------------------------------

    public function test_completed_match_with_completed_status_returns_true(): void
    {
        Functions\when('get_post_meta')->justReturn([ 'status' => 'completed', 'type' => 'agent', 'value' => 'agent-1' ]);

        $this->assertTrue(
            $this->manager->user_satisfies_requirement(1, 0, [ 'meta_key' => 'ai_check', 'match' => 'completed' ])
        );
    }

    public function test_completed_match_with_pending_status_returns_false(): void
    {
        Functions\when('get_post_meta')->justReturn([ 'status' => 'pending', 'type' => 'agent', 'value' => 'agent-1' ]);

        $this->assertFalse(
            $this->manager->user_satisfies_requirement(1, 0, [ 'meta_key' => 'ai_check', 'match' => 'completed' ])
        );
    }

    public function test_completed_match_with_expired_status_returns_false(): void
    {
        Functions\when('get_post_meta')->justReturn([ 'status' => 'expired', 'type' => 'agent', 'value' => 'agent-1' ]);

        $this->assertFalse(
            $this->manager->user_satisfies_requirement(1, 0, [ 'meta_key' => 'ai_check', 'match' => 'completed' ])
        );
    }

    // -------------------------------------------------------------------------
    // user_satisfies_requirement — 'current_user' match mode (user gate)
    // -------------------------------------------------------------------------

    public function test_current_user_match_with_completed_assignment_returns_false(): void
    {
        // Non-pending assignments must not satisfy user-gate transitions.
        Functions\when('get_post_meta')->justReturn([ 'status' => 'completed', 'type' => 'user', 'value' => 42 ]);

        $this->assertFalse(
            $this->manager->user_satisfies_requirement(1, 42, [ 'meta_key' => 'editor', 'match' => 'current_user' ])
        );
    }

    public function test_current_user_match_with_matching_user_returns_true(): void
    {
        Functions\when('get_post_meta')->justReturn([ 'status' => 'pending', 'type' => 'user', 'value' => 42 ]);

        $this->assertTrue(
            $this->manager->user_satisfies_requirement(1, 42, [ 'meta_key' => 'editor', 'match' => 'current_user' ])
        );
    }

    public function test_current_user_match_with_different_user_returns_false(): void
    {
        Functions\when('get_post_meta')->justReturn([ 'status' => 'pending', 'type' => 'user', 'value' => 42 ]);

        $this->assertFalse(
            $this->manager->user_satisfies_requirement(1, 99, [ 'meta_key' => 'editor', 'match' => 'current_user' ])
        );
    }
}
