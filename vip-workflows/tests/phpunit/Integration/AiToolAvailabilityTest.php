<?php
/**
 * AI-backed tool availability, and the `AiAvailability::for_selected_provider()`
 * contract every such tool delegates its gate to.
 *
 * Originally exercised directly against `workflow-tool-excerpt-generator` and
 * `workflow-tool-editorial-alignment`, both of which generate text through
 * OpenAI and both used to present as fully working on a site with no key: they
 * registered through core's `wp_register_ability()`, which produces a plain
 * `WP_Ability` with no availability channel at all, so declaring a callback
 * would not have helped either. This file pins both halves of the fix — that
 * an AI-backed tool registers as a `VIPWorkflow\Abilities\Ability`, and that the
 * ability itself reports the missing credential — which is only provable where
 * core's real `WP_Ability` exists, i.e. here and not in the unit suite.
 *
 * Both example tools now live in external extension plugins, and core ships no
 * AI-backed tool of its own to stand in for them. Coupling core's suite to
 * external extensions — as the previous
 * version of this file did, requiring their plugin files directly — would make
 * coverage of core's own `AiAvailability` contract depend on that repo staying
 * in sync. Both real tools were thin wrappers calling
 * `AiAvailability::for_selected_provider()` as their entire availability
 * callback, so this now exercises that same core method through a minimal
 * fixture ability defined right here, built to the same shape.
 *
 * @package VIPWorkflow\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Fixtures\AiToolSource {

	use VIPWorkflow\Abilities\AiAvailability;
	use VIPWorkflow\Abilities\Availability;

	/**
	 * Ability id the fixture registers, mirroring a real AI-backed tool.
	 */
	const ABILITY_ID = 'vip-workflow-tests/ai-tool-fixture';

	/**
	 * The entire gate, exactly as the real tools implemented it: delegate to the
	 * core helper every AI-backed ability's availability rests on.
	 */
	function check_availability(): bool|Availability {
		return AiAvailability::for_selected_provider( array( 'AI Tool Fixture' ) );
	}

	/**
	 * Register a tool ability pointing at check_availability(), mirroring how a
	 * real AI-backed tool registers.
	 */
	function register_ability(): void {
		if ( ! function_exists( 'vip_workflow_register_ability' ) ) {
			return;
		}

		vip_workflow_register_ability(
			ABILITY_ID,
			array(
				'label'               => 'AI Tool Fixture',
				'description'         => 'Test fixture for the AiAvailability::for_selected_provider() contract.',
				'category'            => 'vip-workflow',
				'input_schema'        => array(
					'type'       => 'object',
					'properties' => array(
						'post_id' => array( 'type' => 'integer' ),
					),
				),
				'output_schema'       => array(
					'type'       => 'object',
					'properties' => array(
						'result' => array( 'type' => 'string' ),
					),
				),
				'execute_callback'    => static function (): array {
					return array( 'result' => '' );
				},
				'permission_callback' => static function (): bool {
					return current_user_can( 'edit_posts' );
				},
				'meta'                => array(
					'type'                  => 'tool',
					'show_in_rest'          => true,
					'availability_callback' => __NAMESPACE__ . '\check_availability',
				),
			)
		);
	}
}

namespace VIPWorkflow\Tests\Integration {

	use VIPWorkflow\AI\CredentialBackend;
	use VIPWorkflow\AI\Credentials;
	use VIPWorkflow\Abilities\Ability;
	use VIPWorkflow\Abilities\Availability;
	use VIPWorkflow\Abilities\Requirement;
	use VIPWorkflow\Abilities\RequirementGroup;

	use const VIPWorkflow\Tests\Fixtures\AiToolSource\ABILITY_ID;

class AiToolAvailabilityTest extends TestCase
{
    /**
     * Ability id => source label, matching the shape the real tools' sources
     * carried when there was more than one to distinguish.
     *
     * @var array<string, string>
     */
    private const TOOLS = array(
        ABILITY_ID => 'AI Tool Fixture',
    );

    public function set_up(): void
    {
        parent::set_up();

        $this->use_backend_without_keys();
    }

    public function tear_down(): void
    {
        Credentials::get_instance()->set_backend( null );
        delete_option( 'vip_workflow_ai_provider' );
        delete_option( 'vip_workflow_ai_models' );

        parent::tear_down();
    }

    /* ---------------------------------------------------------------------
     * Fixtures
     * ------------------------------------------------------------------ */

    /**
     * Install a backend holding the given keys.
     *
     * A real backend would read core connectors or the legacy encrypted option,
     * neither of which is deterministic in a freshly-installed test database.
     * `set_backend()` is the documented seam for exactly this.
     *
     * @param array<string, string> $keys Service id => key.
     */
    private function use_backend( array $keys ): void
    {
        Credentials::get_instance()->set_backend(
            new class( $keys ) implements CredentialBackend {
                /**
                 * @param array<string, string> $keys Service id => key.
                 */
                public function __construct( private array $keys ) {}

                public function get_api_key( string $service ): string
                {
                    return $this->keys[ $service ] ?? '';
                }
            }
        );
    }

    /**
     * Model a site with no AI credentials at all.
     */
    private function use_backend_without_keys(): void
    {
        $this->assertFalse(
            defined( 'VIP_WORKFLOW_OPENAI_KEY' ),
            'A defined key constant outranks every backend, so it would make the unmet cases unreachable.'
        );

        $this->use_backend( array() );
    }

    /**
     * Select an AI provider, as the settings screen would.
     *
     * @param string $provider Provider id.
     */
    private function select_provider( string $provider ): void
    {
        update_option( 'vip_workflow_ai_provider', $provider );
    }

    /**
     * The registered fixture ability, registering it on first use.
     *
     * `vip_workflow_register_ability()` only functions while
     * `wp_abilities_api_init` is running, so the hook is fired again with other
     * listeners detached — WP_UnitTestCase restores `$wp_filter` afterwards.
     * Registration is global and outlives the test, hence the guard.
     *
     * @param  string $ability_id Namespaced ability id.
     * @return Ability
     */
    private function tool( string $ability_id ): Ability
    {
        if ( ! wp_has_ability( $ability_id ) ) {
            remove_all_actions( 'wp_abilities_api_init' );
            add_action( 'wp_abilities_api_init', 'VIPWorkflow\Tests\Fixtures\AiToolSource\register_ability' );
            do_action( 'wp_abilities_api_init' );
        }

        $ability = wp_get_ability( $ability_id );

        $this->assertInstanceOf(
            Ability::class,
            $ability,
            'Registered through core\'s wp_register_ability() the ability would be a plain WP_Ability, whose availability_callback is never consulted.'
        );

        return $ability;
    }

    /**
     * Ability ids, for the data providers.
     */
    public static function provide_tools(): array
    {
        return array_map(
            static fn( string $id ): array => array( $id ),
            array_keys( self::TOOLS )
        );
    }

    /* ---------------------------------------------------------------------
     * No provider configured
     * ------------------------------------------------------------------ */

    /**
     * A site with no credential at all has no provider to be short of a key —
     * nothing has been chosen and nothing is derivable. Naming a vendor's missing
     * credential here is what sent Anthropic-only sites to configure OpenAI.
     *
     * @dataProvider provide_tools
     *
     * @param string $ability_id Namespaced ability id.
     */
    public function test_a_site_with_no_credential_reports_no_provider( string $ability_id ): void
    {
        $ability      = $this->tool( $ability_id );
        $availability = $ability->get_availability();

        $this->assertFalse(
            $ability->is_available(),
            'A tool that cannot generate text must say so before the user runs it.'
        );

        $this->assertCount( 1, $availability->get_groups() );
        $this->assertSame( RequirementGroup::SATISFY_ALL, $availability->get_groups()[0]->get_satisfy() );

        $requirements = $availability->get_requirements();
        $this->assertCount( 1, $requirements );

        $this->assertSame( 'settings:ai-provider:none', $requirements[0]->get_id() );
        $this->assertSame( Requirement::KIND_DEPENDENCY, $requirements[0]->get_kind() );
        $this->assertSame( array( self::TOOLS[ $ability_id ] ), $requirements[0]->get_sources() );
        $this->assertStringNotContainsString( 'OpenAI', $requirements[0]->get_admin_text() );
    }

    /**
     * Once a provider *is* selected, the missing credential is the right answer
     * again — and it names that provider rather than a default.
     *
     * @dataProvider provide_tools
     *
     * @param string $ability_id Namespaced ability id.
     */
    public function test_a_selected_provider_without_a_key_reports_the_credential( string $ability_id ): void
    {
        $this->select_provider( 'openai' );

        $requirements = $this->tool( $ability_id )->get_availability()->get_requirements();

        $this->assertCount( 1, $requirements );
        $this->assertSame( 'credential:openai', $requirements[0]->get_id() );
        $this->assertSame( Requirement::KIND_MISSING_CREDENTIAL, $requirements[0]->get_kind() );
        $this->assertSame( array( self::TOOLS[ $ability_id ] ), $requirements[0]->get_sources() );
    }

    /**
     * @dataProvider provide_tools
     *
     * @param string $ability_id Namespaced ability id.
     */
    public function test_the_editor_register_is_actionable_and_names_no_screen( string $ability_id ): void
    {
        $requirements = $this->tool( $ability_id )->get_availability()->get_requirements();

        $this->assertNotSame(
            '',
            $requirements[0]->get_user_message(),
            'An empty user message tells the editor who triggered the tool nothing.'
        );
        $this->assertStringNotContainsString( '/wp-admin/', $requirements[0]->get_user_message() );
    }

    /**
     * @dataProvider provide_tools
     *
     * @param string $ability_id Namespaced ability id.
     */
    public function test_the_callback_returns_the_structured_shape( string $ability_id ): void
    {
        $meta = $this->tool( $ability_id )->get_meta();

        $this->assertArrayHasKey(
            'availability_callback',
            $meta,
            'The gate has to be declared in meta; nothing else exposes it to the Tools page.'
        );

        $this->assertInstanceOf(
            Availability::class,
            call_user_func( $meta['availability_callback'] ),
            'An unconfigured tool must report structured requirements, not a bare bool.'
        );
    }

    /* ---------------------------------------------------------------------
     * Provider configured
     * ------------------------------------------------------------------ */

    /**
     * @dataProvider provide_tools
     *
     * @param string $ability_id Namespaced ability id.
     */
    public function test_a_configured_openai_key_reports_available( string $ability_id ): void
    {
        $ability = $this->tool( $ability_id );

        $this->use_backend( array( 'openai' => 'sk-integration-test' ) );

        $this->assertTrue(
            $ability->is_available(),
            'Gating a site that can generate text would block a working install.'
        );
        $this->assertSame( array(), $ability->get_availability()->get_requirements() );
        $this->assertTrue(
            call_user_func( $ability->get_meta()['availability_callback'] ),
            'A satisfied check returns bare true so no consumer has to re-derive satisfaction.'
        );
    }

    /**
     * Availability is re-read, never cached: the Tools page shows the result of a
     * save in the same request that performed it.
     *
     * @dataProvider provide_tools
     *
     * @param string $ability_id Namespaced ability id.
     */
    public function test_availability_follows_the_key_within_one_request( string $ability_id ): void
    {
        $ability = $this->tool( $ability_id );

        $this->assertFalse( $ability->is_available() );

        $this->use_backend( array( 'openai' => 'sk-integration-test' ) );
        $this->assertTrue( $ability->is_available() );

        $this->use_backend( array() );
        $this->assertFalse( $ability->is_available() );
    }

    /* ---------------------------------------------------------------------
     * The gate follows the selected provider, and never blames another vendor
     *
     * WordPress core bundles php-ai-client but ships no concrete providers, and
     * the plugin vendors only OpenAI — so in this environment Anthropic is a
     * selected-but-unregistered provider. That is exactly the state whose report
     * must name Anthropic: the bug being fixed was a gate that named OpenAI no
     * matter what the site had selected.
     * ------------------------------------------------------------------ */

    /**
     * @dataProvider provide_tools
     *
     * @param string $ability_id Namespaced ability id.
     */
    public function test_a_tool_reports_the_selected_provider_not_openai( string $ability_id ): void
    {
        $ability = $this->tool( $ability_id );

        $this->select_provider( 'anthropic' );
        $this->use_backend( array( 'anthropic' => 'sk-ant-integration-test' ) );

        $availability = $ability->get_availability();
        $this->assertFalse( $ability->is_available() );

        $requirements = $availability->get_requirements();
        $this->assertCount( 1, $requirements );

        $this->assertSame( 'environment:ai-provider:anthropic', $requirements[0]->get_id() );
        $this->assertStringContainsString( 'Anthropic', $requirements[0]->get_admin_reason() );
        $this->assertStringNotContainsString(
            'OpenAI',
            $requirements[0]->get_admin_text(),
            'The gate must never send an Anthropic site after an OpenAI key.'
        );
    }

    /**
     * An OpenAI key must not make an Anthropic-selected site look configured: the
     * generation path resolves the selected provider, so it would still fail.
     *
     * @dataProvider provide_tools
     *
     * @param string $ability_id Namespaced ability id.
     */
    public function test_an_openai_key_does_not_satisfy_an_anthropic_selection( string $ability_id ): void
    {
        $ability = $this->tool( $ability_id );

        $this->select_provider( 'anthropic' );
        $this->use_backend( array( 'openai' => 'sk-integration-test' ) );

        $this->assertFalse(
            $ability->is_available(),
            'Reporting available here is the false positive the removed OpenAI fallback used to hide.'
        );
        $this->assertSame(
            'environment:ai-provider:anthropic',
            $ability->get_availability()->get_requirements()[0]->get_id()
        );
    }

    /* ---------------------------------------------------------------------
     * Ideation assistants
     *
     * Not abilities — no availability_callback — so they are checked through the
     * bool entry point and their own result arrays.
     * ------------------------------------------------------------------ */

    /**
     * The reported bug, end to end: an Anthropic site was told "OpenAI not
     * configured." by an assistant that generates through the selected provider.
     *
     * @dataProvider provide_assistants
     *
     * @param string $class Assistant class name.
     * @param string $label Expected source label.
     */
    public function test_an_assistant_never_reports_openai_for_an_anthropic_site( string $class, string $label ): void
    {
        $this->select_provider( 'anthropic' );
        $this->use_backend( array( 'anthropic' => 'sk-ant-integration-test' ) );

        $assistant = new $class();

        $this->assertFalse( $assistant->is_available() );

        $result = $assistant->run( array( 'seed' => 'A seed to analyze.' ) );

        $this->assertSame( 'unavailable', $result['status'] );
        $this->assertStringContainsString( 'Anthropic', $result['error'] );
        $this->assertStringNotContainsString(
            'OpenAI',
            $result['error'],
            'This is the exact string the user saw on a Claude-configured site.'
        );
        $this->assertNotSame( '', $label );
    }

    /**
     * A configured selection makes the assistant available. With OpenAI selected
     * and keyed the whole chain resolves — provider registered, key present, and
     * a default model — so nothing gates it.
     *
     * @dataProvider provide_assistants
     *
     * @param string $class Assistant class name.
     */
    public function test_a_configured_assistant_is_available( string $class ): void
    {
        $this->select_provider( 'openai' );
        $this->use_backend( array( 'openai' => 'sk-integration-test' ) );

        $assistant = new $class();

        $this->assertTrue( $assistant->is_available() );
    }

    /**
     * The persisted line names the vendor but neither register's instruction, so a
     * stored result cannot freeze one audience's wording.
     *
     * @dataProvider provide_assistants
     *
     * @param string $class Assistant class name.
     */
    public function test_an_unavailable_assistant_stores_a_register_neutral_line( string $class ): void
    {
        $assistant = new $class();

        $result = $assistant->run( array( 'seed' => 'A seed to analyze.' ) );

        $this->assertSame( 'unavailable', $result['status'] );
        $this->assertStringNotContainsString( '/wp-admin/', $result['error'] );
        $this->assertStringNotContainsString( 'administrator', $result['error'] );
        $this->assertStringNotContainsString( 'wp-config', $result['error'] );
    }

    public static function provide_assistants(): array
    {
        return array(
            'seed analyst'    => array( '\\VIPWorkflow\\Ideation\\Assistants\\SeedAnalyst', 'Seed Analyst' ),
            'editorial mentor' => array( '\\VIPWorkflow\\Ideation\\Assistants\\EditorialMentor', 'Editorial Mentor' ),
        );
    }
}
}
