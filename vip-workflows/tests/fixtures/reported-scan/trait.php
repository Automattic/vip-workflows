<?php
/**
 * Fixture for ReportedDiagnosticsCoverageTest. Read as tokens, never loaded.
 *
 * A trait's map belongs to every class that uses it, which the scan cannot
 * see from here, so it must be reported as a trait rather than missed.
 */

namespace ReportedScanFixture;

trait ReporterTrait {
	private static array $reported = array();
}

class UsesReporter {
	use ReporterTrait;
}
