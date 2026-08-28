<?php
/**
 * Ideation source-upload error classification.
 *
 * A refused upload used to come back as a 500, which sent whoever hit it looking
 * for a broken endpoint when the answer — a disallowed file type — was already in
 * the response body. Assigning 400 to everything fixes that case and breaks its
 * mirror image: a full disk reported as a bad request sends the same person to
 * inspect their own file while the server is the thing that is wrong.
 *
 * So these pin both directions, not just the one the bug was reported for.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use ReflectionMethod;
use VIPWorkflow\API\IdeationSourcesController;

class IdeationSourcesUploadErrorStatusTest extends TestCase
{
    /**
     * Call the private classifier.
     *
     * @param array $file A get_file_params() entry.
     * @return int|null
     */
    private function status_for( array $file ): ?int
    {
        // No setAccessible(): a no-op since PHP 8.1, and deprecated from 8.5.
        $method = new ReflectionMethod( IdeationSourcesController::class, 'upload_error_status' );

        return $method->invoke( null, $file );
    }

    /**
     * A file that arrived intact, as PHP reports one.
     *
     * @param array $overrides Field overrides.
     * @return array
     */
    private function delivered_file( array $overrides = array() ): array
    {
        return array_merge(
            array(
                'name'     => 'brief.pdf',
                'tmp_name' => '/tmp/php-upload-abc',
                'size'     => 48_512,
                'error'    => UPLOAD_ERR_OK,
            ),
            $overrides
        );
    }

    /**
     * Stub the type check WordPress itself would have run.
     *
     * @param bool $allowed Whether the site accepts the type.
     */
    private function stub_type_allowed( bool $allowed ): void
    {
        Functions\when( 'wp_check_filetype_and_ext' )->justReturn(
            array(
                'ext'             => $allowed ? 'pdf' : false,
                'type'            => $allowed ? 'application/pdf' : false,
                'proper_filename' => false,
            )
        );
    }

    // ── The caller's fault ───────────────────────────────────────────

    /**
     * The reported bug: a site with upload_filetypes set to images only.
     */
    public function test_a_disallowed_file_type_is_a_bad_request(): void
    {
        $this->stub_type_allowed( false );

        $this->assertSame( 400, $this->status_for( $this->delivered_file() ) );
    }

    /**
     * @dataProvider caller_side_php_errors
     *
     * @param int $php_error PHP upload error code.
     */
    public function test_php_reports_a_problem_with_what_was_sent( int $php_error ): void
    {
        $this->stub_type_allowed( true );

        $this->assertSame(
            400,
            $this->status_for( $this->delivered_file( array( 'error' => $php_error ) ) )
        );
    }

    public function caller_side_php_errors(): array
    {
        return array(
            'over the php.ini limit'  => array( UPLOAD_ERR_INI_SIZE ),
            'over the form limit'     => array( UPLOAD_ERR_FORM_SIZE ),
            'only partially uploaded' => array( UPLOAD_ERR_PARTIAL ),
            'no file sent'            => array( UPLOAD_ERR_NO_FILE ),
        );
    }

    public function test_an_empty_file_is_a_bad_request(): void
    {
        $this->stub_type_allowed( true );

        $this->assertSame( 400, $this->status_for( $this->delivered_file( array( 'size' => 0 ) ) ) );
    }

    // ── Ours ─────────────────────────────────────────────────────────

    /**
     * @dataProvider server_side_php_errors
     *
     * @param int $php_error PHP upload error code.
     */
    public function test_a_server_that_could_not_receive_the_file_stays_a_server_error( int $php_error ): void
    {
        $this->stub_type_allowed( true );

        $this->assertNull(
            $this->status_for( $this->delivered_file( array( 'error' => $php_error ) ) ),
            'Reporting this as a 400 sends the caller to check a file that is fine.'
        );
    }

    public function server_side_php_errors(): array
    {
        return array(
            'no temporary folder'   => array( UPLOAD_ERR_NO_TMP_DIR ),
            'could not write'       => array( UPLOAD_ERR_CANT_WRITE ),
            'stopped by extension'  => array( UPLOAD_ERR_EXTENSION ),
        );
    }

    /**
     * The gap the PHP codes cannot cover.
     *
     * A move_uploaded_file() failure arrives with no distinct code and a
     * perfectly acceptable file. Classifying on the type check rather than on the
     * message leaves it where it belongs.
     */
    public function test_a_write_failure_on_an_acceptable_file_stays_a_server_error(): void
    {
        $this->stub_type_allowed( true );

        $this->assertNull( $this->status_for( $this->delivered_file() ) );
    }
}
