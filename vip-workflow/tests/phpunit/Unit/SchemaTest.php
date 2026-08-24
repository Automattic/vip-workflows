<?php
/**
 * Schema migration runner unit tests.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflow\Database\Schema;

class SchemaTest extends TestCase
{
    /**
     * Invoke the private run_migrations method via reflection.
     *
     * @param Schema $schema
     * @param string $from_version
     */
    private function run_migrations( Schema $schema, string $from_version ): void
    {
        $method = new \ReflectionMethod( Schema::class, 'run_migrations' );
        $method->invoke( $schema, $from_version );
    }

    /**
     * Override the private get_migrations return value via a reflection-based subclass.
     *
     * @param array $migrations
     * @return Schema
     */
    private function schema_with_migrations( array $migrations ): Schema
    {
        return new class( $migrations ) extends Schema {
            public function __construct( private array $test_migrations ) {}

            protected function get_migrations(): array
            {
                return $this->test_migrations;
            }
        };
    }

    // -------------------------------------------------------------------------
    // run_migrations — happy path
    // -------------------------------------------------------------------------

    public function test_current_install_runs_no_migrations(): void
    {
        global $wpdb;
        $wpdb             = new \stdClass();
        $wpdb->last_error = '';

        // An install already at the current version skips every registered migration,
        // so run_migrations() must complete without touching $wpdb.
        $schema = new Schema();
        $this->run_migrations( $schema, Schema::VERSION );

        $this->expectNotToPerformAssertions();
    }

    public function test_migration_runs_when_from_version_is_older(): void
    {
        global $wpdb;
        $wpdb             = new \stdClass();
        $wpdb->last_error = '';

        $ran   = false;
        $schema = $this->schema_with_migrations(
            [
                [
                    'version' => '2.15.0',
                    'run'     => function () use ( &$ran ): void {
                        $ran = true;
                    },
                ],
            ]
        );

        $this->run_migrations( $schema, '2.14.0' );

        $this->assertTrue( $ran, 'Migration at 2.15.0 must run when upgrading from 2.14.0.' );
    }

    public function test_migration_skipped_when_from_version_is_same(): void
    {
        global $wpdb;
        $wpdb             = new \stdClass();
        $wpdb->last_error = '';

        $ran   = false;
        $schema = $this->schema_with_migrations(
            [
                [
                    'version' => '2.15.0',
                    'run'     => function () use ( &$ran ): void {
                        $ran = true;
                    },
                ],
            ]
        );

        $this->run_migrations( $schema, '2.15.0' );

        $this->assertFalse( $ran, 'Migration at 2.15.0 must not run when already at 2.15.0.' );
    }

    public function test_migration_skipped_when_from_version_is_newer(): void
    {
        global $wpdb;
        $wpdb             = new \stdClass();
        $wpdb->last_error = '';

        $ran   = false;
        $schema = $this->schema_with_migrations(
            [
                [
                    'version' => '2.15.0',
                    'run'     => function () use ( &$ran ): void {
                        $ran = true;
                    },
                ],
            ]
        );

        $this->run_migrations( $schema, '2.16.0' );

        $this->assertFalse( $ran, 'Migration at 2.15.0 must not run when installed version is 2.16.0.' );
    }

    public function test_only_pending_migrations_run_in_order(): void
    {
        global $wpdb;
        $wpdb             = new \stdClass();
        $wpdb->last_error = '';

        $log   = [];
        $schema = $this->schema_with_migrations(
            [
                [
                    'version' => '2.13.0',
                    'run'     => function () use ( &$log ): void {
                        $log[] = '2.13.0';
                    },
                ],
                [
                    'version' => '2.15.0',
                    'run'     => function () use ( &$log ): void {
                        $log[] = '2.15.0';
                    },
                ],
                [
                    'version' => '2.16.0',
                    'run'     => function () use ( &$log ): void {
                        $log[] = '2.16.0';
                    },
                ],
            ]
        );

        $this->run_migrations( $schema, '2.14.0' );

        $this->assertSame(
            [ '2.15.0', '2.16.0' ],
            $log,
            'Only migrations newer than from_version must run, in order.'
        );
    }

    // -------------------------------------------------------------------------
    // run_migrations — failure path
    // -------------------------------------------------------------------------

    public function test_throws_on_db_error(): void
    {
        global $wpdb;
        $wpdb             = new \stdClass();
        $wpdb->last_error = '';

        $schema = $this->schema_with_migrations(
            [
                [
                    'version' => '2.15.0',
                    'run'     => function (): void {
                        global $wpdb;
                        $wpdb->last_error = 'Unknown column foo';
                    },
                ],
            ]
        );

        $this->expectException( \RuntimeException::class );
        $this->expectExceptionMessageMatches( '/2\.15\.0/' );

        $this->run_migrations( $schema, '2.14.0' );
    }

    public function test_stale_last_error_from_prior_query_does_not_trigger(): void
    {
        global $wpdb;
        $wpdb             = new \stdClass();
        // Simulate a stale last_error left by a prior query (e.g. from create_tables/dbDelta).
        $wpdb->last_error = 'Some prior warning';

        $ran    = false;
        $schema = $this->schema_with_migrations(
            [
                [
                    'version' => '2.15.0',
                    'run'     => function () use ( &$ran ): void {
                        $ran = true;
                        // Callable issues no $wpdb query — last_error should be cleared before it runs.
                    },
                ],
            ]
        );

        // Must not throw despite stale last_error — the runner clears it before each callable.
        $this->run_migrations( $schema, '2.14.0' );

        $this->assertTrue( $ran, 'Migration must run even when last_error was set before run_migrations().' );
    }

    public function test_throws_on_callable_exception(): void
    {
        global $wpdb;
        $wpdb             = new \stdClass();
        $wpdb->last_error = '';

        $schema = $this->schema_with_migrations(
            [
                [
                    'version' => '2.15.0',
                    'run'     => function (): void {
                        throw new \LogicException( 'Callable failed hard' );
                    },
                ],
            ]
        );

        $this->expectException( \RuntimeException::class );
        $this->expectExceptionMessageMatches( '/2\.15\.0/' );

        $this->run_migrations( $schema, '2.14.0' );
    }

    public function test_throws_on_malformed_migration_missing_version(): void
    {
        global $wpdb;
        $wpdb             = new \stdClass();
        $wpdb->last_error = '';

        $schema = $this->schema_with_migrations(
            [
                [ 'run' => function (): void {} ],
            ]
        );

        $this->expectException( \InvalidArgumentException::class );

        $this->run_migrations( $schema, '0.0.0' );
    }

    public function test_throws_on_malformed_migration_non_callable_run(): void
    {
        global $wpdb;
        $wpdb             = new \stdClass();
        $wpdb->last_error = '';

        $schema = $this->schema_with_migrations(
            [
                [ 'version' => '2.15.0', 'run' => 'not-a-callable' ],
            ]
        );

        $this->expectException( \InvalidArgumentException::class );

        $this->run_migrations( $schema, '0.0.0' );
    }

    public function test_stops_after_first_failed_migration(): void
    {
        global $wpdb;
        $wpdb             = new \stdClass();
        $wpdb->last_error = '';

        $second_ran = false;
        $schema      = $this->schema_with_migrations(
            [
                [
                    'version' => '2.15.0',
                    'run'     => function (): void {
                        global $wpdb;
                        $wpdb->last_error = 'Query failed';
                    },
                ],
                [
                    'version' => '2.16.0',
                    'run'     => function () use ( &$second_ran ): void {
                        $second_ran = true;
                    },
                ],
            ]
        );

        try {
            $this->run_migrations( $schema, '2.14.0' );
        } catch ( \RuntimeException $e ) {
            // Expected.
        }

        $this->assertFalse( $second_ran, 'Subsequent migrations must not run after a failure.' );
    }

    // -------------------------------------------------------------------------
    // Registered migrations vs Schema::VERSION
    // -------------------------------------------------------------------------

    /**
     * The real registered migrations, in the order get_migrations() returns them.
     *
     * Only their metadata is read — no callable is invoked — so this needs no
     * database and belongs in the unit suite.
     *
     * @return array<int, array{version: string, run: callable}>
     */
    private function registered_migrations(): array
    {
        $method = new \ReflectionMethod( Schema::class, 'get_migrations' );

        return $method->invoke( new Schema() );
    }

    /**
     * A migration nobody can reach is not a migration.
     *
     * install() returns before run_migrations() when the stored DB version is
     * already at or past Schema::VERSION, so an entry registered above VERSION runs
     * on no install at all. This is the bookkeeping half of the documented procedure
     * ("1. Bump Schema::VERSION. 2. Append an entry."), and the half that fails
     * silently when it is skipped.
     */
    public function test_schema_version_covers_every_registered_migration(): void
    {
        foreach ( $this->registered_migrations() as $migration ) {
            $this->assertTrue(
                version_compare( Schema::VERSION, $migration['version'], '>=' ),
                sprintf(
                    'Migration %s is newer than Schema::VERSION (%s), so install() returns before it ever runs.',
                    $migration['version'],
                    Schema::VERSION
                )
            );
        }
    }

    /**
     * Entries must ascend, because run_migrations() stops at the first failure and
     * an out-of-order entry would be skipped by the version compare on the way past.
     */
    public function test_registered_migrations_are_in_ascending_version_order(): void
    {
        $versions = array_column( $this->registered_migrations(), 'version' );
        $sorted   = $versions;

        usort( $sorted, 'version_compare' );

        $this->assertSame( $sorted, $versions, 'get_migrations() must list entries in ascending version order.' );
        $this->assertSame( array_unique( $versions ), $versions, 'Two entries must not share a version.' );
    }

    /**
     * The storage rename must follow the transition-input migration.
     *
     * Existing 2.22 installs have already recorded that version while their
     * sequence rows still live in the old table. Reusing 2.22 for the rename
     * would make install() return before it reaches the storage move.
     */
    public function test_sequence_storage_migration_follows_the_transition_input_migration(): void
    {
        $versions = array_column( $this->registered_migrations(), 'version' );

        $this->assertContains( '2.22.0', $versions );
        $this->assertSame( '2.23.0', end( $versions ) );
    }

    /**
     * The storage rename also carries configuration-event history onto the new
     * event types and payload keys consumed after the rename.
     */
    public function test_sequence_storage_migration_rewrites_configuration_event_history(): void
    {
        global $wpdb;

        $wpdb = new class() {
            public string $prefix = 'wp_';
            public string $postmeta = 'wp_postmeta';
            public string $last_error = '';
            public array $updates = array();

            public function prepare( string $query, ...$args ): string
            {
                foreach ( $args as $arg ) {
                    $replacement = is_int( $arg ) ? (string) $arg : "'" . (string) $arg . "'";
                    $query       = preg_replace( '/%[sd]/', $replacement, $query, 1 );
                }
                return $query;
            }

            public function get_var( string $query )
            {
                return null;
            }

            public function query( string $query ): int
            {
                return 0;
            }

            public function get_results( string $query ): array
            {
                if ( str_contains( $query, 'vip_workflow_events' ) ) {
                    return array(
                        (object) array(
                            'id'         => 19,
                            'event_data' => '{"blueprint_id":42,"blueprint_name":"Editorial","blueprint_slug":"editorial","blueprint_type":"workflow","blueprint":"Editorial","source":"blueprint","kept":"unchanged"}',
                        ),
                    );
                }

                return array();
            }

            public function update( string $table, array $data, array $where ): int
            {
                $this->updates[] = compact( 'table', 'data', 'where' );
                return 1;
            }
        };

        $migration = current(
            array_filter(
                $this->registered_migrations(),
                static fn( array $candidate ): bool => '2.23.0' === $candidate['version']
            )
        );
        ( $migration['run'] )();

        $event_updates = array_values(
            array_filter(
                $wpdb->updates,
                static fn( array $update ): bool => 'wp_vip_workflow_events' === $update['table']
            )
        );

        $this->assertSame(
            array(
                array( 'event_type' => 'sequence.updated' ),
                array( 'event_type' => 'sequence.activated' ),
                array( 'event_type' => 'sequence.deactivated' ),
            ),
            array_column( array_slice( $event_updates, 0, 3 ), 'data' )
        );

        $payload_update = $event_updates[3];
        $this->assertSame( array( 'id' => 19 ), $payload_update['where'] );

        $expected_payload = array(
            'sequence_id'   => 42,
            'sequence_name' => 'Editorial',
            'sequence_slug' => 'editorial',
            'sequence_type' => 'workflow',
            'sequence'      => 'Editorial',
            'source'        => 'sequence',
            'kept'          => 'unchanged',
        );
        $actual_payload   = json_decode( $payload_update['data']['event_data'], true );
        ksort( $expected_payload );
        ksort( $actual_payload );

        $this->assertSame( $expected_payload, $actual_payload );
    }

    // -------------------------------------------------------------------------
    // drop_core_status_transition_targets
    // -------------------------------------------------------------------------

    /**
     * Invoke the private static helper via reflection.
     *
     * @param  array $config Sequence config.
     * @return array
     */
    private function drop_core_targets( array $config ): array
    {
        $method = new \ReflectionMethod( Schema::class, 'drop_core_status_transition_targets' );

        return $method->invoke( null, $config, 7, 'test-slug' );
    }

    /**
     * `future` was a stage when stage WAS post_status; under the matrix it is a
     * core overlay, so the remnant transition is removed.
     */
    public function test_drops_an_overlay_status_target(): void
    {
        $config = $this->drop_core_targets(
            [
                'statuses' => [
                    [
                        'key'         => 'ready',
                        'transitions' => [ [ 'to' => 'publish' ], [ 'to' => 'future' ] ],
                    ],
                    [ 'key' => 'publish' ],
                ],
            ]
        );

        $this->assertSame( [ 'publish' ], array_column( $config['statuses'][0]['transitions'], 'to' ) );
    }

    /**
     * A core status that IS also a defined stage key in this same config is a real
     * destination and must survive — the check is "undefined AND core", not "core".
     */
    public function test_keeps_a_core_status_name_that_is_a_defined_stage(): void
    {
        $config = $this->drop_core_targets(
            [
                'statuses' => [
                    [ 'key' => 'a', 'transitions' => [ [ 'to' => 'draft' ] ] ],
                    [ 'key' => 'draft' ],
                ],
            ]
        );

        $this->assertSame( [ 'draft' ], array_column( $config['statuses'][0]['transitions'], 'to' ) );
    }

    /**
     * A dangling target that is not a core status is a typo or a deleted stage —
     * possibly a destination the author still wants — so it is left for the write
     * gate to reject and a human to resolve.
     */
    public function test_keeps_a_non_core_dangling_target(): void
    {
        $config = $this->drop_core_targets(
            [
                'statuses' => [ [ 'key' => 'a', 'transitions' => [ [ 'to' => 'revieww' ] ] ] ],
            ]
        );

        $this->assertSame( [ 'revieww' ], array_column( $config['statuses'][0]['transitions'], 'to' ) );
    }

    /**
     * A malformed transition entry is preserved so the write gate rejects it
     * loudly, rather than being silently swallowed here.
     */
    public function test_keeps_a_malformed_transition_entry(): void
    {
        $config = $this->drop_core_targets(
            [
                'statuses' => [ [ 'key' => 'a', 'transitions' => [ 'future', [ 'label' => 'no target' ] ] ] ],
            ]
        );

        $this->assertCount( 2, $config['statuses'][0]['transitions'] );
    }

    /**
     * A phase sequence carries no `statuses`, so the helper is a no-op on it.
     */
    public function test_config_without_statuses_is_returned_unchanged(): void
    {
        $config = [ 'phases' => [ [ 'key' => 'ideation' ] ] ];

        $this->assertSame( $config, $this->drop_core_targets( $config ) );
    }

    // -------------------------------------------------------------------------
    // assign_regions_from_legacy_flags
    // -------------------------------------------------------------------------

    /**
     * Invoke the private static helper via reflection.
     *
     * @param  array $config Sequence config.
     * @return array{config: array, promoted: array, defaulted: array}
     */
    private function assign_regions( array $config ): array
    {
        $method = new \ReflectionMethod( Schema::class, 'assign_regions_from_legacy_flags' );

        return $method->invoke( null, $config, 7, 'test-slug' );
    }

    /**
     * Region map of the returned config, keyed by stage key.
     *
     * @param  array $result Helper return value.
     * @return array<string, string|null>
     */
    private function regions_of( array $result ): array
    {
        $regions = [];

        foreach ( $result['config']['statuses'] as $stage ) {
            $regions[ $stage['key'] ] = $stage['status'] ?? null;
        }

        return $regions;
    }

    /**
     * The legacy `publish` flag is the one marker that proves the publish region —
     * it meant "this stage publishes the post" when a stage WAS a post status.
     */
    public function test_legacy_publish_flag_assigns_the_publish_region(): void
    {
        $result = $this->assign_regions(
            [
                'statuses' => [
                    [ 'key' => 'draft' ],
                    [ 'key' => 'published', 'publish' => true ],
                ],
            ]
        );

        $this->assertSame( [ 'draft' => null, 'published' => 'publish' ], $this->regions_of( $result ) );
        $this->assertSame( [ 'published' ], $result['promoted'] );
        $this->assertSame( [ 'draft' ], $result['defaulted'], 'The unproven stage is reported so a human can confirm it.' );
    }

    /**
     * Terminality is not publication: a pipeline can end in rejection. Promoting on
     * `is_terminal` would move declined posts into the publish region.
     */
    public function test_is_terminal_alone_does_not_assign_the_publish_region(): void
    {
        $result = $this->assign_regions(
            [
                'statuses' => [
                    [ 'key' => 'hired', 'is_terminal' => true ],
                    [ 'key' => 'rejected', 'is_terminal' => true ],
                ],
            ]
        );

        $this->assertSame( [ 'hired' => null, 'rejected' => null ], $this->regions_of( $result ) );
        $this->assertSame( [], $result['promoted'] );
    }

    /**
     * The other legacy flags carry no region meaning and must not promote.
     */
    public function test_other_legacy_flags_do_not_assign_a_region(): void
    {
        $result = $this->assign_regions(
            [
                'statuses' => [
                    [ 'key' => 'a', 'show_in_queue' => true ],
                    [ 'key' => 'b', 'is_initial' => true ],
                    [ 'key' => 'c', 'is_in_progress' => true ],
                ],
            ]
        );

        $this->assertSame( [], $result['promoted'] );
        $this->assertSame( [ 'a', 'b', 'c' ], $result['defaulted'] );
    }

    /**
     * Stage names and labels are never consulted — `review` looks like a `pending`
     * candidate but nothing in the row says so, and guessing semantics is worse than
     * a conservative default a human is told about.
     */
    public function test_stage_names_are_never_used_to_infer_a_region(): void
    {
        $result = $this->assign_regions(
            [
                'statuses' => [
                    [ 'key' => 'review', 'label' => 'In Review' ],
                    [ 'key' => 'pending', 'label' => 'Pending' ],
                    [ 'key' => 'publish', 'label' => 'Publish' ],
                ],
            ]
        );

        $this->assertSame( [], $result['promoted'], 'Not even a stage literally keyed "publish" is promoted without the flag.' );
    }

    /**
     * A declared region always wins: this helper only ever SUPPLIES a region where
     * none was declared, so an author's explicit choice cannot be overridden by a
     * stale legacy flag.
     */
    public function test_a_declared_region_is_never_overridden(): void
    {
        $result = $this->assign_regions(
            [
                'statuses' => [
                    [ 'key' => 'archived', 'status' => 'draft', 'publish' => true ],
                    [ 'key' => 'live', 'status' => 'pending' ],
                ],
            ]
        );

        $this->assertSame( [ 'archived' => 'draft', 'live' => 'pending' ], $this->regions_of( $result ) );
        $this->assertSame( [], $result['promoted'] );
        $this->assertSame( [], $result['defaulted'], 'A fully-declared config needs no human review.' );
    }

    /**
     * "Declares no region" must match the write gate's own definition of absent — no
     * key, null, or the empty string — so the helper and the gate never disagree
     * about which stages need one.
     */
    public function test_null_and_empty_regions_count_as_absent(): void
    {
        $result = $this->assign_regions(
            [
                'statuses' => [
                    [ 'key' => 'a', 'status' => null, 'publish' => true ],
                    [ 'key' => 'b', 'status' => '' ],
                ],
            ]
        );

        // "a" is promoted despite its null region; "b" is left exactly as stored for
        // the write gate to default — this helper only ever ADDS a proven region.
        $this->assertSame( [ 'a' => 'publish', 'b' => '' ], $this->regions_of( $result ) );
        $this->assertSame( [ 'a' ], $result['promoted'] );
        $this->assertSame( [ 'b' ], $result['defaulted'] );

        // And the gate does default it, so the two stay in agreement end to end.
        $normalized = \VIPWorkflow\Sequences\Sequence::prepare_config_for_write( $result['config'] );
        $this->assertSame( 'publish', $normalized['statuses'][0]['status'] );
        $this->assertSame( 'draft', $normalized['statuses'][1]['status'] );
    }
}
