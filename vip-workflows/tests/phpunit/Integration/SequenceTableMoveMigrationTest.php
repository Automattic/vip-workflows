<?php
/**
 * Integration coverage for the 2.23.0 storage rename.
 *
 * The migration moves rows from wp_vip_blueprints into wp_vip_sequences, drops
 * the old table, and stays safe when the retired vip_automation_flows is absent.
 * Both are irreversible, and neither had a test — the review that found the
 * unconditional DROP found no coverage of it either.
 *
 * These drive the migration callable directly against real tables, because the
 * behaviour under test is what the database holds afterwards. A mocked $wpdb
 * would assert only that we call it the way we think we do, which is exactly the
 * assumption that was wrong.
 *
 * @package VIPWorkflow\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Integration;

use VIPWorkflow\Database\Schema;

/**
 * Real-WordPress tests for the table and column move.
 */
class SequenceTableMoveMigrationTest extends TestCase
{
	private string $old_table;
	private string $new_table;
	private string $flows;
	private string $events;

	public function set_up(): void
	{
		parent::set_up();

		global $wpdb;
		$this->old_table = $wpdb->prefix . 'vip_blueprints';
		$this->new_table = $wpdb->prefix . 'vip_sequences';
		$this->flows     = $wpdb->prefix . 'vip_automation_flows';
		$this->events    = $wpdb->prefix . 'vip_workflow_events';

		// Start from the pre-migration shape: an old table beside an empty new one.
		$wpdb->query( "DROP TABLE IF EXISTS `{$this->old_table}`" );
		$wpdb->query(
			"CREATE TABLE `{$this->old_table}` LIKE `{$this->new_table}`"
		);
		$wpdb->query( "DELETE FROM `{$this->new_table}`" );
	}

	public function tear_down(): void
	{
		global $wpdb;
		$wpdb->query( "DROP TABLE IF EXISTS `{$this->old_table}`" );
		parent::tear_down();
	}

	/**
	 * Run only the 2.23.0 entry, isolated from version bookkeeping.
	 */
	private function run_move(): void
	{
		$method     = new \ReflectionMethod( Schema::class, 'get_migrations' );
		$migrations = $method->invoke( new Schema() );

		foreach ( $migrations as $migration ) {
			if ( '2.23.0' === $migration['version'] ) {
				( $migration['run'] )();
				return;
			}
		}

		$this->fail( 'No 2.23.0 migration entry found.' );
	}

	/**
	 * Insert a row into the old table.
	 *
	 * @param string $slug Sequence slug.
	 */
	private function seed_old_row( string $slug ): void
	{
		global $wpdb;
		$wpdb->insert(
			$this->old_table,
			array(
				'uuid'       => wp_generate_uuid4(),
				'type'       => 'workflow',
				'name'       => 'Moved ' . $slug,
				'slug'       => $slug,
				'version'    => 1,
				'status'     => 'active',
				'config'     => wp_json_encode( array( 'version' => '2.0', 'statuses' => array() ) ),
				'created_by' => 1,
				'created_at' => current_time( 'mysql' ),
				'updated_at' => current_time( 'mysql' ),
			)
		);
	}

	/**
	 * The rows arrive, and only then does the old table go.
	 */
	public function test_rows_move_and_the_old_table_is_dropped(): void
	{
		global $wpdb;
		$this->seed_old_row( 'first' );
		$this->seed_old_row( 'second' );

		$this->run_move();

		$this->assertSame(
			'2',
			$wpdb->get_var( "SELECT COUNT(*) FROM `{$this->new_table}`" ),
			'both rows should have landed in the new table'
		);
		$this->assertSame(
			array( 'first', 'second' ),
			$wpdb->get_col( "SELECT slug FROM `{$this->new_table}` ORDER BY slug" )
		);
		$this->assertNull(
			$wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $this->old_table ) ),
			'the old table should be gone once its rows are safely across'
		);
	}

	/**
	 * Rows on both sides stops the migration with both tables intact.
	 *
	 * This is the state an interrupted upgrade leaves — create_tables() runs
	 * before the migrations and the version is written after — and it is the one
	 * where dropping the old table destroys rows nothing has copied.
	 */
	public function test_rows_on_both_sides_refuses_and_keeps_both_tables(): void
	{
		global $wpdb;
		$this->seed_old_row( 'still-here' );

		// Something wrote to the new table before the move completed.
		$wpdb->insert(
			$this->new_table,
			array(
				'uuid'       => wp_generate_uuid4(),
				'type'       => 'workflow',
				'name'       => 'Written early',
				'slug'       => 'written-early',
				'version'    => 1,
				'status'     => 'active',
				'config'     => wp_json_encode( array( 'version' => '2.0', 'statuses' => array() ) ),
				'created_by' => 1,
				'created_at' => current_time( 'mysql' ),
				'updated_at' => current_time( 'mysql' ),
			)
		);

		$threw = false;
		try {
			$this->run_move();
		} catch ( \RuntimeException $e ) {
			$threw = true;
			$this->assertStringContainsString( 'already holds', $e->getMessage() );
		}

		$this->assertTrue( $threw, 'the migration must refuse rather than choose a copy to destroy' );
		$this->assertSame(
			$this->old_table,
			$wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $this->old_table ) ),
			'the old table must survive a refusal'
		);
		$this->assertSame(
			'1',
			$wpdb->get_var( "SELECT COUNT(*) FROM `{$this->old_table}`" ),
			'and keep its row'
		);
	}

	/**
	 * The move runs clean when the automation-flows table is not there.
	 *
	 * 2.24.0 removed the automation-flow engine and its tables, but a fresh
	 * install replays every migration from 0.0.0 — this one included. It names
	 * vip_automation_flows to carry blueprint_id onto sequence_id, and a
	 * statement against a missing table sets $wpdb->last_error, which
	 * run_migrations() turns into a thrown RuntimeException. So the table's
	 * absence has to be asked about, not discovered by failing.
	 */
	public function test_the_move_survives_a_missing_automation_flows_table(): void
	{
		global $wpdb;

		$wpdb->query( "DROP TABLE IF EXISTS `{$this->flows}`" );
		$this->seed_old_row( 'editorial' );

		$wpdb->last_error = '';
		$this->run_move();

		$this->assertSame(
			'',
			$wpdb->last_error,
			'the move touched the dropped flows table, which fails the install'
		);
		$this->assertSame(
			'1',
			$wpdb->get_var( "SELECT COUNT(*) FROM `{$this->new_table}`" ),
			'the sequence rows still moved'
		);
	}

	/**
	 * Configuration audit history keeps working after the terminology rename.
	 *
	 * Event consumers now look for sequence.* types and sequence_* payload keys.
	 * Leaving historical rows on the old vocabulary makes those rows disappear
	 * from typed filters and gives consumers an incompatible payload shape.
	 */
	public function test_configuration_event_history_moves_to_sequence_terms(): void
	{
		global $wpdb;

		$event_types = array(
			'blueprint.updated'     => 'sequence.updated',
			'blueprint.activated'   => 'sequence.activated',
			'blueprint.deactivated' => 'sequence.deactivated',
		);

		$ids = array();
		foreach ( $event_types as $old_type => $new_type ) {
			$wpdb->insert(
				$this->events,
				array(
					'post_id'    => null,
					'event_type' => $old_type,
					'event_data' => wp_json_encode(
						array(
							'blueprint_id'   => 42,
							'blueprint_name' => 'Editorial',
							'blueprint_slug' => 'editorial',
							'blueprint_type' => 'workflow',
							'blueprint'      => 'Editorial',
							'source'         => 'blueprint',
							'kept'           => 'unchanged',
						)
					),
					'actor_id'   => 1,
					'actor_type' => 'user',
					'created_at' => current_time( 'mysql' ),
				)
			);
			$ids[ $new_type ] = (int) $wpdb->insert_id;
		}

		$this->run_move();

		foreach ( $ids as $expected_type => $id ) {
			$row  = $wpdb->get_row( $wpdb->prepare( "SELECT event_type, event_data FROM `{$this->events}` WHERE id = %d", $id ) );
			$data = json_decode( (string) $row->event_data, true );

			$this->assertSame( $expected_type, $row->event_type );
			$this->assertSame( 42, $data['sequence_id'] );
			$this->assertSame( 'Editorial', $data['sequence_name'] );
			$this->assertSame( 'editorial', $data['sequence_slug'] );
			$this->assertSame( 'workflow', $data['sequence_type'] );
			$this->assertSame( 'Editorial', $data['sequence'] );
			$this->assertSame( 'sequence', $data['source'] );
			$this->assertSame( 'unchanged', $data['kept'] );
			$this->assertArrayNotHasKey( 'blueprint', $data );
			$this->assertArrayNotHasKey( 'blueprint_id', $data );
			$this->assertArrayNotHasKey( 'blueprint_name', $data );
			$this->assertArrayNotHasKey( 'blueprint_slug', $data );
			$this->assertArrayNotHasKey( 'blueprint_type', $data );
		}
	}
}
