<?php
/**
 * EventRegistry unit tests.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use VIPWorkflows\Automation\EventRegistry;

/**
 * Smoke tests for EventRegistry.
 */
class EventRegistryTest extends TestCase
{
    private EventRegistry $registry;

    protected function setUp(): void
    {
        parent::setUp();
        $this->registry = new EventRegistry();
    }

    public function test_constructor_registers_core_events(): void
    {
        $all = $this->registry->get_all();
        $this->assertNotEmpty( $all );

        // Name the events rather than count them: a bare count passes for any
        // ten entries and has to be edited every time one is added or retired,
        // which says nothing about whether the core vocabulary is registered.
        $this->assertArrayHasKey( 'post.stage_changed', $all );
        $this->assertArrayHasKey( 'post.workflow_assigned', $all );
        $this->assertArrayHasKey( 'post.workflow_completed', $all );
        $this->assertArrayHasKey( 'post.published', $all );
        $this->assertArrayHasKey( 'stage.*.entered', $all );
    }

    public function test_is_valid_with_exact_match(): void
    {
        $this->assertTrue( $this->registry->is_valid( 'post.stage_changed' ) );
        $this->assertTrue( $this->registry->is_valid( 'post.published' ) );
    }

    public function test_is_valid_with_pattern_match(): void
    {
        // stage.*.entered matches stage.draft.entered
        $this->assertTrue( $this->registry->is_valid( 'stage.draft.entered' ) );
        $this->assertTrue( $this->registry->is_valid( 'stage.review.entered' ) );
        $this->assertTrue( $this->registry->is_valid( 'stage.published.completed' ) );
    }

    public function test_is_valid_rejects_unknown_event(): void
    {
        $this->assertFalse( $this->registry->is_valid( 'not.a.real.event' ) );
        $this->assertFalse( $this->registry->is_valid( '' ) );
    }

    public function test_is_valid_pattern_does_not_match_too_many_segments(): void
    {
        // stage.*.entered has exactly 3 segments; extra segment should not match.
        $this->assertFalse( $this->registry->is_valid( 'stage.draft.entered.extra' ) );
    }

    public function test_register_adds_custom_event(): void
    {
        $this->registry->register( 'custom.test_event', [ 'label' => 'Custom', 'category' => 'custom' ] );
        $this->assertTrue( $this->registry->is_valid( 'custom.test_event' ) );
    }

    public function test_get_by_category_filters_correctly(): void
    {
        $workflow_events = $this->registry->get_by_category( 'workflow' );
        $this->assertNotEmpty( $workflow_events );
        foreach ( $workflow_events as $metadata ) {
            $this->assertSame( 'workflow', $metadata['category'] );
        }
    }

    public function test_get_by_category_returns_empty_for_unknown_category(): void
    {
        $result = $this->registry->get_by_category( 'nonexistent' );
        $this->assertEmpty( $result );
    }

    public function test_get_metadata_returns_correct_data(): void
    {
        $meta = $this->registry->get_metadata( 'post.stage_changed' );
        $this->assertIsArray( $meta );
        $this->assertArrayHasKey( 'label', $meta );
        $this->assertArrayHasKey( 'category', $meta );
        $this->assertSame( 'workflow', $meta['category'] );
    }

    public function test_get_metadata_returns_null_for_unknown(): void
    {
        $this->assertNull( $this->registry->get_metadata( 'no.such.event' ) );
    }

    public function test_register_defaults_pattern_to_false(): void
    {
        $this->registry->register( 'simple.event', [] );
        $meta = $this->registry->get_metadata( 'simple.event' );
        $this->assertFalse( $meta['pattern'] );
    }
}
