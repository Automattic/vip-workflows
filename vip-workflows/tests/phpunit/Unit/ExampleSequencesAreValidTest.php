<?php
/**
 * Every committed sequence example must pass the write gate.
 *
 * The canonical templates, the docs examples, the demo, and the sequence
 * fixtures are all things people (and agents) copy. This runs each of them
 * through Sequence::prepare_config_for_write() — the exact gate a real create or
 * import goes through — so a stale or invalid example (a dangling transition
 * target, a stage with no status region, a duplicate key) cannot be committed
 * and then copied into a broken workflow.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use VIPWorkflows\Sequences\Sequence;

class ExampleSequencesAreValidTest extends TestCase
{
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
        $plugin = dirname( __DIR__, 3 );   // .../vip-workflows (the plugin dir)
        $repo   = dirname( __DIR__, 4 );   // repo root
        $fixtures = dirname( __DIR__, 2 ) . '/fixtures';

        return array(
            'template: editorial-basic'        => array( $plugin . '/includes/sequences/templates/editorial-basic.json' ),
            'example: editorial-review (flat)' => array( $repo . '/docs/examples/editorial-review.flat.json' ),
            'example: editorial-review (wrapped)' => array( $repo . '/docs/examples/editorial-review.wrapped.json' ),
            'demo: multimedia-sequence'        => array( $repo . '/docs/demos/multimedia-sequence.json' ),
            'fixture: ai-copy-desk-workflow'   => array( $fixtures . '/ai-copy-desk-workflow.json' ),
        );
    }

    /**
     * Each example decodes and its config survives the write gate unchanged
     * (no InvalidArgumentException, and at least one stage remains).
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
        // config, so unwrap when needed.
        $config = ( isset( $decoded['config'] ) && is_array( $decoded['config'] ) ) ? $decoded['config'] : $decoded;

        $normalized = Sequence::prepare_config_for_write( $config );

        $this->assertNotEmpty(
            $normalized['statuses'] ?? array(),
            "Example normalized to no stages: {$path}"
        );
    }
}
