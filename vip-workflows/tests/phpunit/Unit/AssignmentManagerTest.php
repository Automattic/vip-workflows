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

    // -------------------------------------------------------------------------
    // validate_assignee_access — judged against the status after the move
    // -------------------------------------------------------------------------

    /**
     * A transition whose one input assigns a user.
     *
     * @return array Transition config.
     */
    private function user_transition(): array
    {
        $transition = $this->role_transition();
        $transition['inputs'][0]['assignee_type'] = 'user';

        return $transition;
    }

    /**
     * Stub post 42 by user 5, stored with $stored_status, and capture the two
     * scoped filters validate_assignee_access() adds.
     *
     * @param string $stored_status Status the post holds now.
     * @param array  $added         Filled with [ hook => callback ].
     */
    private function stub_post_and_capture_filters(string $stored_status, array &$added): \WP_Post
    {
        $post = new \WP_Post(array( 'ID' => 42, 'post_author' => 5, 'post_status' => $stored_status, 'post_type' => 'post' ));
        Functions\when('get_post_status')->justReturn($stored_status);
        Functions\when('get_post_status_object')->alias(
            fn($status) => in_array($status, array( 'draft', 'pending', 'publish', 'future', 'private' ), true ) ? (object) array( 'name' => $status ) : null
        );
        Functions\when('get_post')->justReturn($post);
        Functions\when('get_post_type_object')->justReturn(
            (object) array(
                'map_meta_cap' => true,
                'cap'          => (object) array(
                    'edit_published_posts' => 'edit_published_stories',
                    'edit_private_posts'   => 'edit_private_stories',
                ),
            )
        );
        Functions\when('get_userdata')->alias(fn($user_id) => (object) array( 'display_name' => 'User ' . $user_id ));

        // The unit TestCase stubs add_filter() as a no-op; keep what is added,
        // and drop it again on remove_filter(), like the hook registry would.
        Functions\when('add_filter')->alias(
            function ($hook, $callback) use (&$added) {
                $added[ $hook ] = $callback;
                return true;
            }
        );
        Functions\when('remove_filter')->alias(
            function ($hook, $callback) use (&$added) {
                if (isset($added[ $hook ]) && $added[ $hook ] === $callback) {
                    unset($added[ $hook ]);
                    return true;
                }
                return false;
            }
        );

        return $post;
    }

    /**
     * A draft->publish move asks read_post with the post seen as published, so
     * an assignee who can read only published posts is accepted.
     */
    public function test_user_access_is_judged_against_the_status_after_the_move(): void
    {
        $added = array();
        $post  = $this->stub_post_and_capture_filters('draft', $added);
        Functions\when('user_can')->alias(
            function ($user_id, $cap, $post_id) use (&$added, $post) {
                // What map_meta_cap( 'read_post' ) would see through get_post_status().
                return 'publish' === $added['get_post_status']('draft', $post);
            }
        );

        $this->assertTrue($this->manager->validate_assignee_access(42, $this->user_transition(), array( 'desk' => 11 ), 'publish'));
        $this->assertSame(array(), $added, 'The scoped filters must not outlive the check.');
    }

    /**
     * The status filter answers only for this post.
     */
    public function test_status_filter_leaves_other_posts_alone(): void
    {
        $added = array();
        $this->stub_post_and_capture_filters('draft', $added);
        Functions\when('user_can')->alias(
            function () use (&$added) {
                return 'draft' === $added['get_post_status']('draft', new \WP_Post(array( 'ID' => 99 )));
            }
        );

        $this->assertTrue($this->manager->validate_assignee_access(42, $this->user_transition(), array( 'desk' => 11 ), 'publish'));
    }

    /**
     * Core's edit_post mapping reads the stored status for a non-author. The
     * capability it adds for that status is swapped for the target's, using
     * the post type's own capability names.
     */
    public function test_edit_post_mapping_follows_the_status_after_the_move(): void
    {
        $added = array();
        $this->stub_post_and_capture_filters('publish', $added);
        $seen = array();
        Functions\when('user_can')->alias(
            function () use (&$added, &$seen) {
                $map    = $added['map_meta_cap'];
                $seen[] = $map(array( 'edit_others_stories', 'edit_published_stories' ), 'edit_post', 11, array( 42 ));
                // The author's own mapping and other posts are left alone.
                $seen[] = $map(array( 'edit_published_stories' ), 'edit_post', 5, array( 42 ));
                $seen[] = $map(array( 'edit_others_stories', 'edit_published_stories' ), 'edit_post', 11, array( 99 ));
                $seen[] = $map(array( 'read' ), 'read_post', 11, array( 42 ));
                return false;
            }
        );

        $result = $this->manager->validate_assignee_access(42, $this->user_transition(), array( 'desk' => 11 ), 'draft');

        $this->assertSame('assignee_cannot_read', $result->get_error_code());
        $this->assertSame(
            array(
                array( 'edit_others_stories' ),
                array( 'edit_published_stories' ),
                array( 'edit_others_stories', 'edit_published_stories' ),
                array( 'read' ),
            ),
            $seen
        );
    }

    public function test_edit_post_mapping_adds_the_published_cap_for_a_scheduled_target(): void
    {
        $added = array();
        $this->stub_post_and_capture_filters('draft', $added);
        $seen = null;
        Functions\when('user_can')->alias(
            function () use (&$added, &$seen) {
                $seen = $added['map_meta_cap'](array( 'edit_others_stories' ), 'edit_post', 11, array( 42 ));
                return true;
            }
        );

        $this->assertTrue($this->manager->validate_assignee_access(42, $this->user_transition(), array( 'desk' => 11 ), 'future'));
        $this->assertSame(array( 'edit_others_stories', 'edit_published_stories' ), $seen);
    }

    /**
     * A move that leaves the status alone asks read_post as before, with no filters.
     */
    public function test_same_status_check_adds_no_filters(): void
    {
        Functions\when('get_post_status')->justReturn('draft');
        Functions\when('get_userdata')->alias(fn($user_id) => (object) array( 'display_name' => 'User ' . $user_id ));
        Functions\expect('add_filter')->never();
        Functions\expect('user_can')->once()->with(11, 'read_post', 42)->andReturn(false);

        $result = $this->manager->validate_assignee_access(42, $this->user_transition(), array( 'desk' => 11 ), 'draft');

        $this->assertSame('assignee_cannot_read', $result->get_error_code());
        $this->assertSame(400, $result->get_error_data()['status']);
    }

    /**
     * An unregistered target status is a data-integrity error, not a pass.
     */
    public function test_unresolvable_target_status_is_an_error(): void
    {
        Functions\when('get_post_status')->justReturn('draft');
        Functions\when('get_post_status_object')->justReturn(null);
        Functions\expect('user_can')->never();

        $result = $this->manager->validate_assignee_access(42, $this->user_transition(), array( 'desk' => 11 ), 'gone');

        $this->assertInstanceOf(\WP_Error::class, $result);
        $this->assertSame('assignee_access_unresolved', $result->get_error_code());
        $this->assertSame(409, $result->get_error_data()['status']);
    }

    /**
     * With no user assignee there is nothing to check.
     */
    public function test_no_user_assignee_needs_no_status(): void
    {
        Functions\expect('get_post_status')->never();
        Functions\expect('user_can')->never();

        $this->assertTrue($this->manager->validate_assignee_access(42, $this->role_transition(), array( 'desk' => 'contributor' ), 'gone'));
        $this->assertTrue($this->manager->validate_assignee_access(42, $this->user_transition(), array( 'desk' => '' ), 'gone'));
    }
}
