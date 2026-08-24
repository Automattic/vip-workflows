<?php
/**
 * Guideline context read against real Gutenberg Knowledge storage.
 *
 * The unit suite mocks the storage, so it can only prove that our formatting is
 * self-consistent — it cannot notice when Gutenberg reshapes the thing we read.
 * That is exactly how the `/wp/v2/content-guidelines` route stayed "covered"
 * after WordPress/gutenberg#79263 deleted it: guidelines silently stopped
 * reaching every AI prompt while the mocked test stayed green.
 *
 * This test loads Gutenberg's own Knowledge module, writes a guideline row the
 * way the Settings → Guidelines page does, and asserts the provider reads it
 * back. If Gutenberg changes the post type, the taxonomy, or the `guideline-`
 * slug model again, this fails.
 *
 * Every case here also asserts, for free, that the provider reports no
 * integration fault on a working site: WP_UnitTestCase fails any test where an
 * undeclared `_doing_it_wrong()` fires, and `report_fault()` goes through it.
 *
 * @package VIPWorkflow\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Integration;

use VIPWorkflow\Integrations\GuidelineContextProvider;

/**
 * @covers \VIPWorkflow\Integrations\GuidelineContextProvider
 */
class GuidelineContextProviderKnowledgeTest extends TestCase {

	/**
	 * Candidate locations of Gutenberg's Knowledge module, relative to the
	 * plugin directory.
	 *
	 * The feature is being promoted out of `lib/experimental` and into the
	 * WordPress compat layer (WordPress/gutenberg#79674), so both are accepted.
	 *
	 * @var string[]
	 */
	private const KNOWLEDGE_MODULE_PATHS = array(
		'gutenberg/lib/experimental/knowledge/index.php',
		'gutenberg/lib/compat/wordpress-7.1/knowledge/index.php',
		'gutenberg/lib/compat/wordpress-7.2/knowledge/index.php',
	);

	/**
	 * Load Gutenberg's Knowledge module and register its post type.
	 */
	public function set_up(): void {
		parent::set_up();

		$module = self::locate_knowledge_module();
		if ( null === $module ) {
			$this->markTestSkipped(
				'Gutenberg Knowledge module not found. Checked: ' . implode( ', ', self::KNOWLEDGE_MODULE_PATHS )
			);
		}

		require_once $module;

		// `init` has already fired for this process, and register() is guarded by
		// post_type_exists(), so this is safe to call on every test.
		\Gutenberg_Knowledge_Post_Type::register();

		$this->assertTrue(
			post_type_exists( 'wp_knowledge' ),
			'Gutenberg Knowledge module loaded but did not register the wp_knowledge post type.'
		);
	}

	/**
	 * Find Gutenberg's Knowledge module on disk.
	 *
	 * @return string|null Absolute path, or null when Gutenberg is unavailable.
	 */
	private static function locate_knowledge_module(): ?string {
		foreach ( self::KNOWLEDGE_MODULE_PATHS as $relative ) {
			$path = WP_PLUGIN_DIR . '/' . $relative;
			if ( file_exists( $path ) ) {
				return $path;
			}
		}

		return null;
	}

	/**
	 * Write a guideline row the way the Settings → Guidelines page does.
	 *
	 * The `guideline` type term is assigned explicitly rather than left to the
	 * `save_post_wp_knowledge` hook, because that hook is attached inside
	 * `register()` — which early-returns once the post type exists, so a later
	 * test in the same process cannot rely on it still being wired.
	 *
	 * @param string $slug    Row slug (`guideline-{scope}` or `guideline-block-{name}`).
	 * @param string $title   Row title.
	 * @param string $content Guideline text.
	 * @return int Post ID.
	 */
	private function create_guideline_row( string $slug, string $title, string $content ): int {
		$post_id = wp_insert_post(
			array(
				'post_type'    => 'wp_knowledge',
				'post_status'  => 'publish',
				'post_name'    => $slug,
				'post_title'   => $title,
				'post_content' => $content,
			),
			true
		);

		$this->assertNotWPError( $post_id );

		$term_id = wp_knowledge_get_or_create_type_term( 'guideline' );
		$this->assertNotNull( $term_id, 'Could not resolve the `guideline` knowledge type term.' );
		wp_set_object_terms( $post_id, $term_id, 'wp_knowledge_type' );

		// The row was inserted with an exact slug; confirm WordPress kept it,
		// since the whole scope model is slug-addressed.
		$this->assertSame( $slug, get_post( $post_id )->post_name );

		return (int) $post_id;
	}

	public function test_published_guideline_rows_reach_the_ai_context(): void {
		$this->create_guideline_row( 'guideline-copy', 'Copy', 'Only write in iambic pentameter.' );
		$this->create_guideline_row( 'guideline-site', 'Site', 'A trade publication for civil engineers.' );

		$context = GuidelineContextProvider::gather_context();

		$this->assertStringContainsString( '=== Content Guidelines ===', $context );
		$this->assertStringContainsString( 'Only write in iambic pentameter.', $context );
		$this->assertStringContainsString( 'A trade publication for civil engineers.', $context );

		// Site (order 10) precedes Copy (order 20) in Gutenberg's scope registry.
		$this->assertLessThan(
			strpos( $context, 'Only write in iambic pentameter.' ),
			strpos( $context, 'A trade publication for civil engineers.' )
		);
	}

	public function test_per_block_guideline_rows_reach_the_ai_context(): void {
		// Gutenberg encodes the block namespace separator as `_` in the slug and
		// keeps the canonical name in the title.
		$this->create_guideline_row( 'guideline-block-core_pullquote', 'core/pullquote', 'Reserve pull quotes for sourced statements.' );

		$context = GuidelineContextProvider::gather_context();

		$this->assertStringContainsString( 'Block: core/pullquote', $context );
		$this->assertStringContainsString( 'Reserve pull quotes for sourced statements.', $context );
	}

	public function test_unpublished_guideline_rows_are_not_read(): void {
		$post_id = $this->create_guideline_row( 'guideline-copy', 'Copy', 'Draft-only guidance.' );
		wp_update_post( array( 'ID' => $post_id, 'post_status' => 'draft' ) );

		$this->assertSame( 'No guideline context available.', GuidelineContextProvider::gather_context() );
	}

	public function test_non_guideline_knowledge_rows_are_not_read(): void {
		$post_id = wp_insert_post(
			array(
				'post_type'    => 'wp_knowledge',
				'post_status'  => 'publish',
				'post_name'    => 'a-private-note',
				'post_title'   => 'A note',
				'post_content' => 'Personal working notes, not editorial guidance.',
			),
			true
		);
		$this->assertNotWPError( $post_id );

		$term_id = wp_knowledge_get_or_create_type_term( 'note' );
		$this->assertNotNull( $term_id );
		wp_set_object_terms( $post_id, $term_id, 'wp_knowledge_type' );

		$this->assertSame( 'No guideline context available.', GuidelineContextProvider::gather_context() );
	}

	public function test_editorial_alignment_rules_read_the_same_rows(): void {
		$this->create_guideline_row( 'guideline-copy', 'Copy', 'Never use unsupported superlatives.' );

		$rules = GuidelineContextProvider::get_editorial_alignment_rules();

		$this->assertCount( 1, $rules );
		$this->assertStringContainsString( 'Never use unsupported superlatives.', $rules[0]['rule'] );
	}

	public function test_empty_state_when_no_guidelines_are_written(): void {
		$this->assertSame( 'No guideline context available.', GuidelineContextProvider::gather_context() );
		$this->assertSame( array(), GuidelineContextProvider::get_editorial_alignment_rules() );
	}

	/**
	 * The scope registry is Gutenberg's public extension point, and the provider
	 * groups and orders sections from it. If it stops being a filterable,
	 * slug-keyed map of title/order, section labelling here breaks silently.
	 */
	public function test_scope_registry_shape_is_what_the_provider_relies_on(): void {
		$this->assertTrue( function_exists( 'wp_guideline_scopes' ) );

		$scopes = wp_guideline_scopes();

		$this->assertIsArray( $scopes );
		$this->assertArrayHasKey( 'copy', $scopes );
		$this->assertArrayHasKey( 'blocks', $scopes );
		$this->assertArrayHasKey( 'title', $scopes['copy'] );
		$this->assertArrayHasKey( 'order', $scopes['copy'] );
	}

	public function test_a_plugin_registered_scope_is_picked_up(): void {
		add_filter(
			'wp_guideline_scopes',
			static function ( array $scopes ): array {
				$scopes['legal'] = array(
					'title'       => 'Legal',
					'description' => 'Legal review standards.',
					'order'       => 60,
				);
				return $scopes;
			}
		);

		$this->create_guideline_row( 'guideline-legal', 'Legal', 'Clear every claim with counsel.' );

		$this->assertStringContainsString(
			"## Legal\nClear every claim with counsel.",
			GuidelineContextProvider::gather_context()
		);
	}
}
