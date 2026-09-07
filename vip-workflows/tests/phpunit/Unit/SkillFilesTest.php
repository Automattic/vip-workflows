<?php
/**
 * Skill-file rename guards for the Assistants-to-Agents rename.
 *
 * The admin maps a skill-type key to a SKILL.md path and file_exists-guards the
 * read, so a wrong path makes the download silently disappear with no error.
 * These tests pin the filesystem invariants the rename depends on: the new
 * agent skill resolves, the old assistant directory is gone, and the SKILL.md
 * frontmatter/convention reflect the rename.
 *
 * @package VIPWorkflows\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflows\Tests\Unit;

/**
 * Tests for the renamed skill files on disk.
 */
class SkillFilesTest extends TestCase
{
	/**
	 * Plugin root (tests/phpunit/Unit -> plugin root).
	 */
	private function plugin_dir(): string
	{
		return dirname( __DIR__, 3 );
	}

	public function test_all_mapped_skill_files_resolve(): void
	{
		// Mirrors the map in Admin::load_skill_files(); a missing path here is a
		// silent download failure in production.
		$expected = array(
			'skills/create-agent/SKILL.md',
			'skills/create-tool/SKILL.md',
			'skills/create-notification-channel/SKILL.md',
		);

		foreach ( $expected as $relative ) {
			$this->assertFileExists(
				$this->plugin_dir() . '/' . $relative,
				"Mapped skill file is missing: {$relative}"
			);
		}
	}

	public function test_old_assistant_skill_directory_is_removed(): void
	{
		$this->assertDirectoryDoesNotExist(
			$this->plugin_dir() . '/skills/create-assistant',
			'The pre-rename skills/create-assistant directory should no longer exist.'
		);
	}

	public function test_agent_skill_frontmatter_uses_new_slug(): void
	{
		$contents = file_get_contents( $this->plugin_dir() . '/skills/create-agent/SKILL.md' );

		$this->assertStringContainsString( 'name: create-vip-workflows-agent', $contents );
		$this->assertStringNotContainsString( 'create-vip-workflows-assistant', $contents );
	}

	public function test_agent_skill_uses_agent_plugin_naming_convention(): void
	{
		$contents = file_get_contents( $this->plugin_dir() . '/skills/create-agent/SKILL.md' );

		// The renamed extension-plugin convention.
		$this->assertStringContainsString( 'workflow-agent-', $contents );
		$this->assertStringNotContainsString( 'workflow-assistant-', $contents );
	}

	public function test_agent_skill_documents_stage_capable_agents(): void
	{
		$contents = file_get_contents( $this->plugin_dir() . '/skills/create-agent/SKILL.md' );

		$this->assertStringContainsString( 'stage_eligible', $contents );
		$this->assertStringContainsString( 'supports', $contents );
		$this->assertStringContainsString( 'capabilities', $contents );
		$this->assertStringContainsString( 'available_in_ai_stage', $contents );
		$this->assertStringNotContainsString( 'Mirror one of those for a new stage agent', $contents );
	}

	public function test_agent_skill_teaches_binary_stage_outcomes(): void
	{
		$contents = file_get_contents( $this->plugin_dir() . '/skills/create-agent/SKILL.md' );

		// Stage agents make a binary editorial judgment: the skill teaches only
		// pass|fail and must not reintroduce the retired warning outcome.
		$this->assertStringContainsString( "array( 'pass', 'fail' )", $contents );
		$this->assertStringNotContainsString( 'warning', $contents );
	}
}
