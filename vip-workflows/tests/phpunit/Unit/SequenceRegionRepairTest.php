<?php
/**
 * Detection and repair of stages stored without a status region.
 *
 * A sequence written before the stage x status matrix landed has stages with no
 * `status` region. Reading one throws by design (no silent read-time default), so
 * the editor needs a way to SEE the condition without tripping it, and an explicit
 * action to fix it. These tests pin both halves.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use VIPWorkflow\Sequences\Sequence;

/**
 * Tests for Sequence::get_stages_missing_region() and the write gate's default.
 */
class SequenceRegionRepairTest extends TestCase
{
    /**
     * Build a Sequence from a stage list, bypassing the write gate the way a
     * pre-matrix stored row does.
     *
     * @param array  $statuses Stage configs.
     * @param string $type     Sequence type.
     * @return Sequence
     */
    private function sequence_with_stages( array $statuses, string $type = Sequence::TYPE_WORKFLOW ): Sequence
    {
        $config = array(
            'post_types' => array( 'post' ),
            'statuses'   => $statuses,
        );

        $row = (object) array(
            'id'          => 1,
            'uuid'        => 'test-uuid-1234',
            'type'        => $type,
            'name'        => 'Legacy Sequence',
            'slug'        => 'legacy-sequence',
            'description' => '',
            'version'     => 1,
            'status'      => 'active',
            'config'      => json_encode( $config ),
            'created_by'  => 1,
            'created_at'  => '2026-01-01 00:00:00',
            'updated_at'  => '2026-01-01 00:00:00',
        );

        return Sequence::from_row( $row );
    }

    /**
     * A config written through the gate has no missing regions.
     */
    public function test_gated_config_reports_nothing_missing(): void
    {
        $sequence = $this->sequence_with_stages(
            array(
                array( 'key' => 'draft', 'label' => 'Draft', 'status' => 'draft' ),
                array( 'key' => 'live', 'label' => 'Live', 'status' => 'publish' ),
            )
        );

        $this->assertSame( array(), $sequence->get_stages_missing_region() );
    }

    /**
     * A pre-matrix stage is reported, in config order, without throwing.
     */
    public function test_detects_stages_missing_a_region(): void
    {
        $sequence = $this->sequence_with_stages(
            array(
                array( 'key' => 'draft', 'label' => 'Draft' ),
                array( 'key' => 'review', 'label' => 'Review', 'status' => 'pending' ),
                array( 'key' => 'ready', 'label' => 'Ready' ),
            )
        );

        $this->assertSame( array( 'draft', 'ready' ), $sequence->get_stages_missing_region() );
    }

    /**
     * Detection must not trip the read-path exception it exists to avoid.
     */
    public function test_detection_does_not_throw_where_the_read_path_would(): void
    {
        $sequence = $this->sequence_with_stages(
            array( array( 'key' => 'draft', 'label' => 'Draft' ) )
        );

        // Detection is safe...
        $this->assertSame( array( 'draft' ), $sequence->get_stages_missing_region() );

        // ...while the read path still fails loud on the very same stage.
        $this->expectException( \InvalidArgumentException::class );
        $sequence->get_stage_status( 'draft' );
    }

    /**
     * An empty string is as missing as an absent key.
     */
    public function test_empty_region_counts_as_missing(): void
    {
        $sequence = $this->sequence_with_stages(
            array(
                array( 'key' => 'draft', 'label' => 'Draft', 'status' => '' ),
                array( 'key' => 'nulled', 'label' => 'Nulled', 'status' => null ),
            )
        );

        $this->assertSame( array( 'draft', 'nulled' ), $sequence->get_stages_missing_region() );
    }

    /**
     * Phase sequences carry a `phases` graph, not stages with regions.
     */
    public function test_phase_sequences_report_nothing(): void
    {
        $sequence = $this->sequence_with_stages(
            array( array( 'key' => 'ideation', 'label' => 'Ideation' ) ),
            Sequence::TYPE_PHASE
        );

        $this->assertSame( array(), $sequence->get_stages_missing_region() );
    }

    /**
     * The repair's substance: replaying a region-less config through the shared
     * write gate assigns `draft` — the least privileged region, so a stage
     * repaired into it can never publish by accident.
     */
    public function test_write_gate_assigns_draft_to_a_region_less_stage(): void
    {
        $config = array(
            'post_types' => array( 'post' ),
            'statuses'   => array(
                array( 'key' => 'draft', 'label' => 'Draft' ),
                array( 'key' => 'review', 'label' => 'Review' ),
            ),
        );

        $normalized = Sequence::prepare_config_for_write( $config );

        foreach ( $normalized['statuses'] as $stage ) {
            $this->assertSame( 'draft', $stage['status'], "Stage {$stage['key']} should default to draft." );
        }
    }

    /**
     * Repair must not overwrite a region that was already set.
     */
    public function test_write_gate_preserves_an_existing_region(): void
    {
        $config = array(
            'post_types' => array( 'post' ),
            'statuses'   => array(
                array( 'key' => 'draft', 'label' => 'Draft' ),
                array( 'key' => 'live', 'label' => 'Live', 'status' => 'publish' ),
            ),
        );

        $normalized = Sequence::prepare_config_for_write( $config );

        $by_key = array();
        foreach ( $normalized['statuses'] as $stage ) {
            $by_key[ $stage['key'] ] = $stage['status'];
        }

        $this->assertSame( 'draft', $by_key['draft'] );
        $this->assertSame( 'publish', $by_key['live'], 'An explicit region must survive the repair.' );
    }

    /**
     * A repaired sequence reports nothing missing afterwards — the loop the UI
     * relies on to clear its notice.
     */
    public function test_repaired_config_reports_nothing_missing(): void
    {
        $normalized = Sequence::prepare_config_for_write(
            array(
                'post_types' => array( 'post' ),
                'statuses'   => array( array( 'key' => 'draft', 'label' => 'Draft' ) ),
            )
        );

        $sequence = $this->sequence_with_stages( $normalized['statuses'] );

        $this->assertSame( array(), $sequence->get_stages_missing_region() );
    }

    /**
     * The second invariant, and the reason the region detector is not enough on its
     * own: every stage carries a region, so get_stages_missing_region() reports
     * nothing, while no region designates an entry checkpoint and every
     * core-driven reseat into one of them throws.
     */
    public function test_regions_with_stages_but_no_entry_are_detected(): void
    {
        $sequence = $this->sequence_with_stages(
            array(
                array( 'key' => 'draft', 'label' => 'Draft', 'status' => 'draft' ),
                array( 'key' => 'live', 'label' => 'Live', 'status' => 'publish' ),
            )
        );

        $this->assertSame( array(), $sequence->get_stages_missing_region() );
        $this->assertSame( array( 'draft', 'publish' ), $sequence->get_regions_missing_entry() );
    }

    /**
     * Detection must not trip the read-path exception it exists to avoid.
     */
    public function test_entry_detection_does_not_throw_where_the_read_path_would(): void
    {
        $sequence = $this->sequence_with_stages(
            array( array( 'key' => 'draft', 'label' => 'Draft', 'status' => 'draft' ) )
        );

        $this->assertSame( array( 'draft' ), $sequence->get_regions_missing_entry() );

        $this->expectException( \InvalidArgumentException::class );
        $sequence->get_region_entry_stage( 'draft' );
    }

    /**
     * One marked region is satisfied; the other is still reported.
     */
    public function test_only_regions_without_an_entry_are_reported(): void
    {
        $sequence = $this->sequence_with_stages(
            array(
                array( 'key' => 'draft', 'label' => 'Draft', 'status' => 'draft', 'region_entry' => true ),
                array( 'key' => 'live', 'label' => 'Live', 'status' => 'publish' ),
            )
        );

        $this->assertSame( array( 'publish' ), $sequence->get_regions_missing_entry() );
    }

    /**
     * A region-less stage belongs to the other invariant. Counting it here would
     * report a phantom region keyed on nothing.
     */
    public function test_a_region_less_stage_is_not_reported_as_a_region_without_entry(): void
    {
        $sequence = $this->sequence_with_stages(
            array( array( 'key' => 'draft', 'label' => 'Draft' ) )
        );

        $this->assertSame( array( 'draft' ), $sequence->get_stages_missing_region() );
        $this->assertSame( array(), $sequence->get_regions_missing_entry() );
    }

    /**
     * A gated config satisfies both invariants — the loop any repair relies on.
     */
    public function test_gated_config_satisfies_both_invariants(): void
    {
        $normalized = Sequence::prepare_config_for_write(
            array(
                'post_types' => array( 'post' ),
                'statuses'   => array(
                    array( 'key' => 'draft', 'label' => 'Draft' ),
                    array( 'key' => 'live', 'label' => 'Live', 'status' => 'publish' ),
                ),
            )
        );

        $sequence = $this->sequence_with_stages( $normalized['statuses'] );

        $this->assertSame( array(), $sequence->get_stages_missing_region() );
        $this->assertSame( array(), $sequence->get_regions_missing_entry() );
    }

    /**
     * Phase sequences carry a `phases` graph, not stages with regions.
     */
    public function test_phase_sequences_report_no_regions_missing_entry(): void
    {
        $sequence = $this->sequence_with_stages(
            array( array( 'key' => 'ideation', 'label' => 'Ideation', 'status' => 'draft' ) ),
            Sequence::TYPE_PHASE
        );

        $this->assertSame( array(), $sequence->get_regions_missing_entry() );
    }
}
