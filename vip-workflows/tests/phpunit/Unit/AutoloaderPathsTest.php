<?php
/**
 * Autoloader path-naming guard.
 *
 * Ensures every PHP file under includes/ resolves through the custom autoloader
 * in vip-workflows.php on a case-sensitive filesystem (Linux/WPVIP). Without this
 * guard, a mismatched filename works on macOS but fatals in production.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use PHPUnit\Framework\TestCase;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use SplFileInfo;

require_once __DIR__ . '/../../../autoload-paths.php';

class AutoloaderPathsTest extends TestCase
{
    private const PLUGIN_ROOT = __DIR__ . '/../../../';

    /**
     * Files under includes/ that intentionally don't follow class-*.php
     * because they are not class files. These are loaded via explicit
     * require_once or are silent index guards, not the autoloader.
     */
    private const FILENAME_EXCEPTIONS = array(
        'index.php',
        'functions.php',
    );

    /**
     * Directories under includes/ whose immediate *.php children are
     * function-registration files (not classes), loaded via require_once
     * in vip-workflows.php. Files here are exempt from the class-*.php rule.
     */
    private const DIRECTORY_EXCEPTIONS = array(
        'includes/abilities/tools',
        'includes/abilities/agents',
    );

    /**
     * @return string[] Repo-relative POSIX paths.
     */
    private function php_files_under_includes(): array
    {
        $includes_root = realpath( self::PLUGIN_ROOT . 'includes' );

        $this->assertNotFalse( $includes_root, 'includes/ directory not found' );

        $files = array();
        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator( $includes_root, RecursiveDirectoryIterator::SKIP_DOTS )
        );

        foreach ( $iterator as $file ) {
            if ( ! $file instanceof SplFileInfo || ! $file->isFile() ) {
                continue;
            }

            if ( 'php' !== $file->getExtension() ) {
                continue;
            }

            $absolute = $file->getPathname();
            $relative = substr( $absolute, strlen( realpath( self::PLUGIN_ROOT ) ) + 1 );
            $relative = str_replace( DIRECTORY_SEPARATOR, '/', $relative );

            $files[] = $relative;
        }

        sort( $files );

        $this->assertNotEmpty( $files, 'expected at least one PHP file under includes/' );

        return $files;
    }

    public static function class_to_relative_path_cases(): array
    {
        return array(
            'standard class' => array(
                'VIPWorkflows\\Integrations\\GuidelineContextProvider',
                'integrations/class-guideline-context-provider.php',
            ),
            'acronym in class name' => array(
                'VIPWorkflows\\Integrations\\YouTubeTranscript',
                'integrations/class-you-tube-transcript.php',
            ),
            'acronym in nested namespace and class name' => array(
                'VIPWorkflows\\AI\\AiInference',
                'ai/class-ai-inference.php',
            ),
            // Illustrative (no live class required): documents how a leading
            // multi-letter acronym in the class name is lowercased as one run.
            'leading acronym in class name' => array(
                'VIPWorkflows\\Integrations\\AIMediaHelper',
                'integrations/class-ai-media-helper.php',
            ),
            'nested acronym directory and class' => array(
                'VIPWorkflows\\Ideation\\Assistants\\YouTubeVideoProvider',
                'ideation/assistants/class-you-tube-video-provider.php',
            ),
        );
    }

    public function test_no_uppercase_path_segments_under_includes(): void
    {
        $offenders = array();
        foreach ( $this->php_files_under_includes() as $file ) {
            if ( preg_match( '#/[A-Z]#', $file ) ) {
                $offenders[] = $file;
            }
        }

        $this->assertSame(
            array(),
            $offenders,
            "Found tracked paths under includes/ with uppercase segments. " .
            "These work on macOS but fatal on Linux. Rename them to lowercase:\n" .
            implode( "\n", $offenders )
        );
    }

    public function test_filenames_match_class_kebab_convention(): void
    {
        $offenders = array();
        foreach ( $this->php_files_under_includes() as $file ) {
            $basename = basename( $file );
            $directory = dirname( $file );

            if ( in_array( $basename, self::FILENAME_EXCEPTIONS, true ) ) {
                continue;
            }

            foreach ( self::DIRECTORY_EXCEPTIONS as $directory_exception ) {
                if ( str_starts_with( $file, $directory_exception . '/' ) ) {
                    continue 2;
                }
            }

            if ( preg_match( '/^class-[a-z0-9-]+\.php$/', $basename ) ) {
                continue;
            }

            $offenders[] = $file;
        }

        $this->assertSame(
            array(),
            $offenders,
            "Found tracked files under includes/ that don't match class-*.php. " .
            "The custom autoloader in vip-workflows.php expects this convention:\n" .
            implode( "\n", $offenders )
        );
    }

    public function test_class_file_paths_match_autoloader_algorithm(): void
    {
        $offenders = array();
        foreach ( $this->php_files_under_includes() as $file ) {
            $abs_path = self::PLUGIN_ROOT . $file;
            $contents = @file_get_contents( $abs_path );
            if ( false === $contents ) {
                continue;
            }

            if ( ! preg_match( '/^namespace\s+([^;]+);/m', $contents, $ns_match ) ) {
                continue;
            }
            if ( ! preg_match(
                '/^(?:abstract\s+|final\s+)?(?:class|interface|trait|enum)\s+([A-Za-z0-9_]+)/m',
                $contents,
                $cls_match
            ) ) {
                continue;
            }

            $namespace = trim( $ns_match[1] );
            $class_name = $cls_match[1];

            if ( strpos( $namespace, 'VIPWorkflows' ) !== 0 ) {
                continue;
            }
            if ( strpos( $namespace, 'VIPWorkflows\\Tests' ) === 0 ) {
                continue;
            }

            $fqcn = $namespace . '\\' . $class_name;
            $relative = \VIPWorkflows\class_to_relative_path( $fqcn );
            $expected = 'includes/' . $relative;

            if ( $file !== $expected ) {
                $offenders[] = sprintf(
                    "%s\n    declares %s\n    autoloader expects: %s",
                    $file,
                    $fqcn,
                    $expected
                );
            }
        }

        $this->assertSame(
            array(),
            $offenders,
            "Found classes whose file path doesn't match what the custom autoloader generates. " .
            "These load on macOS via case-insensitive FS or via Composer's classmap fallback, " .
            "but fatal on Linux without the classmap:\n\n" .
            implode( "\n\n", $offenders )
        );
    }

    /**
     * @dataProvider class_to_relative_path_cases
     */
    public function test_class_to_relative_path( string $class_name, string $expected ): void
    {
        $this->assertSame( $expected, \VIPWorkflows\class_to_relative_path( $class_name ) );
    }
}
