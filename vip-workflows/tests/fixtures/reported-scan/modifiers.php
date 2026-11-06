<?php
/**
 * Fixture for ReportedDiagnosticsCoverageTest. Read as tokens, never loaded.
 */

namespace ReportedScanFixture;

class StaticFirstReporter {
	static private array $reported = array();
}

#[\AllowDynamicProperties]
final class FinalAttributedReporter {
	public static ?array $reported = null;
}
