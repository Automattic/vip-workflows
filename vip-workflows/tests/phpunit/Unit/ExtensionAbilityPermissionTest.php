<?php
/**
 * Object-level authorization in extension ability permission callbacks.
 *
 * An ability's permission callback is the only gate core's abilities endpoint,
 * WP-CLI and MCP consult before execution. A callback that asks the global
 * `edit_posts` question establishes that the caller is *an* editor, not that
 * they may touch *this* object — so several extensions read post content, and
 * in some cases forwarded it to an external provider, for any ID they were
 * handed.
 *
 * These tests hold every extension ability still shipped in core to the shape
 * `workflow-tool-checklist` already uses: refuse the object the caller cannot
 * edit, in the callback itself.
 *
 * Originally covered six abilities plus a dedicated block for
 * `workflow-tool-minimum-pins`'s project-enumeration-safety check; four of
 * those abilities and minimum-pins itself now live in external extension
 * plugins. The main object-scoped-auth
 * contract keeps real coverage from the two abilities that still ship
 * (`copy-edit`, `tag-sanity-check`) — the contract is `can_execute()`'s, not
 * any individual ability's, so two working examples prove it as well as six
 * did. Minimum-pins' enumeration-safety pattern (a `project_id` rather than a
 * `post_id`, answering an unknown object exactly like a forbidden one) had no
 * remaining in-core example to test against and was removed rather than
 * built into a third synthetic fixture, since object-scoped auth in general
 * is already covered above.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use WP_Error;

/**
 * Tests object-scoped authorization across the `workflow-*` extension abilities.
 */
class ExtensionAbilityPermissionTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        /*
         * Required after the WP function stubs are in place, not at file scope:
         * the agent plugin files call add_action() as they load, and the tool
         * files carry an ABSPATH guard.
         */
        $repo = dirname( __DIR__, 4 );

        require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/helpers.php';
        require_once $repo . '/workflow-agent-copy-edit/workflow-agent-copy-edit.php';
        require_once $repo . '/workflow-agent-tag-sanity-check/workflow-agent-tag-sanity-check.php';
    }

    /**
     * Abilities that read post content, keyed by a readable label.
     *
     * @return array<string, array{0: callable}>
     */
    public static function post_scoped_abilities(): array
    {
        return array(
            'copy-edit agent'  => array( 'WorkflowAgentCopyEdit\can_execute' ),
            'tag-sanity agent' => array( 'WorkflowAgentTagSanityCheck\can_execute' ),
        );
    }

    /**
     * @dataProvider post_scoped_abilities
     */
    public function test_refuses_a_post_the_caller_cannot_edit( callable $can_execute ): void
    {
        $this->allow_edit_post_only_on( 123 );

        $result = $can_execute( array( 'post_id' => 456 ) );

        $this->assertInstanceOf( WP_Error::class, $result, 'Expected a refusal, not a permitted run.' );
        $this->assertSame( 'forbidden', $result->get_error_code() );
    }

    /**
     * @dataProvider post_scoped_abilities
     */
    public function test_permits_a_post_the_caller_can_edit( callable $can_execute ): void
    {
        $this->allow_everything();

        $this->assertTrue( $can_execute( array( 'post_id' => 123 ) ) );
    }

    /**
     * @dataProvider post_scoped_abilities
     */
    public function test_refuses_when_no_post_is_named( callable $can_execute ): void
    {
        // Required fields are required: an ability that reads a post cannot be
        // asked to authorize one that was never named.
        $this->allow_everything();

        $this->assertInstanceOf( WP_Error::class, $can_execute( array() ) );
    }

    /**
     * A refusal must not carry array error-data.
     *
     * `AbilityExecutor` reads a `WP_Error` whose data is an array as a *success*
     * payload, so a denial shaped that way would be stored and reported as a
     * successful ability result — the failure mode is silent, which is why this
     * is asserted rather than left to the helper's docblock.
     *
     * @dataProvider post_scoped_abilities
     */
    public function test_refusal_carries_no_array_error_data( callable $can_execute ): void
    {
        $this->allow_edit_post_only_on( 123 );

        $result = $can_execute( array( 'post_id' => 456 ) );

        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertIsNotArray( $result->get_error_data() );
    }

    /**
     * Let the caller edit exactly one object and nothing else.
     *
     * Denying only the object under test would leave every other ID — including
     * ones that do not exist — permitted, which real WordPress does not do:
     * `edit_post` against an unknown ID maps to `do_not_allow`. Modelling the
     * allow-list rather than a single denial keeps the enumeration test honest.
     *
     * @param int $post_id The only object the caller may edit.
     */
    private function allow_edit_post_only_on( int $post_id ): void
    {
        Functions\when( 'current_user_can' )->alias(
            fn( $capability, $checked_id = null ) => 'edit_post' === $capability
                ? $post_id === $checked_id
                : true
        );
    }

    private function allow_everything(): void
    {
        Functions\when( 'current_user_can' )->justReturn( true );
    }
}
