<?php
/**
 * General-settings AI provider + model handling.
 *
 * Covers the general AI provider/model fields that moved out of the removed
 * ApiKeysController into the general-settings endpoint and became
 * multi-provider.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflows\API\GeneralSettingsController;
use VIPWorkflows\AI\Credentials;
use VIPWorkflows\AI\CredentialBackend;
use WordPress\OpenAiAiProvider\Provider\OpenAiProvider;
use WordPress\AnthropicAiProvider\Provider\AnthropicProvider;
use WordPress\GoogleAiProvider\Provider\GoogleProvider;

class GeneralSettingsModelTest extends TestCase
{
    private array $options = array();

    protected function setUp(): void
    {
        parent::setUp();

        $this->options = array();
        Functions\when( 'get_option' )->alias(
            fn( string $name, $default = false ) => $this->options[ $name ] ?? $default
        );
        Functions\when( 'update_option' )->alias(
            function ( string $name, $value ) {
                $this->options[ $name ] = $value;
                return true;
            }
        );
        // Force live discovery; the catalog comes from the provider stubs below.
        Functions\when( 'get_transient' )->justReturn( false );
        Functions\when( 'set_transient' )->justReturn( true );
        Functions\when( 'delete_transient' )->justReturn( true );
        Functions\when( 'current_user_can' )->justReturn( true );
        Functions\when( 'wp_parse_args' )->alias(
            fn( $args, $defaults = array() ) => array_merge( (array) $defaults, (array) $args )
        );

        // openai keyed via bootstrap constant; give anthropic a key, leave google unkeyed.
        Credentials::get_instance()->set_backend(
            new class() implements CredentialBackend {
                public function get_api_key( string $service ): string
                {
                    return 'anthropic' === $service ? 'sk-ant' : '';
                }
            }
        );

        OpenAiProvider::$catalog    = array(
            array( 'gpt-4o', array( 'TEXT_GENERATION' ) ),
            array( 'gpt-4o-mini', array( 'TEXT_GENERATION' ) ),
        );
        AnthropicProvider::$catalog = array(
            array( 'claude-sonnet-4-5', array( 'TEXT_GENERATION' ) ),
        );
        GoogleProvider::$catalog    = array();
    }

    protected function tearDown(): void
    {
        Credentials::get_instance()->set_backend( null );
        OpenAiProvider::$catalog    = array();
        AnthropicProvider::$catalog = array();
        GoogleProvider::$catalog    = array();
        parent::tearDown();
    }

    private function request( array $json ): object
    {
        $request = Mockery::mock( 'WP_REST_Request' );
        $request->shouldReceive( 'get_json_params' )->andReturn( $json );
        return $request;
    }

    /**
     * These fixtures key two providers, so nothing is derivable from credentials
     * alone — every test below that is about *model* handling states the provider
     * explicitly rather than leaning on resolution. Provider resolution itself is
     * covered in `CredentialsTest`, and end to end in the integration suite.
     */
    public function test_get_settings_exposes_provider_model_and_catalog(): void
    {
        $this->options['vip_workflows_ai_provider'] = 'openai';

        $data = ( new GeneralSettingsController() )->get_settings()->get_data();

        $this->assertSame( 'openai', $data['ai_provider'] );
        $this->assertSame( 'gpt-4o', $data['ai_model'] );
        $this->assertContains( 'openai', $data['ai_providers'] );
        $this->assertContains( 'anthropic', $data['ai_providers'] );
        $this->assertNotContains( 'google', $data['ai_providers'] );
        $this->assertContains( 'gpt-4o-mini', $data['ai_models']['openai'] );
        $this->assertContains( 'claude-sonnet-4-5', $data['ai_models']['anthropic'] );
    }

    public function test_get_settings_reflects_stored_model(): void
    {
        $this->options['vip_workflows_ai_provider'] = 'openai';
        $this->options['vip_workflows_ai_model']    = 'gpt-4-turbo';
        $data = ( new GeneralSettingsController() )->get_settings()->get_data();
        $this->assertSame( 'gpt-4-turbo', $data['ai_model'] );
    }

    public function test_get_settings_falls_back_to_legacy_model_option(): void
    {
        // Back-compat: an install upgraded from the removed api-keys stack has no
        // vip_workflows_ai_model yet, only the legacy vip_workflows_api_keys map.
        // The controller must surface that model via Credentials::model().
        $this->options['vip_workflows_ai_provider'] = 'openai';
        $this->options['vip_workflows_api_keys']    = array( 'openai_model' => 'gpt-4-turbo' );
        $data = ( new GeneralSettingsController() )->get_settings()->get_data();
        $this->assertSame( 'gpt-4-turbo', $data['ai_model'] );
    }

    public function test_save_persists_provider_and_model(): void
    {
        ( new GeneralSettingsController() )->save_settings(
            $this->request( array( 'ai_provider' => 'anthropic', 'ai_model' => 'claude-sonnet-4-5' ) )
        );

        $this->assertSame( 'anthropic', $this->options['vip_workflows_ai_provider'] );
        $this->assertSame( 'claude-sonnet-4-5', $this->options['vip_workflows_ai_models']['anthropic'] );
    }

    public function test_save_persists_model_into_per_provider_map_for_openai(): void
    {
        $this->options['vip_workflows_ai_provider'] = 'openai';

        ( new GeneralSettingsController() )->save_settings(
            $this->request( array( 'ai_model' => 'gpt-4o-mini' ) )
        );

        $this->assertSame( 'gpt-4o-mini', $this->options['vip_workflows_ai_models']['openai'] );
    }

    public function test_get_settings_marks_a_stored_provider_as_selected(): void
    {
        $this->options['vip_workflows_ai_provider'] = 'anthropic';

        $data = ( new GeneralSettingsController() )->get_settings()->get_data();

        $this->assertSame( 'anthropic', $data['ai_provider'] );
        $this->assertTrue( $data['ai_provider_selected'] );
    }

    /**
     * Two providers are keyed here and none is chosen, so nothing resolves. The
     * form has to be able to tell that apart from a saved selection — otherwise
     * the one control that would fix it renders a provider it is not holding.
     */
    public function test_get_settings_reports_an_unresolved_provider_as_unselected(): void
    {
        $data = ( new GeneralSettingsController() )->get_settings()->get_data();

        $this->assertSame( '', $data['ai_provider'] );
        $this->assertFalse( $data['ai_provider_selected'] );
    }

    public function test_save_writes_no_model_when_no_provider_resolves(): void
    {
        ( new GeneralSettingsController() )->save_settings(
            $this->request( array( 'ai_model' => 'gpt-4o-mini' ) )
        );

        $this->assertArrayNotHasKey(
            'vip_workflows_ai_models',
            $this->options,
            'The map is keyed by provider; a model filed under \'\' is unreachable.'
        );
    }

    /**
     * The save path answers from `get_settings()`, so the provider it just wrote
     * has to be the one it reports back — a resolution cache that outlived the
     * write would hand the administrator the value they replaced.
     */
    public function test_save_reports_the_provider_it_just_stored(): void
    {
        $data = ( new GeneralSettingsController() )->save_settings(
            $this->request( array( 'ai_provider' => 'anthropic', 'ai_model' => 'claude-sonnet-4-5' ) )
        )->get_data();

        $this->assertSame( 'anthropic', $data['ai_provider'] );
        $this->assertTrue( $data['ai_provider_selected'] );
    }

    public function test_save_ignores_unavailable_provider(): void
    {
        ( new GeneralSettingsController() )->save_settings(
            $this->request( array( 'ai_provider' => 'google' ) )
        );

        $this->assertArrayNotHasKey( 'vip_workflows_ai_provider', $this->options );
    }

    /**
     * A rejected provider must take the model down with it. `$ai_provider` still
     * holds the previously selected one at that point, so continuing would file
     * the caller's model under a vendor they were not addressing — and answer 200
     * as though it had been saved.
     */
    public function test_save_writes_no_model_when_the_posted_provider_is_rejected(): void
    {
        $this->options['vip_workflows_ai_provider'] = 'openai';

        ( new GeneralSettingsController() )->save_settings(
            $this->request( array( 'ai_provider' => 'google', 'ai_model' => 'gpt-4o-mini' ) )
        );

        $this->assertSame( 'openai', $this->options['vip_workflows_ai_provider'] );
        $this->assertArrayNotHasKey(
            'vip_workflows_ai_models',
            $this->options,
            'The model was aimed at Google; it must not land on OpenAI.'
        );
    }

    /**
     * Unrelated settings in the same request still persist — the rejected
     * provider must not take them down too.
     */
    public function test_a_rejected_provider_does_not_discard_other_settings(): void
    {
        ( new GeneralSettingsController() )->save_settings(
            $this->request( array( 'ai_provider' => 'google', 'allow_self_review' => true ) )
        );

        $this->assertTrue( $this->options['vip_workflows_settings']['allow_self_review'] );
    }

    public function test_save_ignores_invalid_model(): void
    {
        // Stated so the assertion turns on the model being invalid, not on there
        // being no provider to file it under.
        $this->options['vip_workflows_ai_provider'] = 'openai';

        ( new GeneralSettingsController() )->save_settings(
            $this->request( array( 'ai_model' => 'not-a-model' ) )
        );

        $this->assertArrayNotHasKey( 'vip_workflows_ai_models', $this->options );
    }
}
