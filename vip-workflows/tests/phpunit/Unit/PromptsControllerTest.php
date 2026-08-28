<?php
/**
 * PromptsController unit tests.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflows\API\PromptsController;
use VIPWorkflows\AI\PromptRegistry;
use VIPWorkflows\AI\PromptSettings;

class PromptsControllerTest extends TestCase
{
    private PromptsController $controller;
    private array $stored = array();

    protected function setUp(): void
    {
        parent::setUp();

        $this->stored = array();
        Functions\when( 'get_option' )->alias(
            function ( string $option, $default = false ) {
                return 'vip_workflows_prompts' === $option ? $this->stored : $default;
            }
        );
        Functions\when( 'update_option' )->alias(
            function ( string $option, $value ) {
                if ( 'vip_workflows_prompts' === $option ) {
                    $this->stored = $value;
                }
                return true;
            }
        );
        Functions\when( '_doing_it_wrong' )->justReturn( null );
        Functions\when( 'wp_check_invalid_utf8' )->alias(
            fn( $string, $strip = false ) => $string
        );

        PromptRegistry::get_instance()->reset();
        PromptSettings::get_instance()->clear_cache();
        PromptRegistry::get_instance()->register(
            'sample/one',
            array( 'label' => 'Sample One', 'group' => 'Samples', 'default' => 'Default text.' )
        );

        $this->controller = new PromptsController();
    }

    private function make_request( array $params = array(), $json = null ): object
    {
        $request = Mockery::mock( 'WP_REST_Request' );
        $request->shouldReceive( 'get_param' )->andReturnUsing(
            fn( $key ) => $params[ $key ] ?? null
        );
        $request->shouldReceive( 'get_json_params' )->andReturn( $json );
        return $request;
    }

    public function test_get_items_lists_prompts_with_default_and_override(): void
    {
        PromptSettings::get_instance()->set_override( 'sample/one', 'Overridden.' );

        $data = $this->controller->get_items( $this->make_request() )->get_data();

        $this->assertCount( 1, $data );
        $this->assertSame( 'sample/one', $data[0]['id'] );
        $this->assertSame( 'Default text.', $data[0]['default'] );
        $this->assertSame( 'Overridden.', $data[0]['override'] );
        $this->assertSame( 'Samples', $data[0]['group'] );
    }

    public function test_update_override_persists_and_returns_prompt(): void
    {
        $response = $this->controller->update_override(
            $this->make_request( array( 'id' => 'sample/one' ), array( 'prompt' => 'My custom prompt.' ) )
        );

        $this->assertInstanceOf( 'WP_REST_Response', $response );
        $this->assertSame( 'My custom prompt.', $response->get_data()['override'] );
        $this->assertSame( 'My custom prompt.', PromptSettings::get_instance()->get_override( 'sample/one' ) );
    }

    public function test_empty_prompt_resets_override(): void
    {
        PromptSettings::get_instance()->set_override( 'sample/one', 'Was set.' );

        $response = $this->controller->update_override(
            $this->make_request( array( 'id' => 'sample/one' ), array( 'prompt' => '   ' ) )
        );

        $this->assertNull( $response->get_data()['override'] );
        $this->assertNull( PromptSettings::get_instance()->get_override( 'sample/one' ) );
    }

    public function test_unknown_prompt_returns_404(): void
    {
        $response = $this->controller->update_override(
            $this->make_request( array( 'id' => 'no/such' ), array( 'prompt' => 'x' ) )
        );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'unknown_prompt', $response->get_error_code() );
    }

    public function test_missing_prompt_key_returns_400(): void
    {
        $response = $this->controller->update_override(
            $this->make_request( array( 'id' => 'sample/one' ), array( 'notprompt' => 'x' ) )
        );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'invalid_payload', $response->get_error_code() );
    }

    public function test_non_string_prompt_returns_400(): void
    {
        $response = $this->controller->update_override(
            $this->make_request( array( 'id' => 'sample/one' ), array( 'prompt' => array( 'not', 'a', 'string' ) ) )
        );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'invalid_prompt', $response->get_error_code() );
    }

    public function test_oversized_prompt_returns_413(): void
    {
        $response = $this->controller->update_override(
            $this->make_request( array( 'id' => 'sample/one' ), array( 'prompt' => str_repeat( 'a', 20001 ) ) )
        );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'prompt_too_large', $response->get_error_code() );
    }

    public function test_persistence_failure_returns_500(): void
    {
        Functions\when( 'update_option' )->justReturn( false );
        PromptSettings::get_instance()->clear_cache();

        $response = $this->controller->update_override(
            $this->make_request( array( 'id' => 'sample/one' ), array( 'prompt' => 'New value.' ) )
        );

        $this->assertInstanceOf( 'WP_Error', $response );
        $this->assertSame( 'save_failed', $response->get_error_code() );
    }

    public function test_permission_check_requires_manage_options(): void
    {
        Functions\when( 'current_user_can' )->justReturn( false );
        $this->assertFalse( $this->controller->admin_permissions_check() );

        Functions\when( 'current_user_can' )->justReturn( true );
        $this->assertTrue( $this->controller->admin_permissions_check() );
    }
}
