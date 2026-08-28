<?php
/**
 * Unit tests for the stage-label snapshot rule.
 *
 * StatusManager::snapshot_stage_label() is the single producer of every stage
 * label written into the workflow audit trail. Its contract is the whole fix:
 * return the label the sequence proves, and null when it proves none — never a
 * value derived from the stage key. A derived value ("Status_3") is written once
 * and then renders as the stage's name forever, which is the bug.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use ReflectionMethod;
use VIPWorkflow\Sequences\Sequence;
use VIPWorkflow\Workflow\StatusManager;

/**
 * Tests for StatusManager::snapshot_stage_label().
 */
class StageLabelSnapshotTest extends TestCase
{
    /**
     * Invoke the private snapshot helper.
     *
     * @param  Sequence|null $sequence Sequence, or null when unresolvable.
     * @param  string         $stage_key Stage key.
     * @return string|null
     */
    private function snapshot( ?Sequence $sequence, string $stage_key ): ?string
    {
        // No setAccessible() call: private methods are reflectively invokable
        // since PHP 8.1, and the setter is deprecated in 8.5.
        $method = new ReflectionMethod( StatusManager::class, 'snapshot_stage_label' );

        return $method->invoke( null, $sequence, $stage_key );
    }

    /**
     * Sequence with one generated-key stage whose label shares no text with it.
     *
     * @return Sequence
     */
    private function sequence(): Sequence
    {
        return Sequence::from_row(
            (object) array(
                'id'          => 1,
                'uuid'        => 'snapshot-fixture-uuid',
                'type'        => Sequence::TYPE_WORKFLOW,
                'name'        => 'Snapshot Fixture',
                'slug'        => 'snapshot-fixture',
                'description' => '',
                'version'     => 1,
                'status'      => 'active',
                'config'      => (string) wp_json_encode(
                    array(
                        'statuses' => array(
                            array(
                                'key'    => 'status_3',
                                'label'  => 'Legal Hold',
                                'status' => 'draft',
                            ),
                        ),
                    )
                ),
                'created_by'  => 1,
                'created_at'  => '2026-01-01 00:00:00',
                'updated_at'  => '2026-01-01 00:00:00',
            )
        );
    }

    /**
     * A stage the sequence defines snapshots its author-written label.
     */
    public function test_defined_stage_snapshots_its_label(): void
    {
        $this->assertSame( 'Legal Hold', $this->snapshot( $this->sequence(), 'status_3' ) );
    }

    /**
     * A stage the sequence no longer defines snapshots null — NOT a value
     * derived from the key, which would persist "Status_9" into history forever.
     */
    public function test_undefined_stage_snapshots_null_rather_than_the_key(): void
    {
        $label = $this->snapshot( $this->sequence(), 'status_9' );

        $this->assertNull( $label );
        $this->assertNotSame( 'Status_9', $label );
    }

    /**
     * No sequence at all snapshots null, not a value derived from the key.
     */
    public function test_missing_sequence_snapshots_null(): void
    {
        $this->assertNull( $this->snapshot( null, 'status_3' ) );
    }

    /**
     * An empty stage key names no stage, so there is nothing to snapshot.
     */
    public function test_empty_stage_key_snapshots_null(): void
    {
        $this->assertNull( $this->snapshot( $this->sequence(), '' ) );
    }
}
