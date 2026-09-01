<?php
/**
 * Mechanical guards for docs/guides/copy-standard.md.
 *
 * Only the rules a machine can check without judgement live here. Sentence
 * case, helper-text length and whether an error offers a way forward are
 * review questions, not assertions — a regex that tried would fail on
 * `Parse.ly`, on core's own `Pending Review`, and on every legitimate
 * exception the standard already lists.
 *
 * What is checked is what has no exceptions:
 *
 * - `workflow sequence`, the compound that is neither of the two names.
 * - `Please`, which the plugin does not say.
 * - `...` where `…` belongs, the one typography rule that drifted by language.
 * - `You do not have permission`, where core says `Sorry, you are not allowed`.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use PHPUnit\Framework\TestCase as PHPUnitTestCase;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;

class CopyStandardTest extends PHPUnitTestCase
{
    private const PLUGIN_ROOT = __DIR__ . '/../../../';

    private const OWN_DIRS = array( 'includes', 'src' );

    private const EXTENSIONS = array( 'php', 'js', 'jsx' );

    private const SKIPPED_DIRS = array( 'node_modules', 'vendor', 'build', 'dist' );

    /**
     * Translatable string literals, as one blob per file.
     *
     * Only the text inside `__()`, `_e()`, `_x()`, `_n()` and the `esc_*`
     * variants: a rule about what the plugin *says* must not fire on a
     * variable name, a CSS class, or a code comment discussing the rule.
     *
     * @return array<string, string[]> Relative path => translatable strings.
     */
    private function translatable_strings(): array
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

            foreach ( new RecursiveIteratorIterator( $directories ) as $file ) {
                if ( ! $file->isFile() ) {
                    continue;
                }
                if ( ! in_array( strtolower( $file->getExtension() ), self::EXTENSIONS, true ) ) {
                    continue;
                }

                $contents = (string) file_get_contents( $file->getPathname() );
                $relative = $dir . '/' . str_replace( $root . '/', '', $file->getPathname() );

                $matches = array();
                preg_match_all(
                    "/(?:esc_html__|esc_html_e|esc_attr__|esc_attr_e|_ex|_nx|__|_e|_x|_n)\(\s*'((?:[^'\\\\]|\\\\.)*)'/",
                    $contents,
                    $matches
                );

                if ( ! empty( $matches[1] ) ) {
                    $found[ $relative ] = $matches[1];
                }
            }
        }

        return $found;
    }

    /**
     * This plugin, plus each sibling beside it.
     *
     * Discovered rather than listed, for the reason SequenceTerminologyTest
     * gives: a hardcoded list goes stale the moment a sibling is added or
     * removed, and reads as passing while looking at nothing.
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

    /**
     * Collect every translatable string matching a pattern.
     *
     * @param  string $pattern Regex applied to each string.
     * @return array<string, string[]> Relative path => offending strings.
     */
    private function offenders( string $pattern ): array
    {
        $found = array();

        foreach ( $this->translatable_strings() as $relative => $strings ) {
            foreach ( $strings as $string ) {
                if ( 1 === preg_match( $pattern, $string ) ) {
                    $found[ $relative ][] = $string;
                }
            }
        }

        return $found;
    }

    public function test_no_workflow_sequence_compound(): void
    {
        $offenders = $this->offenders( '/\bworkflow\s+sequences?\b/i' );

        $this->assertSame(
            array(),
            $offenders,
            "The definition a post follows is a workflow. `sequence` survives only for "
                . "phase sequences, parameter names and identifiers — never as a compound.\n"
                . print_r( $offenders, true )
        );
    }

    public function test_no_please(): void
    {
        $offenders = $this->offenders( '/\bplease\b/i' );

        $this->assertSame(
            array(),
            $offenders,
            "The plugin does not beg. `Please try again` is `Try again`.\n"
                . print_r( $offenders, true )
        );
    }

    public function test_ellipsis_is_a_character_not_three_periods(): void
    {
        $offenders = $this->offenders( '/\.\.\./' );

        $this->assertSame(
            array(),
            $offenders,
            "Use `…`, not three periods. The two used to split by language: PHP wrote "
                . "`Processing...` while JS wrote `Processing…`.\n"
                . print_r( $offenders, true )
        );
    }

    public function test_permission_errors_use_core_wording(): void
    {
        $offenders = $this->offenders( '/\byou (?:do not|don\'t) have permission\b/i' );

        $this->assertSame(
            array(),
            $offenders,
            "Core writes `Sorry, you are not allowed to …`, and that is what "
                . "screen-reader users hear from every other plugin.\n"
                . print_r( $offenders, true )
        );
    }
}
