<?php
/**
 * Fixture for ReportedDiagnosticsCoverageTest. Read as tokens, never loaded.
 *
 * Two map owners in one file, plus declarations the scan must not count.
 */

namespace ReportedScanFixture;

class FirstReporter {
	private static array $reported = array();

	public static function report( string $message ): void {
		// A read inside a method is not a declaration.
		static::$reported[ $message ] = true;
	}
}

class SecondReporter {
	private static array $reported = array();
}

class NotAReporter {
	// A parameter named $reported is not a static property.
	public static function check( array $reported ): string {
		$anonymous = new class() {
			public $reported = array();
		};

		return SecondReporter::class;
	}
}

class UntypedReporter {
	protected static $reported = [];
}
