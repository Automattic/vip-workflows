<?php
/**
 * Shared test doubles for the php-ai-client facade.
 *
 * Loaded once from bootstrap.php so every suite binds to the same stub
 * regardless of file load order. Tests drive behavior through the public
 * static properties (e.g. AiClient::$generatedText, AiClient::$throwMessage).
 *
 * @package VIPWorkflow\Tests
 */

declare( strict_types=1 );

namespace WordPress\AiClient {
    if ( ! class_exists( AiClient::class, false ) ) {
        class AiClient
        {
            public static bool $configured     = true;
            public static string $generatedText = 'Generated text';
            /** @var string[] Sequential responses; each generateText() shifts one, falling back to $generatedText when empty. */
            public static array $responseQueue = array();
            /** @var string Finish reason reported by generateTextResult(): 'stop', 'length', 'content_filter', 'tool_calls' or 'error'. */
            public static string $finishReason = 'stop';
            /** @var bool When true, generateTextResult() returns a result carrying no candidates. */
            public static bool $emptyCandidates = false;
            /**
             * @var bool When true, the candidate carries no content-channel part, so toText()
             *           throws exactly as the real one does. This is the shape a thinking model
             *           returns when the token ceiling is spent on reasoning before any reply is
             *           written: parts exist, but all of them are on the thought channel.
             */
            public static bool $contentPartMissing = false;
            public static ?string $throwMessage = null;
            public static string $lastPrompt    = '';
            public static mixed $lastFile       = null;
            public static mixed $lastModel      = null;
            public static int $lastMaxTokens    = 0;
            /** @var float|null Temperature from the last usingTemperature() call, or null when unset. */
            public static ?float $lastTemperature = null;
            /** @var string|null System instruction from the last usingSystemInstruction() call, or null when unset. */
            public static ?string $lastSystemInstruction = null;
            /** @var float|null Timeout from the last usingRequestOptions() call, or null when unset. */
            public static ?float $lastRequestTimeout = null;

            public static function isConfigured( string $provider ): bool
            {
                return self::$configured;
            }

            public static function prompt( string $prompt ): self
            {
                self::$lastPrompt            = $prompt;
                self::$lastFile              = null;
                self::$lastModel             = null;
                self::$lastMaxTokens         = 0;
                self::$lastTemperature       = null;
                self::$lastSystemInstruction = null;
                self::$lastRequestTimeout    = null;

                return new self();
            }

            public function withFile( mixed $file ): self
            {
                self::$lastFile = $file;
                return $this;
            }

            public function usingModel( mixed $model ): self
            {
                self::$lastModel = $model;
                return $this;
            }

            public function usingMaxTokens( int $max_tokens ): self
            {
                self::$lastMaxTokens = $max_tokens;
                return $this;
            }

            public function usingTemperature( float $temperature ): self
            {
                self::$lastTemperature = $temperature;
                return $this;
            }

            public function usingSystemInstruction( string $instruction ): self
            {
                self::$lastSystemInstruction = $instruction;
                return $this;
            }

            public function usingRequestOptions( mixed $options ): self
            {
                self::$lastRequestTimeout = $options->getTimeout();
                return $this;
            }

            public function asJsonResponse(): self
            {
                return $this;
            }

            public function generateText(): string
            {
                if ( null !== self::$throwMessage ) {
                    throw new \Exception( self::$throwMessage );
                }

                if ( array() !== self::$responseQueue ) {
                    return (string) array_shift( self::$responseQueue );
                }

                return self::$generatedText;
            }

            /**
             * Terminal call that exposes the provider's finish reason alongside the text.
             *
             * Mirrors the real builder, where generateText() is sugar for
             * generateTextResult()->toText() and therefore discards the reason the
             * generation stopped.
             */
            public function generateTextResult(): \WordPress\AiClient\Results\DTO\GenerativeAiResult
            {
                $text = $this->generateText();

                if ( self::$emptyCandidates ) {
                    return new \WordPress\AiClient\Results\DTO\GenerativeAiResult( array() );
                }

                return new \WordPress\AiClient\Results\DTO\GenerativeAiResult(
                    array(
                        new \WordPress\AiClient\Results\DTO\Candidate(
                            self::$contentPartMissing ? null : $text,
                            new \WordPress\AiClient\Results\Enums\FinishReasonEnum( self::$finishReason )
                        ),
                    )
                );
            }

            public static function defaultRegistry(): AiClientRegistryStub
            {
                if ( null === self::$registry ) {
                    self::$registry = new AiClientRegistryStub();
                }
                return self::$registry;
            }

            public static ?AiClientRegistryStub $registry = null;
        }
    }

    if ( ! class_exists( AiClientRegistryStub::class, false ) ) {
        /** Minimal registry double mapping provider ids to stub provider classes. */
        class AiClientRegistryStub
        {
            /** @var array<string, string> id => provider class. */
            public array $providers = array(
                'openai'    => 'WordPress\\OpenAiAiProvider\\Provider\\OpenAiProvider',
                'anthropic' => 'WordPress\\AnthropicAiProvider\\Provider\\AnthropicProvider',
                'google'    => 'WordPress\\GoogleAiProvider\\Provider\\GoogleProvider',
            );

            /** @var array<string, string> id => authenticated key, for assertions. */
            public array $authenticated = array();

            public function hasProvider( string $id_or_class ): bool
            {
                return isset( $this->providers[ $id_or_class ] ) || in_array( $id_or_class, $this->providers, true );
            }

            public function getProviderClassName( string $id ): ?string
            {
                return $this->providers[ $id ] ?? null;
            }

            public function registerProvider( string $class ): void {}

            public function setProviderRequestAuthentication( string $id, mixed $auth ): void
            {
                $this->authenticated[ $id ] = $auth;
            }
        }
    }
}

namespace WordPress\AiClient\Results\Enums {
    if ( ! class_exists( FinishReasonEnum::class, false ) ) {
        /** Finish-reason double exposing the is*() checks the real enum builds via __call(). */
        class FinishReasonEnum
        {
            public const STOP           = 'stop';
            public const LENGTH         = 'length';
            public const CONTENT_FILTER = 'content_filter';
            public const TOOL_CALLS     = 'tool_calls';
            public const ERROR          = 'error';

            public function __construct( public string $value ) {}

            public function isStop(): bool
            {
                return self::STOP === $this->value;
            }

            public function isLength(): bool
            {
                return self::LENGTH === $this->value;
            }

            public function isContentFilter(): bool
            {
                return self::CONTENT_FILTER === $this->value;
            }

            public function isToolCalls(): bool
            {
                return self::TOOL_CALLS === $this->value;
            }

            public function isError(): bool
            {
                return self::ERROR === $this->value;
            }
        }
    }
}

namespace WordPress\AiClient\Results\DTO {
    use WordPress\AiClient\Results\Enums\FinishReasonEnum;

    if ( ! class_exists( Candidate::class, false ) ) {
        /**
         * Candidate double carrying flat text in place of a Message tree.
         *
         * Null text stands in for a candidate whose parts are all on the thought
         * channel, which the real toText() skips over — the collapsed form of "there
         * are parts, but none of them are content".
         */
        class Candidate
        {
            public function __construct(
                private ?string $text,
                private FinishReasonEnum $finish_reason
            ) {}

            public function getText(): ?string
            {
                return $this->text;
            }

            public function getFinishReason(): FinishReasonEnum
            {
                return $this->finish_reason;
            }
        }
    }

    if ( ! class_exists( GenerativeAiResult::class, false ) ) {
        /** Result double over a list of Candidate doubles. */
        class GenerativeAiResult
        {
            /** @param Candidate[] $candidates */
            public function __construct( private array $candidates ) {}

            /** @return Candidate[] */
            public function getCandidates(): array
            {
                return $this->candidates;
            }

            /**
             * Matches the real toText(), which throws when there is no text to return —
             * including when the first candidate carries parts but none on the content
             * channel, the shape a ceiling spent entirely on reasoning produces.
             */
            public function toText(): string
            {
                if ( array() === $this->candidates || null === $this->candidates[0]->getText() ) {
                    throw new \RuntimeException( 'No text content found in first candidate' );
                }

                return $this->candidates[0]->getText();
            }
        }
    }
}

namespace WordPress\AiClient\Providers\Http\DTO {
    if ( ! class_exists( RequestOptions::class, false ) ) {
        /** Request-options double covering the timeout the stage agents set. */
        class RequestOptions
        {
            private ?float $timeout = null;

            public function setTimeout( ?float $timeout ): void
            {
                $this->timeout = $timeout;
            }

            public function getTimeout(): ?float
            {
                return $this->timeout;
            }
        }
    }
}

namespace WordPress\AiClient\Files\DTO {
    if ( ! class_exists( File::class, false ) ) {
        class File
        {
            public function __construct(
                public string $path,
                public string $mime_type
            ) {}
        }
    }
}

namespace WordPress\AiClient\Stubs {
    /** A capability double exposing ->name like the real CapabilityEnum cases. */
    if ( ! class_exists( CapabilityStub::class, false ) ) {
        class CapabilityStub
        {
            public function __construct( public string $name ) {}
        }
    }

    /** A ModelMetadata double exposing getId()/getSupportedCapabilities(). */
    if ( ! class_exists( ModelMetadataStub::class, false ) ) {
        class ModelMetadataStub
        {
            /** @param string[] $caps Capability names. */
            public function __construct( private string $id, private array $caps ) {}

            public function getId(): string
            {
                return $this->id;
            }

            /** @return CapabilityStub[] */
            public function getSupportedCapabilities(): array
            {
                return array_map( fn( string $n ) => new CapabilityStub( $n ), $this->caps );
            }
        }
    }

    /** A model-metadata directory double over a catalog of [id, caps] pairs. */
    if ( ! class_exists( ModelMetadataDirectoryStub::class, false ) ) {
        class ModelMetadataDirectoryStub
        {
            /** @param array<array{0:string,1:string[]}> $catalog */
            public function __construct( private array $catalog ) {}

            /** @return ModelMetadataStub[] */
            public function listModelMetadata(): array
            {
                return array_map(
                    fn( array $entry ) => new ModelMetadataStub( $entry[0], $entry[1] ),
                    $this->catalog
                );
            }
        }
    }
}

namespace WordPress\OpenAiAiProvider\Provider {
    if ( ! class_exists( OpenAiProvider::class, false ) ) {
        class OpenAiProvider
        {
            /** @var array<array{0:string,1:string[]}> Catalog tests can override. */
            public static array $catalog = array();

            public static function model( string $model ): string
            {
                return $model;
            }

            public static function modelMetadataDirectory(): \WordPress\AiClient\Stubs\ModelMetadataDirectoryStub
            {
                return new \WordPress\AiClient\Stubs\ModelMetadataDirectoryStub( self::$catalog );
            }
        }
    }
}

namespace WordPress\AnthropicAiProvider\Provider {
    if ( ! class_exists( AnthropicProvider::class, false ) ) {
        class AnthropicProvider
        {
            /** @var array<array{0:string,1:string[]}> Catalog tests can override. */
            public static array $catalog = array();

            public static function model( string $model ): string
            {
                return $model;
            }

            public static function modelMetadataDirectory(): \WordPress\AiClient\Stubs\ModelMetadataDirectoryStub
            {
                return new \WordPress\AiClient\Stubs\ModelMetadataDirectoryStub( self::$catalog );
            }
        }
    }
}

namespace WordPress\GoogleAiProvider\Provider {
    if ( ! class_exists( GoogleProvider::class, false ) ) {
        class GoogleProvider
        {
            /** @var array<array{0:string,1:string[]}> Catalog tests can override. */
            public static array $catalog = array();

            public static function model( string $model ): string
            {
                return $model;
            }

            public static function modelMetadataDirectory(): \WordPress\AiClient\Stubs\ModelMetadataDirectoryStub
            {
                return new \WordPress\AiClient\Stubs\ModelMetadataDirectoryStub( self::$catalog );
            }
        }
    }
}
