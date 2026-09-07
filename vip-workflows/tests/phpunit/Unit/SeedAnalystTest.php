<?php
/**
 * Tests for the Seed Analyst brand-context formatting.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use ReflectionMethod;
use VIPWorkflows\Ideation\Assistants\SeedAnalyst;

require_once __DIR__ . '/../../../includes/ideation/assistants/class-seed-analyst.php';

/**
 * @covers \VIPWorkflows\Ideation\Assistants\SeedAnalyst
 */
class SeedAnalystTest extends TestCase {

	public function test_format_brand_context_includes_guideline_content_not_just_title(): void {
		$section = $this->invoke_format(
			array(
				array(
					'title'   => 'Content Guidelines',
					'content' => "=== Content Guidelines ===\n## Copy Guidelines\nNo unsupported superlatives.",
				),
			)
		);

		$this->assertStringContainsString( 'BRAND CONTEXT', $section );
		$this->assertStringContainsString( 'Content Guidelines:', $section );
		// The actual rule text must reach the prompt, not just the label.
		$this->assertStringContainsString( 'No unsupported superlatives.', $section );
	}

	public function test_format_brand_context_falls_back_to_title_when_content_missing(): void {
		$section = $this->invoke_format( array( array( 'title' => 'House Style' ) ) );

		$this->assertStringContainsString( 'House Style', $section );
	}

	public function test_format_brand_context_is_empty_when_no_usable_entries(): void {
		$this->assertSame( '', $this->invoke_format( array() ) );
		$this->assertSame( '', $this->invoke_format( array( array( 'title' => '', 'content' => '' ) ) ) );
	}

	/**
	 * Invoke the private static formatter.
	 *
	 * @param array $brand_context Brand knowledge entries.
	 * @return string
	 */
	private function invoke_format( array $brand_context ): string {
		$method = new ReflectionMethod( SeedAnalyst::class, 'format_brand_context' );

		return $method->invoke( null, $brand_context );
	}
}
