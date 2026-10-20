<?php
/**
 * Shifts the post dates in a WXR document so seeded demo content is recent.
 *
 * Every wp:post_date and wp:post_date_gmt moves by the same whole number of
 * days, chosen so the newest local post date lands on the current day without
 * passing the current time. Posts keep their spacing, every date stays a valid
 * calendar date, and no published post becomes scheduled on import. Unset
 * (0000-00-00) dates are left alone.
 *
 * Shared by tools/wp-env-after-start.sh and the pull request preview
 * blueprint, which runs it at boot so dates are relative to when the preview
 * is opened rather than when it was built.
 *
 * Usage: php tools/playground/shift-wxr-dates.php <source.xml> <destination.xml>
 *
 * @package VIPWorkflows
 */

// Captures the opening tag, the date field name, the date, and the closing CDATA.
const VIP_WORKFLOWS_WXR_DATE      = '/(<wp:(post_date(?:_gmt)?)><!\[CDATA\[)(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(\]\]>)/';
const VIP_WORKFLOWS_WXR_DATE_UNSET = '0000-00-00 00:00:00';

/**
 * Returns the WXR document with its post dates shifted relative to `$now`.
 *
 * @param string             $wxr WXR document.
 * @param \DateTimeInterface $now Current site-local time.
 * @return string The shifted document.
 * @throws \UnexpectedValueException When the document has no local post dates.
 */
function vip_workflows_shift_wxr_dates( $wxr, $now ) {
	$utc    = new DateTimeZone( 'UTC' );
	$latest = null;

	preg_match_all( VIP_WORKFLOWS_WXR_DATE, $wxr, $matches, PREG_SET_ORDER );
	foreach ( $matches as $match ) {
		if ( 'post_date' !== $match[2] || VIP_WORKFLOWS_WXR_DATE_UNSET === $match[3] ) {
			continue;
		}
		$date = new DateTimeImmutable( $match[3], $utc );
		if ( null === $latest || $date > $latest ) {
			$latest = $date;
		}
	}

	if ( null === $latest ) {
		throw new UnexpectedValueException( 'WXR document has no wp:post_date values to shift' );
	}

	// Compare wall-clock times; post_date is site-local and carries no zone.
	$today = new DateTimeImmutable( $now->format( 'Y-m-d H:i:s' ), $utc );
	$days  = (int) $latest->setTime( 0, 0 )->diff( $today->setTime( 0, 0 ) )->format( '%r%a' );
	if ( $latest->modify( sprintf( '%+d days', $days ) ) > $today ) {
		--$days;
	}

	return preg_replace_callback(
		VIP_WORKFLOWS_WXR_DATE,
		static function ( $match ) use ( $days, $utc ) {
			if ( VIP_WORKFLOWS_WXR_DATE_UNSET === $match[3] ) {
				return $match[0];
			}
			$shifted = ( new DateTimeImmutable( $match[3], $utc ) )->modify( sprintf( '%+d days', $days ) );
			return $match[1] . $shifted->format( 'Y-m-d H:i:s' ) . $match[4];
		},
		$wxr
	);
}

if ( 'cli' === PHP_SAPI && isset( $argv[0] ) && realpath( $argv[0] ) === __FILE__ ) {
	if ( 3 !== count( $argv ) ) {
		fwrite( STDERR, "Usage: php tools/playground/shift-wxr-dates.php <source.xml> <destination.xml>\n" ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fwrite
		exit( 1 );
	}

	$vip_workflows_wxr = file_get_contents( $argv[1] ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
	if ( false === $vip_workflows_wxr ) {
		exit( 1 );
	}

	// wp-env sites run in UTC.
	$vip_workflows_shifted = vip_workflows_shift_wxr_dates( $vip_workflows_wxr, new DateTimeImmutable( 'now', new DateTimeZone( 'UTC' ) ) );
	if ( false === file_put_contents( $argv[2], $vip_workflows_shifted ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
		exit( 1 );
	}
}
