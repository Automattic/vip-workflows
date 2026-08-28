<?php
/**
 * Execute-path coverage for the Import Sequence ability.
 *
 * Runs in the integration suite so execute_import_sequence() exercises the real
 * SequencesController::import_sequence() path against a booted WordPress + DB.
 *
 * @package VIPWorkflow\Tests\Integration
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Integration;

use VIPWorkflow\Sequences\SequenceRepository;

require_once dirname( __DIR__, 3 ) . '/includes/abilities/tools/import-sequence.php';

/**
 * Tests the Import Sequence ability execute callback end to end.
 */
class ImportSequenceAbilityTest extends TestCase
{
	public function set_up(): void
	{
		parent::set_up();
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
	}

	private function sample_json(): array
	{
		return array(
			'type'        => 'workflow',
			'name'        => 'Imported Flow',
			'description' => 'Imported via ability.',
			'config'      => array(
				'post_types' => array( 'post' ),
				'statuses'   => array(
					array( 'key' => 'draft', 'label' => 'Draft' ),
					array( 'key' => 'done', 'label' => 'Done', 'is_terminal' => true ),
				),
			),
		);
	}

	public function test_imports_a_workflow_sequence_as_draft(): void
	{
		$result = \VIPWorkflow\Abilities\Tools\execute_import_sequence(
			array( 'sequence_json' => $this->sample_json() )
		);

		$this->assertTrue( $result['success'] );
		$this->assertGreaterThan( 0, $result['sequence_id'] );
		$this->assertSame( 'workflow', $result['type'] );
		// Imported sequences are created as drafts.
		$this->assertSame( 'draft', $result['status'] );

		$sequence = ( new SequenceRepository() )->find( $result['sequence_id'] );
		$this->assertNotNull( $sequence );
		$this->assertSame( 'draft', $sequence->status );
	}

	public function test_name_override_is_applied(): void
	{
		$result = \VIPWorkflow\Abilities\Tools\execute_import_sequence(
			array(
				'sequence_json' => $this->sample_json(),
				'name'           => 'Renamed On Import',
			)
		);

		$this->assertTrue( $result['success'] );
		$this->assertSame( 'Renamed On Import', $result['name'] );
	}

	public function test_missing_sequence_json_returns_error(): void
	{
		$result = \VIPWorkflow\Abilities\Tools\execute_import_sequence( array() );

		$this->assertWPError( $result );
		$this->assertSame( 'missing_sequence_json', $result->get_error_code() );
	}

	public function test_invalid_type_is_rejected_by_the_controller(): void
	{
		$json         = $this->sample_json();
		$json['type'] = 'bogus';

		$result = \VIPWorkflow\Abilities\Tools\execute_import_sequence(
			array( 'sequence_json' => $json )
		);

		$this->assertWPError( $result );
		$this->assertSame( 'invalid_sequence_type', $result->get_error_code() );
	}
}
