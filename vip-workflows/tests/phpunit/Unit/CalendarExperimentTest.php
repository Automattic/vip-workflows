<?php
/**
 * Tests for the CalendarExperiment declaration and its ExperimentRegistry gating.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflows\Experiments\CalendarExperiment;
use VIPWorkflows\Experiments\ExperimentRegistry;

/**
 * Tests for CalendarExperiment.
 */
class CalendarExperimentTest extends TestCase
{
    private CalendarExperiment $experiment;

    protected function setUp(): void
    {
        parent::setUp();
        $this->experiment = new CalendarExperiment();
    }

    public function test_get_id_returns_calendar(): void
    {
        $this->assertSame( 'calendar', $this->experiment->get_id() );
    }

    public function test_get_modules_returns_empty_array(): void
    {
        // The Calendar view owns no dedicated modules — it is a page/endpoint
        // gated directly at the Admin/WorkflowController call sites.
        $this->assertSame( array(), $this->experiment->get_modules() );
    }

    public function test_disabled_by_default(): void
    {
        Functions\when( 'get_option' )->justReturn( array() );

        $registry = new ExperimentRegistry();
        $registry->register( $this->experiment );

        $this->assertFalse( $registry->is_enabled( 'calendar' ) );
    }

    public function test_enabled_when_option_contains_id(): void
    {
        Functions\when( 'get_option' )->justReturn( array( 'calendar' ) );

        $registry = new ExperimentRegistry();
        $registry->register( $this->experiment );

        $this->assertTrue( $registry->is_enabled( 'calendar' ) );
    }
}
