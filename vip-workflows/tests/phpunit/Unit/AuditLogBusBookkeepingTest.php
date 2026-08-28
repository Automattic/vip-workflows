<?php
/**
 * AuditLogController bus-bookkeeping exclusion unit tests.
 *
 * One stage change is recorded twice over in the workflow-events table:
 * StatusManager writes the canonical `status_transition` audit row, and the
 * automation EventBus stores its own `post.stage_changed` and
 * `stage.{key}.entered` emissions as bookkeeping. Every human-facing reader
 * must serve only the canonical row — these tests pin that each of them (the
 * audit log's events, type-options, and user-options queries, and the
 * recent-activity ability) carries StatusManager::bus_bookkeeping_exclusion()
 * at the SQL layer, and that the exclusion is the two narrow bookkeeping
 * families rather than the whole extensible `stage.` namespace. The
 * end-to-end proof against real MySQL lives in the integration suite
 * (Integration/AuditLogControllerTest).
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflow\API\AuditLogController;
use WP_REST_Request;

/**
 * @covers \VIPWorkflow\API\AuditLogController
 */
class AuditLogBusBookkeepingTest extends TestCase
{
    /**
     * Mock wpdb instance.
     *
     * @var object
     */
    private $wpdb;

    /**
     * Every prepare() call the controller issued: [query, values] pairs.
     *
     * @var array
     */
    private array $prepared = array();

    protected function set_up()
    {
        parent::set_up();

        $this->prepared = array();

        $this->wpdb         = Mockery::mock( 'wpdb' );
        $this->wpdb->prefix = 'wp_';
        $this->wpdb->shouldReceive( 'prepare' )->andReturnUsing(
            function ( $query, ...$args ) {
                // wpdb::prepare accepts values either variadically or as one array.
                if ( 1 === count( $args ) && is_array( $args[0] ) ) {
                    $args = $args[0];
                }
                $this->prepared[] = array( $query, $args );
                return $query;
            }
        );

        global $wpdb;
        $wpdb = $this->wpdb;

        // A full-access user, so the query is not scoped to their own activity
        // and the WHERE clause under test is the exclusion alone.
        Functions\when( 'get_current_user_id' )->justReturn( 7 );
        Functions\when( 'get_userdata' )->justReturn(
            (object) array( 'roles' => array( 'administrator' ) )
        );
        Functions\when( 'get_option' )->justReturn( array() );
    }

    /**
     * The prepared calls whose SQL contains a marker string.
     *
     * @param string $marker Substring identifying the query.
     * @return array [query, values] pairs.
     */
    private function prepared_matching( string $marker ): array
    {
        return array_values(
            array_filter(
                $this->prepared,
                static fn( array $call ) => str_contains( $call[0], $marker )
            )
        );
    }

    /**
     * Assert one prepared call excludes the bus's bookkeeping rows.
     *
     * @param array  $call    [query, values] pair.
     * @param string $column  The event-type column as the query names it.
     */
    private function assert_excludes_bookkeeping( array $call, string $column ): void
    {
        list( $query, $values ) = $call;

        $this->assertStringContainsString(
            "( {$column} <> %s AND {$column} NOT LIKE %s AND {$column} NOT LIKE %s )",
            $query
        );
        $this->assertContains( 'post.stage_changed', $values );
        $this->assertContains( 'stage.%.entered', $values );
        $this->assertContains( 'stage.%.completed', $values );
        // Deliberately NOT the whole namespace: EventRegistry::register() is
        // public, so an extension's `stage.*` event with no canonical row must
        // stay visible.
        $this->assertNotContains( 'stage.%', $values );
    }

    public function test_get_events_excludes_bus_bookkeeping_in_count_and_select(): void
    {
        $this->wpdb->shouldReceive( 'get_var' )->once()->andReturn( 0 );
        $this->wpdb->shouldReceive( 'get_results' )->once()->andReturn( array() );

        $request = new WP_REST_Request( 'GET', '/vip-workflow/v1/audit-log' );
        foreach ( array( 'page' => 1, 'per_page' => 25, 'orderby' => 'created_at', 'order' => 'desc' ) as $key => $value ) {
            $request->set_param( $key, $value );
        }

        $data = ( new AuditLogController() )->get_events( $request )->get_data();

        $this->assertSame( 0, $data['total'] );
        $this->assertSame( array(), $data['events'] );

        $count_calls = $this->prepared_matching( 'SELECT COUNT(*)' );
        $this->assertCount( 1, $count_calls, 'The count query must be prepared with the exclusion values.' );
        $this->assert_excludes_bookkeeping( $count_calls[0], 'e.event_type' );

        $select_calls = $this->prepared_matching( 'SELECT e.*' );
        $this->assertCount( 1, $select_calls, 'The select query must be prepared with the exclusion values.' );
        $this->assert_excludes_bookkeeping( $select_calls[0], 'e.event_type' );
    }

    public function test_get_event_types_offers_no_bus_bookkeeping_options(): void
    {
        $this->wpdb->shouldReceive( 'get_col' )->once()->andReturn( array( 'status_transition' ) );

        $data = ( new AuditLogController() )->get_event_types()->get_data();

        // The one distinct type the (already filtered) query returned, labeled.
        $this->assertSame( array( 'status_transition' ), array_column( $data, 'value' ) );

        $distinct_calls = $this->prepared_matching( 'SELECT DISTINCT event_type' );
        $this->assertCount( 1, $distinct_calls, 'The type-options query must be prepared with the exclusion values.' );
        $this->assert_excludes_bookkeeping( $distinct_calls[0], 'event_type' );
    }

    public function test_get_users_offers_no_actors_on_the_strength_of_bookkeeping(): void
    {
        $this->wpdb->shouldReceive( 'get_col' )->once()->andReturn( array() );

        $data = ( new AuditLogController() )->get_users()->get_data();

        $this->assertSame( array(), $data );

        $actor_calls = $this->prepared_matching( 'SELECT DISTINCT actor_id' );
        $this->assertCount( 1, $actor_calls, 'The user-options query must be prepared with the exclusion values.' );
        $this->assert_excludes_bookkeeping( $actor_calls[0], 'event_type' );
    }

    public function test_recent_activity_ability_excludes_bus_bookkeeping(): void
    {
        require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/get-recent-activity.php';

        $this->wpdb->shouldReceive( 'get_results' )->once()->andReturn( array() );

        $result = \VIPWorkflow\Abilities\Tools\execute_get_recent_activity(
            array(
                'days'  => 7,
                'limit' => 20,
            )
        );

        $this->assertSame( 0, $result['count'] );
        $this->assertSame( array(), $result['events'] );

        $activity_calls = $this->prepared_matching( 'ORDER BY created_at DESC LIMIT' );
        $this->assertCount( 1, $activity_calls, 'The recent-activity query must be prepared with the exclusion values.' );
        $this->assert_excludes_bookkeeping( $activity_calls[0], 'event_type' );
    }
}
