<?php
/**
 * Runtime availability gates: what they store, and how it reads back.
 *
 * Lives in the integration suite because both gates only reach the structured
 * channel through a `VIPWorkflows\Abilities\Ability` resolved out of the registry,
 * and abilities can only be registered while `wp_abilities_api_init` is running —
 * `wp_register_ability()` silently no-ops anywhere else. The unit counterpart
 * (tests/phpunit/Unit/IdeationOrchestratorTest.php) pins the persisted shape;
 * only here can the register actually be selected against a real user's
 * capabilities.
 *
 * The credential backend is pinned to Connectors in `set_up` so the admin
 * register genuinely carries a `/wp-admin/` URL. Without that pin the "no admin
 * URL reaches an editor" assertion could pass vacuously.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\AI\ConnectorsCredentialBackend;
use VIPWorkflows\AI\Credentials;
use VIPWorkflows\Abilities\AbilityExecutor;
use VIPWorkflows\Abilities\AbilityResultRepository;
use VIPWorkflows\Abilities\Availability;
use VIPWorkflows\Abilities\Destination;
use VIPWorkflows\Abilities\Requirement;
use VIPWorkflows\Abilities\RequirementFactory;
use VIPWorkflows\Abilities\RequirementGroup;
use VIPWorkflows\Ideation\Assistants\IdeationOrchestrator;

/**
 * @covers \VIPWorkflows\Abilities\AbilityExecutor::execute
 * @covers \VIPWorkflows\Ideation\Assistants\IdeationOrchestrator
 * @covers \VIPWorkflows\API\AvailabilitySerializer
 */
class RuntimeAvailabilityRequirementsTest extends TestCase
{
    private const STRUCTURED_ABILITY = 'vip-workflows/runtime-structured-fixture';

    private const BARE_BOOL_ABILITY = 'vip-workflows/runtime-bare-bool-fixture';

    /**
     * Register two fixture agents: one structured, one legacy bool.
     *
     * Abilities can only be registered while `wp_abilities_api_init` is running,
     * so the hook is fired again with every other listener detached —
     * WP_UnitTestCase restores `$wp_filter` afterwards. Registration is global and
     * outlives the test, hence the guards.
     */
    public function set_up(): void
    {
        parent::set_up();

        Credentials::get_instance()->set_backend( new ConnectorsCredentialBackend() );

        $registered = array_map(
            static function ( $ability ): string {
                return $ability->get_name();
            },
            wp_get_abilities()
        );

        remove_all_actions( 'wp_abilities_api_init' );
        add_action(
            'wp_abilities_api_init',
            static function () use ( $registered ): void {
                if ( ! in_array( self::STRUCTURED_ABILITY, $registered, true ) ) {
                    vip_workflows_register_ability(
                        self::STRUCTURED_ABILITY,
                        self::ability_args(
                            'Structured Fixture',
                            static function (): Availability {
                                return Availability::unmet(
                                    RequirementGroup::all(
                                        RequirementFactory::missing_credential( 'tavily', 'Tavily', array( 'Structured Fixture' ) )
                                    )
                                );
                            }
                        )
                    );
                }

                if ( ! in_array( self::BARE_BOOL_ABILITY, $registered, true ) ) {
                    vip_workflows_register_ability(
                        self::BARE_BOOL_ABILITY,
                        self::ability_args(
                            'Bare Bool Fixture',
                            static function (): bool {
                                return false;
                            }
                        )
                    );
                }
            }
        );
        do_action( 'wp_abilities_api_init' );
    }

    public function tear_down(): void
    {
        Credentials::get_instance()->set_backend( null );

        parent::tear_down();
    }

    /**
     * Registration args for a research fixture agent.
     *
     * @param  string   $label                Ability label.
     * @param  callable $availability_callback Availability callback.
     * @return array
     */
    private static function ability_args( string $label, callable $availability_callback ): array
    {
        return array(
            'label'               => $label,
            'description'         => 'A research agent used to exercise the runtime availability gates.',
            'category'            => 'research',
            'execute_callback'    => static function (): array {
                return array( 'cards' => array(), 'summary' => 'ran' );
            },
            'permission_callback' => static function (): bool {
                return true;
            },
            'input_schema'        => array(
                'type'       => 'object',
                'properties' => array( 'seed' => array( 'type' => 'string' ) ),
            ),
            'meta'                => array(
                'type'                  => 'research',
                'icon'                  => 'search',
                'thinking_message'      => 'Working…',
                'success_message'       => 'Done.',
                'availability_callback' => $availability_callback,
            ),
        );
    }

    private function become_editor_only(): void
    {
        $user_id = self::factory()->user->create( array( 'role' => 'author' ) );
        wp_set_current_user( $user_id );

        $this->assertTrue( current_user_can( 'edit_posts' ) );
        $this->assertFalse( current_user_can( 'manage_options' ) );
    }

    private function become_administrator(): void
    {
        wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
    }

    /**
     * Run one fixture agent against a throwaway project and hand back its meta.
     *
     * @param  string $ability_id Which fixture to run.
     * @return array{project_id: int, stored: array}
     */
    private function run_gate( string $ability_id ): array
    {
        $project_id = self::factory()->post->create();

        $result = ( new IdeationOrchestrator() )->run_initial_assistant( $project_id, $ability_id );

        $this->assertSame( 'unavailable', $result['status'] );

        $stored = json_decode(
            (string) get_post_meta( $project_id, '_vip_ideation_asst_' . str_replace( '/', '__', $ability_id ), true ),
            true
        );

        return array(
            'project_id' => $project_id,
            'stored'     => $stored,
        );
    }

    /**
     * Every requirement in a serialized availability payload.
     *
     * @param  array $availability Serialized availability.
     * @return array<int, array>
     */
    private function requirements( array $availability ): array
    {
        $requirements = array();
        foreach ( $availability['groups'] as $group ) {
            foreach ( $group['requirements'] as $requirement ) {
                $requirements[] = $requirement;
            }
        }

        return $requirements;
    }

    public function test_orchestrator_stores_requirement_identity_and_kind(): void
    {
        $this->become_administrator();

        $stored = $this->run_gate( self::STRUCTURED_ABILITY )['stored'];

        $this->assertSame(
            array(
                array(
                    'satisfy'      => RequirementGroup::SATISFY_ALL,
                    'requirements' => array(
                        array(
                            'id'      => 'credential:tavily',
                            'kind'    => Requirement::KIND_MISSING_CREDENTIAL,
                            'sources' => array( 'Structured Fixture' ),
                        ),
                    ),
                ),
            ),
            $stored['requirements']
        );
    }

    public function test_orchestrator_stores_no_rendered_requirement_text(): void
    {
        $this->become_administrator();

        $encoded = (string) wp_json_encode( $this->run_gate( self::STRUCTURED_ABILITY )['stored']['requirements'] );

        $this->assertStringNotContainsString( 'Connectors', $encoded );
        $this->assertStringNotContainsString( '/wp-admin/', $encoded );
    }

    public function test_administrator_reading_stored_meta_gets_the_destination(): void
    {
        $this->become_administrator();

        $project_id = $this->run_gate( self::STRUCTURED_ABILITY )['project_id'];

        $state        = ( new IdeationOrchestrator() )->get_state( $project_id );
        $requirements = $this->requirements( $state['assistants'][ self::STRUCTURED_ABILITY ]['availability'] );

        $this->assertCount( 1, $requirements );
        $this->assertSame( 'credential:tavily', $requirements[0]['id'] );
        $this->assertArrayHasKey( 'reason', $requirements[0] );
        $this->assertSame( Destination::KIND_ADMIN_URL, $requirements[0]['destination']['kind'] );
        $this->assertStringContainsString( '/wp-admin/', $requirements[0]['destination']['url'] );
    }

    public function test_editor_only_user_reading_the_same_meta_gets_the_user_register(): void
    {
        // Written while an administrator was running ideation — the fresh-install
        // case. The stored value must not have frozen their wording in.
        $this->become_administrator();
        $project_id = $this->run_gate( self::STRUCTURED_ABILITY )['project_id'];

        $this->become_editor_only();

        $state        = ( new IdeationOrchestrator() )->get_state( $project_id );
        $requirements = $this->requirements( $state['assistants'][ self::STRUCTURED_ABILITY ]['availability'] );

        $this->assertCount( 1, $requirements );
        $this->assertSame( 'credential:tavily', $requirements[0]['id'] );
        $this->assertArrayHasKey( 'message', $requirements[0] );
        $this->assertArrayNotHasKey( 'reason', $requirements[0] );
        $this->assertArrayNotHasKey( 'destination', $requirements[0] );
        $this->assertStringNotContainsString(
            '/wp-admin/',
            (string) wp_json_encode( $state ),
            'An editor cannot open an admin screen, so no admin URL may appear anywhere in their state payload.'
        );
    }

    public function test_bare_bool_agent_keeps_the_generic_line_and_reports_no_requirements(): void
    {
        $this->become_administrator();

        $gate       = $this->run_gate( self::BARE_BOOL_ABILITY );
        $project_id = $gate['project_id'];

        $this->assertSame( array(), $gate['stored']['requirements'] );
        $this->assertSame( 'Research agent is not configured.', $gate['stored']['error'] );

        // There is nothing to re-render, but the ability is still registered, so
        // the reader gets an availability payload with no groups. That presence is
        // how the editor knows retrying could help once the agent is configured;
        // withholding it would strand a live-but-unconfigured agent.
        $state     = ( new IdeationOrchestrator() )->get_state( $project_id );
        $assistant = $state['assistants'][ self::BARE_BOOL_ABILITY ];

        $this->assertArrayHasKey( 'availability', $assistant );
        $this->assertFalse( $assistant['availability']['available'] );
        $this->assertSame( array(), $assistant['availability']['groups'] );
    }

    public function test_state_names_a_registered_agent_from_its_own_label(): void
    {
        // The ideation header iterates the stored assistant map, so the label has
        // to travel with the status. Resolved from the registered ability, which is
        // the only thing that knows what an agent is called — the client used to
        // guess from the research-abilities response and rendered the raw ability id
        // for anything absent from it.
        $this->become_administrator();

        $project_id = $this->run_gate( self::STRUCTURED_ABILITY )['project_id'];

        $state = ( new IdeationOrchestrator() )->get_state( $project_id );

        $this->assertSame( 'Structured Fixture', $state['assistants'][ self::STRUCTURED_ABILITY ]['label'] );

        // And it is the ability's own label, not the id dressed up: the humanized id
        // would read "Runtime Structured Fixture".
        $this->assertStringNotContainsString(
            'Runtime',
            $state['assistants'][ self::STRUCTURED_ABILITY ]['label']
        );
    }

    public function test_an_editor_gets_the_same_label_as_an_administrator(): void
    {
        // The register split governs requirement wording only. An agent's name is
        // not capability-dependent, and an editor left without one would be back to
        // reading ability ids.
        $this->become_administrator();
        $project_id = $this->run_gate( self::STRUCTURED_ABILITY )['project_id'];

        $this->become_editor_only();

        $state = ( new IdeationOrchestrator() )->get_state( $project_id );

        $this->assertSame( 'Structured Fixture', $state['assistants'][ self::STRUCTURED_ABILITY ]['label'] );
    }

    public function test_executor_stores_requirement_identity_and_kind_on_the_result(): void
    {
        $this->become_administrator();

        $post_id = self::factory()->post->create();

        $result = ( new AbilityExecutor() )->execute( self::STRUCTURED_ABILITY, array( 'post_id' => $post_id ) );

        $this->assertFalse( $result->success );
        $this->assertSame( 'Ability is not configured.', $result->error );
        $this->assertSame(
            array(
                array(
                    'satisfy'      => RequirementGroup::SATISFY_ALL,
                    'requirements' => array(
                        array(
                            'id'      => 'credential:tavily',
                            'kind'    => Requirement::KIND_MISSING_CREDENTIAL,
                            'sources' => array( 'Structured Fixture' ),
                        ),
                    ),
                ),
            ),
            $result->unmet_requirements
        );

        // It has its own field because `output` is contracted to the ability's
        // output_schema, and a gated ability produced no output at all.
        $this->assertSame( array(), $result->output );
        $this->assertArrayHasKey( 'unmet_requirements', $result->to_array() );

        // And it survives the round trip through the results table, without
        // leaking the reserved storage key into the schema-bound payload.
        $persisted = ( new AbilityResultRepository() )->find_by_post( $post_id, self::STRUCTURED_ABILITY, 1 );

        $this->assertCount( 1, $persisted );
        $this->assertSame(
            'credential:tavily',
            $persisted[0]->unmet_requirements[0]['requirements'][0]['id']
        );
        $this->assertSame( array(), $persisted[0]->output );
    }

    public function test_executor_keeps_the_generic_line_for_a_bare_bool_agent(): void
    {
        $this->become_administrator();

        $result = ( new AbilityExecutor() )->execute( self::BARE_BOOL_ABILITY, array( 'post_id' => self::factory()->post->create() ) );

        $this->assertFalse( $result->success );
        $this->assertSame( 'Ability is not configured.', $result->error );
        $this->assertSame( array(), $result->unmet_requirements );
        $this->assertSame( array(), $result->output, 'output is the ability\'s schema-shaped payload; a gated ability produced none.' );
    }
}
