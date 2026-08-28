<?php
/**
 * Tests for the canonical guideline context provider.
 *
 * These cover the grouping/formatting logic over `wp_knowledge` guideline rows.
 * Whether Gutenberg still stores guidelines in that shape is not something a
 * mocked test can answer — that is asserted against real Gutenberg in
 * tests/phpunit/Integration/GuidelineContextProviderKnowledgeTest.php.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflows\Integrations\GuidelineContextProvider;

require_once __DIR__ . '/../../../includes/integrations/class-guideline-context-provider.php';

/**
 * @covers \VIPWorkflows\Integrations\GuidelineContextProvider
 */
class GuidelineContextProviderTest extends TestCase {

	/**
	 * The scope registry Gutenberg ships by default.
	 *
	 * @var array<string, array{title: string, order: int}>
	 */
	private const DEFAULT_SCOPES = array(
		'site'       => array( 'title' => 'Site', 'order' => 10 ),
		'copy'       => array( 'title' => 'Copy', 'order' => 20 ),
		'images'     => array( 'title' => 'Images', 'order' => 30 ),
		'blocks'     => array( 'title' => 'Blocks', 'order' => 40 ),
		'additional' => array( 'title' => 'Additional', 'order' => 50 ),
	);

	/**
	 * Stub Knowledge storage as present, holding the given rows.
	 *
	 * @param array<int, array{slug: string, content: string, title?: string}> $rows   Guideline rows.
	 * @param array<string, array{title: string, order: int}>|null             $scopes Scope registry.
	 */
	private function given_guideline_rows( array $rows, ?array $scopes = null ): void {
		Functions\when( 'post_type_exists' )->justReturn( true );
		Functions\when( 'wp_guideline_scopes' )->justReturn( $scopes ?? self::DEFAULT_SCOPES );

		$posts = array();
		foreach ( $rows as $row ) {
			$posts[] = $this->create_mock_post(
				array(
					'post_type'    => 'wp_knowledge',
					'post_status'  => 'publish',
					'post_name'    => $row['slug'],
					'post_title'   => $row['title'] ?? $row['slug'],
					'post_content' => $row['content'],
				)
			);
		}

		Functions\when( 'get_posts' )->justReturn( $posts );
	}

	public function test_gather_context_reads_guideline_rows_from_knowledge_storage(): void {
		$this->given_guideline_rows(
			array(
				array( 'slug' => 'guideline-site', 'title' => 'Site', 'content' => 'Describe the audience plainly.' ),
				array( 'slug' => 'guideline-copy', 'title' => 'Copy', 'content' => 'Use precise, practical editorial voice.' ),
				array( 'slug' => 'guideline-additional', 'title' => 'Additional', 'content' => 'Avoid unsupported claims.' ),
			)
		);

		$context = GuidelineContextProvider::gather_context();

		$this->assertStringContainsString( '=== Content Guidelines ===', $context );
		$this->assertStringContainsString( "## Site\nDescribe the audience plainly.", $context );
		$this->assertStringContainsString( "## Copy\nUse precise, practical editorial voice.", $context );
		$this->assertStringContainsString( "## Additional\nAvoid unsupported claims.", $context );
	}

	public function test_per_block_rows_are_titled_with_the_canonical_block_name(): void {
		$this->given_guideline_rows(
			array(
				array(
					// Gutenberg encodes the namespace separator as `_` in the slug
					// and keeps the canonical name in the title.
					'slug'    => 'guideline-block-core_paragraph',
					'title'   => 'core/paragraph',
					'content' => 'Keep paragraphs focused.',
				),
			)
		);

		$this->assertStringContainsString(
			"## Block: core/paragraph\nKeep paragraphs focused.",
			GuidelineContextProvider::gather_context()
		);
	}

	public function test_sections_follow_the_scope_registry_order(): void {
		$this->given_guideline_rows(
			array(
				array( 'slug' => 'guideline-additional', 'content' => 'Third.' ),
				array( 'slug' => 'guideline-site', 'content' => 'First.' ),
				array( 'slug' => 'guideline-copy', 'content' => 'Second.' ),
			)
		);

		$context = GuidelineContextProvider::gather_context();

		$this->assertLessThan( strpos( $context, 'Second.' ), strpos( $context, 'First.' ) );
		$this->assertLessThan( strpos( $context, 'Third.' ), strpos( $context, 'Second.' ) );
	}

	public function test_a_plugin_registered_scope_is_picked_up(): void {
		$this->given_guideline_rows(
			array(
				array( 'slug' => 'guideline-legal', 'title' => 'Legal', 'content' => 'Clear every claim with counsel.' ),
			),
			array( 'legal' => array( 'title' => 'Legal', 'order' => 60 ) )
		);

		$this->assertStringContainsString(
			"## Legal\nClear every claim with counsel.",
			GuidelineContextProvider::gather_context()
		);
	}

	public function test_rows_outside_the_scope_registry_are_ignored(): void {
		Functions\expect( '_doing_it_wrong' )->never();
		$this->given_guideline_rows(
			array(
				// A slug suffixed by wp_unique_post_slug(); Gutenberg's Settings
				// page treats it as dead data, so it must not reach the model.
				array( 'slug' => 'guideline-copy-2', 'content' => 'Stale duplicate.' ),
				// A knowledge row that is not a guideline scope at all.
				array( 'slug' => 'some-note', 'content' => 'Unrelated note.' ),
				array( 'slug' => 'guideline-copy', 'content' => 'The live guidance.' ),
			)
		);

		$context = GuidelineContextProvider::gather_context();

		$this->assertStringContainsString( 'The live guidance.', $context );
		$this->assertStringNotContainsString( 'Stale duplicate.', $context );
		$this->assertStringNotContainsString( 'Unrelated note.', $context );
	}

	public function test_gather_context_returns_empty_message_when_knowledge_storage_is_unavailable(): void {
		Functions\when( 'wp_guideline_scopes' )->justReturn( array() );
		Functions\when( 'post_type_exists' )->justReturn( false );

		$this->assertSame(
			'No guideline context available.',
			GuidelineContextProvider::gather_context()
		);
	}

	public function test_gather_context_returns_empty_message_when_no_guidelines_are_written(): void {
		$this->given_guideline_rows( array() );

		$this->assertSame(
			'No guideline context available.',
			GuidelineContextProvider::gather_context()
		);
	}

	/**
	 * A site that does not run Gutenberg's guidelines feature is not misconfigured,
	 * and must not have its debug log filled with reports about it.
	 */
	public function test_no_fault_is_reported_when_the_feature_is_not_running(): void {
		Functions\expect( '_doing_it_wrong' )->never();
		Functions\when( 'wp_guideline_scopes' )->justReturn( array() );
		Functions\when( 'post_type_exists' )->justReturn( false );

		$this->assertSame( 'No guideline context available.', GuidelineContextProvider::gather_context() );
	}

	/**
	 * Nor is a site that simply has not written any guidelines yet.
	 */
	public function test_no_fault_is_reported_when_no_guidelines_are_written(): void {
		Functions\expect( '_doing_it_wrong' )->never();
		$this->given_guideline_rows( array() );

		$this->assertSame( 'No guideline context available.', GuidelineContextProvider::gather_context() );
	}

	/**
	 * Guidelines are configured to work and do not: the scope registry loaded,
	 * but the storage it describes is missing.
	 */
	public function test_fault_is_reported_when_the_registry_loads_without_its_storage(): void {
		Functions\expect( '_doing_it_wrong' )->once();
		Functions\when( 'wp_guideline_scopes' )->justReturn( self::DEFAULT_SCOPES );
		Functions\when( 'post_type_exists' )->justReturn( false );

		$this->assertSame( 'No guideline context available.', GuidelineContextProvider::gather_context() );
	}

	/**
	 * The drift signal: rows are stored, but the slug model no longer matches.
	 * This is the shape the `/wp/v2/content-guidelines` removal would have taken.
	 */
	public function test_fault_is_reported_when_no_stored_row_maps_to_a_scope(): void {
		Functions\expect( '_doing_it_wrong' )->once();
		$this->given_guideline_rows(
			array(
				array( 'slug' => 'knowledge-copy', 'content' => 'Stored under a slug we do not recognize.' ),
			)
		);

		$this->assertSame( 'No guideline context available.', GuidelineContextProvider::gather_context() );
	}

	public function test_a_fault_is_reported_only_once_per_request(): void {
		Functions\expect( '_doing_it_wrong' )->once();
		Functions\when( 'wp_guideline_scopes' )->justReturn( self::DEFAULT_SCOPES );
		Functions\when( 'post_type_exists' )->justReturn( false );

		GuidelineContextProvider::gather_context();
		GuidelineContextProvider::gather_context();
		GuidelineContextProvider::get_editorial_alignment_rules();
	}

	public function test_blank_rows_do_not_produce_empty_sections(): void {
		$this->given_guideline_rows(
			array(
				array( 'slug' => 'guideline-images', 'content' => '   ' ),
				array( 'slug' => 'guideline-copy', 'content' => 'Real guidance.' ),
			)
		);

		$context = GuidelineContextProvider::gather_context();

		$this->assertStringContainsString( "## Copy\nReal guidance.", $context );
		$this->assertStringNotContainsString( 'Images', $context );
	}

	public function test_editorial_alignment_rules_read_knowledge_guideline_rows(): void {
		$this->given_guideline_rows(
			array(
				array( 'slug' => 'guideline-copy', 'content' => 'Never use unsupported superlatives.' ),
			)
		);

		$rules = GuidelineContextProvider::get_editorial_alignment_rules( 123 );

		$this->assertSame(
			array(
				array(
					'name' => 'Content Guidelines',
					'rule' => "## Copy\nNever use unsupported superlatives.",
				),
			),
			$rules
		);
	}

	public function test_editorial_alignment_rules_are_empty_when_no_guidelines_exist(): void {
		Functions\when( 'wp_guideline_scopes' )->justReturn( array() );
		Functions\when( 'post_type_exists' )->justReturn( false );

		$this->assertSame( array(), GuidelineContextProvider::get_editorial_alignment_rules() );
	}

	public function test_guideline_context_is_filterable(): void {
		$this->given_guideline_rows(
			array( array( 'slug' => 'guideline-copy', 'content' => 'Base rule.' ) )
		);
		Functions\when( 'apply_filters' )->alias(
			function ( string $tag, $value ) {
				return 'vip_workflows_guideline_context' === $tag ? $value . "\nAppended by filter." : $value;
			}
		);

		$this->assertStringContainsString( "\nAppended by filter.", GuidelineContextProvider::gather_context() );
	}

	public function test_editorial_alignment_rules_are_filterable(): void {
		$this->given_guideline_rows( array() );
		Functions\when( 'apply_filters' )->alias(
			function ( string $tag, $value ) {
				if ( 'vip_workflows_editorial_alignment_rules' === $tag ) {
					$value[] = array( 'name' => 'Locale', 'rule' => 'UK English spelling.' );
				}
				return $value;
			}
		);

		$this->assertSame(
			array( array( 'name' => 'Locale', 'rule' => 'UK English spelling.' ) ),
			GuidelineContextProvider::get_editorial_alignment_rules()
		);
	}
}
