<?php
/**
 * Unit tests for agent-attributed revisions (Agent stage verification).
 *
 * A stage agent's content write is performed while impersonating a capable
 * human, so the revision is natively authored by that human. The runner tags
 * the revision with the acting ability id as it is saved, then relabels its
 * author in the core revisions UI to credit the agent.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflows\Workflow\StageAgentRunner;

/**
 * Tests for StageAgentRunner::stamp_agent_revision() and label_agent_revision().
 */
class StageAgentRevisionAttributionTest extends TestCase
{
    protected function tearDown(): void
    {
        // Never leave the process-global acting id set between tests.
        $this->set_acting_ability( '' );
        parent::tearDown();
    }

    /**
     * Set the runner's private static $acting_ability_id (normally set only
     * around execute()).
     *
     * @param string $ability_id Ability id, or '' for "no agent acting".
     */
    private function set_acting_ability( string $ability_id ): void
    {
        $prop = ( new \ReflectionClass( StageAgentRunner::class ) )->getProperty( 'acting_ability_id' );
        $prop->setValue( null, $ability_id );
    }

    /**
     * While an agent is executing, a saved revision is tagged with the acting
     * ability id.
     */
    public function test_stamps_revision_while_agent_acting(): void
    {
        $this->set_acting_ability( 'vip-workflows/copy-edit' );

        Functions\expect( 'update_post_meta' )
            ->once()
            ->with( 4242, StageAgentRunner::AGENT_REVISION_META, 'vip-workflows/copy-edit' );

        ( new StageAgentRunner() )->stamp_agent_revision( 4242 );
    }

    /**
     * A revision saved outside an agent run (a human edit) is never tagged.
     */
    public function test_does_not_stamp_revision_for_human_edit(): void
    {
        $this->set_acting_ability( '' );

        Functions\expect( 'update_post_meta' )->never();

        ( new StageAgentRunner() )->stamp_agent_revision( 4242 );
    }

    /**
     * A tagged revision's author label is replaced with the agent's name,
     * marked "(agent)".
     */
    public function test_relabels_tagged_revision_author(): void
    {
        Functions\when( 'get_post_meta' )->justReturn( 'vip-workflows/copy-edit' );
        // No registered ability object -> Actor::name_for falls back to the id.
        Functions\when( 'wp_get_ability' )->justReturn( null );

        $data = ( new StageAgentRunner() )->label_agent_revision(
            array( 'author' => 'Ada Lovelace' ),
            (object) array( 'ID' => 4242 )
        );

        $this->assertSame( 'vip-workflows/copy-edit (agent)', $data['author'] );
    }

    /**
     * An untagged revision (human edit) passes through unchanged.
     */
    public function test_leaves_untagged_revision_untouched(): void
    {
        Functions\when( 'get_post_meta' )->justReturn( '' );

        $data = ( new StageAgentRunner() )->label_agent_revision(
            array( 'author' => 'Ada Lovelace' ),
            (object) array( 'ID' => 4242 )
        );

        $this->assertSame( 'Ada Lovelace', $data['author'] );
    }
}
