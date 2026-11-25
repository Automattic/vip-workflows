<?php
/**
 * The assignee role filter, as AssignmentManager reads it.
 *
 * Covers how `filter.roles` is read and what the refusal says. The transition
 * route, with real users and roles, runs in the integration suite
 * (AssigneeRoleFilterTest).
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflows\Workflow\AssignmentManager;

/**
 * Tests for the role filter on a user assignee.
 */
class AssigneeRoleFilterValidationTest extends TestCase
{
    /**
     * Users by ID, as get_userdata() reports them.
     *
     * @var array<int, object>
     */
    private array $users = array();

    protected function setUp(): void
    {
        parent::setUp();

        $this->users = array(
            7 => (object) array(
                'ID'           => 7,
                'display_name' => 'Eli Editor',
                'roles'        => array( 'editor' ),
            ),
            8 => (object) array(
                'ID'           => 8,
                'display_name' => 'Avery Author',
                'roles'        => array( 'author' ),
            ),
            9 => (object) array(
                'ID'           => 9,
                'display_name' => 'Pat Photo',
                'roles'        => array( 'author', 'photo_editor' ),
            ),
        );

        Functions\when( 'get_userdata' )->alias(
            function ( $user_id ) {
                return $this->users[ (int) $user_id ] ?? false;
            }
        );
    }

    /**
     * A transition with one assignment input under the meta key `reviewer`.
     *
     * @param  mixed  $filter        The input's `filter` value, or null for none.
     * @param  string $assignee_type Assignee type.
     * @return array<string, mixed>
     */
    private function transition( $filter, string $assignee_type = 'user' ): array
    {
        $input = array(
            'type'          => 'assignment',
            'meta_key'      => 'reviewer',
            'assignee_type' => $assignee_type,
            'label'         => 'Reviewer',
        );

        if ( null !== $filter ) {
            $input['filter'] = $filter;
        }

        return array(
            'to'     => 'review',
            'inputs' => array( $input ),
        );
    }

    /**
     * Validate an assignee against a filter.
     *
     * @param  mixed $filter   The input's `filter` value.
     * @param  mixed $assignee Assignee value.
     * @return true|\WP_Error
     */
    private function validate( $filter, $assignee )
    {
        return ( new AssignmentManager() )->validate_transition_assignees( $this->transition( $filter ), array( 'reviewer' => $assignee ) );
    }

    public function test_refuses_a_user_without_the_role_and_names_the_field_and_the_role(): void
    {
        $result = $this->validate( array( 'roles' => array( 'editor' ) ), 8 );

        $this->assertInstanceOf( \WP_Error::class, $result );
        $this->assertSame( 'assignee_role_not_allowed', $result->get_error_code() );
        $this->assertSame( 'Avery Author can’t be assigned to “Reviewer”. Choose someone with the Editor role.', $result->get_error_message() );
        $this->assertSame(
            array(
                'status'   => 400,
                'meta_key' => 'reviewer',
                'user_id'  => 8,
                'roles'    => array( 'editor' ),
            ),
            $result->get_error_data()
        );
    }

    public function test_names_several_roles_and_shows_an_unregistered_slug_as_it_is(): void
    {
        $result = $this->validate( array( 'roles' => array( 'editor', 'photo_desk' ) ), 8 );

        $this->assertInstanceOf( \WP_Error::class, $result );
        $this->assertSame(
            'Avery Author can’t be assigned to “Reviewer”. Choose someone with one of these roles: Editor, photo_desk.',
            $result->get_error_message()
        );
    }

    public function test_accepts_a_user_with_the_role(): void
    {
        $this->assertTrue( $this->validate( array( 'roles' => array( 'editor' ) ), 7 ) );
    }

    public function test_accepts_a_user_who_holds_any_one_of_the_roles(): void
    {
        $this->assertTrue( $this->validate( array( 'roles' => array( 'editor', 'photo_editor' ) ), 9 ) );
        $this->assertTrue( $this->validate( array( 'roles' => array( 'photo_editor' ) ), 9 ) );
    }

    public function test_accepts_a_user_id_sent_as_a_string(): void
    {
        $this->assertTrue( $this->validate( array( 'roles' => array( 'editor' ) ), '7' ) );
        $this->assertInstanceOf( \WP_Error::class, $this->validate( array( 'roles' => array( 'editor' ) ), '8' ) );
    }

    /**
     * The picker's route reads its role list through sanitize_key(), so an
     * imported sequence's slugs are read the same way here.
     */
    public function test_reads_role_slugs_the_way_the_picker_does(): void
    {
        $filter = array( 'roles' => array( ' editor ', '', null, 5, array( 'author' ) ) );

        $this->assertTrue( $this->validate( $filter, 7 ) );

        $refusal = $this->validate( $filter, 8 );
        $this->assertInstanceOf( \WP_Error::class, $refusal );
        $this->assertSame( array( 'editor' ), $refusal->get_error_data()['roles'] );
    }

    /**
     * Filters that name no usable role. The picker lists every user for these.
     *
     * @return array<string, array{0: mixed}>
     */
    public static function provide_filters_that_limit_nothing(): array
    {
        return array(
            'no filter'               => array( null ),
            'an empty filter'         => array( array() ),
            'an empty role list'      => array( array( 'roles' => array() ) ),
            'a role list of blanks'   => array( array( 'roles' => array( '', '  ' ) ) ),
            'a role list of one text' => array( array( 'roles' => 'editor' ) ),
            'a filter that is text'   => array( 'editor' ),
        );
    }

    /**
     * @dataProvider provide_filters_that_limit_nothing
     *
     * @param mixed $filter The input's `filter` value.
     */
    public function test_a_filter_with_no_usable_role_limits_nothing( $filter ): void
    {
        $this->assertTrue( $this->validate( $filter, 8 ) );
    }

    public function test_a_role_assignee_is_not_held_to_the_filter(): void
    {
        Functions\when( 'wp_roles' )->justReturn(
            new class() {
                /**
                 * Role display names.
                 *
                 * @var array<string, string>
                 */
                public array $role_names = array( 'author' => 'Author' );

                /**
                 * Whether a role is registered.
                 *
                 * @param  string $role Role slug.
                 * @return bool
                 */
                public function is_role( $role ): bool {
                    return 'author' === $role;
                }
            }
        );

        $result = ( new AssignmentManager() )->validate_transition_assignees(
            $this->transition( array( 'roles' => array( 'editor' ) ), 'role' ),
            array( 'reviewer' => 'author' )
        );

        $this->assertTrue( $result );
    }

    public function test_an_empty_selection_is_left_to_the_required_rule(): void
    {
        $this->assertTrue( $this->validate( array( 'roles' => array( 'editor' ) ), '' ) );
        $this->assertTrue( $this->validate( array( 'roles' => array( 'editor' ) ), null ) );
    }

    public function test_a_user_who_does_not_exist_still_gets_the_existing_error(): void
    {
        $result = $this->validate( array( 'roles' => array( 'editor' ) ), 404 );

        $this->assertInstanceOf( \WP_Error::class, $result );
        $this->assertSame( 'invalid_assignee', $result->get_error_code() );
    }
}
