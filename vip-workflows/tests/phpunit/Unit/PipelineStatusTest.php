<?php
/**
 * Pipeline-status parity guard.
 *
 * A story's pipeline status is declared twice — once in PHP
 * (VIPWorkflow\Story\Story, which owns the vocabulary and registers a post
 * status for each) and once in JS (src/admin/utils/pipeline-status.js, which
 * the My Ideation list and the ideation landing's pipeline table draw from).
 * Neither language can read the other's copy without a build step, so this test
 * reads the JS file and asserts the two agree.
 *
 * It exists because they had already drifted: the JS copy knew four of the six
 * statuses — so a story in `refresh` or `archived` rendered its raw slug and
 * could not be filtered for — and it called `editorial` "In Editorial" where
 * PHP calls it "Editorial".
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use VIPWorkflow\Story\Story;

class PipelineStatusTest extends TestCase
{
    private const PIPELINE_JS = __DIR__ . '/../../../src/admin/utils/pipeline-status.js';

    /**
     * PIPELINE_STATUSES from the JS module, as slug => label, in source order.
     *
     * @return array<string, string>
     */
    private function js_statuses(): array
    {
        $source = file_get_contents( self::PIPELINE_JS );

        $this->assertNotFalse( $source, 'src/admin/utils/pipeline-status.js could not be read' );

        $matched = preg_match(
            '/export const PIPELINE_STATUSES = \{(.*?)\n\};/s',
            (string) $source,
            $block
        );

        $this->assertSame( 1, $matched, 'PIPELINE_STATUSES object not found in pipeline-status.js' );

        // Each entry reads `slug: { label: __( 'Name', 'vip-workflow' ), … }`,
        // with the label possibly on its own line when prettier wraps it.
        preg_match_all(
            "/(\w+):\s*\{\s*label:\s*__\(\s*'([^']+)'/s",
            $block[1],
            $entries,
            PREG_SET_ORDER
        );

        $this->assertNotEmpty( $entries, 'PIPELINE_STATUSES declares no statuses' );

        $statuses = array();
        foreach ( $entries as $entry ) {
            $statuses[ $entry[1] ] = $entry[2];
        }

        return $statuses;
    }

    /**
     * Same slugs, same labels, same order. `assertSame` on two associative
     * arrays compares order too, which is what keeps the filter's option list
     * reading as the pipeline rather than as an arbitrary set.
     */
    public function test_js_statuses_match_the_php_vocabulary(): void
    {
        $this->assertSame(
            Story::statuses(),
            $this->js_statuses(),
            'Story::statuses() and PIPELINE_STATUSES in pipeline-status.js have drifted apart'
        );
    }

    /**
     * Every status constant is in the list. A seventh added to the class but
     * not to `statuses()` would register no post status and reach the admin as
     * a raw slug.
     */
    public function test_every_status_constant_is_declared(): void
    {
        $constants = array(
            Story::STATUS_IDEATION,
            Story::STATUS_EDITORIAL,
            Story::STATUS_PUBLISHED,
            Story::STATUS_MONITORING,
            Story::STATUS_REFRESH,
            Story::STATUS_ARCHIVED,
        );

        $this->assertSame( $constants, array_keys( Story::statuses() ) );
    }
}
