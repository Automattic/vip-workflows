<?php
/**
 * AbilitiesController unit tests.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflows\API\AbilitiesController;
use VIPWorkflows\Abilities\AbilityExecutor;
use VIPWorkflows\Abilities\AbilityResult;
use VIPWorkflows\Abilities\AbilitySettings;
use WP_Error;

class AbilitiesControllerTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        Functions\when( 'get_option' )->justReturn( array() );

        // Availability serialization asks who is reading; individual tests
        // override this where the answer matters.
        Functions\when( 'current_user_can' )->justReturn( true );

        AbilitySettings::get_instance()->clear_cache();
    }

    public function test_get_items_without_category_returns_only_vip_workflows_abilities(): void
    {
        Functions\when( 'wp_get_abilities' )->justReturn(
            array(
                $this->create_ability_stub( 'vip-workflows/readability', 'vip-workflows' ),
                $this->create_ability_stub( 'vip-workflows/web-researcher', 'research' ),
            )
        );

        $controller = $this->create_controller();
        $response   = $controller->get_items( $this->create_request_stub() );
        $data       = $response->get_data();

        $this->assertCount( 1, $data );
        $this->assertSame( 'vip-workflows/readability', $data[0]['id'] );
        $this->assertSame( 'vip-workflows', $data[0]['category'] );
    }

    public function test_get_items_with_research_category_returns_only_research_abilities(): void
    {
        Functions\when( 'wp_get_abilities' )->justReturn(
            array(
                $this->create_ability_stub( 'vip-workflows/readability', 'vip-workflows' ),
                $this->create_ability_stub( 'vip-workflows/web-researcher', 'research' ),
                $this->create_ability_stub( 'vip-workflows/archive-scout', 'research' ),
            )
        );

        $controller = $this->create_controller();
        $response   = $controller->get_items( $this->create_request_stub( array( 'category' => 'research' ) ) );
        $data       = $response->get_data();

        // Strict filter: only 'research' abilities returned, vip-workflows ones excluded.
        $this->assertCount( 2, $data );
        $ids = array_column( $data, 'id' );
        $this->assertContains( 'vip-workflows/web-researcher', $ids );
        $this->assertContains( 'vip-workflows/archive-scout', $ids );
        $this->assertNotContains( 'vip-workflows/readability', $ids );
    }

    public function test_get_items_with_vip_workflows_category_excludes_research_abilities(): void
    {
        Functions\when( 'wp_get_abilities' )->justReturn(
            array(
                $this->create_ability_stub( 'vip-workflows/readability', 'vip-workflows' ),
                $this->create_ability_stub( 'vip-workflows/web-researcher', 'research' ),
            )
        );

        $controller = $this->create_controller();
        $response   = $controller->get_items( $this->create_request_stub( array( 'category' => 'vip-workflows' ) ) );
        $data       = $response->get_data();

        $this->assertCount( 1, $data );
        $this->assertSame( 'vip-workflows/readability', $data[0]['id'] );
        $this->assertNotSame( 'research', $data[0]['category'] );
    }

    public function test_get_items_with_stage_context_returns_only_stage_eligible(): void
    {
        Functions\when( 'wp_get_abilities' )->justReturn(
            array(
                $this->create_ability_stub_with_meta(
                    'workflow-agent-reformat-to-template/reformat-to-template',
                    'vip-workflows',
                    array( 'supports' => array( 'workflow', 'stage' ), 'stage_eligible' => true )
                ),
                $this->create_ability_stub_with_meta(
                    'vip-workflows/readability',
                    'vip-workflows',
                    array( 'supports' => array( 'workflow' ), 'transition_eligible' => true )
                ),
            )
        );

        $controller = $this->create_controller();
        $response   = $controller->get_items( $this->create_request_stub( array( 'context' => 'stage' ) ) );
        $data       = $response->get_data();

        $this->assertCount( 1, $data );
        $this->assertSame( 'workflow-agent-reformat-to-template/reformat-to-template', $data[0]['id'] );
    }

    public function test_get_items_with_stage_context_includes_stage_eligible_plugins_across_categories(): void
    {
        Functions\when( 'wp_get_abilities' )->justReturn(
            array(
                $this->create_ability_stub_with_meta(
                    'workflow-agent-fact-check/fact-check',
                    'research',
                    array( 'supports' => array( 'workflow', 'stage' ), 'stage_eligible' => true )
                ),
                $this->create_ability_stub_with_meta(
                    'vip-workflows/readability',
                    'vip-workflows',
                    array( 'supports' => array( 'workflow' ), 'transition_eligible' => true )
                ),
            )
        );

        $controller = $this->create_controller();
        $response   = $controller->get_items( $this->create_request_stub( array( 'context' => 'stage' ) ) );
        $data       = $response->get_data();

        $this->assertCount( 1, $data );
        $this->assertSame( 'workflow-agent-fact-check/fact-check', $data[0]['id'] );
    }

    public function test_get_items_with_stage_context_excludes_stage_support_without_stage_eligible(): void
    {
        Functions\when( 'wp_get_abilities' )->justReturn(
            array(
                $this->create_ability_stub_with_meta(
                    'workflow-agent-fact-check/fact-check',
                    'research',
                    array( 'supports' => array( 'workflow', 'stage' ), 'stage_eligible' => true )
                ),
                $this->create_ability_stub_with_meta(
                    'workflow-agent-draft-check/draft-check',
                    'research',
                    array( 'supports' => array( 'workflow', 'stage' ), 'stage_eligible' => false )
                ),
            )
        );

        $controller = $this->create_controller();
        $response   = $controller->get_items( $this->create_request_stub( array( 'context' => 'stage' ) ) );
        $data       = $response->get_data();
        $ids        = array_column( $data, 'id' );

        $this->assertSame( array( 'workflow-agent-fact-check/fact-check' ), $ids );
        $this->assertNotContains( 'workflow-agent-draft-check/draft-check', $ids );
    }

    /**
     * These stubs are plain objects, not `VIPWorkflows\Abilities\Ability`, so they
     * exercise the same branch a bare `WP_Ability` takes: no structured
     * availability channel exists, and the key must still be present with an
     * empty group list rather than omitted.
     *
     * Register *selection* is deliberately not asserted here. It depends on a
     * real capability check against a real user, and `wp_register_ability()`
     * silently no-ops outside `wp_abilities_api_init`, so no mocked ability can
     * produce requirements to choose a register for. That contract is pinned in
     * tests/phpunit/Integration/AbilitiesControllerRegisterTest.php.
     */
    public function test_get_items_serializes_an_empty_availability_set_for_an_ability_without_the_structured_channel(): void
    {
        Functions\when( 'current_user_can' )->justReturn( true );
        Functions\when( 'wp_get_abilities' )->justReturn(
            array( $this->create_ability_stub( 'vip-workflows/readability', 'vip-workflows' ) )
        );

        $controller = $this->create_controller();
        $data       = $controller->get_items( $this->create_request_stub() )->get_data();

        $this->assertArrayHasKey( 'availability', $data[0] );
        $this->assertSame(
            array(
                'available' => true,
                'groups'    => array(),
            ),
            $data[0]['availability']
        );
    }

    public function test_get_item_includes_the_availability_key(): void
    {
        Functions\when( 'current_user_can' )->justReturn( true );
        Functions\when( 'wp_get_ability' )->justReturn(
            $this->create_ability_stub( 'vip-workflows/readability', 'vip-workflows' )
        );

        $controller = $this->create_controller();
        $data       = $controller->get_item( $this->create_request_stub( array( 'id' => 'vip-workflows/readability' ) ) )->get_data();

        $this->assertArrayHasKey( 'availability', $data );
        $this->assertSame( array(), $data['availability']['groups'] );
    }

    public function test_get_items_permissions_check_denies_without_edit_posts(): void
    {
        Functions\when( 'current_user_can' )->justReturn( false );

        $controller = $this->create_controller();

        $this->assertFalse( $controller->get_items_permissions_check( $this->create_request_stub( array( 'context' => 'stage' ) ) ) );
    }

    public function test_get_post_results_permissions_check_denies_without_edit_post(): void
    {
        // User has the global edit_posts cap but not edit_post on this specific post.
        Functions\when( 'current_user_can' )->alias(
            fn( $capability, $post_id = null ) => 'edit_posts' === $capability
        );

        $controller = $this->create_controller();
        $result     = $controller->get_post_results_permissions_check(
            $this->create_request_stub( array( 'post_id' => 123 ) )
        );

        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'rest_forbidden', $result->get_error_code() );
    }

    public function test_get_post_results_permissions_check_denies_without_edit_posts(): void
    {
        Functions\when( 'current_user_can' )->justReturn( false );

        $controller = $this->create_controller();
        $result     = $controller->get_post_results_permissions_check(
            $this->create_request_stub( array( 'post_id' => 123 ) )
        );

        $this->assertFalse( $result );
    }

    public function test_get_post_results_permissions_check_allows_with_edit_post(): void
    {
        Functions\when( 'current_user_can' )->alias(
            fn( $capability, $post_id = null ) => in_array( $capability, array( 'edit_posts', 'edit_post' ), true )
        );

        $controller = $this->create_controller();
        $result     = $controller->get_post_results_permissions_check(
            $this->create_request_stub( array( 'post_id' => 123 ) )
        );

        $this->assertTrue( $result );
    }

    public function test_run_ability_permissions_check_denies_without_edit_posts(): void
    {
        Functions\when( 'current_user_can' )->justReturn( false );

        $controller = $this->create_controller();

        $this->assertFalse(
            $controller->run_ability_permissions_check( $this->create_request_stub( array( 'post_id' => 123 ) ) )
        );
    }

    public function test_run_ability_permissions_check_allows_a_post_the_caller_can_edit(): void
    {
        $this->allow_edit_post_on( 123 );

        $controller = $this->create_controller();

        $this->assertTrue(
            $controller->run_ability_permissions_check( $this->create_request_stub( array( 'post_id' => 123 ) ) )
        );
    }

    public function test_run_ability_permissions_check_allows_a_content_only_request(): void
    {
        // No object identifier anywhere, so there is nothing to authorize
        // beyond the global capability. The route documents `content` as the
        // alternative to `post_id`; that path must stay open.
        $this->allow_edit_post_on( 123 );

        $controller = $this->create_controller();

        $this->assertTrue(
            $controller->run_ability_permissions_check(
                $this->create_request_stub( array( 'content' => 'Some prose to analyze.' ) )
            )
        );
    }

    /**
     * The check used to read the top-level `post_id` only. A caller who sent no
     * top-level id skipped the object check entirely, then had `options` supply
     * the id that actually ran.
     */
    public function test_run_ability_permissions_check_denies_an_options_only_post_the_caller_cannot_edit(): void
    {
        $this->allow_edit_post_on( 123 );

        $controller = $this->create_controller();
        $result     = $controller->run_ability_permissions_check(
            $this->create_request_stub( array( 'options' => array( 'post_id' => 456 ) ) )
        );

        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'rest_forbidden', $result->get_error_code() );
    }

    public function test_run_ability_permissions_check_denies_an_options_only_project_the_caller_cannot_edit(): void
    {
        // `project_id` outranks `post_id` when the executor resolves which
        // object a run belongs to, so it carries the same authority and needs
        // the same check.
        $this->allow_edit_post_on( 123 );

        $controller = $this->create_controller();
        $result     = $controller->run_ability_permissions_check(
            $this->create_request_stub( array( 'options' => array( 'project_id' => 456 ) ) )
        );

        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'rest_forbidden', $result->get_error_code() );
    }

    /**
     * Two different ids for one run is a malformed request, not a precedence
     * puzzle. Resolving it silently either way hides the caller's bug behind an
     * authorization decision.
     */
    public function test_run_ability_permissions_check_rejects_a_conflicting_reserved_key(): void
    {
        // The caller can edit both posts, so nothing here is an access failure.
        // The request is refused for being self-contradictory.
        Functions\when( 'current_user_can' )->justReturn( true );

        $controller = $this->create_controller();
        $result     = $controller->run_ability_permissions_check(
            $this->create_request_stub(
                array(
                    'post_id' => 123,
                    'options' => array( 'post_id' => 456 ),
                )
            )
        );

        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'ability_context_conflict', $result->get_error_code() );
        $this->assertSame( 400, $result->get_error_data()['status'] );
    }

    public function test_run_ability_permissions_check_allows_a_reserved_key_that_repeats_the_same_value(): void
    {
        $this->allow_edit_post_on( 123 );

        $controller = $this->create_controller();

        $this->assertTrue(
            $controller->run_ability_permissions_check(
                $this->create_request_stub(
                    array(
                        'post_id' => 123,
                        'options' => array( 'post_id' => 123 ),
                    )
                )
            )
        );
    }

    public function test_run_ability_permissions_check_authorizes_the_string_form_of_an_options_identifier(): void
    {
        // `options` is registered as a free-form object with no sanitize
        // callback, so values arriving inside it have not been through absint
        // the way the top-level `post_id` has.
        $this->allow_edit_post_on( 123 );

        $controller = $this->create_controller();
        $result     = $controller->run_ability_permissions_check(
            $this->create_request_stub( array( 'options' => array( 'post_id' => '456' ) ) )
        );

        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'rest_forbidden', $result->get_error_code() );
    }

    /**
     * The defect was a disagreement between the two entry points: one checked a
     * context the other never executed. This pins them to the same answer.
     */
    public function test_run_ability_executes_against_the_authorized_identifier(): void
    {
        $this->allow_edit_post_on( 123 );

        $executor   = $this->create_recording_executor();
        $controller = $this->create_controller( $executor );

        $controller->run_ability(
            $this->create_request_stub(
                array(
                    'id'      => 'vip-workflows/readability',
                    'post_id' => 123,
                )
            )
        );

        $this->assertSame( 123, $executor->captured['post_id'] );
    }

    public function test_run_ability_passes_non_reserved_options_through_untouched(): void
    {
        $this->allow_edit_post_on( 123 );

        $executor   = $this->create_recording_executor();
        $controller = $this->create_controller( $executor );

        $controller->run_ability(
            $this->create_request_stub(
                array(
                    'id'      => 'vip-workflows/readability',
                    'post_id' => 123,
                    'options' => array(
                        'tone'       => 'formal',
                        'max_length' => 40,
                    ),
                )
            )
        );

        $this->assertSame( 'formal', $executor->captured['tone'] );
        $this->assertSame( 40, $executor->captured['max_length'] );
        $this->assertSame( 123, $executor->captured['post_id'] );
    }

    /**
     * Let the caller hold every capability except `edit_post` on one object.
     *
     * @param int $post_id The only object the caller may edit.
     */
    private function allow_edit_post_on( int $post_id ): void
    {
        Functions\when( 'current_user_can' )->alias(
            fn( $capability, $checked_id = null ) => 'edit_post' === $capability
                ? $post_id === $checked_id
                : true
        );
    }

    /**
     * An executor that records the context it was handed instead of running it.
     *
     * The parent constructor reaches for the repository and the event bus, and
     * neither exists in a unit run; the override is what keeps the double cheap.
     */
    private function create_recording_executor(): AbilityExecutor
    {
        // AbilityResult stamps the acting user onto every row it builds.
        Functions\when( 'get_current_user_id' )->justReturn( 1 );

        return new class extends AbilityExecutor {
            /**
             * Input handed to the last execute() call.
             *
             * @var array
             */
            public array $captured = array();

            // phpcs:ignore Generic.CodeAnalysis.UselessOverridingMethod.Found -- Skips the parent's service lookups.
            public function __construct() {}

            // `$context` is unused here but must be declared: omitting a
            // parameter the parent has is an incompatible signature, and PHP
            // fatals on the class declaration rather than on a call.
            public function execute( string $ability_name, array $input = array(), string $context = '' ): AbilityResult
            {
                $this->captured = $input;

                return AbilityResult::success( $ability_name, array() );
            }
        };
    }

    private function create_ability_stub_with_meta( string $name, string $category, array $meta ): object
    {
        return new class( $name, $category, $meta ) {
            public function __construct(
                private string $name,
                private string $category,
                private array $meta
            ) {}

            public function get_category(): string
            {
                return $this->category;
            }

            public function get_name(): string
            {
                return $this->name;
            }

            public function get_label(): string
            {
                return $this->name;
            }

            public function get_description(): string
            {
                return 'Test ability';
            }

            public function get_input_schema(): array
            {
                return array();
            }

            public function get_meta(): array
            {
                return $this->meta;
            }
        };
    }

    private function create_request_stub( array $params = array() ): object
    {
        return new class( $params ) {
            public function __construct( private array $params ) {}

            public function get_param( string $key )
            {
                return $this->params[ $key ] ?? null;
            }
        };
    }

    private function create_controller( ?AbilityExecutor $executor = null ): AbilitiesController
    {
        $reflection = new \ReflectionClass( AbilitiesController::class );
        $controller = $reflection->newInstanceWithoutConstructor();

        if ( $executor ) {
            ( new \ReflectionProperty( AbilitiesController::class, 'executor' ) )
                ->setValue( $controller, $executor );
        }

        return $controller;
    }

    private function create_ability_stub( string $name, string $category ): object
    {
        return new class( $name, $category ) {
            public function __construct(
                private string $name,
                private string $category
            ) {}

            public function get_category(): string
            {
                return $this->category;
            }

            public function get_name(): string
            {
                return $this->name;
            }

            public function get_label(): string
            {
                return $this->name;
            }

            public function get_description(): string
            {
                return 'Test ability';
            }

            public function get_input_schema(): array
            {
                return array();
            }

            public function get_meta(): array
            {
                return array(
                    'supports' => array(),
                );
            }
        };
    }
}
