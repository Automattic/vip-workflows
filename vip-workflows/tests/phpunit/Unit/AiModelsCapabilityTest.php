<?php
/**
 * AiModels capability-detection unit tests.
 *
 * Regression coverage for the text-generation capability match, which must
 * handle the AI Client's enum-like CapabilityEnum (a magic `->name` for which
 * property_exists()/isset() return false), native PHP enums, and plain strings.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use VIPWorkflows\AI\AiModels;

/**
 * A native backed enum whose case name is the lowercase capability id, mirroring
 * how some providers report capabilities.
 */
enum FakeCapabilityBackedEnum: string {
	case text_generation = 'text_generation';
	case image_generation = 'image_generation';
}

/**
 * An enum-like value object exposing `name` only through a magic getter — the
 * shape that broke the original property_exists()-based check.
 */
class FakeMagicCapability {
	public function __construct( private string $capability ) {}

	public function __get( string $prop ) {
		return 'name' === $prop ? $this->capability : null;
	}
}

/**
 * A metadata double returning a fixed capability list.
 */
class FakeModelMeta {
	/**
	 * @param array $caps Capability values.
	 */
	public function __construct( private array $caps ) {}

	public function getSupportedCapabilities(): array {
		return $this->caps;
	}
}

/**
 * Tests for AiModels::supports_text_generation() via reflection.
 */
class AiModelsCapabilityTest extends TestCase
{
    private function supports( array $caps ): bool
    {
        $method = new \ReflectionMethod( AiModels::class, 'supports_text_generation' );
        return (bool) $method->invoke( null, new FakeModelMeta( $caps ) );
    }

    public function test_matches_magic_getter_capability(): void
    {
        $this->assertTrue( $this->supports( array( new FakeMagicCapability( 'TEXT_GENERATION' ) ) ) );
    }

    public function test_matches_lowercase_magic_getter_capability(): void
    {
        $this->assertTrue( $this->supports( array( new FakeMagicCapability( 'text_generation' ) ) ) );
    }

    public function test_matches_backed_enum_capability(): void
    {
        $this->assertTrue( $this->supports( array( FakeCapabilityBackedEnum::text_generation ) ) );
    }

    public function test_matches_plain_string_capability(): void
    {
        $this->assertTrue( $this->supports( array( 'text_generation' ) ) );
    }

    public function test_no_match_for_unrelated_capabilities(): void
    {
        $this->assertFalse( $this->supports( array( new FakeMagicCapability( 'image_generation' ), 'embedding' ) ) );
        $this->assertFalse( $this->supports( array( FakeCapabilityBackedEnum::image_generation ) ) );
    }
}
