<?php
/**
 * The word `blueprint` does not come back.
 *
 * It used to be this plugin's name for a sequence, and it collided with
 * WordPress Playground's own Blueprints — which this repo also ships, at
 * blueprint.json, for the demo environment. Two different things called the
 * same thing in one codebase is the confusion the rename removed.
 *
 * Shipping code has one legitimate mention: the migration that converts the old
 * table and meta key has to name what it is converting from.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use PHPUnit\Framework\TestCase as PHPUnitTestCase;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;

class SequenceTerminologyTest extends PHPUnitTestCase
{
    private const PLUGIN_ROOT = __DIR__ . '/../../../';

    /**
     * The migration names the old table and meta key on purpose.
     */
    private const ALLOWED = array(
        'includes/database/class-schema.php',
    );

    /**
     * This plugin's own shipping directories.
     *
     * The sibling extension plugins are scanned too, but they are discovered
     * rather than listed — see scanned_dirs(). A hardcoded list went stale the
     * moment main deleted workflow-github: the entry silently matched nothing,
     * and the list had only ever named four of the fourteen siblings, so the
     * guard read as passing while barely looking.
     */
    private const OWN_DIRS = array(
        'includes',
        'src',
    );

    /**
     * Every directory the guard walks: this plugin, plus each sibling beside it.
     *
     * @return string[] Paths relative to PLUGIN_ROOT.
     */
    private function scanned_dirs(): array
    {
        $siblings = glob( self::PLUGIN_ROOT . '../workflow-*', GLOB_ONLYDIR );
        $siblings = false === $siblings ? array() : $siblings;

        return array_merge(
            self::OWN_DIRS,
            array_map(
                static fn( string $path ): string => '../' . basename( $path ),
                $siblings
            )
        );
    }

    private const EXTENSIONS = array( 'php', 'js', 'jsx', 'css' );

    /**
     * Never walked: dependency trees and build output, which are neither ours
     * to name nor small enough to scan.
     */
    private const SKIPPED_DIRS = array( 'node_modules', 'vendor', 'build', 'dist' );

    /**
     * @return array<string, string[]> Relative path => offending lines.
     */
    private function offenders(): array
    {
        $found = array();

        foreach ( $this->scanned_dirs() as $dir ) {
            $root = realpath( self::PLUGIN_ROOT . $dir );
            if ( false === $root ) {
                continue;
            }

            $directories = new \RecursiveCallbackFilterIterator(
                new RecursiveDirectoryIterator( $root, RecursiveDirectoryIterator::SKIP_DOTS ),
                static function ( $current ): bool {
                    return ! $current->isDir()
                        || ! in_array( $current->getFilename(), self::SKIPPED_DIRS, true );
                }
            );

            $files = new RecursiveIteratorIterator( $directories );
            foreach ( $files as $file ) {
                if ( ! $file->isFile() ) {
                    continue;
                }
                if ( ! in_array( strtolower( $file->getExtension() ), self::EXTENSIONS, true ) ) {
                    continue;
                }

                $relative = $dir . '/' . str_replace( $root . '/', '', $file->getPathname() );
                if ( in_array( $relative, self::ALLOWED, true ) ) {
                    continue;
                }

                $contents = (string) file_get_contents( $file->getPathname() );
                if ( false === stripos( $contents, 'blueprint' ) ) {
                    continue;
                }

                foreach ( explode( "\n", $contents ) as $number => $line ) {
                    if ( false !== stripos( $line, 'blueprint' ) ) {
                        $found[ $relative ][] = ( $number + 1 ) . ': ' . trim( $line );
                    }
                }
            }
        }

        return $found;
    }

    public function test_shipping_code_says_sequence_not_blueprint(): void
    {
        $offenders = $this->offenders();

        $this->assertSame(
            array(),
            $offenders,
            "The plugin's own concept is a sequence. `blueprint` belongs to WordPress "
                . "Playground, which this repo also ships.\n"
                . print_r( $offenders, true )
        );
    }

    /**
     * Identifiers the rename removed. Referencing one is a fatal, not a wording
     * slip, so this is checked everywhere — tests included.
     *
     * @var string[]
     */
    private const REMOVED_SYMBOLS = array(
        'VIPWorkflow\\Blueprints',
        'BlueprintRepository',
        'BlueprintsController',
        'BlueprintCptRestController',
        'BLUEPRINT_META_KEY',
    );

    /**
     * A dead class reference anywhere, including tests.
     *
     * The guard above deliberately skips `tests/`, because a test that asserts
     * the old word is ABSENT has to name it — `assertArrayNotHasKey( 'blueprint_id',
     * ... )` is correct and must keep reading that way. These are different: they
     * are CamelCase identifiers of classes that no longer exist, which no negative
     * assertion spells, and which fail only when the file is executed.
     *
     * This is not hypothetical. MetadataFieldSanitizationTest arrived on main
     * during this rename holding `VIPWorkflow\Blueprints\BlueprintRepository`,
     * passed the word guard because tests are not scanned, and took the
     * integration suite down with "Class not found" three tests at a time.
     */
    public function test_no_file_references_a_class_the_rename_removed(): void
    {
        $offenders = array();

        foreach ( array( 'includes', 'src', 'tests' ) as $dir ) {
            $root = realpath( self::PLUGIN_ROOT . $dir );
            if ( false === $root ) {
                continue;
            }

            $directories = new \RecursiveCallbackFilterIterator(
                new RecursiveDirectoryIterator( $root, RecursiveDirectoryIterator::SKIP_DOTS ),
                static function ( $current ): bool {
                    return ! $current->isDir()
                        || ! in_array( $current->getFilename(), self::SKIPPED_DIRS, true );
                }
            );

            foreach ( new RecursiveIteratorIterator( $directories ) as $file ) {
                if ( ! $file->isFile() ) {
                    continue;
                }
                if ( ! in_array( strtolower( $file->getExtension() ), self::EXTENSIONS, true ) ) {
                    continue;
                }
                // This file names every removed symbol by definition.
                if ( __FILE__ === $file->getPathname() ) {
                    continue;
                }

                $contents = (string) file_get_contents( $file->getPathname() );
                foreach ( self::REMOVED_SYMBOLS as $symbol ) {
                    if ( false !== strpos( $contents, $symbol ) ) {
                        $offenders[ $dir . '/' . str_replace( $root . '/', '', $file->getPathname() ) ][] = $symbol;
                    }
                }
            }
        }

        $this->assertSame(
            array(),
            $offenders,
            "These name a class the rename removed, so they fatal when executed.\n"
                . print_r( $offenders, true )
        );
    }

    /**
     * The guard walks what it claims to walk.
     *
     * Discovery can fail open in a way a hardcoded list cannot: if the glob
     * matches nothing, offenders() iterates an almost-empty list and every
     * assertion above passes without reading a sibling plugin. The previous list
     * failed this way quietly — it named four siblings, one of which had been
     * deleted, out of fourteen present.
     */
    public function test_the_guard_scans_this_plugin_and_every_sibling(): void
    {
        $dirs = $this->scanned_dirs();

        foreach ( self::OWN_DIRS as $own ) {
            $this->assertContains( $own, $dirs );
        }

        $siblings = array_values( array_filter( $dirs, static fn( string $d ): bool => str_starts_with( $d, '../workflow-' ) ) );

        $this->assertNotEmpty(
            $siblings,
            'The sibling glob found nothing, so the guard is reading less than it appears to.'
        );

        foreach ( $dirs as $dir ) {
            $this->assertDirectoryExists(
                self::PLUGIN_ROOT . $dir,
                "The guard names a directory that is not there, so it silently scans nothing for it: {$dir}"
            );
        }
    }

    /**
     * The allowance is real, so the guard cannot pass by pointing at nothing.
     */
    public function test_the_allowed_file_exists(): void
    {
        foreach ( self::ALLOWED as $relative ) {
            $this->assertFileExists( self::PLUGIN_ROOT . $relative );
        }
    }
}
