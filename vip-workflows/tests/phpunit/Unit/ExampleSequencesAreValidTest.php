<?php
/**
 * Every committed sequence example must pass the write gate.
 *
 * The canonical template, the docs examples, the demo, and the sequence
 * fixture are all things people (and agents) copy. This runs each of them
 * through the checks a real create applies before it writes: the controller's
 * metadata-field and assignment-key validators, then
 * Sequence::prepare_config_for_write() — so a stale or invalid example (a
 * dangling transition target, a stage with no status region, a duplicate key,
 * an unknown metadata field type) cannot be committed and then copied into a
 * broken workflow.
 *
 * Two rules are deliberately out of scope here. The checks run in the order
 * create_item() uses; import_sequence() asks the same questions in another
 * order, which changes which error a broken file reports first, not whether it
 * is caught. And the stage-agent validator is not run at all: it resolves
 * ability IDs through the abilities registry, which the unit suite does not
 * boot. No suite currently covers that rule for the two agent-bearing files,
 * so renaming an agent ability would break the demo and the fixture silently.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Mockery;
use VIPWorkflows\API\SequencesController;
use VIPWorkflows\Sequences\Sequence;

class ExampleSequencesAreValidTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        // SequencesController's constructor reaches for the global $wpdb.
        global $wpdb;
        $wpdb         = Mockery::mock( 'wpdb' );
        $wpdb->prefix = 'wp_';
    }

    /**
     * Committed sequence example files.
     *
     * Only sequence-shaped JSON is listed here; helper fixtures that are not
     * sequences (region-math.json, abilities-response-contract.json) are excluded.
     *
     * @return array<string, array{0:string}>
     */
    public static function example_files(): array
    {
        $plugin   = dirname( __DIR__, 3 );   // .../vip-workflows (the plugin dir)
        $repo     = dirname( __DIR__, 4 );   // repo root
        $fixtures = dirname( __DIR__, 2 ) . '/fixtures';

        return array(
            'template: editorial-basic'           => array( $plugin . '/includes/sequences/templates/editorial-basic.json' ),
            'example: editorial-review (flat)'    => array( $repo . '/docs/examples/editorial-review.flat.json' ),
            'example: editorial-review (wrapped)' => array( $repo . '/docs/examples/editorial-review.wrapped.json' ),
            'demo: multimedia-sequence'           => array( $repo . '/docs/demos/multimedia-sequence.json' ),
            'fixture: ai-copy-desk-workflow'      => array( $fixtures . '/ai-copy-desk-workflow.json' ),
        );
    }

    /**
     * Each example decodes, passes the controller validators a write runs
     * first, and survives the write gate with at least one stage — leaving the
     * gate nothing to default, so what a reader copies is what gets stored.
     *
     * @dataProvider example_files
     *
     * @param string $path Absolute path to a committed sequence example.
     */
    public function test_example_passes_the_write_gate( string $path ): void
    {
        $this->assertFileExists( $path, "Example file is missing: {$path}" );

        $decoded = json_decode( (string) file_get_contents( $path ), true );
        $this->assertIsArray( $decoded, "Example is not valid JSON: {$path}" );

        // WRAPPED envelopes nest the config under `config`; FLAT bodies and bare
        // configs put the config keys at the top level. The write gate reads the
        // config, so unwrap when needed. The declared type travels in the envelope
        // for both shapes and decides which stage rules the gate applies.
        $config = ( isset( $decoded['config'] ) && is_array( $decoded['config'] ) ) ? $decoded['config'] : $decoded;
        $type   = ( isset( $decoded['type'] ) && is_string( $decoded['type'] ) ) ? $decoded['type'] : Sequence::TYPE_WORKFLOW;

        $this->assertIsArray( $config['statuses'] ?? null, "Example declares no statuses: {$path}" );

        $controller = new SequencesController();

        $metadata_check = $controller->validate_metadata_fields( $config['metadata_fields'] ?? array() );
        $this->assertFalse(
            $metadata_check instanceof \WP_Error,
            "Example fails the metadata-field check ({$path}): " . ( $metadata_check instanceof \WP_Error ? $metadata_check->get_error_message() : '' )
        );

        $statuses = Sequence::normalize_input_shape( array( 'statuses' => $config['statuses'] ) )['statuses'];

        $assignment_check = $controller->validate_assignment_keys( $statuses );
        $this->assertFalse(
            $assignment_check instanceof \WP_Error,
            "Example fails the assignment-key check ({$path}): " . ( $assignment_check instanceof \WP_Error ? $assignment_check->get_error_message() : '' )
        );

        // Every committed example spells out its regions and entry checkpoints
        // today. Holding them to that keeps the gate's silent defaults out of
        // what a reader copies.
        $this->assertSame(
            array(),
            Sequence::find_stages_missing_region( $statuses ),
            "Example leaves a stage without a status region for the gate to default: {$path}"
        );
        $this->assertSame(
            array(),
            Sequence::find_regions_missing_entry( $statuses ),
            "Example leaves a region without a region_entry for the gate to auto-assign: {$path}"
        );

        $normalized = Sequence::prepare_config_for_write( $config, $type );

        $this->assertNotEmpty(
            $normalized['statuses'] ?? array(),
            "Example normalized to no stages: {$path}"
        );
    }
}
