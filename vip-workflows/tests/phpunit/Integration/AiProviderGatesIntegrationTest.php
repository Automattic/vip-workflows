<?php
/**
 * Stage-agent availability, and the one capability that is genuinely OpenAI-only.
 *
 * The `workflow-agent-*` stage agents generate through `StageAgent` →
 * `AiInference`, and declared no `availability_callback` at all: they presented as
 * working on an unconfigured site and failed only once a post reached their
 * stage. They were already registered through `vip_workflow_register_ability()`,
 * so the declaration is read — this file proves that end to end, against core's
 * real `WP_Ability`, which the unit suite does not have.
 *
 * Originally exercised against all four stage agents shipped at the time; two of
 * them (`workflow-agent-fact-check`, `workflow-agent-reformat-to-template`) now
 * live in external extension plugins. Coupling core's suite to external
 * extensions would make coverage of core's own
 * `StageAgent` contract depend on that repo staying in sync, so this now covers
 * only the two stage agents that still ship in core — the contract itself is
 * `StageAgent`'s, not any individual agent's, so two working examples prove it
 * as well as four did.
 *
 * It also pins the opposite verdict for `AiImageProvider`: image generation is
 * available through OpenAI only, so naming OpenAI there is correct and must not
 * follow the provider selection. Without a test that distinction is one refactor
 * away from being "tidied up" into a bug.
 *
 * @package VIPWorkflow\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Integration;

use VIPWorkflow\AI\AiInference;
use VIPWorkflow\AI\CredentialBackend;
use VIPWorkflow\AI\Credentials;
use VIPWorkflow\Abilities\Ability;
use VIPWorkflow\Abilities\Requirement;
use VIPWorkflow\Ideation\Assistants\AiImageProvider;

class AiProviderGatesIntegrationTest extends TestCase
{
    /**
     * Ability id => [ plugin directory, registration callback, source label ].
     *
     * @var array<string, array{0:string,1:string,2:string}>
     */
    private const AGENTS = array(
        'workflow-agent-copy-edit/copy-edit'               => array(
            'workflow-agent-copy-edit',
            'WorkflowAgentCopyEdit\\register',
            'Copy Edit',
        ),
        'workflow-agent-tag-sanity-check/tag-sanity-check' => array(
            'workflow-agent-tag-sanity-check',
            'WorkflowAgentTagSanityCheck\\register',
            'Tag Sanity Check',
        ),
    );

    public function set_up(): void
    {
        parent::set_up();

        $this->assertFalse(
            defined( 'VIP_WORKFLOW_OPENAI_KEY' ),
            'A defined key constant outranks every backend, so it would make the unmet cases unreachable.'
        );

        $this->use_backend( array() );
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
     * Select a provider, as the settings screen would.
     *
     * @param string $provider Provider id.
     */
    private function select_provider( string $provider ): void
    {
        update_option( 'vip_workflow_ai_provider', $provider );
    }

    /**
     * The registered ability for a stage agent, registering it on first use.
     *
     * `vip_workflow_register_ability()` only functions while
     * `wp_abilities_api_init` is running, so the hook is fired again with other
     * listeners detached — WP_UnitTestCase restores `$wp_filter` afterwards.
     * Registration is global and outlives the test, hence the guard.
     *
     * @param  string $ability_id Namespaced ability id.
     * @return Ability
     */
    private function agent( string $ability_id ): Ability
    {
        list( $directory, $register ) = self::AGENTS[ $ability_id ];

        $plugin = dirname( __DIR__, 4 ) . '/' . $directory . '/' . $directory . '.php';

        $this->assertFileExists(
            $plugin,
            'The agent under test must be a sibling of the plugin directory in both the monorepo and container layouts.'
        );

        // Defines the functions and adds the registration hook; nothing fires yet.
        require_once $plugin;

        if ( ! wp_has_ability( $ability_id ) ) {
            remove_all_actions( 'wp_abilities_api_init' );
            add_action( 'wp_abilities_api_init', $register );
            do_action( 'wp_abilities_api_init' );
        }

        $ability = wp_get_ability( $ability_id );

        $this->assertInstanceOf(
            Ability::class,
            $ability,
            'Registered through core\'s wp_register_ability() the callback would be silently discarded.'
        );

        return $ability;
    }

    public static function provide_agents(): array
    {
        return array_map(
            static fn( string $id ): array => array( $id ),
            array_keys( self::AGENTS )
        );
    }

    /* ---------------------------------------------------------------------
     * Stage agents
     * ------------------------------------------------------------------ */

    /**
     * @dataProvider provide_agents
     *
     * @param string $ability_id Namespaced ability id.
     */
    public function test_an_unconfigured_agent_reports_unmet( string $ability_id ): void
    {
        $agent = $this->agent( $ability_id );

        $this->assertFalse(
            $agent->is_available(),
            'A stage agent that cannot generate must say so before a post reaches its stage.'
        );

        $requirements = $agent->get_availability()->get_requirements();
        $this->assertCount( 1, $requirements );
        $this->assertSame(
            'settings:ai-provider:none',
            $requirements[0]->get_id(),
            'With no credential and no selection there is no provider to be short of a key.'
        );
        $this->assertSame( Requirement::KIND_DEPENDENCY, $requirements[0]->get_kind() );
        $this->assertSame(
            array( self::AGENTS[ $ability_id ][2] ),
            $requirements[0]->get_sources(),
            'The requirement must name the agent, so a shared gap lists every agent needing it.'
        );
    }

    /* ---------------------------------------------------------------------
     * The reported bug: an Anthropic-only site, with nothing ever selected
     * ------------------------------------------------------------------ */

    /**
     * The exact shape of the report: one credential, and the provider picker never
     * opened, so `vip_workflow_ai_provider` — which only that picker writes — is
     * unset. Every agent used to answer for OpenAI here regardless of which vendor
     * the site had connected. It must now answer for the one it has.
     *
     * The requirement is Anthropic's *environment* gap rather than its credential
     * or model because this plugin vendors only the OpenAI provider package, so
     * nothing registers Anthropic with the AI Client in a bare test install. Which
     * of Anthropic's three gaps is reported is beside the point being pinned: the
     * answer is about the connected vendor, and never about OpenAI.
     *
     * @dataProvider provide_agents
     *
     * @param string $ability_id Namespaced ability id.
     */
    public function test_a_single_credential_site_answers_for_that_vendor_not_openai( string $ability_id ): void
    {
        $agent = $this->agent( $ability_id );

        $this->use_backend( array( 'anthropic' => 'sk-ant-integration-test' ) );

        $requirements = $agent->get_availability()->get_requirements();

        $this->assertCount( 1, $requirements );
        $this->assertStringContainsString(
            'anthropic',
            $requirements[0]->get_id(),
            'The one connected vendor is the only one the site can be short of anything for.'
        );
        $this->assertStringNotContainsString( 'OpenAI', $requirements[0]->get_admin_text() );
        $this->assertStringNotContainsString( 'OpenAI', $requirements[0]->get_user_message() );
    }

    /**
     * And the same derivation reaching all the way to available, on the provider
     * this plugin does vendor: one credential, no selection, a model chosen.
     * Before the fix this passed for the wrong reason — the hardcoded default
     * happened to name the keyed vendor.
     *
     * @dataProvider provide_agents
     *
     * @param string $ability_id Namespaced ability id.
     */
    public function test_a_single_credential_site_reports_available_without_a_selection( string $ability_id ): void
    {
        $agent = $this->agent( $ability_id );

        $this->use_backend( array( 'openai' => 'sk-integration-test' ) );

        $this->assertTrue(
            $agent->is_available(),
            'One credential and no selection is unambiguous; the site is configured and must say so.'
        );
        $this->assertSame( array(), $agent->get_availability()->get_requirements() );
    }

    /**
     * Two credentials and no selection is a real choice, and nothing may make it
     * on the administrator's behalf — picking one would send editorial content to
     * a vendor nobody chose.
     *
     * @dataProvider provide_agents
     *
     * @param string $ability_id Namespaced ability id.
     */
    public function test_two_credentials_and_no_selection_report_no_provider( string $ability_id ): void
    {
        $agent = $this->agent( $ability_id );

        $this->use_backend(
            array(
                'anthropic' => 'sk-ant-integration-test',
                'openai'    => 'sk-integration-test',
            )
        );

        $requirements = $agent->get_availability()->get_requirements();

        $this->assertFalse( $agent->is_available() );
        $this->assertCount( 1, $requirements );
        $this->assertSame( 'settings:ai-provider:none', $requirements[0]->get_id() );
    }

    /**
     * The invariant the whole change turns on: an unmet gate has to mean
     * generation really would fail, so fixing the copy alone could never turn a
     * correct "unavailable" into a false "available".
     *
     * One-directional by necessity. `AiInference::model()` finishes by asking the
     * provider for the model, which authenticates and calls out — so the
     * configured direction cannot be proven without a live key, and is left to the
     * unit suite against a stubbed registry. Every unmet state is provable here,
     * and that is the direction that matters: the gate must never promise more
     * than the resolver can deliver.
     *
     * Not parameterized over the agents, unlike its neighbours: `AiInference`
     * suppresses a repeated diagnostic for the rest of the process, so a second
     * pass would expect an incorrect-usage notice that has already been spent.
     * The agents share this resolver — proving it once proves it for every
     * registered stage agent.
     */
    public function test_every_unmet_state_resolves_no_model(): void
    {
        $this->setExpectedIncorrectUsage( 'VIPWorkflow\AI\AiInference::model' );

        $agent = $this->agent( 'workflow-agent-copy-edit/copy-edit' );

        $fixtures = array(
            'no credential at all'            => array(),
            'one unregistered vendor'         => array( 'anthropic' => 'sk-ant' ),
            'two credentials, nothing chosen' => array( 'anthropic' => 'sk-ant', 'openai' => 'sk-oai' ),
        );

        foreach ( $fixtures as $name => $keys ) {
            $this->use_backend( $keys );
            delete_option( 'vip_workflow_ai_models' );

            $this->assertFalse(
                $agent->is_available(),
                sprintf( 'A site with %s cannot generate.', $name )
            );
            $this->assertNull(
                AiInference::get_instance()->model(),
                sprintf( 'The gate reported unmet for %s, so inference must resolve nothing.', $name )
            );
        }
    }

    /**
     * @dataProvider provide_agents
     *
     * @param string $ability_id Namespaced ability id.
     */
    public function test_a_configured_agent_reports_available( string $ability_id ): void
    {
        $agent = $this->agent( $ability_id );

        $this->use_backend( array( 'openai' => 'sk-integration-test' ) );

        $this->assertTrue( $agent->is_available() );
        $this->assertSame( array(), $agent->get_availability()->get_requirements() );
    }

    /**
     * @dataProvider provide_agents
     *
     * @param string $ability_id Namespaced ability id.
     */
    public function test_an_agent_reports_the_selected_provider_not_openai( string $ability_id ): void
    {
        $agent = $this->agent( $ability_id );

        $this->select_provider( 'anthropic' );
        $this->use_backend( array( 'openai' => 'sk-integration-test' ) );

        $requirements = $agent->get_availability()->get_requirements();

        $this->assertFalse(
            $agent->is_available(),
            'An OpenAI key cannot satisfy an agent that generates through the selected provider.'
        );
        $this->assertSame( 'environment:ai-provider:anthropic', $requirements[0]->get_id() );
        $this->assertStringNotContainsString( 'OpenAI', $requirements[0]->get_admin_text() );
    }

    /**
     * The declaration has to travel in `meta`, because that is the only channel
     * the Tools page and the AI-stage picker read it from.
     *
     * @dataProvider provide_agents
     *
     * @param string $ability_id Namespaced ability id.
     */
    public function test_the_callback_is_declared_and_serializable( string $ability_id ): void
    {
        $meta = $this->agent( $ability_id )->get_meta();

        $this->assertArrayHasKey( 'availability_callback', $meta );
        $this->assertIsString(
            $meta['availability_callback'],
            'A closure would survive is_callable() but break the JSON encoding of meta in the Tools response.'
        );
        $this->assertNotFalse( wp_json_encode( $meta ) );
    }

    /* ---------------------------------------------------------------------
     * The OpenAI-only capability
     * ------------------------------------------------------------------ */

    /**
     * Image generation goes through `generateImage()`, which this plugin only has
     * via OpenAI. It must therefore ignore the provider selection entirely —
     * following it would refuse a site whose images work, and promise images on a
     * site that cannot make any.
     */
    public function test_image_generation_follows_openai_not_the_selection(): void
    {
        $provider = new AiImageProvider();

        $this->select_provider( 'anthropic' );
        $this->use_backend( array( 'anthropic' => 'sk-ant-integration-test' ) );

        $this->assertFalse(
            $provider->is_configured(),
            'An Anthropic key cannot generate images here, whatever the site has selected.'
        );

        $this->use_backend( array( 'openai' => 'sk-integration-test' ) );

        $this->assertTrue(
            $provider->is_configured(),
            'An OpenAI key is exactly what image generation needs, even with Anthropic selected.'
        );
    }

    /**
     * And its unmet requirement names OpenAI — the one place in this change where
     * naming OpenAI is the correct answer rather than the bug.
     */
    public function test_image_generation_reports_the_openai_credential(): void
    {
        $this->select_provider( 'anthropic' );

        $requirement = ( new AiImageProvider() )->get_unmet_requirement();

        $this->assertSame( 'credential:openai', $requirement->get_id() );
        $this->assertStringContainsString( 'OpenAI', $requirement->get_admin_reason() );
    }

    /**
     * Image generation names no model, so it must not be gated on the text-model
     * choice that `AiAvailability::for_provider()` requires.
     */
    public function test_image_generation_does_not_require_a_text_model(): void
    {
        $this->select_provider( 'anthropic' );
        $this->use_backend( array( 'openai' => 'sk-integration-test' ) );

        delete_option( 'vip_workflow_ai_models' );

        $this->assertTrue(
            ( new AiImageProvider() )->is_configured(),
            'A missing text-model choice has nothing to do with generating an image.'
        );
    }
}
