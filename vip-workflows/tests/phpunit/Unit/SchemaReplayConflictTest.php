<?php
/**
 * The stored-config replay keeps a save that lands between its read and its write.
 *
 * The replay reads every sequence, normalizes each one, and writes it back. It
 * runs on `init`, so an API save can land in between. Each write is conditional
 * on the row still holding what was read; these tests drive that against a
 * $wpdb double whose rows can change between the read and the update.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflows\Database\Schema;

class SchemaReplayConflictTest extends TestCase
{
    /**
     * Options written during the test.
     *
     * @var array<string, mixed>
     */
    private array $options = array();

    /**
     * Where error_log() writes during the test.
     */
    private string $log_file = '';

    /**
     * The error_log ini value to restore.
     *
     * @var string|false
     */
    private $previous_log = false;

    protected function set_up()
    {
        parent::set_up();

        $this->options = array();

        Functions\when( 'get_option' )->alias(
            fn( $name, $fallback = false ) => array_key_exists( $name, $this->options ) ? $this->options[ $name ] : $fallback
        );
        Functions\when( 'update_option' )->alias(
            function ( $name, $value ) {
                $this->options[ $name ] = $value;
                return true;
            }
        );

        $this->log_file     = (string) tempnam( sys_get_temp_dir(), 'vipwf-log' );
        $this->previous_log = ini_set( 'error_log', $this->log_file );
    }

    protected function tear_down()
    {
        if ( false !== $this->previous_log ) {
            ini_set( 'error_log', (string) $this->previous_log );
        }
        if ( '' !== $this->log_file && file_exists( $this->log_file ) ) {
            unlink( $this->log_file );
        }

        parent::tear_down();
    }

    /**
     * A normalized two-stage config whose first transition carries the given inputs.
     *
     * @param  string $review_label Label of the second stage, to tell saves apart.
     * @param  array  $inputs       Inputs on the draft-to-review transition.
     * @return array
     */
    private static function config( string $review_label, array $inputs ): array
    {
        $transition = array( 'to' => 'review', 'label' => 'Send' );

        if ( ! empty( $inputs ) ) {
            $transition['inputs'] = $inputs;
        }

        return array(
            'statuses' => array(
                array(
                    'key'          => 'draft',
                    'label'        => 'Draft',
                    'status'       => 'draft',
                    'region_entry' => true,
                    'transitions'  => array( $transition ),
                ),
                array(
                    'key'          => 'review',
                    'label'        => $review_label,
                    'status'       => 'pending',
                    'region_entry' => true,
                ),
            ),
        );
    }

    /**
     * A note input, the shape the 2.25.0 replay removes.
     *
     * @return array
     */
    private static function note(): array
    {
        return array( 'type' => 'textarea', 'note_name' => 'Why', 'required' => true );
    }

    /**
     * Install a $wpdb double holding the given rows.
     *
     * `$before_update` runs before each conditional UPDATE is applied, with the
     * row id and the attempt number, and may change the stored config to model a
     * save landing in between.
     *
     * @param  array<int, array> $configs       Sequence id => config.
     * @param  callable|null     $before_update Called as ( $wpdb, $id, $attempt ).
     * @return object The double.
     */
    private function install_wpdb( array $configs, ?callable $before_update = null ): object
    {
        global $wpdb;

        $stored = array();
        foreach ( $configs as $id => $config ) {
            $stored[ $id ] = (string) json_encode( $config );
        }

        $wpdb = new class( $stored, $before_update ) {
            public string $prefix     = 'wp_';
            public string $last_error = '';

            /** @var array<int, array{0: string, 1: array}> */
            private array $prepared = array();

            /** @var array<int, int> Conditional UPDATE attempts per id. */
            public array $attempts = array();

            /** @var array<int, int> Rows read back by id after a conflict. */
            public array $reread = array();

            /** @var callable|null */
            private $before_update;

            public function __construct( public array $stored, ?callable $before_update )
            {
                $this->before_update = $before_update;
            }

            public function prepare( string $query, ...$args ): string
            {
                $this->prepared[] = array( $query, $args );
                return 'PREPARED#' . ( count( $this->prepared ) - 1 );
            }

            private function resolve( string $query ): array
            {
                if ( str_starts_with( $query, 'PREPARED#' ) ) {
                    return $this->prepared[ (int) substr( $query, 9 ) ];
                }
                return array( $query, array() );
            }

            public function get_results( string $query ): array
            {
                $rows = array();
                foreach ( $this->stored as $id => $config ) {
                    $rows[] = $this->row( $id );
                }
                return $rows;
            }

            public function get_row( string $query )
            {
                [ $sql, $args ] = $this->resolve( $query );

                if ( ! str_starts_with( $sql, 'SELECT' ) ) {
                    throw new \LogicException( 'Unexpected get_row: ' . $sql );
                }

                $id                  = (int) $args[0];
                $this->reread[ $id ] = ( $this->reread[ $id ] ?? 0 ) + 1;

                return isset( $this->stored[ $id ] ) ? $this->row( $id ) : null;
            }

            public function query( string $query )
            {
                [ $sql, $args ] = $this->resolve( $query );

                if ( ! str_starts_with( $sql, 'UPDATE' ) || ! str_contains( $sql, 'AND HEX(config) = %s' ) ) {
                    throw new \LogicException( 'Unexpected query: ' . $sql );
                }

                [ $config, , $id, $hex ] = $args;
                $this->attempts[ $id ]   = ( $this->attempts[ $id ] ?? 0 ) + 1;

                if ( null !== $this->before_update ) {
                    ( $this->before_update )( $this, $id, $this->attempts[ $id ] );
                }

                if ( ! isset( $this->stored[ $id ] ) || strtoupper( bin2hex( $this->stored[ $id ] ) ) !== $hex ) {
                    return 0;
                }

                $this->stored[ $id ] = $config;
                return 1;
            }

            private function row( int $id ): object
            {
                return (object) array(
                    'id'     => (string) $id,
                    'name'   => 'Sequence ' . $id,
                    'slug'   => 'sequence-' . $id,
                    'type'   => 'workflow',
                    'config' => $this->stored[ $id ],
                );
            }
        };

        return $wpdb;
    }

    /**
     * Run the replay the 2.25.0 migration runs.
     */
    private function replay(): void
    {
        $method = new \ReflectionMethod( Schema::class, 'replay_stored_stage_configs' );
        $method->invoke( null, true );
    }

    /**
     * Review records, keyed by sequence id.
     *
     * @return array<int, array>
     */
    private function review_records(): array
    {
        return array_column( (array) ( $this->options[ Schema::REGION_REVIEW_OPTION ] ?? array() ), null, 'id' );
    }

    /**
     * A save between the read and the write is kept, and the retry cleans it.
     */
    public function test_a_concurrent_save_is_kept_and_cleaned_on_retry(): void
    {
        $wpdb = $this->install_wpdb(
            array( 1 => self::config( 'Review', array( self::note() ) ) ),
            static function ( $wpdb, int $id, int $attempt ): void {
                if ( 1 === $attempt ) {
                    // The concurrent save renames a stage, and still holds a note.
                    $wpdb->stored[ $id ] = (string) json_encode( self::config( 'Legal review', array( self::note() ) ) );
                }
            }
        );

        $this->replay();

        $stored = json_decode( $wpdb->stored[1], true );

        $this->assertSame( 2, $wpdb->attempts[1], 'The first write conflicts and is retried once.' );
        $this->assertSame( 1, $wpdb->reread[1], 'The changed row is read again.' );
        $this->assertSame( 'Legal review', $stored['statuses'][1]['label'], 'The concurrent save is kept.' );
        $this->assertArrayNotHasKey( 'inputs', $stored['statuses'][0]['transitions'][0], 'The cleanup applies to the new config.' );
        $this->assertSame( array(), $this->review_records(), 'A conflict resolved by the retry is not recorded.' );
    }

    /**
     * A save that changes only the case of a label is still a change.
     *
     * The column collation is usually case-insensitive, so the comparison is on
     * the stored bytes.
     */
    public function test_a_case_only_concurrent_save_is_a_conflict(): void
    {
        $wpdb = $this->install_wpdb(
            array( 1 => self::config( 'review', array( self::note() ) ) ),
            static function ( $wpdb, int $id, int $attempt ): void {
                if ( 1 === $attempt ) {
                    $wpdb->stored[ $id ] = (string) json_encode( self::config( 'Review', array( self::note() ) ) );
                }
            }
        );

        $this->replay();

        $this->assertSame( 'Review', json_decode( $wpdb->stored[1], true )['statuses'][1]['label'] );
    }

    /**
     * A row that changes again on the retry is left as saved, logged and
     * recorded for review, and the other rows still migrate.
     */
    public function test_a_second_conflict_is_logged_recorded_and_skipped(): void
    {
        $wpdb = $this->install_wpdb(
            array(
                1 => self::config( 'Review', array( self::note() ) ),
                2 => self::config( 'Review', array( self::note() ) ),
            ),
            static function ( $wpdb, int $id, int $attempt ): void {
                if ( 1 === $id ) {
                    $wpdb->stored[ $id ] = (string) json_encode( self::config( 'Save ' . $attempt, array( self::note() ) ) );
                }
            }
        );

        $this->replay();

        $this->assertSame( 2, $wpdb->attempts[1], 'The conflicting row is retried once, not without end.' );
        $this->assertSame( 'Save 2', json_decode( $wpdb->stored[1], true )['statuses'][1]['label'], 'The latest save is left as written.' );

        $records = $this->review_records();
        $this->assertArrayHasKey( 1, $records );
        $this->assertStringContainsString( 'changed while the upgrade was updating it', (string) $records[1]['error'] );

        $this->assertStringContainsString(
            'Cannot normalize sequence 1 ("sequence-1"): it changed twice',
            (string) file_get_contents( $this->log_file )
        );

        $other = json_decode( $wpdb->stored[2], true );
        $this->assertArrayNotHasKey( 'inputs', $other['statuses'][0]['transitions'][0], 'The migration continues with the other rows.' );
        $this->assertArrayNotHasKey( 2, $records );
    }

    /**
     * A row deleted between the read and the write is logged, not recorded:
     * there is nothing left to review.
     */
    public function test_a_row_deleted_in_between_is_skipped(): void
    {
        $wpdb = $this->install_wpdb(
            array( 1 => self::config( 'Review', array( self::note() ) ) ),
            static function ( $wpdb, int $id ): void {
                unset( $wpdb->stored[ $id ] );
            }
        );

        $this->replay();

        $this->assertSame( 1, $wpdb->attempts[1] );
        $this->assertSame( array(), $this->review_records() );
        $this->assertStringContainsString( 'was deleted while the upgrade', (string) file_get_contents( $this->log_file ) );
    }

    /**
     * A row that needs no change is never written, so zero affected rows always
     * means a conflict.
     */
    public function test_a_clean_row_issues_no_update(): void
    {
        $clean = \VIPWorkflows\Sequences\Sequence::prepare_config_for_write( self::config( 'Review', array() ) );
        $wpdb  = $this->install_wpdb( array( 1 => $clean ) );

        $this->replay();

        $this->assertSame( array(), $wpdb->attempts );
        $this->assertSame( array(), $wpdb->reread );
    }

    /**
     * A failed update query is a database error, not a conflict.
     */
    public function test_a_failed_update_query_throws(): void
    {
        global $wpdb;

        $this->install_wpdb( array( 1 => self::config( 'Review', array( self::note() ) ) ) );

        $failing = new class( $wpdb ) {
            public string $prefix     = 'wp_';
            public string $last_error = '';

            public function __construct( private object $inner ) {}

            public function prepare( string $query, ...$args ): string
            {
                return $this->inner->prepare( $query, ...$args );
            }

            public function get_results( string $query ): array
            {
                return $this->inner->get_results( $query );
            }

            public function query( string $query )
            {
                $this->last_error = 'Lock wait timeout exceeded';
                return false;
            }
        };
        $wpdb = $failing;

        $this->expectException( \RuntimeException::class );
        $this->expectExceptionMessage( 'Lock wait timeout exceeded' );

        $this->replay();
    }
}
