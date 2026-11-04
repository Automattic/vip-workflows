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
    // get_assignee_access_warnings — role assignees the role cannot all read
    // -------------------------------------------------------------------------

    /**
     * A transition whose one input assigns a role.
     *
     * @return array Transition config.
     */
    private function role_transition(): array
    {
        return array(
            'to'     => 'review',
            'inputs' => array(
                array(
                    'type'          => 'assignment',
                    'meta_key'      => 'desk',
                    'assignee_type' => 'role',
                ),
            ),
        );
    }

    /**
     * Stub the role registry with one role whose members are the given IDs.
     *
     * @param array $member_ids Users holding the role.
     * @param array $role_caps  Capabilities the role grants.
     */
    private function stub_role(array $member_ids, array $role_caps = array()): void
    {
        $role = \Mockery::mock('WP_Role');
        $role->shouldReceive('has_cap')->andReturnUsing(fn($cap) => in_array($cap, $role_caps, true));
        Functions\when('get_role')->alias(fn($slug) => 'contributor' === $slug ? $role : null);
        Functions\when('get_users')->justReturn($member_ids);
        $roles = \Mockery::mock('WP_Roles');
        $roles->shouldReceive('get_names')->andReturn(array( 'contributor' => 'Contributor' ));
        Functions\when('wp_roles')->justReturn($roles);
        Functions\when('translate_user_role')->returnArg();
    }

    public function test_role_with_some_members_unable_to_read_is_flagged(): void
    {
        $this->stub_role(array( 3, 4 ));
        Functions\when('user_can')->alias(fn($user_id) => 3 === (int) $user_id);

        $warnings = $this->manager->get_assignee_access_warnings(42, $this->role_transition(), array( 'desk' => 'contributor' ));

        $this->assertSame(
            array(
                array(
                    'type'     => 'assignee_cannot_read',
                    'meta_key' => 'desk',
                    'role'     => 'contributor',
                    'message'  => 'Some people with the Contributor role can’t open this post, so the assignment won’t appear in their My Work.',
                ),
            ),
            $warnings
        );
    }

    public function test_role_with_no_member_able_to_read_says_no_one(): void
    {
        $this->stub_role(array( 3, 4 ));
        Functions\when('user_can')->justReturn(false);

        $warnings = $this->manager->get_assignee_access_warnings(42, $this->role_transition(), array( 'desk' => 'contributor' ));

        $this->assertCount(1, $warnings);
        $this->assertSame('No one with the Contributor role can open this post, so the assignment won’t appear in anyone’s My Work.', $warnings[0]['message']);
    }

    public function test_role_whose_members_can_all_read_is_not_flagged(): void
    {
        $this->stub_role(array( 3, 4 ));
        Functions\when('user_can')->justReturn(true);

        $this->assertSame(array(), $this->manager->get_assignee_access_warnings(42, $this->role_transition(), array( 'desk' => 'contributor' )));
    }

    public function test_empty_role_is_judged_by_its_own_capabilities(): void
    {
        Functions\when('map_meta_cap')->justReturn(array( 'edit_others_posts' ));

        $this->stub_role(array(), array( 'read' ));
        $this->assertCount(1, $this->manager->get_assignee_access_warnings(42, $this->role_transition(), array( 'desk' => 'contributor' )));

        $this->stub_role(array(), array( 'read', 'edit_others_posts' ));
        $this->assertSame(array(), $this->manager->get_assignee_access_warnings(42, $this->role_transition(), array( 'desk' => 'contributor' )));
    }

    public function test_user_and_cleared_slots_raise_no_role_warning(): void
    {
        Functions\expect('get_users')->never();
        $transition = $this->role_transition();

        $this->assertSame(array(), $this->manager->get_assignee_access_warnings(42, $transition, array( 'desk' => '' )));
        $this->assertSame(array(), $this->manager->get_assignee_access_warnings(42, $transition, array()));

        $transition['inputs'][0]['assignee_type'] = 'user';
        $this->assertSame(array(), $this->manager->get_assignee_access_warnings(42, $transition, array( 'desk' => 7 )));
    }
}
