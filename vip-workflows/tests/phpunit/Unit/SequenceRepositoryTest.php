<?php
/**
 * SequenceRepository unit tests.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflow\Sequences\Sequence;
use VIPWorkflow\Sequences\SequenceRepository;

/**
 * Tests for the SequenceRepository class.
 */
class SequenceRepositoryTest extends TestCase
{
    /**
     * Mock wpdb instance.
     *
     * @var object
     */
    private $wpdb;

    /**
     * Repository under test.
     *
     * @var SequenceRepository
     */
    private SequenceRepository $repository;

    /**
     * Set up test fixtures.
     */
    protected function setUp(): void
    {
        parent::setUp();

        // Create mock wpdb with required properties.
        $this->wpdb         = Mockery::mock( 'wpdb' );
        $this->wpdb->prefix = 'wp_';

        // Replace global $wpdb with our mock.
        global $wpdb;
        $wpdb = $this->wpdb;

        $this->repository = new SequenceRepository();
    }

    /**
     * Create a mock database row.
     *
     * @param array $overrides Field overrides.
     * @return object
     */
    private function create_db_row( array $overrides = array() ): object
    {
        $defaults = array(
            'id'          => 1,
            'uuid'        => 'test-uuid-1234',
            'type'        => Sequence::TYPE_WORKFLOW,
            'name'        => 'Test Sequence',
            'slug'        => 'test-sequence',
            'description' => 'A test sequence',
            'version'     => 1,
            'status'      => 'active',
            'config'      => '{"statuses":[]}',
            'created_by'  => 1,
            'created_at'  => '2026-01-01 00:00:00',
            'updated_at'  => '2026-01-01 00:00:00',
        );

        return (object) array_merge( $defaults, $overrides );
    }

    /**
     * Test find returns sequence when found.
     */
    public function test_find_returns_sequence(): void
    {
        $row = $this->create_db_row();

        $this->wpdb->shouldReceive( 'prepare' )
            ->once()
            ->andReturn( 'prepared_query' );

        $this->wpdb->shouldReceive( 'get_row' )
            ->once()
            ->with( 'prepared_query' )
            ->andReturn( $row );

        $result = $this->repository->find( 1 );

        $this->assertInstanceOf( Sequence::class, $result );
        $this->assertSame( 1, $result->id );
        $this->assertSame( 'Test Sequence', $result->name );
    }

    /**
     * Test find returns null when not found.
     */
    public function test_find_returns_null_when_not_found(): void
    {
        $this->wpdb->shouldReceive( 'prepare' )
            ->once()
            ->andReturn( 'prepared_query' );

        $this->wpdb->shouldReceive( 'get_row' )
            ->once()
            ->with( 'prepared_query' )
            ->andReturn( null );

        $result = $this->repository->find( 999 );

        $this->assertNull( $result );
    }

    /**
     * Test preload fetches all requested cache entries in one call.
     */
    public function test_preload_gets_cached_sequences_in_one_call(): void
    {
        $cached_sequence  = Sequence::from_row( $this->create_db_row( array( 'id' => 1 ) ) );
        $bulk_get_calls   = 0;
        $read_keys        = array();
        $read_group       = null;

        Functions\when( 'wp_cache_get_multiple' )->alias(
            function ( array $keys, string $group ) use ( &$bulk_get_calls, &$read_keys, &$read_group, $cached_sequence ) {
                ++$bulk_get_calls;
                $read_keys  = $keys;
                $read_group = $group;

                $values = array_fill_keys( $keys, false );
                foreach ( $keys as $key ) {
                    if ( str_ends_with( $key, '_sequence_1' ) ) {
                        $values[ $key ] = $cached_sequence;
                    }
                }

                return $values;
            }
        );
        Functions\when( 'wp_cache_set_multiple' )->justReturn( true );

        $this->wpdb->shouldReceive( 'prepare' )->once()->andReturn( 'prepared_query' );
        $this->wpdb->shouldReceive( 'get_results' )->once()->andReturn(
            array( $this->create_db_row( array( 'id' => 2 ) ) )
        );

        $result = $this->repository->preload( array( 1, 1, 2 ) );

        $this->assertSame( 1, $bulk_get_calls );
        $this->assertSame( SequenceRepository::CACHE_GROUP, $read_group );
        $this->assertCount( 2, $read_keys );
        $this->assertSame( $cached_sequence, $result[1] );
        $this->assertSame( 2, $result[2]->id );
    }

    /**
     * Test preload writes found and missing sequences in one call.
     */
    public function test_preload_sets_found_and_missing_sequences_in_one_call(): void
    {
        $bulk_set_calls = 0;
        $written        = array();
        $write_group    = null;

        Functions\when( 'wp_cache_get_multiple' )->alias(
            function ( array $keys ) {
                return array_fill_keys( $keys, false );
            }
        );
        Functions\when( 'wp_cache_set_multiple' )->alias(
            function ( array $values, string $group ) use ( &$bulk_set_calls, &$written, &$write_group ) {
                ++$bulk_set_calls;
                $written     = $values;
                $write_group = $group;

                return true;
            }
        );

        $this->wpdb->shouldReceive( 'prepare' )->once()->andReturn( 'prepared_query' );
        $this->wpdb->shouldReceive( 'get_results' )->once()->andReturn(
            array( $this->create_db_row( array( 'id' => 1 ) ) )
        );

        $this->repository->preload( array( 1, 999 ) );

        $this->assertSame( 1, $bulk_set_calls );
        $this->assertSame( SequenceRepository::CACHE_GROUP, $write_group );
        $this->assertCount( 2, $written );

        $found_keys   = preg_grep( '/_sequence_1$/', array_keys( $written ) );
        $missing_keys = preg_grep( '/_sequence_999$/', array_keys( $written ) );

        $this->assertCount( 1, $found_keys );
        $this->assertCount( 1, $missing_keys );
        $this->assertInstanceOf( Sequence::class, $written[ reset( $found_keys ) ] );
        $this->assertSame( '', $written[ reset( $missing_keys ) ] );
    }

    /**
     * Test find_by_uuid returns sequence.
     */
    public function test_find_by_uuid(): void
    {
        $row = $this->create_db_row( array( 'uuid' => 'specific-uuid' ) );

        $this->wpdb->shouldReceive( 'prepare' )
            ->once()
            ->andReturn( 'prepared_query' );

        $this->wpdb->shouldReceive( 'get_row' )
            ->once()
            ->andReturn( $row );

        $result = $this->repository->find_by_uuid( 'specific-uuid' );

        $this->assertInstanceOf( Sequence::class, $result );
        $this->assertSame( 'specific-uuid', $result->uuid );
    }

    /**
     * Test find_by_slug returns latest active sequence.
     */
    public function test_find_by_slug(): void
    {
        $row = $this->create_db_row(
            array(
                'slug'    => 'my-workflow',
                'version' => 3,
            )
        );

        $this->wpdb->shouldReceive( 'prepare' )
            ->once()
            ->andReturn( 'prepared_query' );

        $this->wpdb->shouldReceive( 'get_row' )
            ->once()
            ->andReturn( $row );

        $result = $this->repository->find_by_slug( 'my-workflow' );

        $this->assertInstanceOf( Sequence::class, $result );
        $this->assertSame( 'my-workflow', $result->slug );
        $this->assertSame( 3, $result->version );
    }

    /**
     * Test find_version returns specific version.
     */
    public function test_find_version(): void
    {
        $row = $this->create_db_row(
            array(
                'slug'    => 'my-workflow',
                'version' => 2,
            )
        );

        $this->wpdb->shouldReceive( 'prepare' )
            ->once()
            ->andReturn( 'prepared_query' );

        $this->wpdb->shouldReceive( 'get_row' )
            ->once()
            ->andReturn( $row );

        $result = $this->repository->find_version( 'my-workflow', 2 );

        $this->assertInstanceOf( Sequence::class, $result );
        $this->assertSame( 2, $result->version );
    }

    /**
     * Test get_all returns array of sequences.
     */
    public function test_get_all(): void
    {
        $rows = array(
            $this->create_db_row( array( 'id' => 1, 'name' => 'First' ) ),
            $this->create_db_row( array( 'id' => 2, 'name' => 'Second' ) ),
        );

        $this->wpdb->shouldReceive( 'prepare' )
            ->andReturn( 'prepared_query' );

        $this->wpdb->shouldReceive( 'get_results' )
            ->once()
            ->andReturn( $rows );

        $result = $this->repository->get_all();

        $this->assertCount( 2, $result );
        $this->assertContainsOnlyInstancesOf( Sequence::class, $result );
        $this->assertSame( 'First', $result[0]->name );
        $this->assertSame( 'Second', $result[1]->name );
    }

    /**
     * Test get_all writes its per-sequence cache entries in one call.
     */
    public function test_get_all_sets_sequences_in_one_call(): void
    {
        $rows = array(
            $this->create_db_row( array( 'id' => 1, 'name' => 'First' ) ),
            $this->create_db_row( array( 'id' => 2, 'name' => 'Second' ) ),
        );

        $bulk_set_calls = 0;
        $written        = array();
        $write_group    = null;

        Functions\when( 'wp_cache_set_multiple' )->alias(
            function ( array $values, string $group ) use ( &$bulk_set_calls, &$written, &$write_group ) {
                ++$bulk_set_calls;
                $written     = $values;
                $write_group = $group;

                return true;
            }
        );

        $this->wpdb->shouldReceive( 'get_results' )->once()->andReturn( $rows );

        $result = $this->repository->get_all();

        $this->assertCount( 2, $result );
        $this->assertSame( 1, $bulk_set_calls );
        $this->assertSame( SequenceRepository::CACHE_GROUP, $write_group );
        $this->assertCount( 2, $written );
        $this->assertContainsOnlyInstancesOf( Sequence::class, $written );
    }

    /**
     * Test get_all with type filter.
     */
    public function test_get_all_with_type_filter(): void
    {
        $rows = array(
            $this->create_db_row( array( 'type' => Sequence::TYPE_PHASE ) ),
        );

        $this->wpdb->shouldReceive( 'prepare' )
            ->andReturn( 'prepared_query' );

        $this->wpdb->shouldReceive( 'get_results' )
            ->once()
            ->andReturn( $rows );

        $result = $this->repository->get_all( array( 'type' => Sequence::TYPE_PHASE ) );

        $this->assertCount( 1, $result );
        $this->assertSame( Sequence::TYPE_PHASE, $result[0]->type );
    }

    /**
     * Test get_workflow_sequences helper.
     */
    public function test_get_workflow_sequences(): void
    {
        $rows = array(
            $this->create_db_row( array( 'type' => Sequence::TYPE_WORKFLOW ) ),
        );

        $this->wpdb->shouldReceive( 'prepare' )
            ->andReturn( 'prepared_query' );

        $this->wpdb->shouldReceive( 'get_results' )
            ->once()
            ->andReturn( $rows );

        $result = $this->repository->get_workflow_sequences();

        $this->assertCount( 1, $result );
        $this->assertTrue( $result[0]->is_workflow() );
    }

    /**
     * Test get_active returns only active sequences.
     */
    public function test_get_active(): void
    {
        $rows = array(
            $this->create_db_row( array( 'status' => 'active' ) ),
        );

        $this->wpdb->shouldReceive( 'prepare' )
            ->andReturn( 'prepared_query' );

        $this->wpdb->shouldReceive( 'get_results' )
            ->once()
            ->andReturn( $rows );

        $result = $this->repository->get_active();

        $this->assertCount( 1, $result );
        $this->assertTrue( $result[0]->is_active() );
    }

    /**
     * Test create inserts and returns ID.
     */
    public function test_create(): void
    {
        $this->wpdb->shouldReceive( 'insert' )
            ->once()
            ->andReturn( 1 );

        $this->wpdb->insert_id = 5;

        Functions\expect( 'get_current_user_id' )->andReturn( 1 );

        $result = $this->repository->create(
            'New Sequence',
            'new-sequence',
            'Description',
            array( 'statuses' => array( array( 'key' => 'draft', 'label' => 'Draft' ) ) ),
            1
        );

        $this->assertSame( 5, $result );
    }

    /**
     * create() persists the config RETURNED by the write gate, not the raw
     * input: the missing stage `status` is defaulted to draft and the region's
     * entry checkpoint is auto-assigned before the row is inserted.
     */
    public function test_create_persists_gate_normalized_config(): void
    {
        $captured = null;
        $this->wpdb->shouldReceive( 'insert' )
            ->once()
            ->andReturnUsing(
                function ( $table, $data ) use ( &$captured ) {
                    $captured = $data;
                    return 1;
                }
            );
        $this->wpdb->insert_id = 7;

        $result = $this->repository->create(
            'Gated Sequence',
            'gated-sequence',
            'Description',
            array( 'statuses' => array( array( 'key' => 'draft', 'label' => 'Draft' ) ) ),
            1
        );

        $this->assertSame( 7, $result );

        $stored = json_decode( $captured['config'], true );
        $this->assertSame( 'draft', $stored['statuses'][0]['status'], 'Missing region defaulted at write time.' );
        $this->assertTrue( $stored['statuses'][0]['region_entry'], 'Region entry auto-assigned at write time.' );
    }

    /**
     * create() propagates the write gate's rejection (no insert happens).
     */
    public function test_create_throws_on_invalid_config(): void
    {
        $this->wpdb->shouldReceive( 'insert' )->never();

        $this->expectException( \InvalidArgumentException::class );

        $this->repository->create(
            'Bad Sequence',
            'bad-sequence',
            'Description',
            array( 'statuses' => array( array( 'key' => 'scheduled', 'label' => 'Scheduled', 'status' => 'future' ) ) ),
            1
        );
    }

    /**
     * update() routes a config change through the write gate too — the second
     * write path cannot bypass normalization or validation.
     */
    public function test_update_config_flows_through_gate(): void
    {
        $row = $this->create_db_row();

        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'prepared_query' );
        $this->wpdb->shouldReceive( 'get_row' )->once()->andReturn( $row );

        $captured = null;
        $this->wpdb->shouldReceive( 'update' )
            ->once()
            ->andReturnUsing(
                function ( $table, $data ) use ( &$captured ) {
                    $captured = $data;
                    return 1;
                }
            );

        $result = $this->repository->update(
            1,
            array( 'config' => array( 'statuses' => array( array( 'key' => 'writing', 'label' => 'Writing' ) ) ) )
        );

        $this->assertSame( 1, $result );

        $stored = json_decode( $captured['config'], true );
        $this->assertSame( 'draft', $stored['statuses'][0]['status'] );
        $this->assertTrue( $stored['statuses'][0]['region_entry'] );
    }

    /**
     * update() rejects an invalid stage graph before touching the database.
     */
    public function test_update_throws_on_invalid_config(): void
    {
        $row = $this->create_db_row();

        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'prepared_query' );
        $this->wpdb->shouldReceive( 'get_row' )->once()->andReturn( $row );
        $this->wpdb->shouldReceive( 'update' )->never();

        $this->expectException( \InvalidArgumentException::class );

        $this->repository->update( 1, array( 'config' => array( 'statuses' => array() ) ) );
    }

    /**
     * Test create returns false on failure.
     */
    public function test_create_failure(): void
    {
        $this->wpdb->shouldReceive( 'insert' )
            ->once()
            ->andReturn( false );

        $result = $this->repository->create(
            'New Sequence',
            'new-sequence',
            'Description',
            array( 'statuses' => array( array( 'key' => 'draft', 'label' => 'Draft' ) ) ),
            1
        );

        $this->assertFalse( $result );
    }

    /**
     * Test update modifies sequence.
     */
    public function test_update(): void
    {
        $row = $this->create_db_row();

        $this->wpdb->shouldReceive( 'prepare' )
            ->andReturn( 'prepared_query' );

        $this->wpdb->shouldReceive( 'get_row' )
            ->once()
            ->andReturn( $row );

        $this->wpdb->shouldReceive( 'update' )
            ->once()
            ->andReturn( 1 );

        $result = $this->repository->update(
            1,
            array( 'name' => 'Updated Name' )
        );

        $this->assertSame( 1, $result );
    }

    /**
     * Test update returns false for non-existent sequence.
     */
    public function test_update_not_found(): void
    {
        $this->wpdb->shouldReceive( 'prepare' )
            ->andReturn( 'prepared_query' );

        $this->wpdb->shouldReceive( 'get_row' )
            ->once()
            ->andReturn( null );

        $result = $this->repository->update( 999, array( 'name' => 'Test' ) );

        $this->assertFalse( $result );
    }

    /**
     * Test archive sets status to archived.
     */
    public function test_archive(): void
    {
        $this->wpdb->shouldReceive( 'update' )
            ->once()
            ->with(
                Mockery::any(),
                Mockery::on(
                    function ( $data ) {
                        return 'archived' === $data['status'];
                    }
                ),
                array( 'id' => 1 )
            )
            ->andReturn( 1 );

        $result = $this->repository->archive( 1 );

        $this->assertTrue( $result );
    }

    /**
     * Test delete removes sequence.
     */
    public function test_delete(): void
    {
        $this->wpdb->shouldReceive( 'delete' )
            ->once()
            ->with(
                Mockery::any(),
                array( 'id' => 1 ),
                array( '%d' )
            )
            ->andReturn( 1 );

        $result = $this->repository->delete( 1 );

        $this->assertTrue( $result );
    }

    /**
     * Test get_versions returns all versions of a sequence.
     */
    public function test_get_versions(): void
    {
        $rows = array(
            $this->create_db_row( array( 'version' => 3 ) ),
            $this->create_db_row( array( 'version' => 2 ) ),
            $this->create_db_row( array( 'version' => 1 ) ),
        );

        $this->wpdb->shouldReceive( 'prepare' )
            ->once()
            ->andReturn( 'prepared_query' );

        $this->wpdb->shouldReceive( 'get_results' )
            ->once()
            ->andReturn( $rows );

        $result = $this->repository->get_versions( 'test-sequence' );

        $this->assertCount( 3, $result );
        $this->assertSame( 3, $result[0]->version );
        $this->assertSame( 2, $result[1]->version );
        $this->assertSame( 1, $result[2]->version );
    }

    // ── Cache invalidation ───────────────────────────────────────────

    /*
     * These use Functions\when()->alias() rather than Functions\expect().
     * TestCase::setUp() already stubs the wp_cache_* family through
     * Functions\stubs(), and a later expect() on a name that is already stubbed
     * registers an expectation the code under test never reaches — it keeps
     * calling the stub, and the expectation fails as "called 0 times" while the
     * call plainly happened. Redefining through when() replaces the stub, so the
     * counters below record real calls.
     */

    /**
     * Set up a wpdb that satisfies a successful update().
     */
    private function stub_successful_update(): void
    {
        $this->wpdb->shouldReceive( 'prepare' )->andReturn( 'prepared_query' );
        $this->wpdb->shouldReceive( 'get_row' )->andReturn( $this->create_db_row() );
        $this->wpdb->shouldReceive( 'update' )->andReturn( 1 );
    }

    /**
     * Count calls to wp_cache_incr, and control what it returns.
     *
     * @param mixed $return What the stubbed incr returns.
     * @return object Counter with a public `calls` property.
     */
    private function count_incr_calls( $return = 2 ): object
    {
        $counter = new class {
            /** @var int */
            public $calls = 0;
        };

        Functions\when( 'wp_cache_incr' )->alias(
            function () use ( $counter, $return ) {
                ++$counter->calls;

                return $return;
            }
        );

        return $counter;
    }

    /**
     * Test a drop-in that flushes the group is left to do so.
     *
     * The version salt exists only because most drop-ins decline. Bumping it as
     * well would cold-start a cache that had just been correctly emptied.
     */
    public function test_group_flush_is_preferred_when_the_drop_in_supports_it(): void
    {
        $this->stub_successful_update();

        Functions\when( 'wp_cache_flush_group' )->justReturn( true );
        $incr = $this->count_incr_calls();

        $this->repository->update( 1, array( 'name' => 'Updated Name' ) );

        $this->assertSame( 0, $incr->calls );
    }

    /**
     * Test the version is bumped when the drop-in declines to flush.
     *
     * This is the memcached case, and the whole bug: without it the row changes
     * and every cached reader carries on serving the previous configuration.
     */
    public function test_version_is_bumped_when_group_flush_is_unsupported(): void
    {
        $this->stub_successful_update();

        Functions\when( 'wp_cache_flush_group' )->justReturn( false );
        $incr = $this->count_incr_calls();

        $this->repository->update( 1, array( 'name' => 'Updated Name' ) );

        $this->assertSame( 1, $incr->calls );
    }

    /**
     * Test an evicted version key is re-seeded without reusing its generation.
     *
     * `incr` returns false when the key has been evicted. A timestamp can collide
     * with the generation just used by the read before the update, pointing readers
     * back at stale entries under that same namespace.
     */
    public function test_an_evicted_version_key_is_reseeded_without_reusing_the_generation(): void
    {
        $this->stub_successful_update();

        Functions\when( 'wp_cache_flush_group' )->justReturn( false );
        $this->count_incr_calls( false );
        $next_generation = 1700000001;
        Functions\when( 'VIPWorkflow\Sequences\random_int' )->alias(
            function () use ( &$next_generation ) {
                return $next_generation++;
            }
        );

        $written = array();

        Functions\when( 'wp_cache_set' )->alias(
            function ( $key, $value ) use ( &$written ) {
                if ( 'cache_version' === $key ) {
                    $written[] = $value;
                }

                return true;
            }
        );

        $this->repository->update( 1, array( 'name' => 'First Update' ) );
        $this->repository->update( 1, array( 'name' => 'Second Update' ) );

        $this->assertGreaterThanOrEqual( 2, count( $written ), 'Each failed increment must seed the absent key.' );
        $this->assertContainsOnly( 'int', $written );
        $this->assertCount(
            count( $written ),
            array_unique( $written ),
            'Re-seeding must not revive a generation that was just invalidated.'
        );
    }
}
