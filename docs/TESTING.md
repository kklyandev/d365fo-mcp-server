# Test Documentation

This project uses [Vitest](https://vitest.dev/) as the testing framework.

## Running Tests

```bash
# Run all tests in watch mode
npm test

# Run tests with coverage
npm test -- --coverage

# Run specific test file
npm test tests/tools/search.test.ts
```

## Test Structure

Tests are organized into the following directories:

- `tests/tools/` - Unit tests for MCP tools (search, batchSearch, classInfo, tableInfo, formInfo, queryInfo, viewInfo, edtInfo, enumInfo, findReferences, methodSignature, and intelligent tools)
- `tests/server/` - Integration tests for server components (HTTP transport)
- `tests/utils/` - Unit tests for utility functions (fuzzyMatching, modelClassifier, suggestionEngine, configManager, packageResolver, xppConfigProvider)
- `tests/metadata/` - Unit tests for XML metadata parsing (table and view XML parsers)
- `tests/e2e/` - End-to-end tests with real MCP protocol communication and full user scenario simulations
- `tests/` - Root-level tests (symbolIndex, workspaceDetector, modelClassifier auto-detection, model tag extraction, setup configuration)

## Test Coverage

The test suite covers:

### Tools (Unit Tests)
- **search.test.ts**: Tests for symbol search functionality
  - Search with results
  - Empty query handling
  - Cache integration
  - MaxResults parameter
  - Error handling

- **batchSearch.test.ts**: Tests for parallel batch search functionality
  - Multiple parallel queries execution
  - Result aggregation and deduplication
  - Individual query error handling
  - Empty batch handling
  - Performance optimization validation

- **searchSuggestions.test.ts**: Integration tests for intelligent search suggestions
  - Typo correction when no results found ("Did you mean?")
  - Broader search suggestions
  - Narrower search suggestions
  - Integration with search tool and term relationship graph
  - Cache integration for suggestions

- **classInfo.test.ts**: Tests for class information retrieval
  - XML parsing
  - Database fallback when XML missing
  - Class not found handling
  - Error handling

- **tableInfo.test.ts**: Tests for table information retrieval
  - XML parsing
  - Database fallback when XML missing
  - Table not found handling
  - Error handling

- **formInfo.test.ts**: Tests for form information retrieval
  - XML parsing of form datasources, controls, and methods
  - Form not found handling
  - Error handling

- **queryInfo.test.ts**: Tests for query information retrieval
  - XML parsing of query datasources, joins, and ranges
  - Query not found handling
  - Error handling

- **viewInfo.test.ts**: Tests for view/data entity information retrieval
  - XML parsing of view fields, relations, and methods
  - View not found handling
  - Error handling

- **edtInfo.test.ts**: Tests for Extended Data Type information retrieval
  - XML parsing of AxEdt metadata (base type, reference table, constraints)
  - EDT not found handling
  - Error handling

- **enumInfo.test.ts**: Tests for enum information retrieval
  - XML parsing of AxEnum values, labels, and properties
  - Enum not found handling
  - Error handling

- **findReferences.test.ts**: Tests for cross-codebase reference lookup
  - Finding usages across methods (source_snippet scan)
  - Finding subclasses (extends relationship)
  - Finding method-level references
  - Empty result handling
  - Error handling

- **methodSignature.test.ts**: Tests for exact method signature extraction
  - Full signature with return type, modifiers, and parameters
  - Default parameter values
  - Protected vs. public modifiers
  - Method not found handling
  - Error handling

- **intelligentTools.test.ts**: Tests for intelligent code generation tools
  - Pattern analysis (analyze_code_patterns)
  - Method implementation suggestions (suggest_method_implementation)
  - Class completeness analysis (analyze_class_completeness)
  - API usage patterns (get_api_usage_patterns)
  - Cache integration for pattern analysis
  - Error handling and empty result scenarios

### Server Components (Integration Tests)
- **transport.test.ts**: Tests for MCP protocol HTTP transport layer
  - Initialize request handling
  - Tools list endpoint
  - Tool call execution
  - Notification handling
  - Ping endpoint
  - Resource templates
  - Invalid method handling
  - Health endpoint

### Database Tests
- **symbolIndex.test.ts**: Tests for SQLite symbol indexing
  - Database creation
  - Symbol addition and retrieval
  - Full-text search
  - Symbol counting
  - Method/field retrieval

### Metadata Parser Tests (`tests/metadata/`)
- **xmlParser.table.test.ts**: Tests for AxTable XML parsing
  - Nested index field extraction
  - Relation and constraint parsing
  - PrimaryIndex / ClusteredIndex resolution
  - Field metadata (type, mandatory flag)

- **xmlParser.view.test.ts**: Tests for AxView XML parsing
  - View field extraction
  - Computed column handling
  - Relation parsing from view metadata

### End-to-End Tests (`tests/e2e/`)
- **mcp-protocol.test.ts**: Full MCP protocol communication tests
  - Initialize handshake and server capabilities
  - Tools list endpoint returning all tool definitions
  - Tool call execution via JSON-RPC over HTTP
  - Notification handling
  - Health and ping endpoints
  - Error responses for unknown methods
  - Session management

- **user-scenarios.test.ts**: Real-world user scenario simulations
  - Searching for D365FO symbols by name and keyword
  - Retrieving class and table information
  - Code completion (IntelliSense-style)
  - Code generation patterns (batch job, CoC, etc.)
  - Pattern analysis and method suggestion workflows
  - Error handling for missing/unknown objects

### Root-Level Tests
- **workspaceDetector.test.ts**: Tests for D365FO workspace auto-detection
  - Detecting `.rnrproj` project files in a workspace
  - Resolving project model name from project file
  - Handling missing or invalid project structures

- **modelClassifierAutoDetect.test.ts**: Tests for model classifier with auto-detection support
  - Recognizing Microsoft standard models (ApplicationSuite, ApplicationPlatform, etc.)
  - Registering and recognizing auto-detected custom models
  - `clearAutoDetectedModels()` isolation between tests

- **modelTagExtraction.test.ts**: Tests for `<Model>` / `<ModelName>` tag extraction from `.rnrproj`
  - Standard `<Model>` tag format
  - Alternative `<ModelName>` tag format
  - Multiple PropertyGroup handling

### Utilities (Unit Tests)
- **fuzzyMatching.test.ts**: Tests for fuzzy string matching algorithms
  - Levenshtein distance calculation (edit distance)
  - Similarity scoring (normalized 0.0-1.0)
  - Fuzzy match finding with threshold
  - Probable typo detection
  - Broader/narrower search generation
  - Root term extraction

- **modelClassifier.test.ts**: Tests for D365FO model classification
  - Parsing CUSTOM_MODELS environment variable
  - Custom vs standard model identification
  - EXTENSION_PREFIX matching logic
  - Model filtering by type (custom/standard)
  - Case-insensitive model name comparison

- **suggestionEngine.test.ts**: Tests for intelligent suggestion system
  - Typo correction with Levenshtein distance
  - Broader and narrower search suggestions
  - Term relationship graph building and traversal
  - Suggestion formatting and ranking
  - Limit enforcement and result deduplication

- **configManager.test.ts**: Tests for configuration manager
  - `DEV_ENVIRONMENT_TYPE=ude` detection
  - `XPP_CONFIG_NAME` environment variable support
  - Runtime context update via `setRuntimeContext()`

- **packageResolver.test.ts**: Tests for D365FO package/model resolver
  - Resolving model name to package directory via Descriptor XML
  - Handling spaces in model display names
  - Missing descriptor and empty directory edge cases

- **xppConfigProvider.test.ts**: Tests for XPP environment config provider (UDE support)
  - Listing available XPP configs sorted by modification time
  - Parsing `configName` and `version` from filename pattern (`name___version`)
  - Loading `ModelStoreFolder` and `FrameworkDirectory` from JSON config
  - Handling empty or missing config directories

## Writing New Tests

When adding new functionality, ensure to:

1. Create unit tests for individual functions/tools
2. Use mocks for external dependencies (database, cache, parser)
3. Test both success and error scenarios
4. Test edge cases (empty inputs, null values, etc.)
5. Maintain test isolation - each test should be independent

## CI/CD Integration

Tests run automatically in GitHub Actions on:
- Every push to main and develop branches
- Pull requests to main and develop branches
- Matrix testing on Node.js 20.x and 22.x

**Note:** Tests currently run with `continue-on-error: true` in the CI pipeline, meaning the build can proceed even if tests fail. This is temporary during active development.

## Mock Strategy

We use Vitest's `vi.fn()` to create mock implementations:
- **XppSymbolIndex**: Database operations (searchSymbols, getClassMethods, etc.) are mocked with predefined return values
- **RedisCacheService**: Cache operations (get, set, getFuzzy) return controlled test data and track calls
- **Parser, WorkspaceScanner, HybridSearch**: Mocked as empty objects when not needed for specific tests

Mocks are created with partial types and reset in `beforeEach()` hooks to ensure test isolation and deterministic behavior.

## Coverage Requirements

Aim for:
- **80%+ line coverage** for critical paths
- **100% coverage** for error handling
- **All exported functions** should have tests

Run coverage reports with:
```bash
npm test -- --coverage
```

Coverage reports are generated in `coverage/` directory.
