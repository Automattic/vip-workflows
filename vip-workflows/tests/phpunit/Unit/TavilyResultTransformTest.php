<?php
/**
 * What a Tavily result becomes once transformed.
 *
 * Tavily returns markdown. The provider carried its own `strip_markdown()`
 * applied to `excerpt` and never to `content`, with the link rule ahead of the
 * image rule — which made the image rule unreachable and left a stray `!` in
 * place of every image. These cover the transform's contract now that it defers
 * to `Markdown`, so a second private stripper cannot quietly reappear.
 *
 * Driven through `search()` rather than the private transform, because the claims
 * are about what a caller receives.
 *
 * @package VIPWorkflow\Tests\Unit
 */

declare( strict_types=1 );

namespace VIPWorkflow\Tests\Unit;

use Brain\Monkey\Functions;
use VIPWorkflow\AI\CredentialBackend;
use VIPWorkflow\AI\Credentials;
use VIPWorkflow\Ideation\Research\SearchProviders\TavilyProvider;

require_once __DIR__ . '/../../../includes/integrations/class-markdown.php';

class TavilyResultTransformTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        Functions\when( 'wp_parse_url' )->alias( 'parse_url' );
        Functions\when( 'wp_json_encode' )->alias( 'json_encode' );
        Functions\when( 'wp_remote_retrieve_response_code' )->justReturn( 200 );
        Functions\when( '__' )->returnArg();

        // Use the credential seam rather than defining VIP_WORKFLOW_TAVILY_KEY:
        // a constant cannot be undefined again, and the tests asserting an
        // unconfigured provider run in the same process.
        Credentials::get_instance()->set_backend(
            new class() implements CredentialBackend {
                public function get_api_key( string $service ): string
                {
                    return 'tavily' === $service ? 'test-key' : '';
                }
            }
        );
    }

    protected function tearDown(): void
    {
        Credentials::get_instance()->set_backend( null );

        parent::tearDown();
    }

    /**
     * Run one Tavily result through the provider and return the transformed row.
     *
     * @param array $result Raw Tavily result.
     * @return array Transformed source row.
     */
    private function transform( array $result ): array
    {
        Functions\when( 'wp_remote_post' )->justReturn( array( 'body' => '' ) );
        Functions\when( 'wp_remote_retrieve_body' )->justReturn(
            (string) json_encode( array( 'results' => array( $result ) ) )
        );

        $rows = ( new TavilyProvider() )->search( 'a query' );

        $this->assertIsArray( $rows, 'Provider returned an error rather than results.' );
        $this->assertCount( 1, $rows );

        return $rows[0];
    }

    /**
     * The reported symptom: an image in the snippet left a stray `!` because the
     * link rule consumed its `[alt](src)` first.
     */
    public function test_an_image_in_the_snippet_leaves_no_stray_bang(): void
    {
        $row = $this->transform(
            array(
                'url'     => 'https://wildpathsaz.com/loop/',
                'title'   => 'Clouds Rest',
                'content' => '![WildPathsAZ logo](https://wildpathsaz.com/l.png) Real body text.',
            )
        );

        $this->assertStringNotContainsString( '!', $row['excerpt'] );
        $this->assertStringContainsString( 'Real body text.', $row['excerpt'] );
    }

    /**
     * The other reported symptom. Tavily joins elided passages with `[...]`, which
     * destroys the line break a heading sat on, so a line-anchored heading rule
     * could not match it.
     */
    public function test_a_heading_after_an_elision_marker_loses_its_hashes(): void
    {
        $row = $this->transform(
            array(
                'url'     => 'https://wildpathsaz.com/loop/',
                'content' => 'For one of our [...] #### Half Dome Day Hike Possibly the biggest challenge',
            )
        );

        $this->assertStringNotContainsString( '#', $row['excerpt'] );
        $this->assertStringContainsString( 'Half Dome Day Hike', $row['excerpt'] );
        $this->assertStringNotContainsString( '[...]', $row['excerpt'] );
    }

    /**
     * A `#` that is not a heading marker is content, and must survive the fix for
     * the case above.
     */
    public function test_a_hash_in_ordinary_copy_survives(): void
    {
        $row = $this->transform(
            array(
                'url'     => 'https://example.test/x',
                'content' => 'Permit #42 is required for the #halfdome route.',
            )
        );

        $this->assertSame( 'Permit #42 is required for the #halfdome route.', $row['excerpt'] );
    }

    public function test_links_reduce_to_their_label_in_the_excerpt(): void
    {
        $row = $this->transform(
            array(
                'url'     => 'https://example.test/x',
                'content' => 'See the [trail guide](https://example.test/g) for details.',
            )
        );

        $this->assertSame( 'See the trail guide for details.', $row['excerpt'] );
    }

    /**
     * An excerpt is a one-line field, so the structure `to_plain_text()` preserves
     * is collapsed here — including bullet markers, which read as stray hyphens
     * once a list is flattened.
     */
    public function test_the_excerpt_is_a_single_line_without_list_markers(): void
    {
        $row = $this->transform(
            array(
                'url'     => 'https://example.test/x',
                'content' => "Designations:\n\n- 63 National Parks\n- National Monuments",
            )
        );

        $this->assertStringNotContainsString( "\n", $row['excerpt'] );
        $this->assertSame( 'Designations: 63 National Parks National Monuments', $row['excerpt'] );
    }

    /**
     * `content` stays markdown: the detail modal renders it, the board preview
     * strips it for its own slot, and prompts read it fine. Flattening it here
     * would discard structure all three can use.
     */
    public function test_content_keeps_its_markdown(): void
    {
        $raw = "# Clouds Rest\n\nA **very strenuous** loop.\n\n- 37.9 miles\n- 9,198 feet";

        $row = $this->transform(
            array(
                'url'         => 'https://example.test/x',
                'content'     => 'A short snippet.',
                'raw_content' => $raw,
            )
        );

        $this->assertSame( $raw, $row['content'] );
    }

    /**
     * Falls back to the snippet when Tavily returns no raw content, which it does
     * for pages it could not extract.
     */
    public function test_content_falls_back_to_the_snippet(): void
    {
        $row = $this->transform(
            array( 'url' => 'https://example.test/x', 'content' => 'Only a snippet.' )
        );

        $this->assertSame( 'Only a snippet.', $row['content'] );
    }

    public function test_the_domain_comes_from_the_url(): void
    {
        $row = $this->transform(
            array( 'url' => 'https://wildpathsaz.com/loop/?utm=1', 'content' => 'Body.' )
        );

        $this->assertSame( 'wildpathsaz.com', $row['domain'] );
    }
}
