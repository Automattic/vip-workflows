<?php
/**
 * The PHP half of the shared region-math golden fixture.
 *
 * The JS half is tests/unit-js/workflow-side-effect.test.js, reading the SAME
 * tests/fixtures/region-math.json. The rule these pin is implemented three times
 * across two languages and had already drifted twice; a comment saying "MUST
 * change together" is not a test.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use Mockery;
use VIPWorkflows\Sequences\Sequence;
use VIPWorkflows\Sequences\SequenceRepository;
use VIPWorkflows\Workflow\PostTypeManager;
use VIPWorkflows\Workflow\StatusManager;

/**
 * Golden-fixture conformance for the region map and the publish boundary.
 */
class RegionMathFixtureTest extends TestCase
{
    /**
     * Decoded fixture, shared by both suites.
     *
     * @return array
     */
    private static function fixture(): array
    {
        $path = dirname( __DIR__, 2 ) . '/fixtures/region-math.json';
        $raw  = file_get_contents( $path );

        static::assertIsString( $raw, 'The shared region-math fixture must be readable.' );

        $decoded = json_decode( $raw, true );

        static::assertIsArray( $decoded, 'The shared region-math fixture must be valid JSON.' );

        return $decoded;
    }

    /**
     * A StatusManager with no constructor wiring (the region map needs none).
     *
     * @return StatusManager
     */
    private function bare_status_manager(): StatusManager
    {
        return ( new \ReflectionClass( StatusManager::class ) )->newInstanceWithoutConstructor();
    }

    public function test_status_to_region_matches_the_shared_fixture(): void
    {
        $manager = $this->bare_status_manager();

        foreach ( self::fixture()['statusToRegion'] as $case ) {
            $this->assertSame(
                $case['region'],
                $manager->status_to_region( $case['status'] ),
                sprintf( 'status_to_region("%s"): %s', $case['status'], $case['why'] )
            );
        }
    }

    /**
     * crosses_publish_boundary() reads the region off the post's STAGE, so each
     * fixture case is driven through a sequence reporting that region.
     */
    public function test_crosses_publish_boundary_matches_the_shared_fixture(): void
    {
        foreach ( self::fixture()['crossesPublishBoundary'] as $case ) {
            Functions\when( 'get_post' )->justReturn( $this->create_mock_post( array( 'ID' => 42 ) ) );
            // The fixture varies the STAGE's region; `draft` is the committed
            // status throughout so it exerts no publish-side pull of its own.
            // The stage-vs-status disagreement has its own tests in
            // StatusManagerBoundaryTest.
            Functions\when( 'get_post_status' )->justReturn( 'draft' );
            Functions\when( 'get_post_meta' )->alias(
                function ( $post_id, $key, $single = false ) {
                    if ( StatusManager::SEQUENCE_META_KEY === $key ) {
                        return 7;
                    }
                    if ( StatusManager::STAGE_META_KEY === $key ) {
                        return 'the_stage';
                    }
                    return '';
                }
            );

            $sequence = Mockery::mock( Sequence::class );
            $sequence->shouldReceive( 'get_status' )->andReturn( array( 'key' => 'the_stage' ) );
            $sequence->shouldReceive( 'get_stage_status' )
                ->with( 'the_stage' )
                ->andReturn( $case['currentRegion'] );

            $repository = Mockery::mock( SequenceRepository::class );
            $repository->shouldReceive( 'find' )->andReturn( $sequence );

            $manager = new StatusManager( $repository, Mockery::mock( PostTypeManager::class ) );

            $this->assertSame(
                $case['crosses'],
                $manager->crosses_publish_boundary( 42, $case['targetStatus'] ),
                sprintf(
                    'crosses_publish_boundary(region "%s" -> status "%s"): %s',
                    $case['currentRegion'],
                    $case['targetStatus'],
                    $case['why']
                )
            );
        }
    }

    /**
     * Both suites must actually be reading cases — an empty or renamed fixture
     * would otherwise let every assertion above pass vacuously.
     */
    public function test_fixture_carries_cases_for_both_suites(): void
    {
        $fixture = self::fixture();

        $this->assertNotEmpty( $fixture['statusToRegion'] );
        $this->assertNotEmpty( $fixture['crossesPublishBoundary'] );
    }
}
