<?php
/**
 * The 2.28.0 migration deletes the retired Create Draft record from post meta.
 *
 * @package VIPWorkflows\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Integration;

use VIPWorkflows\Database\MigrationDeferred;
use VIPWorkflows\Database\Schema;

/**
 * Create Draft used to write a record to `vip_draft_ai_context` that nothing
 * reads. The migration removes every copy, a page at a time, and resumes on a
 * later request when it runs out of time. Exercised against real post meta and
 * the real object cache.
 */
class DraftRecordCleanupMigrationTest extends TestCase {

	private const KEY = 'vip_draft_ai_context';

	private const VERSION_OPTION = 'vip_workflows_db_version';

	/**
	 * Add the retired record to a post, straight to post meta.
	 *
	 * @param int $post_id Post ID.
	 */
	private function add_record( int $post_id ): void {
		add_post_meta( $post_id, self::KEY, '{"source":"ideation"}' );
	}

	/**
	 * Rows left for the key, read from the table rather than the cache.
	 *
	 * @return int
	 */
	private function rows_left(): int {
		global $wpdb;
		return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$wpdb->postmeta} WHERE meta_key = %s", self::KEY ) );
	}

	/**
	 * Run the migration's helper directly.
	 */
	private function cleanup(): void {
		( new \ReflectionMethod( Schema::class, 'delete_retired_draft_records' ) )->invoke( null );
	}

	/**
	 * Set one of Schema's cleanup limits for a test, returning the old value.
	 *
	 * @param string    $name  Static property name.
	 * @param int|float $value Value to set.
	 * @return int|float The previous value.
	 */
	private function set_limit( string $name, $value ) {
		$property = new \ReflectionProperty( Schema::class, $name );
		$previous = $property->getValue();
		$property->setValue( null, $value );
		return $previous;
	}

	/**
	 * Every post loses the record; other meta, on the same post or not, stays.
	 */
	public function test_deletes_the_record_and_leaves_other_meta(): void {
		$posts = self::factory()->post->create_many( 3 );
		foreach ( $posts as $post_id ) {
			$this->add_record( $post_id );
		}
		update_post_meta( $posts[0], 'unrelated_key', 'kept' );
		update_post_meta( $posts[1], '_vip_ideation_project_id', 42 );

		$this->cleanup();

		$this->assertSame( 0, $this->rows_left() );
		foreach ( $posts as $post_id ) {
			$this->assertFalse( metadata_exists( 'post', $post_id, self::KEY ) );
		}
		$this->assertSame( 'kept', get_post_meta( $posts[0], 'unrelated_key', true ) );
		$this->assertSame( '42', get_post_meta( $posts[1], '_vip_ideation_project_id', true ) );
	}

	/**
	 * More rows than one page holds are all deleted in a single run.
	 */
	public function test_deletes_across_several_pages(): void {
		foreach ( self::factory()->post->create_many( 5 ) as $post_id ) {
			$this->add_record( $post_id );
		}

		$page = $this->set_limit( 'draft_record_cleanup_page_size', 2 );
		try {
			$this->cleanup();
		} finally {
			$this->set_limit( 'draft_record_cleanup_page_size', $page );
		}

		$this->assertSame( 0, $this->rows_left() );
	}

	/**
	 * A run out of time deletes the page in hand, then defers; the next run
	 * finishes the job.
	 */
	public function test_a_run_out_of_time_defers_and_the_next_run_finishes(): void {
		foreach ( self::factory()->post->create_many( 3 ) as $post_id ) {
			$this->add_record( $post_id );
		}

		$page   = $this->set_limit( 'draft_record_cleanup_page_size', 1 );
		$budget = $this->set_limit( 'draft_record_cleanup_budget', 0.0 );
		try {
			try {
				$this->cleanup();
				$this->fail( 'A cleanup out of time did not defer.' );
			} catch ( MigrationDeferred $e ) {
				$this->assertStringContainsString( 'time budget', $e->getMessage() );
			}
			$this->set_limit( 'draft_record_cleanup_budget', $budget );

			$this->assertSame( 2, $this->rows_left(), 'Exactly one page was deleted before deferring.' );

			$this->cleanup();
		} finally {
			// Both limits go back on every path, a failed assertion included.
			$this->set_limit( 'draft_record_cleanup_page_size', $page );
			$this->set_limit( 'draft_record_cleanup_budget', $budget );
		}

		$this->assertSame( 0, $this->rows_left() );
	}

	/**
	 * Running it on a site with nothing to delete does nothing and throws
	 * nothing, including a second time.
	 */
	public function test_is_idempotent(): void {
		$post_id = self::factory()->post->create();
		$this->add_record( $post_id );

		$this->cleanup();
		$this->cleanup();

		$this->assertSame( 0, $this->rows_left() );
	}

	/**
	 * A post whose meta is already cached stops reporting the record without
	 * a manual cache flush.
	 */
	public function test_clears_the_post_meta_cache(): void {
		$post_id = self::factory()->post->create();
		$this->add_record( $post_id );
		$this->assertNotSame( '', get_post_meta( $post_id, self::KEY, true ), 'The value was primed into the cache.' );
		$this->assertNotFalse( wp_cache_get( $post_id, 'post_meta' ) );

		$this->cleanup();

		$this->assertSame( '', get_post_meta( $post_id, self::KEY, true ) );
	}

	/**
	 * A post with the key twice loses both rows.
	 */
	public function test_deletes_every_row_on_a_post_with_the_key_twice(): void {
		$post_id = self::factory()->post->create();
		$this->add_record( $post_id );
		$this->add_record( $post_id );
		$this->assertSame( 2, $this->rows_left() );

		$page = $this->set_limit( 'draft_record_cleanup_page_size', 1 );
		try {
			$this->cleanup();
		} finally {
			$this->set_limit( 'draft_record_cleanup_page_size', $page );
		}

		$this->assertSame( 0, $this->rows_left() );
		$this->assertSame( array(), get_post_meta( $post_id, self::KEY ) );
	}

	/**
	 * A row written after a short page was read, but before it was deleted,
	 * is found by the next read rather than left behind.
	 */
	public function test_a_row_written_mid_run_is_deleted(): void {
		global $wpdb;
		$post_id = self::factory()->post->create();
		$this->add_record( $post_id );

		$inserted   = false;
		$interleave = static function ( string $query ) use ( $wpdb, $post_id, &$inserted ): string {
			if ( ! $inserted && str_starts_with( $query, 'DELETE FROM' ) && str_contains( $query, self::KEY ) ) {
				$inserted = true;
				$wpdb->insert(
					$wpdb->postmeta,
					array(
						'post_id'    => $post_id,
						'meta_key'   => self::KEY,
						'meta_value' => 'late',
					)
				);
			}
			return $query;
		};

		update_option( self::VERSION_OPTION, '2.27.0' );
		add_filter( 'query', $interleave );
		try {
			( new Schema() )->install();
		} finally {
			remove_filter( 'query', $interleave );
		}

		$this->assertTrue( $inserted, 'The row was written between the read and the delete.' );
		$this->assertSame( Schema::VERSION, get_option( self::VERSION_OPTION ) );
		$this->assertSame( 0, $this->rows_left() );
		$this->assertSame( array(), get_post_meta( $post_id, self::KEY ) );
	}

	/**
	 * Another run deleting the same rows first, and an earlier unrelated
	 * database error, neither make the cleanup fail.
	 */
	public function test_an_overlapping_run_and_a_stale_error_are_harmless(): void {
		global $wpdb;
		$post_id = self::factory()->post->create();
		$this->add_record( $post_id );
		get_post_meta( $post_id );

		$deleted    = false;
		$interleave = static function ( string $query ) use ( $wpdb, &$deleted ): string {
			if ( ! $deleted && str_starts_with( $query, 'DELETE FROM' ) && str_contains( $query, self::KEY ) ) {
				$deleted = true;
				$wpdb->query( $query );
			}
			return $query;
		};

		$wpdb->last_error = 'stale earlier error';
		add_filter( 'query', $interleave );
		try {
			$this->cleanup();
		} finally {
			remove_filter( 'query', $interleave );
		}

		$this->assertTrue( $deleted, 'The rows were deleted by the overlapping run first.' );
		$this->assertSame( 0, $this->rows_left() );
		$this->assertSame( array(), get_post_meta( $post_id, self::KEY ) );
	}

	/**
	 * Upgrading from the previous release runs the migration and records the
	 * new version.
	 */
	public function test_install_from_the_previous_release_deletes_the_records(): void {
		$post_id = self::factory()->post->create();
		$this->add_record( $post_id );

		update_option( self::VERSION_OPTION, '2.27.0' );
		( new Schema() )->install();

		$this->assertSame( Schema::VERSION, get_option( self::VERSION_OPTION ) );
		$this->assertSame( 0, $this->rows_left() );
	}

	/**
	 * An upgrade whose cleanup defers leaves the version where it was, so the
	 * next request runs the migration again.
	 */
	public function test_an_upgrade_that_defers_leaves_the_version_unbumped(): void {
		foreach ( self::factory()->post->create_many( 2 ) as $post_id ) {
			$this->add_record( $post_id );
		}

		update_option( self::VERSION_OPTION, '2.27.0' );

		$page   = $this->set_limit( 'draft_record_cleanup_page_size', 1 );
		$budget = $this->set_limit( 'draft_record_cleanup_budget', 0.0 );
		try {
			( new Schema() )->install();
			$this->fail( 'An upgrade out of time did not defer.' );
		} catch ( MigrationDeferred $e ) {
			$this->assertSame( '2.27.0', get_option( self::VERSION_OPTION ) );
		} finally {
			$this->set_limit( 'draft_record_cleanup_page_size', $page );
			$this->set_limit( 'draft_record_cleanup_budget', $budget );
		}

		( new Schema() )->install();

		$this->assertSame( Schema::VERSION, get_option( self::VERSION_OPTION ) );
		$this->assertSame( 0, $this->rows_left() );
	}
}
