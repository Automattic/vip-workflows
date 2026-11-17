<?php
/**
 * Test-only adapter for files that PHP did not receive over HTTP.
 * Delegates to the real media handler with a custom upload action, making core
 * use is_readable() rather than is_uploaded_file(). MIME, size, attachment,
 * metadata and database handling remain in core. Only marked fixtures use it.
 */
namespace VIPWorkflows\API;

function media_handle_upload( $file_id, $post_id, $post_data = array(), $overrides = array( 'test_form' => false ) ) {
    if ( ! empty( $_FILES[ $file_id ]['_transcription_fixture'] ) ) {
        $overrides['action'] = 'vip_transcription_fixture';
    }
    return \media_handle_upload( $file_id, $post_id, $post_data, $overrides );
}
