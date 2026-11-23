<?php
/**
 * A configured OpenAI provider whose HTTP replies are canned.
 *
 * The AI call runs for real through the AI Client and the vendored OpenAI
 * provider; only the HTTP reply is canned, through `pre_http_request`. The
 * model listing and the Responses call are the only canned layer; every other
 * HTTP request is refused, so nothing reaches the network.
 *
 * Call `set_up_canned_openai_provider()` from `set_up()` and
 * `tear_down_canned_openai_provider()` from `tear_down()`, before
 * `parent::tear_down()`. The using test supplies the text of the Responses
 * reply through `canned_reply_text()`. Each request is recorded in
 * `$requests` as "METHOD url", and its body in `$request_bodies`.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\AI\CredentialBackend;
use VIPWorkflows\AI\Credentials;

trait CannedOpenAiProvider
{
    /**
     * HTTP requests made while the provider was set up, in order, as
     * "METHOD url".
     *
     * @var string[]
     */
    private array $requests = array();

    /**
     * The body of each request in `$requests`, at the same index.
     *
     * @var string[]
     */
    private array $request_bodies = array();

    /**
     * The model the canned model listing offers.
     *
     * @var string
     */
    private string $canned_model = '';

    /**
     * Request authentication the OpenAI provider had before this test.
     *
     * @var mixed
     */
    private $previous_auth = null;

    /**
     * Whether set-up replaced the OpenAI provider's authentication, so
     * tear-down knows there is something to put back.
     *
     * @var bool
     */
    private bool $auth_replaced = false;

    /**
     * The text of the canned Responses reply.
     *
     * @return string
     */
    abstract protected function canned_reply_text(): string;

    /**
     * Configure OpenAI with a key and a model, and answer its HTTP requests.
     *
     * @param string $model Model the site selects and the listing offers.
     */
    private function set_up_canned_openai_provider( string $model ): void
    {
        $this->canned_model = $model;

        // An OpenAI key and model, as an administrator would configure them.
        Credentials::get_instance()->set_backend( $this->backend_with_openai_key() );
        update_option( 'vip_workflows_ai_provider', 'openai' );
        update_option( 'vip_workflows_ai_models', array( 'openai' => $model ) );

        // The plugin authenticates providers once, at boot, from the keys it
        // finds then. This test's key arrives later, so it is applied the same way.
        // Tear-down puts the old authentication back through the client's
        // private properties, so check they are all there before changing it.
        $registry = \WordPress\AiClient\AiClient::defaultRegistry();
        $this->require_restorable_provider_state( $registry );

        $this->previous_auth = $registry->getProviderRequestAuthentication( 'openai' );
        $registry->setProviderRequestAuthentication(
            'openai',
            new \WordPress\AiClient\Providers\Http\DTO\ApiKeyRequestAuthentication( 'test-key' )
        );
        $this->auth_replaced = true;

        add_filter( 'pre_http_request', array( $this, 'answer_provider' ), 10, 3 );
    }

    /**
     * Stop answering requests and put the provider settings back.
     */
    private function tear_down_canned_openai_provider(): void
    {
        remove_filter( 'pre_http_request', array( $this, 'answer_provider' ), 10 );

        // A failed restore still reports, but never skips the rest of tear-down.
        try {
            if ( $this->auth_replaced ) {
                $this->auth_replaced = false;
                $this->restore_provider_auth();
            }
        } finally {
            Credentials::get_instance()->set_backend( null );
            delete_option( 'vip_workflows_ai_provider' );
            delete_option( 'vip_workflows_ai_models' );
        }
    }

    /**
     * Fail before the test changes anything when a private property that
     * restore_provider_auth() relies on is missing, for example after an AI
     * Client update renames it.
     *
     * @param \WordPress\AiClient\Providers\ProviderRegistry $registry Default registry.
     */
    private function require_restorable_provider_state( $registry ): void
    {
        $this->require_property( $registry, 'providerAuthenticationInstances' );

        foreach ( $this->provider_objects_holding_auth( $registry->getProviderClassName( 'openai' ) ) as $holder ) {
            $this->require_property( $holder, 'requestAuthentication' );
            $this->require_property( $holder, 'httpTransporter' );
        }
    }

    /**
     * Put the OpenAI provider's authentication back as this test found it.
     *
     * When there was none, the registry has no setter for "none", so its
     * entry is removed and the key is cleared from the provider objects it
     * was forwarded to. Those objects are kept rather than rebuilt, so they
     * keep the HTTP transporter the registry gave them at registration.
     */
    private function restore_provider_auth(): void
    {
        $registry = \WordPress\AiClient\AiClient::defaultRegistry();

        if ( null !== $this->previous_auth ) {
            $registry->setProviderRequestAuthentication( 'openai', $this->previous_auth );
        } else {
            $class_name = $registry->getProviderClassName( 'openai' );

            $instances = $this->require_property( $registry, 'providerAuthenticationInstances' );
            $map       = $instances->getValue( $registry );
            unset( $map[ $class_name ] );
            $instances->setValue( $registry, $map );

            foreach ( $this->provider_objects_holding_auth( $class_name ) as $holder ) {
                $this->clear_request_authentication( $holder );
            }
        }

        $this->assertSame( $this->previous_auth, $registry->getProviderRequestAuthentication( 'openai' ) );

        $class_name = $registry->getProviderClassName( 'openai' );
        foreach ( $this->provider_objects_holding_auth( $class_name ) as $holder ) {
            $this->assertSame( $this->previous_auth, $this->read_property( $holder, 'requestAuthentication' ) );
            $this->assertSame( $registry->getHttpTransporter(), $this->read_property( $holder, 'httpTransporter' ) );
        }
    }

    /**
     * The provider's model directory, and the one its availability check
     * wraps, when they take request authentication.
     *
     * @param  string $class_name Provider class.
     * @return object[]
     */
    private function provider_objects_holding_auth( string $class_name ): array
    {
        $candidates   = array( $class_name::modelMetadataDirectory() );
        $availability = $class_name::availability();
        if ( $this->find_property( $availability, 'modelMetadataDirectory' ) ) {
            $candidates[] = $this->read_property( $availability, 'modelMetadataDirectory' );
        }

        $holders = array();
        foreach ( $candidates as $candidate ) {
            if ( $candidate instanceof \WordPress\AiClient\Providers\Http\Contracts\WithRequestAuthenticationInterface && ! in_array( $candidate, $holders, true ) ) {
                $holders[] = $candidate;
            }
        }
        return $holders;
    }

    /**
     * Unset an object's request authentication, which has no public unsetter.
     *
     * @param object $holder Object using the request authentication trait.
     */
    private function clear_request_authentication( object $holder ): void
    {
        $this->require_property( $holder, 'requestAuthentication' )->setValue( $holder, null );
    }

    /**
     * Read a property declared anywhere in an object's class hierarchy.
     *
     * @param  object $holder Object.
     * @param  string $name   Property name.
     * @return mixed
     */
    private function read_property( object $holder, string $name )
    {
        return $this->require_property( $holder, $name )->getValue( $holder );
    }

    /**
     * Find a property declared anywhere in an object's class hierarchy, and
     * fail the test naming it when it is not there.
     *
     * @param  object $holder Object.
     * @param  string $name   Property name.
     * @return \ReflectionProperty
     */
    private function require_property( object $holder, string $name ): \ReflectionProperty
    {
        $property = $this->find_property( $holder, $name );
        if ( null === $property ) {
            $this->fail( sprintf( 'The AI Client no longer has %s::$%s, which this test resets after each run.', get_class( $holder ), $name ) );
        }
        return $property;
    }

    /**
     * Find a property declared anywhere in an object's class hierarchy.
     *
     * @param  object $holder Object.
     * @param  string $name   Property name.
     * @return \ReflectionProperty|null
     */
    private function find_property( object $holder, string $name ): ?\ReflectionProperty
    {
        for ( $class = new \ReflectionClass( $holder ); $class; $class = $class->getParentClass() ) {
            if ( $class->hasProperty( $name ) && $class->getProperty( $name )->getDeclaringClass()->getName() === $class->getName() ) {
                return $class->getProperty( $name );
            }
        }
        return null;
    }

    /**
     * Canned OpenAI replies: the model list, and one Responses reply carrying
     * `canned_reply_text()`. Every other request is refused.
     *
     * @param  false|array $preempt Whether to preempt the request.
     * @param  array       $args    Request arguments.
     * @param  string      $url     Request URL.
     * @return array|\WP_Error
     */
    public function answer_provider( $preempt, $args, $url )
    {
        $method                 = strtoupper( (string) ( $args['method'] ?? 'GET' ) );
        $this->requests[]       = $method . ' ' . $url;
        $body                   = $args['body'] ?? '';
        $this->request_bodies[] = is_string( $body ) ? $body : (string) wp_json_encode( $body );

        $host = (string) wp_parse_url( (string) $url, PHP_URL_HOST );
        $path = (string) wp_parse_url( (string) $url, PHP_URL_PATH );

        if ( 'api.openai.com' !== $host ) {
            return new \WP_Error( 'http_request_blocked', 'No network in this test.' );
        }

        if ( '/v1/models' === $path ) {
            return $this->json_response(
                array(
                    'object' => 'list',
                    'data'   => array(
                        array(
                            'id'     => $this->canned_model,
                            'object' => 'model',
                        ),
                    ),
                )
            );
        }

        if ( '/v1/responses' === $path ) {
            return $this->json_response(
                array(
                    'id'     => 'resp_test',
                    'status' => 'completed',
                    'output' => array(
                        array(
                            'type'    => 'message',
                            'role'    => 'assistant',
                            'content' => array(
                                array(
                                    'type' => 'output_text',
                                    'text' => $this->canned_reply_text(),
                                ),
                            ),
                        ),
                    ),
                    'usage'  => array(
                        'input_tokens'  => 10,
                        'output_tokens' => 20,
                        'total_tokens'  => 30,
                    ),
                )
            );
        }

        return new \WP_Error( 'http_request_blocked', 'No network in this test.' );
    }

    /**
     * The bodies of the requests made to one path on the provider, in order.
     *
     * @param  string $path URL path, for example `/v1/responses`.
     * @return string[]
     */
    private function provider_request_bodies( string $path ): array
    {
        $bodies = array();
        foreach ( $this->requests as $index => $request ) {
            list( , $url ) = explode( ' ', $request, 2 );
            if ( $path === (string) wp_parse_url( $url, PHP_URL_PATH ) ) {
                $bodies[] = $this->request_bodies[ $index ];
            }
        }
        return $bodies;
    }

    /**
     * A credential backend holding an OpenAI key only.
     *
     * @return CredentialBackend
     */
    private function backend_with_openai_key(): CredentialBackend
    {
        return new class() implements CredentialBackend {
            public function get_api_key( string $service ): string
            {
                return 'openai' === $service ? 'test-key' : '';
            }
        };
    }

    /**
     * A WordPress HTTP API response carrying JSON.
     *
     * @param  array $data Response body.
     * @return array
     */
    private function json_response( array $data ): array
    {
        return array(
            'headers'  => array( 'content-type' => 'application/json' ),
            'body'     => (string) wp_json_encode( $data ),
            'response' => array(
                'code'    => 200,
                'message' => 'OK',
            ),
            'cookies'  => array(),
            'filename' => null,
        );
    }
}
