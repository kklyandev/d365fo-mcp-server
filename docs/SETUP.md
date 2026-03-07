# Setup Guide — Client Configuration

This guide covers everything a **developer** needs to start using the D365 F&O MCP Server
with GitHub Copilot in Visual Studio 2022.

If you are responsible for deploying the server infrastructure to Azure, see [SETUP_AZURE.md](SETUP_AZURE.md).

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Step 1 — Enable MCP in GitHub and Visual Studio](#step-1--enable-mcp-in-github-and-visual-studio)
- [Step 2 — Place copilot-instructions.md](#step-2--place-copilot-instructionsmd)
- [Step 3 — Create .mcp.json](#step-3--create-mcpjson)
  - [Scenario A: Azure-hosted server (most teams)](#scenario-a-azure-hosted-server-most-teams)
  - [Scenario B: Hybrid — Azure search + local file writes](#scenario-b-hybrid--azure-search--local-file-writes)
  - [Scenario C: Local server only](#scenario-c-local-server-only)
  - [Scenario D: UDE (Unified Developer Experience)](#scenario-d-ude-unified-developer-experience)
- [Where to place .mcp.json](#where-to-place-mcpjson)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Component | Minimum version | Notes |
|-----------|----------------|-------|
| Visual Studio 2022 | 17.14 | Earlier versions do not support MCP |
| GitHub Copilot extension | Latest | Requires an active Copilot subscription |
| Node.js | 24.x LTS | Required for hybrid setup only |
| Git | Any | Required for hybrid setup only |

---

## Step 1 — Enable MCP in GitHub and Visual Studio

1. Go to **https://github.com/settings/copilot/features** and enable **Editor Preview Features**.

2. In Visual Studio: **Tools → Options → GitHub → Copilot**
   → Enable **"Enable MCP server integration in agent mode"**

3. Open Copilot Chat and switch to **Agent Mode** (not Ask or Edit).

> MCP tools only appear in Agent Mode. If you do not see them, check that both settings above are enabled.

---

## Step 2 — Place copilot-instructions.md

Copy the file `.github/copilot-instructions.md` from this repository into the root of your
D365FO solution workspace (same folder as your `.sln` file):

```
K:\VSProjects\MySolution\
├── .mcp.json                      ← config file (created in Step 3)
├── .github\
│   └── copilot-instructions.md   ← copy here from this repo
├── MySolution.sln
└── MyProject\
    └── MyProject.rnrproj
```

GitHub Copilot automatically picks up `copilot-instructions.md` and uses it to give
the AI the right D365FO context for every conversation.

---

## Step 3 — Create .mcp.json

Choose the scenario that matches your setup.

---

### Scenario A: Azure-hosted server (most teams)

**What it is:** Your team runs the MCP server on Azure. You only connect to it as a client.
No local server, no local database.

**What you need:**
- The URL of the Azure-hosted MCP server (ask your admin)
- Your `workspacePath` (path to your model on the Windows VM)

**What you do NOT need to do:**
- Install Node.js or clone the repository
- Build a metadata index — it lives in the cloud

**.mcp.json:**

```json
{
  "servers": {
    "d365fo-code-intelligence": {
      "url": "https://your-server.azurewebsites.net/mcp/"
    },
    "context": {
      "workspacePath": "K:\\AosService\\PackagesLocalDirectory\\YourPackageName\\YourModelName"
    }
  }
}
```

The two-level `workspacePath` (`PackageName\ModelName`) is the only value you need.
From it the server automatically derives `packagePath`, `packageName`, and `modelName`.

> **Read-only limitation:** The Azure server cannot write files to your local Windows VM.
> To create or modify files, use **Scenario B** (hybrid) or copy the generated XML manually.

---

### Scenario B: Hybrid — Azure search + local file writes

**What it is:** The Azure server handles all metadata search (fast, shared index).
A lightweight local server runs on your Windows VM and handles only file creation/modification.
GitHub Copilot routes each tool call to the correct server automatically.

**What you need:**
- The Azure server URL
- Node.js 24.x installed on your Windows VM
- A local clone of this repository

**One-time setup on your Windows VM:**

```powershell
git clone https://github.com/dynamics365ninja/d365fo-mcp-server.git K:\d365fo-mcp-server
cd K:\d365fo-mcp-server
npm install
npm run build
```

> You do **not** need to extract metadata or build a database. The metadata index lives
> in Azure Blob Storage and is downloaded by the Azure server, not the local companion.
> The local server starts in under one second and only handles file operations.

**Keeping it up to date** — pull and rebuild whenever a new version is released:

```powershell
cd K:\d365fo-mcp-server
git pull
npm install
npm run build
```

**.mcp.json:**

```json
{
  "servers": {
    "d365fo-azure": {
      "url": "https://your-server.azurewebsites.net/mcp/"
    },
    "d365fo-local": {
      "command": "node",
      "args": ["K:\\d365fo-mcp-server\\dist\\index.js", "--stdio"],
      "env": {
        "MCP_SERVER_MODE": "write-only"
      }
    },
    "context": {
      "workspacePath": "K:\\AosService\\PackagesLocalDirectory\\YourPackageName\\YourModelName",
      "projectPath": "K:\\VSProjects\\MySolution\\MyProject\\MyProject.rnrproj"
    }
  }
}
```

`projectPath` is optional but recommended — it pins the exact `.rnrproj` so file creation
always targets the right model even when multiple projects are open.

> **How it works:** GitHub Copilot sees both tool lists combined. Search calls go to Azure,
> `create_d365fo_file` / `modify_d365fo_file` / `create_label` go to the local server.

---

### Scenario C: Local server only

**What it is:** The MCP server runs entirely on your Windows VM. All metadata is indexed
locally. Suitable for individual developers who do not want to use Azure.

**What you need:**
- Node.js 24.x, Git
- A D365FO installation with `PackagesLocalDirectory`
- Time to build the metadata index (~5–15 min for custom models, ~1–2 h for everything)

**Setup:**

```powershell
git clone https://github.com/dynamics365ninja/d365fo-mcp-server.git K:\d365fo-mcp-server
cd K:\d365fo-mcp-server
npm install
copy .env.example .env
```

Edit `.env`:

```env
DEV_ENVIRONMENT_TYPE=auto
PACKAGES_PATH=K:/AosService/PackagesLocalDirectory
CUSTOM_MODELS=YourPackageName
```

Extract and index the metadata:

```powershell
# Custom models only (recommended, a few minutes)
npm run extract-metadata
npm run build-database

# Full extraction including all Microsoft standard models (~1-2 h)
$env:EXTRACT_MODE="all"; npm run extract-metadata
npm run build-database
```

Start the server:

```powershell
npm start
```

The server runs at `http://localhost:8080`. Verify with `http://localhost:8080/health`.

**.mcp.json:**

```json
{
  "servers": {
    "d365fo-code-intelligence": {
      "url": "http://localhost:8080/mcp/"
    },
    "context": {
      "workspacePath": "K:\\AosService\\PackagesLocalDirectory\\YourPackageName\\YourModelName"
    }
  }
}
```

**Keeping it up to date** — after a D365FO version upgrade or model changes, re-run extraction:

```powershell
npm run extract-metadata
npm run build-database
```

---

### Scenario D: UDE (Unified Developer Experience)

**What it is:** You use Visual Studio 2022 with Power Platform Tools and the UDE environment.
Metadata roots are different from traditional `PackagesLocalDirectory`.

The server reads your XPP config from `%LOCALAPPDATA%\Microsoft\Dynamics365\XPPConfig\`
automatically. In most cases you do not need to set any paths manually.

**.mcp.json (auto-detection, recommended):**

```json
{
  "servers": {
    "d365fo-code-intelligence": {
      "url": "https://your-server.azurewebsites.net/mcp/"
    },
    "context": {
      "modelName": "YourModelName",
      "devEnvironmentType": "ude"
    }
  }
}
```

**.mcp.json (explicit paths, if auto-detection does not work):**

```json
{
  "servers": {
    "d365fo-code-intelligence": {
      "url": "https://your-server.azurewebsites.net/mcp/"
    },
    "context": {
      "modelName": "YourModelName",
      "customPackagesPath": "C:\\CustomXppCode",
      "microsoftPackagesPath": "C:\\Users\\...\\Dynamics365\\10.0.2428.63\\PackagesLocalDirectory",
      "devEnvironmentType": "ude"
    }
  }
}
```

---

## Where to place .mcp.json

The server searches for `.mcp.json` starting from the current working directory and walking
up 5 parent levels. The recommended locations are:

**Option 1 — Per-solution (recommended)**

Place the file next to your `.sln` file:

```
K:\VSProjects\MySolution\
├── .mcp.json          ← here
├── MySolution.sln
└── MyProject\
    └── MyProject.rnrproj
```

This is the most precise option. Visual Studio opens `.mcp.json` automatically when it opens
the solution folder.

**Option 2 — Global (all solutions on this machine)**

Place the file in your user profile directory (`%USERPROFILE%\.mcp.json`), for example:

```
C:\Users\YourName\.mcp.json
```

Use this when you have a single model that applies to all your D365FO work and you do not
want to maintain per-solution files.

---

## Troubleshooting

### MCP tools not loading in Visual Studio
- Confirm Visual Studio version is 17.14 or later
- Confirm *Editor Preview Features* are enabled at https://github.com/settings/copilot/features
- Confirm Copilot Chat is in **Agent Mode** (not Ask or Edit)
- Confirm `.mcp.json` is in the solution root (same folder as the `.sln` file)
- Restart Visual Studio after creating or editing `.mcp.json`

### File created in wrong D365FO model
Use the two-level `workspacePath` format: `PackagesLocalDirectory\YourPackageName\YourModelName`.
The server extracts both `packageName` and `modelName` from it automatically.
See [WORKSPACE_DETECTION.md](WORKSPACE_DETECTION.md).

### Local server (hybrid) does not start
- Confirm Node.js 24.x is installed: `node --version`
- Confirm the build is up to date: re-run `npm install && npm run build` in the repo folder
- Check the path in `.mcp.json` `args` matches where you cloned the repository

### "fts5: syntax error" when searching
Your search query contains special characters. The server handles this automatically with a
fallback to LIKE search. If you still see this error, update to the latest version.

### No results when searching
- Confirm the Azure server is reachable: open the `/health` URL in a browser
- For local setup: verify the database was built — `data/xpp-metadata.db` should exist and be > 100 MB

---

## Next Steps

- [MCP_CONFIG.md](MCP_CONFIG.md) — full reference for all `.mcp.json` options
- [SETUP_AZURE.md](SETUP_AZURE.md) — deploy the server to Azure (admins only)
- [USAGE_EXAMPLES.md](USAGE_EXAMPLES.md) — example Copilot prompts
- [CUSTOM_EXTENSIONS.md](CUSTOM_EXTENSIONS.md) — ISV and multi-model setups
- [PIPELINES.md](PIPELINES.md) — automate metadata refresh
