<?php
/**
 * Every `$reported` de-duplication map is reset by both test bases.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use VIPWorkflows\Tests\ReportedDiagnostics;

/**
 * A map the shared list misses silently swallows a repeat fault in a later
 * test, and the test that expected it still passes. These checks make adding a
 * map without listing it, or a base that stops using the list, fail instead.
 */
class ReportedDiagnosticsCoverageTest extends TestCase
{
    public function test_every_class_declaring_a_reported_map_is_listed(): void
    {
        $declared = self::classes_declaring_reported_map( dirname( __DIR__, 3 ) . '/includes' );

        $this->assertNotEmpty( $declared, 'The scan found no $reported maps at all, so it is not reading the source.' );

        $missing = array_diff( $declared, ReportedDiagnostics::CLASSES );
        $this->assertSame(
            array(),
            array_values( $missing ),
            'These classes declare a static $reported map that ReportedDiagnostics::CLASSES does not reset.'
        );
    }

    public function test_every_listed_class_has_a_static_reported_map(): void
    {
        foreach ( ReportedDiagnostics::CLASSES as $class ) {
            $property = new \ReflectionProperty( $class, 'reported' );
            $this->assertTrue( $property->isStatic(), "{$class}::\$reported is not static." );
        }
    }

    /**
     * @dataProvider base_files
     */
    public function test_each_base_resets_through_the_shared_list( string $path ): void
    {
        $source = (string) file_get_contents( $path );

        $this->assertStringContainsString( 'ReportedDiagnostics::reset()', $source );
        $this->assertDoesNotMatchRegularExpression(
            "/ReflectionProperty\(\s*[^,]+,\s*'reported'\s*\)/",
            $source,
            'A base resets a $reported map by hand; add the class to ReportedDiagnostics::CLASSES instead.'
        );
    }

    public function test_reset_empties_every_map(): void
    {
        foreach ( ReportedDiagnostics::CLASSES as $class ) {
            ( new \ReflectionProperty( $class, 'reported' ) )->setValue( null, array( 'left over' => true ) );
        }

        ReportedDiagnostics::reset();

        foreach ( ReportedDiagnostics::CLASSES as $class ) {
            $this->assertSame( array(), ( new \ReflectionProperty( $class, 'reported' ) )->getValue() );
        }
    }

    /**
     * @return array<string, array{string}>
     */
    public static function base_files(): array
    {
        $root = dirname( __DIR__ );

        return array(
            'unit'        => array( $root . '/Unit/TestCase.php' ),
            'integration' => array( $root . '/Integration/TestCase.php' ),
        );
    }

    /**
     * Fully qualified names of the classes under a directory that declare a
     * static `$reported` property, read from the source rather than loaded.
     *
     * @return string[]
     */
    private static function classes_declaring_reported_map( string $dir ): array
    {
        $classes  = array();
        $iterator = new \RecursiveIteratorIterator( new \RecursiveDirectoryIterator( $dir, \FilesystemIterator::SKIP_DOTS ) );

        foreach ( $iterator as $file ) {
            if ( 'php' !== $file->getExtension() ) {
                continue;
            }

            $source = (string) file_get_contents( $file->getPathname() );
            if ( ! preg_match( '/^\s*(?:(?:private|protected|public)\s+)?static\s+(?:\??[\w\\\\]+\s+)?\$reported\b/m', $source ) ) {
                continue;
            }

            preg_match( '/^namespace\s+([\w\\\\]+)\s*;/m', $source, $namespace );
            preg_match( '/^\s*(?:final\s+|abstract\s+)*class\s+(\w+)/m', $source, $class );
            if ( ! $class ) {
                continue;
            }

            $classes[] = ( $namespace ? $namespace[1] . '\\' : '' ) . $class[1];
        }

        sort( $classes );
        return $classes;
    }
}
