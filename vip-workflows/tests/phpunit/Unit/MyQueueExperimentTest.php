<?php
/**
 * Tests for the MyQueueExperiment declaration and its ExperimentRegistry gating.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflows\Experiments\ExperimentRegistry;
use VIPWorkflows\Experiments\MyQueueExperiment;

/**
 * Tests for MyQueueExperiment.
 */
class MyQueueExperimentTest extends TestCase
{
    private MyQueueExperiment $experiment;

    protected function setUp(): void
    {
        parent::setUp();
        $this->experiment = new MyQueueExperiment();
    }

    public function test_get_id_returns_my_queue(): void
    {
        $this->assertSame( 'my_queue', $this->experiment->get_id() );
    }

    public function test_get_modules_returns_empty_array(): void
    {
        // My Queue owns no dedicated modules — it is a tab/endpoint gated
        // directly at the MyDashboardPage/WorkflowController call sites.
        $this->assertSame( array(), $this->experiment->get_modules() );
    }

    public function test_disabled_by_default(): void
    {
        Functions\when( 'get_option' )->justReturn( array() );

        $registry = new ExperimentRegistry();
        $registry->register( $this->experiment );

        $this->assertFalse( $registry->is_enabled( 'my_queue' ) );
    }

    public function test_enabled_when_option_contains_id(): void
    {
        Functions\when( 'get_option' )->justReturn( array( 'my_queue' ) );

        $registry = new ExperimentRegistry();
        $registry->register( $this->experiment );

        $this->assertTrue( $registry->is_enabled( 'my_queue' ) );
    }
}
