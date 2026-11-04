<?php
/**
 * AssignmentManager unit tests.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflows\Workflow\AssignmentManager;

class AssignmentManagerTest extends TestCase
{
    private AssignmentManager $manager;

    /**
     * Database global to restore after a test replaces it.
     *
     * @var mixed
     */
    private $previous_wpdb;

    protected function setUp(): void
    {
        global $wpdb;
        parent::setUp();
        $this->manager       = new AssignmentManager();
        $this->previous_wpdb = $wpdb;
    }

    protected function tearDown(): void
    {
        global $wpdb;
        // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- Restore the saved database global.
        $wpdb = $this->previous_wpdb;
        parent::tearDown();
    }

    // -------------------------------------------------------------------------
    // check_transition_input_keys — only declared keys are accepted
    // -------------------------------------------------------------------------

    /**
     * A transition with an assignment input and a retired free-text note.
     *
     * @return array
     */
    private function transition_with_assignment(): array
    {
        return array(
            'to'     => 'review',
            'inputs' => array(
                array( 'type' => 'textarea', 'note_id' => 'n1', 'note_name' => 'Why' ),
                array( 'type' => 'assignment', 'meta_key' => 'legal_reviewer', 'assignee_type' => 'user' ),
            ),
        );
    }

    /**
     * The assignment's value, notes and their labels are accepted.
     */
    public function test_check_transition_input_keys_accepts_the_assignment_keys(): void
    {
        $this->assertTrue(
            $this->manager->check_transition_input_keys(
                $this->transition_with_assignment(),
                array(
                    'legal_reviewer'             => 7,
                    'legal_reviewer__name'       => 'Legal reviewer',
                    'legal_reviewer_notes'       => 'Check the claims.',
                    'legal_reviewer_notes__name' => 'Notes',
                )
            )
        );
    }

    /**
     * Any other key, including a retired note's `wfp_` key, is a 400 that
     * names the key.
     *
     * @dataProvider undeclared_input_provider
     *
     * @param array  $input    Submitted input.
     * @param string $expected The key the error should name.
     */
    public function test_check_transition_input_keys_rejects_an_undeclared_key( array $input, string $expected ): void
    {
        $result = $this->manager->check_transition_input_keys($this->transition_with_assignment(), $input);

        $this->assertInstanceOf(\WP_Error::class, $result);
        $this->assertSame('unknown_transition_input', $result->get_error_code());
        $this->assertSame(400, $result->get_error_data()['status']);
        $this->assertSame($expected, $result->get_error_data()['key']);
        $this->assertSame(
            'This transition doesn’t accept the “' . $expected . '” input.',
            $result->get_error_message()
        );
    }

    /**
     * Undeclared input mixed with or without declared input.
     *
     * @return array
     */
    public static function undeclared_input_provider(): array
    {
        return array(
            'retired note'           => array( array( 'legal_reviewer' => 7, 'wfp_n1_why' => 'Because.' ), 'wfp_n1_why' ),
            'arbitrary key'          => array( array( 'other' => 'Arbitrary.' ), 'other' ),
            'retired note label'     => array( array( 'wfp_n1_why__name' => 'Why' ), 'wfp_n1_why__name' ),
            'another slot\'s key'    => array( array( 'approver' => 'editor' ), 'approver' ),
        );
    }

    /**
     * A transition that declares no assignment, or no authored edge at all,
     * accepts no input.
     */
    public function test_check_transition_input_keys_rejects_everything_without_an_assignment(): void
    {
        $input = array( 'legal_reviewer' => 7 );

        $no_assignment = array(
            'to'     => 'review',
            'inputs' => array(
                array( 'type' => 'textarea', 'note_id' => 'n1', 'note_name' => 'Why' ),
            ),
        );

        foreach ( array( $no_assignment, array( 'to' => 'review' ), null ) as $transition ) {
            $result = $this->manager->check_transition_input_keys($transition, $input);
            $this->assertInstanceOf(\WP_Error::class, $result);
            $this->assertSame('legal_reviewer', $result->get_error_data()['key']);
        }

        $this->assertTrue($this->manager->check_transition_input_keys(null, array()));
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
     * for `inputs[0]` would find a retired note a stored sequence still carries
     * ahead of it, and write no assignment at all.
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
     * name no assignee while looking like it had been filled. This is the
     * ABSENT-key case: the transition itself may carry no assignment input,
     * so `input_data` never mentioning the slot must not touch it.
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
    // process_transition_input / unassign — clearing an optional assignment
    // -------------------------------------------------------------------------

    /**
     * Stub get_post_meta/delete_post_meta for unassign(), seeded with an
     * existing assignment.
     *
     * @param array $existing Assignment array `get_post_meta` should answer
     *                        with for any key (simulates one already stored).
     * @param array $deleted  Filled with every storage key delete_post_meta
     *                        was called with.
     */
    private function capture_unassign(array $existing, array &$deleted): void
    {
        Functions\when('get_post_meta')->alias(
            function ($post_id, $key, $single) use ($existing) {
                return $existing;
            }
        );
        Functions\when('delete_post_meta')->alias(
            function ($post_id, $key) use (&$deleted) {
                $deleted[] = $key;
                return true;
            }
        );
    }

    /**
     * An explicit empty value — present in input_data, unlike the "skipped"
     * case above — clears whatever was previously assigned. This is the one
     * way an optional assignment popover has to submit "no one" after a
     * prior assignment.
     */
    public function test_process_transition_input_clears_an_assignment_submitted_empty(): void
    {
        $written = array();
        $this->capture_assignments($written);
        $deleted = array();
        $this->capture_unassign(
            array( 'value' => 7, 'type' => 'user', 'status' => 'pending' ),
            $deleted
        );

        $this->manager->process_transition_input(
            42,
            array(
                'to'     => 'review',
                'inputs' => array( array( 'type' => 'assignment', 'meta_key' => 'legal_reviewer' ) ),
            ),
            array( 'legal_reviewer' => '' )
        );

        $this->assertSame(array(), $written, 'Clearing must not also write a new assignment.');
        $this->assertSame(array( '_vip_workflows_assignment_legal_reviewer' ), $deleted);
    }

    /**
     * unassign() deletes the slot's post meta when something was there.
     */
    public function test_unassign_deletes_an_existing_assignment(): void
    {
        $deleted = array();
        $this->capture_unassign(
            array( 'value' => 7, 'type' => 'user', 'status' => 'pending' ),
            $deleted
        );

        $this->manager->unassign(42, 'legal_reviewer');

        $this->assertSame(array( '_vip_workflows_assignment_legal_reviewer' ), $deleted);
    }

    /**
     * unassign() is a no-op, not an error, when the slot was never assigned —
     * "reach a state with nothing here", not "undo a specific assignment".
     */
    public function test_unassign_is_a_noop_when_nothing_was_assigned(): void
    {
        $deleted = array();
        Functions\when('get_post_meta')->justReturn('');
        Functions\when('delete_post_meta')->alias(
            function ($post_id, $key) use (&$deleted) {
                $deleted[] = $key;
                return true;
            }
        );

        $this->manager->unassign(42, 'legal_reviewer');

        $this->assertSame(array(), $deleted);
    }

    // -------------------------------------------------------------------------
    // assign — per-type on_assign handlers
    // -------------------------------------------------------------------------

    /**
     * Answer the `vip_workflows_assignee_types` filter with the given handlers.
     *
     * @param array      $handlers Handlers keyed by assignee type.
     * @param array|null $default  Filled with the value the manager passed in.
     */
    private function register_assignee_type_handlers( array $handlers, ?array &$default ): void
    {
        Functions\when('apply_filters')->alias(
            function ($tag, $value) use ($handlers, &$default) {
                if ('vip_workflows_assignee_types' !== $tag) {
                    return $value;
                }
                $default = $value;
                return $handlers;
            }
        );
    }

    /**
     * An extension's `on_assign` handler, registered through the
     * `vip_workflows_assignee_types` filter, runs with the post, the assigned
     * value and the input config. The built-in types register none, so the
     * filter starts empty.
     */
    public function test_assign_runs_the_on_assign_handler_for_its_type(): void
    {
        $written = array();
        $this->capture_assignments($written);

        $calls   = array();
        $default = null;
        $this->register_assignee_type_handlers(
            array(
                'team' => array(
                    'on_assign' => function ($post_id, $value, $config) use (&$calls) {
                        $calls[] = array( $post_id, $value, $config );
                    },
                ),
            ),
            $default
        );

        $config = array( 'meta_key' => 'desk', 'assignee_type' => 'team' );
        $this->manager->assign(42, 'desk', 'news', 'team', $config);

        $this->assertSame(array(), $default, 'Built-in types register no handler.');
        $this->assertSame(array( array( 42, 'news', $config ) ), $calls);
    }

    /**
     * A handler registered for another type does not run.
     */
    public function test_assign_runs_no_handler_for_a_type_without_one(): void
    {
        $written = array();
        $this->capture_assignments($written);

        $calls   = 0;
        $default = null;
        $this->register_assignee_type_handlers(
            array(
                'team' => array(
                    'on_assign' => function () use (&$calls) {
                        ++$calls;
                    },
                ),
            ),
            $default
        );

        $this->manager->assign(42, 'legal_reviewer', 7, 'user');

        $this->assertSame(0, $calls);
        $this->assertSame('user', $written['_vip_workflows_assignment_legal_reviewer']['type']);
    }

    // -------------------------------------------------------------------------
    // process_transition_input — conditional writes against an expected slot
    // -------------------------------------------------------------------------

    /**
     * Replace wpdb with a double whose conditional delete reports $rows.
     *
     * @param int|false $rows    Rows the DELETE reports.
     * @param array     $deletes Filled with each DELETE's WHERE clause.
     * @param array     $actions Filled with each fired action name.
     */
    private function conditional_delete_reports( $rows, array &$deletes, array &$actions ): void
    {
        global $wpdb;
        // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- Unit double; restored in tearDown().
        $wpdb           = \Mockery::mock('wpdb');
        $wpdb->postmeta = 'wp_postmeta';
        $wpdb->shouldReceive('delete')->andReturnUsing(
            function ($table, $where) use ($rows, &$deletes) {
                $deletes[] = $where;
                return $rows;
            }
        );
        Functions\when('maybe_serialize')->alias(fn($value) => serialize($value)); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.serialize_serialize -- Mirrors core.
        Functions\when('do_action')->alias(
            function ($hook) use (&$actions) {
                $actions[] = $hook;
            }
        );
    }

    /**
     * The optional-assignment transition the clear tests submit an empty value to.
     *
     * @return array
     */
    private function optional_assignment_transition(): array
    {
        return array(
            'to'     => 'draft',
            'inputs' => array(
                array( 'type' => 'assignment', 'meta_key' => 'legal_reviewer', 'assignee_type' => 'user', 'label' => 'Legal reviewer' ),
            ),
        );
    }

    /**
     * Clearing a slot that still holds what was read deletes it by that value.
     */
    public function test_conditional_clear_deletes_the_slot_it_read(): void
    {
        $deletes  = array();
        $actions  = array();
        $previous = array( 'value' => 7, 'type' => 'user', 'status' => 'pending' );
        $this->conditional_delete_reports(1, $deletes, $actions);

        $result = $this->manager->process_transition_input(
            42,
            $this->optional_assignment_transition(),
            array( 'legal_reviewer' => '' ),
            array( 'legal_reviewer' => $previous )
        );

        $this->assertSame(array(), $result);
        $this->assertSame(serialize($previous), $deletes[0]['meta_value']); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.serialize_serialize -- Expected column value.
        $this->assertSame('_vip_workflows_assignment_legal_reviewer', $deletes[0]['meta_key']);
        $this->assertSame(array( 'vip_workflows_assignment_removed' ), $actions);
    }

    /**
     * Clearing a slot another request reassigned in the meantime is a 409,
     * and the reassignment is not deleted or announced as removed.
     */
    public function test_conditional_clear_of_a_changed_slot_is_a_conflict(): void
    {
        $deletes = array();
        $actions = array();
        $this->conditional_delete_reports(0, $deletes, $actions);

        $result = $this->manager->process_transition_input(
            42,
            $this->optional_assignment_transition(),
            array( 'legal_reviewer' => '' ),
            array( 'legal_reviewer' => array( 'value' => 7, 'type' => 'user', 'status' => 'pending' ) )
        );

        $this->assertInstanceOf(\WP_Error::class, $result);
        $this->assertSame('assignment_conflict', $result->get_error_code());
        $this->assertSame(409, $result->get_error_data()['status']);
        $this->assertStringContainsString('Legal reviewer', $result->get_error_message());
        $this->assertSame(array(), $actions);
    }

    /**
     * A database error is a 500, not a conflict.
     */
    public function test_conditional_write_database_error_is_a_failure(): void
    {
        $deletes = array();
        $actions = array();
        $this->conditional_delete_reports(false, $deletes, $actions);

        $result = $this->manager->process_transition_input(
            42,
            $this->optional_assignment_transition(),
            array( 'legal_reviewer' => '' ),
            array( 'legal_reviewer' => array( 'value' => 7, 'type' => 'user', 'status' => 'pending' ) )
        );

        $this->assertInstanceOf(\WP_Error::class, $result);
        $this->assertSame('assignment_write_failed', $result->get_error_code());
        $this->assertSame(500, $result->get_error_data()['status']);
    }
}
