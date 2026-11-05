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
        $declared = self::reported_map_declarations( dirname( __DIR__, 3 ) . '/includes' );

        $this->assertNotEmpty( $declared['class'], 'The scan found no $reported maps at all, so it is not reading the source.' );

        $missing = array_diff( $declared['class'], ReportedDiagnostics::CLASSES );
        $this->assertSame(
            array(),
            array_values( $missing ),
            'These classes declare a static $reported map that ReportedDiagnostics::CLASSES does not reset.'
        );
    }

    /**
     * A trait's static is copied into every class that uses it, so the list
     * would have to name the consuming classes, which this scan cannot see
     * from the trait's own file. Rather than miss them, a trait-declared map
     * is refused outright.
     */
    public function test_no_trait_declares_a_reported_map(): void
    {
        $declared = self::reported_map_declarations( dirname( __DIR__, 3 ) . '/includes' );

        $this->assertSame(
            array(),
            $declared['trait'],
            'These traits declare a static $reported map. Declare it on each class that uses the trait instead, and add those classes to ReportedDiagnostics::CLASSES.'
        );
    }

    /**
     * The scan attributes each map to the class whose body declares it: every
     * class in a multi-class file, untyped declarations, either modifier order,
     * and a trait reported as a trait rather than missed.
     */
    public function test_scan_attributes_each_map_to_its_declaring_class(): void
    {
        $declared = self::reported_map_declarations( dirname( __DIR__, 2 ) . '/fixtures/reported-scan' );

        $this->assertSame(
            array(
                'ReportedScanFixture\\FinalAttributedReporter',
                'ReportedScanFixture\\FirstReporter',
                'ReportedScanFixture\\SecondReporter',
                'ReportedScanFixture\\StaticFirstReporter',
                'ReportedScanFixture\\UntypedReporter',
            ),
            $declared['class']
        );
        $this->assertSame( array( 'ReportedScanFixture\\ReporterTrait' ), $declared['trait'] );
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
     * Where static `$reported` maps are declared under a directory, read from
     * the source rather than loaded.
     *
     * Tokenized, so each property is attributed to the class, trait or enum
     * whose body declares it: every one in a multi-class file, whatever the
     * modifier order or type. A `$reported` inside a method (a parameter, a
     * `static::$reported` read) is not a declaration and is not counted.
     *
     * @return array{class: string[], trait: string[]} Fully qualified owner
     *               names, sorted, keyed by the kind of declaration that owns
     *               the map. Enums count as classes.
     */
    private static function reported_map_declarations( string $dir ): array
    {
        $found    = array(
            'class' => array(),
            'trait' => array(),
        );
        $iterator = new \RecursiveIteratorIterator( new \RecursiveDirectoryIterator( $dir, \FilesystemIterator::SKIP_DOTS ) );

        foreach ( $iterator as $file ) {
            if ( 'php' !== $file->getExtension() ) {
                continue;
            }

            foreach ( self::reported_map_owners( (string) file_get_contents( $file->getPathname() ) ) as $owner ) {
                $found[ $owner['kind'] ][] = $owner['name'];
            }
        }

        sort( $found['class'] );
        sort( $found['trait'] );
        return $found;
    }

    /**
     * The owners of the static `$reported` declarations in one file.
     *
     * @return array<int, array{kind: string, name: string}>
     */
    private static function reported_map_owners( string $source ): array
    {
        $tokens    = token_get_all( $source );
        $count     = count( $tokens );
        $namespace = '';
        $depth     = 0;
        $stack     = array(); // Open class-likes: kind, name, and the depth inside their body.
        $pending   = null;    // A class-like whose name is read and whose `{` is still to come.
        $owners    = array();

        for ( $i = 0; $i < $count; $i++ ) {
            $token = $tokens[ $i ];
            $id    = is_array( $token ) ? $token[0] : null;
            $text  = is_array( $token ) ? $token[1] : $token;

            if ( T_NAMESPACE === $id ) {
                $namespace = '';
                for ( $j = $i + 1; $j < $count; $j++ ) {
                    $next = $tokens[ $j ];
                    if ( ';' === $next || '{' === $next ) {
                        break;
                    }
                    if ( is_array( $next ) && in_array( $next[0], array( T_STRING, T_NAME_QUALIFIED, T_NS_SEPARATOR ), true ) ) {
                        $namespace .= $next[1];
                    }
                }
                continue;
            }

            if ( in_array( $id, array( T_CLASS, T_TRAIT, T_INTERFACE, T_ENUM ), true ) && ! self::is_class_constant_or_anonymous( $tokens, $i ) ) {
                for ( $j = $i + 1; $j < $count; $j++ ) {
                    if ( is_array( $tokens[ $j ] ) && T_STRING === $tokens[ $j ][0] ) {
                        $pending = array(
                            'kind' => T_TRAIT === $id ? 'trait' : 'class',
                            'name' => ( '' !== $namespace ? $namespace . '\\' : '' ) . $tokens[ $j ][1],
                        );
                        break;
                    }
                }
                continue;
            }

            if ( '{' === $text || T_CURLY_OPEN === $id || T_DOLLAR_OPEN_CURLY_BRACES === $id ) {
                ++$depth;
                if ( null !== $pending && '{' === $text ) {
                    $stack[] = $pending + array( 'depth' => $depth );
                    $pending = null;
                }
                continue;
            }

            if ( '}' === $text ) {
                if ( $stack && end( $stack )['depth'] === $depth ) {
                    array_pop( $stack );
                }
                --$depth;
                continue;
            }

            if ( T_VARIABLE === $id && '$reported' === $text && $stack && end( $stack )['depth'] === $depth && self::is_static_property( $tokens, $i ) ) {
                $owner    = end( $stack );
                $owners[] = array(
                    'kind' => $owner['kind'],
                    'name' => $owner['name'],
                );
            }
        }

        return $owners;
    }

    /**
     * Whether a `class` token is `Foo::class` or `new class`, neither of
     * which declares a named class.
     *
     * @param array<int, mixed> $tokens Tokens of the file.
     */
    private static function is_class_constant_or_anonymous( array $tokens, int $index ): bool
    {
        for ( $j = $index - 1; $j >= 0; $j-- ) {
            if ( is_array( $tokens[ $j ] ) && in_array( $tokens[ $j ][0], array( T_WHITESPACE, T_COMMENT, T_DOC_COMMENT ), true ) ) {
                continue;
            }
            return is_array( $tokens[ $j ] ) && in_array( $tokens[ $j ][0], array( T_DOUBLE_COLON, T_NEW ), true );
        }

        return false;
    }

    /**
     * Whether the variable at `$index`, directly in a class-like body, is a
     * static property declaration rather than a method's parameter.
     *
     * Reads back to the start of the statement.
     *
     * @param array<int, mixed> $tokens Tokens of the file.
     */
    private static function is_static_property( array $tokens, int $index ): bool
    {
        $static = false;
        for ( $j = $index - 1; $j >= 0; $j-- ) {
            $token = $tokens[ $j ];
            if ( ';' === $token || '{' === $token || '}' === $token ) {
                break;
            }
            if ( is_array( $token ) && in_array( $token[0], array( T_FUNCTION, T_FN ), true ) ) {
                return false;
            }
            if ( is_array( $token ) && T_STATIC === $token[0] ) {
                $static = true;
            }
        }

        return $static;
    }
}
