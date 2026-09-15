<?php
/**
 * Tests for the KanbanExperiment declaration and its ExperimentRegistry gating.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflows\Experiments\ExperimentRegistry;
use VIPWorkflows\Experiments\KanbanExperiment;

/**
 * Tests for KanbanExperiment.
 */
class KanbanExperimentTest extends TestCase
{
    private KanbanExperiment $experiment;

    protected function setUp(): void
    {
        parent::setUp();
        $this->experiment = new KanbanExperiment();
    }

    public function test_get_id_returns_kanban(): void
    {
        $this->assertSame( 'kanban', $this->experiment->get_id() );
    }

    public function test_get_modules_returns_empty_array(): void
    {
        // The Kanban board owns no dedicated modules — it is a page/endpoint
        // gated directly at the Admin/WorkflowController call sites.
        $this->assertSame( array(), $this->experiment->get_modules() );
    }

    public function test_disabled_by_default(): void
    {
        Functions\when( 'get_option' )->justReturn( array() );

        $registry = new ExperimentRegistry();
        $registry->register( $this->experiment );

        $this->assertFalse( $registry->is_enabled( 'kanban' ) );
    }

    public function test_enabled_when_option_contains_id(): void
    {
        Functions\when( 'get_option' )->justReturn( array( 'kanban' ) );

        $registry = new ExperimentRegistry();
        $registry->register( $this->experiment );

        $this->assertTrue( $registry->is_enabled( 'kanban' ) );
    }
}
