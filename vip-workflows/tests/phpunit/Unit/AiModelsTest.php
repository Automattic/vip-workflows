<?php
/**
 * Per-provider model catalog tests.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflows\AI\AiModels;
use WordPress\OpenAiAiProvider\Provider\OpenAiProvider;

class AiModelsTest extends TestCase
{
    private array $transients = array();

    protected function setUp(): void
    {
        parent::setUp();

        $this->transients = array();
        Functions\when( 'get_transient' )->alias(
            fn( string $name ) => $this->transients[ $name ] ?? false
        );
        Functions\when( 'set_transient' )->alias(
            function ( string $name, $value ) {
                $this->transients[ $name ] = $value;
                return true;
            }
        );
        Functions\when( 'delete_transient' )->alias(
            function ( string $name ) {
                unset( $this->transients[ $name ] );
                return true;
            }
        );

        OpenAiProvider::$catalog = array();
    }

    protected function tearDown(): void
    {
        OpenAiProvider::$catalog = array();
        parent::tearDown();
    }

    public function test_discovers_text_generation_models_only(): void
    {
        OpenAiProvider::$catalog = array(
            array( 'gpt-4o', array( 'TEXT_GENERATION' ) ),
            array( 'gpt-4o-mini', array( 'TEXT_GENERATION' ) ),
            array( 'text-embedding-3', array( 'EMBEDDING' ) ),
        );

        $models = AiModels::for_provider( 'openai' );

        $this->assertContains( 'gpt-4o', $models );
        $this->assertContains( 'gpt-4o-mini', $models );
        $this->assertNotContains( 'text-embedding-3', $models );
    }

    public function test_drops_dated_snapshot_ids(): void
    {
        OpenAiProvider::$catalog = array(
            array( 'gpt-4o', array( 'TEXT_GENERATION' ) ),
            array( 'gpt-4o-2026-01-15', array( 'TEXT_GENERATION' ) ),
        );

        $models = AiModels::for_provider( 'openai' );

        $this->assertContains( 'gpt-4o', $models );
        $this->assertNotContains( 'gpt-4o-2026-01-15', $models );
    }

    public function test_returns_cached_catalog_without_discovery(): void
    {
        $this->transients['vip_workflows_ai_models_openai'] = array( 'cached-model' );
        // A different live catalog would be discovered if the cache were ignored.
        OpenAiProvider::$catalog = array( array( 'gpt-4o', array( 'TEXT_GENERATION' ) ) );

        $this->assertSame( array( 'cached-model' ), AiModels::for_provider( 'openai' ) );
    }

    public function test_caches_discovered_catalog(): void
    {
        OpenAiProvider::$catalog = array( array( 'gpt-4o', array( 'TEXT_GENERATION' ) ) );

        AiModels::for_provider( 'openai' );

        $this->assertSame( array( 'gpt-4o' ), $this->transients['vip_workflows_ai_models_openai'] );
    }

    public function test_is_valid_checks_against_catalog(): void
    {
        OpenAiProvider::$catalog = array( array( 'gpt-4o', array( 'TEXT_GENERATION' ) ) );

        $this->assertTrue( AiModels::is_valid( 'openai', 'gpt-4o' ) );
        $this->assertFalse( AiModels::is_valid( 'openai', 'not-a-model' ) );
    }

    public function test_is_valid_accepts_any_non_empty_when_catalog_empty(): void
    {
        OpenAiProvider::$catalog = array();

        $this->assertTrue( AiModels::is_valid( 'openai', 'anything' ) );
        $this->assertFalse( AiModels::is_valid( 'openai', '' ) );
    }

    public function test_flush_clears_cache(): void
    {
        $this->transients['vip_workflows_ai_models_openai'] = array( 'cached-model' );

        AiModels::flush( 'openai' );

        $this->assertArrayNotHasKey( 'vip_workflows_ai_models_openai', $this->transients );
    }
}
