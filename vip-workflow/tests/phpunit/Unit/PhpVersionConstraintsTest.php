<?php
/**
 * PHP version constraint guards.
 *
 * Two time/version-gated reminders:
 *   1. If tests run under PHP 8.4+, the Debian Trixie patch may no longer be needed.
 *   2. After 2026-11-01, PHP 8.2 is two months from EOL — time to upgrade.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use PHPUnit\Framework\TestCase;

class PhpVersionConstraintsTest extends TestCase
{
    /**
     * Reminder (never fails) that the Debian Trixie apt/dpkg patch in
     * scripts/patch-wp-env.js may no longer be necessary once the test runtime
     * reaches PHP 8.4+.
     *
     * The patch was added because wordpress:php8.2 Docker images use Debian
     * Trixie, which breaks apt-get over HTTP and ships with corrupted dpkg
     * state files. On PHP 8.4+ this skips with a reminder rather than failing,
     * so it surfaces in the skipped list without redding the suite: confirm the
     * new base image does not share these issues, then remove
     * scripts/patch-wp-env.js and its postinstall entry in package.json.
     */
    public function test_patch_wp_env_still_needed(): void
    {
        if ( PHP_MAJOR_VERSION === 8 && PHP_MINOR_VERSION < 4 ) {
            $this->markTestSkipped( sprintf(
                'Running PHP %s — Debian Trixie patch still needed.',
                PHP_VERSION
            ) );
        }

        $this->markTestSkipped( sprintf(
            'Running PHP %s (8.4+). The scripts/patch-wp-env.js Debian Trixie workaround ' .
            'was written for the wordpress:php8.2 Docker image. ' .
            'Verify whether the new base image still needs it, then remove the patch ' .
            'and its postinstall entry in package.json if not.',
            PHP_VERSION
        ) );
    }

    /**
     * Fails on or after 2026-11-01 to remind us that PHP 8.2 reaches end of
     * life on 2026-12-08 — two months away at that point.
     *
     * When this fires: update composer.json (require php), .wp-env.json
     * (phpVersion), and the GitHub Actions matrix to drop 8.2 and require 8.3+.
     */
    public function test_php82_eol_not_approaching(): void
    {
        $warning_date = new \DateTimeImmutable( '2026-11-01' );
        $now          = new \DateTimeImmutable( 'now' );

        if ( $now < $warning_date ) {
            $this->markTestSkipped( sprintf(
                'PHP 8.2 EOL warning not active until %s.',
                $warning_date->format( 'Y-m-d' )
            ) );
        }

        $this->fail(
            'PHP 8.2 reaches end of life on 2026-12-08 (two months away). ' .
            'Update the minimum PHP version: composer.json (require php), ' .
            '.wp-env.json (phpVersion), and the GitHub Actions matrix.'
        );
    }

    /**
     * No test may call ReflectionProperty/ReflectionMethod::setAccessible().
     *
     * It has done nothing since PHP 8.1 — every property and method is already
     * reachable through Reflection — and PHP 8.5 deprecates it. The deprecation
     * notice counts as unexpected output, so PHPUnit marks the test RISKY, and
     * the suite exits non-zero on risky tests. Five stray calls turned a green
     * 907-test run into a failed CI build on the 8.5 matrix leg while passing
     * everywhere else.
     *
     * This guard exists because the failure is invisible below 8.5: nothing a
     * developer runs locally on 8.2-8.4 will catch a reintroduced call. Grepping
     * the sources is the only check that works on every version.
     */
    public function test_no_test_calls_the_deprecated_set_accessible(): void
    {
        $root    = dirname( __DIR__, 2 );
        $offends = array();

        $files = new \RecursiveIteratorIterator( new \RecursiveDirectoryIterator( $root ) );
        foreach ( $files as $file ) {
            if ( ! $file->isFile() || 'php' !== $file->getExtension() ) {
                continue;
            }

            $contents = (string) file_get_contents( $file->getPathname() );

            // Match the CALL, not this test's own prose about it.
            if ( preg_match( '/->\s*setAccessible\s*\(/', $contents ) ) {
                $offends[] = substr( $file->getPathname(), strlen( $root ) + 1 );
            }
        }

        $this->assertSame(
            array(),
            $offends,
            'setAccessible() is a no-op since PHP 8.1 and deprecated in 8.5, where the notice makes the test risky and fails the build. Delete the call — Reflection reaches private members without it.'
        );
    }
}
