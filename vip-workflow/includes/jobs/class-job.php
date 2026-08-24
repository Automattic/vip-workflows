<?php
/**
 * Abstract Job class.
 *
 * Base class for all scheduled jobs. Third-party plugins can extend this
 * to register their own jobs with the workflow system.
 *
 * @package VIPWorkflow
 */

declare( strict_types=1 );

namespace VIPWorkflow\Jobs;

/**
 * Abstract base class for scheduled jobs.
 */
abstract class Job {


	/**
	 * Option name prefix for job settings.
	 */
	private const OPTION_PREFIX = 'vip_workflow_job_';

	/**
	 * Get the unique job ID.
	 *
	 * @return string Unique identifier (e.g., 'sla_check', 'airtable_sync').
	 */
	abstract public function get_id(): string;

	/**
	 * Get the job name for display.
	 *
	 * @return string Human-readable name.
	 */
	abstract public function get_name(): string;

	/**
	 * Get the job description.
	 *
	 * @return string Description of what this job does.
	 */
	abstract public function get_description(): string;

	/**
	 * Get the run interval in seconds.
	 *
	 * @return int Interval between runs. Use constants like HOUR_IN_SECONDS.
	 */
	abstract public function get_interval(): int;

	/**
	 * Run the job.
	 *
	 * @return array Results data (passed to completion action).
	 */
	abstract public function run(): array;

	/**
	 * Get the job icon.
	 *
	 * @return string Icon slug from the set in src/admin/components/ideation/assistant-icon.js.
	 */
	public function get_icon(): string {
		return 'cog';
	}

	/**
	 * Get the specific time of day to run (optional).
	 *
	 * Override this to schedule the job at a specific time.
	 *
	 * @return string|null Time in 'HH:MM:SS' format, or null for interval-based scheduling.
	 */
	public function get_scheduled_time(): ?string {
		return null;
	}

	/**
	 * Check if this job has configurable settings.
	 *
	 * Override to return true if your job needs settings.
	 *
	 * @return bool
	 */
	public function has_settings(): bool {
		return false;
	}

	/**
	 * Sanitize settings input.
	 *
	 * Override this if has_settings() returns true.
	 *
	 * @param  array $input Raw input from form.
	 * @return array Sanitized settings.
	 */
	public function sanitize_settings( array $input ): array {
		return $input;
	}

	/**
	 * Get the action hook name for this job.
	 *
	 * @return string WordPress action hook name.
	 */
	public function get_hook(): string {
		return 'vip_workflow_job_' . $this->get_id();
	}

	/**
	 * Get the completion action hook name.
	 *
	 * @return string WordPress action hook name fired after job completes.
	 */
	public function get_completion_hook(): string {
		return $this->get_hook() . '_complete';
	}

	/**
	 * Execute the job and fire completion hook.
	 *
	 * This is called by the scheduler. It runs the job and fires the completion action.
	 */
	public function execute(): void {
		$results = $this->run();
		do_action( $this->get_completion_hook(), $results );
	}

	// =========================================================================
	// Settings Methods
	// =========================================================================

	/**
	 * Get the WordPress option name for this job's settings.
	 *
	 * @return string Option name (e.g., 'vip_workflow_job_airtable').
	 */
	public function get_option_name(): string {
		return self::OPTION_PREFIX . $this->get_id();
	}

	/**
	 * Get stored settings for this job.
	 *
	 * @return array Job settings.
	 */
	public function get_settings(): array {
		return get_option( $this->get_option_name(), array() );
	}

	/**
	 * Update settings for this job.
	 *
	 * @param  array $settings Settings to save.
	 * @return bool True on success.
	 */
	public function update_settings( array $settings ): bool {
		return update_option( $this->get_option_name(), $settings, false );
	}

	/**
	 * Register this job's WordPress option.
	 * Called automatically by the scheduler.
	 */
	public function register_option(): void {
		if ( ! $this->has_settings() ) {
			return;
		}

		register_setting(
			'vip_workflow_integrations',
			$this->get_option_name(),
			array(
				'type'              => 'array',
				'sanitize_callback' => array( $this, 'sanitize_settings' ),
				'default'           => array(),
			)
		);
	}

	// =========================================================================
	// Display Methods
	// =========================================================================

	/**
	 * Format interval for display.
	 *
	 * @return string Human-readable interval.
	 */
	public function get_interval_text(): string {
		$seconds = $this->get_interval();

		if ( $seconds < HOUR_IN_SECONDS ) {
			$minutes = $seconds / MINUTE_IN_SECONDS;
			return sprintf(
			/* translators: %d: number of minutes */
				_n( 'Every %d minute', 'Every %d minutes', $minutes, 'vip-workflow' ),
				$minutes
			);
		}

		if ( $seconds < DAY_IN_SECONDS ) {
			$hours = $seconds / HOUR_IN_SECONDS;
			if ( 1.0 === $hours ) {
				return __( 'Hourly', 'vip-workflow' );
			}
			return sprintf(
			/* translators: %d: number of hours */
				__( 'Every %d hours', 'vip-workflow' ),
				$hours
			);
		}

		return __( 'Daily', 'vip-workflow' );
	}

	/**
	 * Convert job to array for REST API.
	 *
	 * @return array Job data.
	 */
	public function to_array(): array {
		return array(
			'id'             => $this->get_id(),
			'name'           => $this->get_name(),
			'description'    => $this->get_description(),
			'icon'           => $this->get_icon(),
			'interval'       => $this->get_interval(),
			'interval_text'  => $this->get_interval_text(),
			'scheduled_time' => $this->get_scheduled_time(),
			'has_settings'   => $this->has_settings(),
			'settings'       => $this->has_settings() ? $this->get_settings() : array(),
		);
	}
}
