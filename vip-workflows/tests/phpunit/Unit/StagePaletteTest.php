<?php
/**
 * Stage palette parity guard.
 *
 * The qualitative stage palette is declared twice — once in PHP
 * (VIPWorkflows\Workflow\StagePalette, for the seeder and the REST responses)
 * and once in JS (src/admin/utils/stage-palette.js, for the sequence editor's
 * color picker). Neither language can read the other's copy without a build
 * step, so this test reads the JS file and asserts the two agree slot for slot.
 * Change one side and the unit suite fails until the other side matches.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use PHPUnit\Framework\TestCase;
use VIPWorkflows\Workflow\StagePalette;

class StagePaletteTest extends TestCase
{
    private const PALETTE_JS = __DIR__ . '/../../../src/admin/utils/stage-palette.js';

    /**
     * The hex values of STAGE_PALETTE in src/admin/utils/stage-palette.js, in
     * slot order.
     *
     * @return string[]
     */
    private function js_palette_slots(): array
    {
        $source = file_get_contents( self::PALETTE_JS );

        $this->assertNotFalse( $source, 'src/admin/utils/stage-palette.js could not be read' );

        $matched = preg_match( '/export const STAGE_PALETTE = \[(.*?)\];/s', $source, $block );

        $this->assertSame( 1, $matched, 'STAGE_PALETTE array not found in stage-palette.js' );

        preg_match_all( "/value:\s*'(#[0-9A-Fa-f]{6})'/", $block[1], $values );

        $this->assertNotEmpty( $values[1], 'STAGE_PALETTE declares no color values' );

        return $values[1];
    }

    public function test_php_slots_match_the_js_palette(): void
    {
        $this->assertSame(
            $this->js_palette_slots(),
            StagePalette::SLOTS,
            'StagePalette::SLOTS and STAGE_PALETTE in stage-palette.js have drifted apart'
        );
    }

    public function test_default_color_is_the_first_slot_in_both_languages(): void
    {
        $this->assertSame( StagePalette::SLOTS[0], StagePalette::DEFAULT_COLOR );

        $source = file_get_contents( self::PALETTE_JS );

        // The JS default is written as an expression, so assert the expression
        // rather than a value: it is what keeps the two defaults tied together.
        $this->assertStringContainsString(
            'export const DEFAULT_STAGE_COLOR = STAGE_PALETTE[ 0 ].value;',
            (string) $source,
            'DEFAULT_STAGE_COLOR in stage-palette.js no longer resolves to the first slot'
        );
    }

    public function test_at_cycles_through_the_slots(): void
    {
        $count = count( StagePalette::SLOTS );

        $this->assertSame( StagePalette::SLOTS[0], StagePalette::at( 0 ) );
        $this->assertSame( StagePalette::SLOTS[ $count - 1 ], StagePalette::at( $count - 1 ) );
        $this->assertSame( StagePalette::SLOTS[0], StagePalette::at( $count ) );
        $this->assertSame( StagePalette::SLOTS[1], StagePalette::at( $count + 1 ) );
        $this->assertSame( StagePalette::SLOTS[ $count - 1 ], StagePalette::at( -1 ) );
    }

    /**
     * Every core post status resolves to a palette slot, and so does one that
     * is not core's — a CPT-registered status is an unmapped category, not a
     * missing value, so it takes the default slot.
     */
    public function test_every_core_post_status_maps_onto_the_palette(): void
    {
        foreach ( array( 'draft', 'pending', 'future', 'publish', 'private' ) as $status ) {
            $this->assertContains(
                StagePalette::for_post_status( $status ),
                StagePalette::SLOTS,
                sprintf( 'post status "%s" resolved to a color outside the palette', $status )
            );
        }

        $this->assertSame( StagePalette::DEFAULT_COLOR, StagePalette::for_post_status( 'nonesuch' ) );
    }

    /**
     * The five core statuses are told apart by color, so no two may share a
     * slot.
     */
    public function test_core_post_statuses_are_visually_distinct(): void
    {
        $colors = array_map(
            static fn( string $status ): string => StagePalette::for_post_status( $status ),
            array( 'draft', 'pending', 'future', 'publish', 'private' )
        );

        $this->assertSame( $colors, array_unique( $colors ), 'two core post statuses share a palette slot' );
    }
}
