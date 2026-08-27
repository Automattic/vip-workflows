<?php
/**
 * Job Scheduler - Action Scheduler integration.
 *
 * @package VIPWorkflow
 */

declare( strict_types=1 );

namespace VIPWorkflow\Jobs;

use VIPWorkflow\ModuleInterface;

/**
 * Manages scheduled background jobs using Action Scheduler.
 *
 * Jobs can be registered by plugins using the 'vip_workflow_register_jobs' hook.
 */
class JobScheduler implements ModuleInterface {


	/**
	 * Get the identifier.
	 *
	 * @inheritDoc
	 */
	public function get_id(): string {
		return 'job-scheduler';
	}

	/**
	 * Registered jobs.
	 *
	 * @var array<string, Job>
	 */
	private array $jobs = array();

	/**
	 * Whether the scheduler has been initialized.
	 *
	 * @var bool
	 */
	private bool $initialized = false;

	/**
	 * Initialize the job scheduler.
	 */
	public function init(): void {
		if ( $this->initialized ) {
			return;
		}

		// Register built-in jobs.
		$this->register_job( new CleanupJob() );

		// Allow plugins to register additional jobs.
		do_action( 'vip_workflow_register_jobs', $this );

		// Register action hooks and options for each job.
		foreach ( $this->jobs as $job ) {
			add_action( $job->get_hook(), array( $job, 'execute' ) );
			$job->register_option();
		}

		// Schedule jobs on admin init (only if not already scheduled).
		add_action( 'admin_init', array( $this, 'schedule_jobs' ) );

		// Also schedule on plugin activation.
		add_action( 'vip_workflow_activated', array( $this, 'schedule_jobs' ) );

		// Unschedule on deactivation.
		add_action( 'vip_workflow_deactivated', array( $this, 'unschedule_all' ) );

		$this->initialized = true;
	}

	/**
	 * Register a job.
	 *
	 * @param Job $job Job instance.
	 */
	public function register_job( Job $job ): void {
		$id = $job->get_id();

		/*
		 * Warn if the ID is not one the REST routes can address.
		 *
		 * `Job::get_id()` is abstract, so the ID is whatever a subclass returns,
		 * and the only normalization the plugin declares for one is
		 * `sanitize_key()` — which is what /jobs/{id}/run and /jobs/{id}/settings
		 * match on. An ID that does not survive that round trip therefore reaches
		 * no route: the job would list in the admin and then 404 on every attempt
		 * to run or configure it. Refuse it here instead, where the registering
		 * plugin can still see why.
		 */
		if ( '' === $id || sanitize_key( $id ) !== $id ) {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_trigger_error
			trigger_error(
				sprintf(
					'VIP Workflow: Invalid job ID "%s" - must be lowercase letters, digits, underscores or hyphens. Skipping registration.',
					esc_html( $id )
				),
				E_USER_WARNING
			);
			return;
		}

		// Warn if duplicate job ID.
		if ( isset( $this->jobs[ $id ] ) ) {
         // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_trigger_error
			trigger_error(
				sprintf( 'VIP Workflow: Duplicate job ID "%s" - skipping registration.', esc_html( $id ) ),
				E_USER_WARNING
			);
			return;
		}

		$this->jobs[ $id ] = $job;
	}

	/**
	 * Get all registered jobs.
	 *
	 * @return array<string, Job>
	 */
	public function get_jobs(): array {
		return $this->jobs;
	}

	/**
	 * Get a job by ID.
	 *
	 * @param  string $id Job ID.
	 * @return Job|null
	 */
	public function get_job( string $id ): ?Job {
		return $this->jobs[ $id ] ?? null;
	}

	/**
	 * Schedule all recurring jobs.
	 */
	public function schedule_jobs(): void {
		if ( ! function_exists( 'as_has_scheduled_action' ) ) {
			return; // Action Scheduler not available.
		}

		foreach ( $this->jobs as $job ) {
			$hook = $job->get_hook();

			// Skip if already scheduled.
			if ( as_has_scheduled_action( $hook ) ) {
				continue;
			}

			// Calculate first run time.
			$timestamp = $this->get_first_run_time( $job );

			// Schedule recurring action.
			as_schedule_recurring_action(
				$timestamp,
				$job->get_interval(),
				$hook,
				array(),
				'vip-workflow'
			);
		}
	}

	/**
	 * Get the first run timestamp for a job.
	 *
	 * @param  Job $job Job instance.
	 * @return int Unix timestamp.
	 */
	private function get_first_run_time( Job $job ): int {
		$scheduled_time = $job->get_scheduled_time();

		if ( $scheduled_time ) {
			// Schedule for specific time of day.
			$today = wp_date( 'Y-m-d' ) . ' ' . $scheduled_time;
			$timestamp = strtotime( $today );

			// If time has passed today, schedule for tomorrow.
			if ( $timestamp < time() ) {
				$timestamp = strtotime( '+1 day', $timestamp );
			}

			return $timestamp;
		}

		// Default: run in 1 minute.
		return time() + 60;
	}

	/**
	 * Unschedule all jobs.
	 */
	public function unschedule_all(): void {
		if ( ! function_exists( 'as_unschedule_all_actions' ) ) {
			return;
		}

		foreach ( $this->jobs as $job ) {
			as_unschedule_all_actions( $job->get_hook() );
		}
	}

	/**
	 * Run a job immediately (for testing/manual trigger).
	 *
	 * @param  string $job_id Job ID.
	 * @return bool True if job was queued.
	 */
	public function run_now( string $job_id ): bool {
		$job = $this->get_job( $job_id );

		if ( ! $job ) {
			return false;
		}

		if ( ! function_exists( 'as_enqueue_async_action' ) ) {
			return false;
		}

		as_enqueue_async_action( $job->get_hook(), array(), 'vip-workflow' );
		return true;
	}

	/**
	 * Get job status for admin display.
	 *
	 * @return array
	 */
	public function get_job_status(): array {
		if ( ! function_exists( 'as_get_scheduled_actions' ) ) {
			return array();
		}

		$status = array();

		foreach ( $this->jobs as $job ) {
			$hook = $job->get_hook();

			// Get next scheduled run.
			$next = as_next_scheduled_action( $hook );

			// Get last completed run.
			$completed = as_get_scheduled_actions(
				array(
					'hook'     => $hook,
					'status'   => \ActionScheduler_Store::STATUS_COMPLETE,
					'per_page' => 1,
					'orderby'  => 'date',
					'order'    => 'DESC',
				)
			);

			$last_run = ! empty( $completed ) ? reset( $completed ) : null;

			$status[ $job->get_id() ] = array(
				'id'            => $job->get_id(),
				'name'          => $job->get_name(),
				'description'   => $job->get_description(),
				'interval'      => $job->get_interval(),
				'interval_text' => $job->get_interval_text(),
				'next_run'      => $next ? $next : null,
				'next_run_text' => $next ? wp_date( 'M j, g:i a', $next ) : __( 'Not scheduled', 'vip-workflow' ),
				'last_run'      => $last_run ? $last_run->get_schedule()->get_date()->getTimestamp() : null,
				'last_run_text' => $last_run ? wp_date( 'M j, g:i a', $last_run->get_schedule()->get_date()->getTimestamp() ) : __( 'Never', 'vip-workflow' ),
			);
		}

		return $status;
	}
}
