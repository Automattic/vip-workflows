<?php
/**
 * MediaProcessor path-trust tests.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflow\Integrations\UploadsPathGuard;
use WP_Error;

/**
 * A file is only read/sent to the AI provider when it resolves inside the
 * uploads directory.
 */
class MediaProcessorPathTest extends TestCase
{
    private string $basedir;
    private string $inside;
    private string $outside;

    protected function set_up()
    {
        parent::set_up();

        $this->basedir = sys_get_temp_dir() . '/vipwf_uploads_' . uniqid();
        mkdir( $this->basedir );
        $this->inside = $this->basedir . '/attachment.jpg';
        file_put_contents( $this->inside, 'x' );
        $this->outside = tempnam( sys_get_temp_dir(), 'vipwf_outside_' );

        Functions\when( 'wp_get_upload_dir' )->justReturn( array( 'basedir' => $this->basedir ) );
    }

    protected function tear_down()
    {
        @unlink( $this->inside );
        @unlink( $this->outside );
        @rmdir( $this->basedir );
        parent::tear_down();
    }

    public function test_allows_a_file_inside_the_uploads_dir(): void
    {
        $this->assertTrue( UploadsPathGuard::validate( $this->inside ) );
    }

    public function test_rejects_a_file_outside_the_uploads_dir(): void
    {
        $result = UploadsPathGuard::validate( $this->outside );
        $this->assertInstanceOf( WP_Error::class, $result );
        $this->assertSame( 'invalid_file_path', $result->get_error_code() );
    }

    public function test_rejects_a_traversal_path(): void
    {
        $result = UploadsPathGuard::validate( $this->basedir . '/../../etc/hosts' );
        $this->assertInstanceOf( WP_Error::class, $result );
    }
}
