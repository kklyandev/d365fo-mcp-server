# D365 F&O MCP Server

<div align="center">

**GitHub Copilot with full knowledge of your D365 F&O codebase**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24.0.0-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)

</div>

---

## What Is This?

An MCP server that gives GitHub Copilot access to your D365 F&O codebase — 584,799+ symbols indexed in SQLite FTS5. Copilot then knows exact method signatures, field types, class hierarchies, and generates X++ code that compiles on the first try.

```
┌─────────────────────┐    MCP/HTTP     ┌──────────────────────────────────┐
│  GitHub Copilot     │ ◄────────────► │  D365 F&O MCP Server             │
│  (Agent Mode)       │                 │                                  │
│                     │                 │  ┌─────────┐   ┌──────────────┐ │
│  "Show methods of   │                 │  │ Symbols │   │ Labels       │ │
│   SalesTable"       │                 │  │  ~1 GB  │   │  ~8 GB       │ │
│                     │                 │  │ 584K+   │   │ 19M+ labels  │ │
│  ← answer in 50ms   │                 │  │ symbols │   │ 70 languages │ │
└─────────────────────┘                 │  └─────────┘   └──────────────┘ │
                                        └──────────────────────────────────┘
```

| Without this server | With this server |
|---------------------|-----------------|
| Copilot guesses method names → compile errors | Exact signatures → code works |
| Searching in AOT: 5–30 minutes | Answer in < 50 ms |
| 584,799 symbols with no fast search | Everything indexed and instantly available |

---

## Quick Start

```powershell
git clone https://github.com/dynamics365ninja/d365fo-mcp-server.git
cd d365fo-mcp-server
npm install
copy .env.example .env          # Fill in PACKAGES_PATH and CUSTOM_MODELS
npm run extract-metadata         # Extract XML from D365FO packages
npm run build-database           # Build SQLite index (~5–20 min)
npm run dev                      # Server running at http://localhost:3000
```

> **UDE (Power Platform Tools)?** Run `npm run select-config` instead of setting `PACKAGES_PATH`.

---

## GitHub Copilot Setup

**1.** Enable *Editor Preview Features* at **github.com/settings/copilot/features**

**2.** In Visual Studio: **Tools → Options → GitHub → Copilot** → check *Enable MCP server integration in agent mode*

**3.** Add `.mcp.json` to the root of your Visual Studio solution (next to the `.sln` file):

```json
{
  "servers": {
    "d365fo-code-intelligence": {
      "url": "http://localhost:3000/mcp/"
    },
    "context": {
      "workspacePath": "K:\\AosService\\PackagesLocalDirectory\\YourModel"
    }
  }
}
```

The server automatically locates your `.rnrproj`, extracts the correct model name, and writes new files to the right place in AOT. `workspacePath` is the only setting most users ever need.

> **Full options** (UDE paths, explicit projectPath, solutionPath): see [docs/MCP_CONFIG.md](docs/MCP_CONFIG.md)

**4.** Copy Copilot instructions to your solution root:

```powershell
Copy-Item -Path ".github" -Destination "C:\Path\To\YourSolution\" -Recurse
```

---

## What It Can Do — 29 Tools

### 🔍 Code Search & Navigation
| Prompt | What happens |
|--------|-------------|
| `What methods does SalesTable have?` | Returns all methods with their signatures |
| `Find classes related to invoicing` | Full-text search across 584K+ symbols |
| `Where is CustTable.validateWrite() used?` | Where-used analysis across the entire codebase |
| `Show me the structure of CustTable` | Fields with EDTs, indexes, foreign key relations |

### ⚡ Code Generation
| Prompt | What happens |
|--------|-------------|
| `Create a CoC extension for SalesTable.validateWrite()` | Exact signature + boilerplate |
| `How is LedgerJournalEngine initialized?` | Patterns from your own codebase |
| `Is my class MyHelper missing any standard methods?` | Class completeness analysis |
| `Create a batch job for order processing` | Complete batch job template |

### 🎨 Smart Object Generation
| Prompt | What happens |
|--------|-------------|
| `Generate a transaction table with common fields` | AI-driven table with intelligent field/index suggestions |
| `Create a SimpleList form for MyOrderTable` | AI-driven form with datasource and grid controls |
| `What EDT should I use for CustomerAccount field?` | Suggests EDTs using fuzzy matching and pattern analysis |

### 🏷️ Label Management
| Prompt | What happens |
|--------|-------------|
| `Find a label for "customer"` | Searches all AxLabelFile objects |
| `Translations of label MyFeature in model MyModel` | All languages at once |
| `Create a new label MyNewField in MyModel` | Writes to all .label.txt files |
| `Rename label OldName to NewName in MyModel` | Renames ID in .label.txt, X++ source and XML metadata |

### 📝 File Operations *(local VM only)*
- Generates correct D365FO XML for classes, tables, forms, enums
- Writes the file directly to the right location in AOT
- Automatically adds the file to `.rnrproj`
- Creates a backup before every change

---

## Azure Deployment

Host the server on Azure App Service — the entire team shares a single instance.

| Resource | Configuration | Monthly cost |
|----------|---------------|-------------|
| App Service P0v3 | 1 vCPU, 4 GB RAM | ~$62 |
| Blob Storage | 2 GB (symbols + labels) | ~$3 |
| Redis Cache (optional) | Basic C0 | ~$16 |
| **Total without Redis** | | **~$65 / month** |

The database is automatically downloaded from Azure Blob Storage on server startup.

Setup guide: [docs/SETUP.md](docs/SETUP.md) · CI/CD pipeline: [docs/PIPELINES.md](docs/PIPELINES.md)

---

## Documentation

| File | Contents |
|------|---------|
| [docs/SETUP.md](docs/SETUP.md) | Installation, configuration, Azure deployment |
| [docs/MCP_CONFIG.md](docs/MCP_CONFIG.md) | `.mcp.json` reference — workspace paths, UDE, project settings |
| [docs/MCP_TOOLS.md](docs/MCP_TOOLS.md) | All 29 tools with example prompts |
| [docs/USAGE_EXAMPLES.md](docs/USAGE_EXAMPLES.md) | Practical examples: search, generation, CoC |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Technical architecture, dual-database design |
| [docs/CUSTOM_EXTENSIONS.md](docs/CUSTOM_EXTENSIONS.md) | ISV / custom model configuration |
| [docs/PIPELINES.md](docs/PIPELINES.md) | Automated metadata extraction via Azure DevOps |
