# Setup Guide — Azure Deployment

This guide covers deploying the D365 F&O MCP Server to Azure App Service.

If you are a developer who only wants to **use** an existing server, see [SETUP.md](SETUP.md) instead.

---

## Table of Contents

- [What You Need](#what-you-need)
- [Architecture Overview](#architecture-overview)
- [Step 1 — Create Azure Resources](#step-1--create-azure-resources)
- [Step 2 — Configure App Settings](#step-2--configure-app-settings)
- [Step 3 — Deploy the Application](#step-3--deploy-the-application)
- [Step 4 — Build and Upload the Metadata Database](#step-4--build-and-upload-the-metadata-database)
- [Step 5 — Verify](#step-5--verify)
- [Azure DevOps Pipelines](#azure-devops-pipelines)
- [Updating the Server](#updating-the-server)
- [Troubleshooting](#troubleshooting)

---

## What You Need

- **Azure CLI** installed and logged in (`az login`)
- **Node.js** 24.x LTS (for building the application and metadata)
- **Python** 3.x (required by `node-gyp` to compile the native SQLite addon during `npm install`)
- **Git**
- An Azure subscription with permissions to create App Service, Storage Account, and optionally Redis

---

## Architecture Overview

```
Developer's Windows VM
  GitHub Copilot (VS 2022)
       │
       ├──► Azure App Service (read-only)
       │      └── downloads xpp-metadata.db from Blob Storage on cold start
       │
       └──► Local write-only companion (optional, hybrid setup)
              └── node dist/index.js --stdio
```

**Azure resources:**

| Resource | Purpose | Minimum SKU |
|----------|---------|------------|
| Azure Blob Storage | Stores `xpp-metadata.db` (~1–1.5 GB) and `xpp-metadata-labels.db` (~500 MB) | Standard LRS |
| Azure App Service Plan | Hosts the Node.js server | B1 (dev/test), P0v3 (production) |
| Azure App Service (Web App) | Runs the MCP server | Linux, Node 24 LTS |
| Azure Cache for Redis | Optional — speeds up repeated queries | C0 Basic or higher |

---

## Step 1 — Create Azure Resources

### Using Azure CLI

```bash
# Variables — adjust to your environment
RG="your-resource-group"
LOCATION="westeurope"
STORAGE="yourstorageaccount"
PLAN="xpp-mcp-plan"
APP="xpp-mcp-server"

# Resource group
az group create --name $RG --location $LOCATION

# Storage account + containers
az storage account create \
  --name $STORAGE \
  --resource-group $RG \
  --location $LOCATION \
  --sku Standard_LRS

az storage container create --name xpp-metadata --account-name $STORAGE
az storage container create --name packages     --account-name $STORAGE

# App Service plan (Linux)
az appservice plan create \
  --name $PLAN \
  --resource-group $RG \
  --sku P0v3 \
  --is-linux

# Web app — Node 24 LTS
az webapp create \
  --name $APP \
  --plan $PLAN \
  --resource-group $RG \
  --runtime "NODE:24-lts"
```

> For a development or test server **B1 SKU is sufficient**. Use P0v3 or higher for a production
> server shared by a team (minimum 3.5 GB RAM for the full metadata database).

### Using the Azure Portal

1. Create a **Resource Group** in your chosen region.
2. Create a **Storage Account** (Standard LRS). Inside it, create two **Blob Containers**:
   - `xpp-metadata` — receives the built databases
   - `packages` — receives the raw `PackagesLocalDirectory.zip` used by pipelines
3. Create an **App Service Plan** (Linux, Node 24 LTS, P0v3 recommended).
4. Create a **Web App** on that plan.

---

## Step 2 — Configure App Settings

Run this once after creating the web app. Replace the placeholders with real values.

```bash
# Get the storage connection string
CONN=$(az storage account show-connection-string \
  --name $STORAGE --resource-group $RG --query connectionString -o tsv)

az webapp config appsettings set \
  --name $APP \
  --resource-group $RG \
  --settings \
    AZURE_STORAGE_CONNECTION_STRING="$CONN" \
    BLOB_CONTAINER_NAME="xpp-metadata" \
    DB_PATH="./data/xpp-metadata.db" \
    LABELS_DB_PATH="./data/xpp-metadata-labels.db" \
    LABEL_LANGUAGES="en-US" \
    MCP_SERVER_MODE="read-only" \
    NODE_ENV="production" \
    SCM_DO_BUILD_DURING_DEPLOYMENT="true"
```

**Key settings:**

| Setting | Value | Notes |
|---------|-------|-------|
| `AZURE_STORAGE_CONNECTION_STRING` | Connection string | From Azure Portal → Storage Account → Access keys |
| `BLOB_CONTAINER_NAME` | `xpp-metadata` | Container that holds the uploaded databases |
| `MCP_SERVER_MODE` | `read-only` | Hides file-creation tools — clients use the local hybrid companion instead |
| `LABEL_LANGUAGES` | e.g. `en-US,cs,de` | Reduce to only what your team uses — each language adds ~125 MB |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `true` | Oryx runs `npm ci` on deploy, compiling native addons for the correct Node version |

**Optional Redis settings (recommended for teams):**

```bash
az webapp config appsettings set \
  --name $APP --resource-group $RG \
  --settings \
    REDIS_ENABLED="true" \
    REDIS_URL="rediss://your-redis.redis.cache.windows.net:6380" \
    REDIS_PASSWORD="your-redis-access-key"
```

---

## Step 3 — Deploy the Application

```powershell
# Clone and build
git clone https://github.com/dynamics365ninja/d365fo-mcp-server.git
cd d365fo-mcp-server
npm install
npm run build

# Package for deployment
# Do NOT include node_modules — Oryx rebuilds them on App Service
# for the correct platform (Linux x64 with the exact Node version).
Compress-Archive -Path dist, package.json, package-lock.json, startup.sh `
  -DestinationPath deploy.zip

# Deploy
az webapp deployment source config-zip `
  --resource-group $RG `
  --name $APP `
  --src deploy.zip
```

> **Why exclude node_modules?** The `better-sqlite3` addon is a native module compiled for your
> local OS. Including it would break the server on Linux. The `SCM_DO_BUILD_DURING_DEPLOYMENT=true`
> setting tells Oryx to run `npm ci` after unpacking, compiling everything for Linux.

---

## Step 4 — Build and Upload the Metadata Database

The metadata database must be built from your D365FO installation and uploaded to Blob Storage.
The App Service downloads it automatically on startup.

### Option A — Azure DevOps Pipelines (recommended)

See [Azure DevOps Pipelines](#azure-devops-pipelines) below. The pipelines handle extraction,
database build, and upload automatically.

### Option B — Manual (from your Windows VM)

```powershell
# On your D365FO Windows VM
cd K:\d365fo-mcp-server

# Configure .env
copy .env.example .env
# Set PACKAGES_PATH, CUSTOM_MODELS, AZURE_STORAGE_CONNECTION_STRING, BLOB_CONTAINER_NAME

# Extract metadata and build the database
npm run extract-metadata
npm run build-database

# Upload to Blob Storage
az storage blob upload `
  --connection-string $env:AZURE_STORAGE_CONNECTION_STRING `
  --container-name xpp-metadata `
  --name xpp-metadata.db `
  --file data/xpp-metadata.db `
  --overwrite

az storage blob upload `
  --connection-string $env:AZURE_STORAGE_CONNECTION_STRING `
  --container-name xpp-metadata `
  --name xpp-metadata-labels.db `
  --file data/xpp-metadata-labels.db `
  --overwrite
```

The App Service will download the fresh database on the next cold start (or restart).

---

## Step 5 — Verify

```bash
curl https://$APP.azurewebsites.net/health
```

Expected response: `{"status":"ok","mode":"read-only", ...}`

Check that the tool count in the response matches `read-only` mode (all tools except
`create_d365fo_file`, `modify_d365fo_file`, `create_label`).

---

## Azure DevOps Pipelines

Three ready-to-use pipelines are in `.azure-pipelines/`:

| Pipeline | When to use | Duration |
|----------|-------------|----------|
| `d365fo-mcp-data-build-custom.yml` | After any change to your custom models | ~5–15 min |
| `d365fo-mcp-data-build-standard.yml` | After a D365FO version upgrade or hotfix | ~30–45 min |
| `d365fo-mcp-data-platform-upgrade.yml` | Full rebuild: standard + custom + database | ~1.5–2 h |

### Required Variable Group

Create a variable group named **`xpp-mcp-server-config`** in Azure DevOps Library:

| Variable | Secret | Example value |
|----------|--------|--------------|
| `AZURE_STORAGE_CONNECTION_STRING` | Yes | Connection string from Azure Portal |
| `BLOB_CONTAINER_NAME` | No | `xpp-metadata` |
| `CUSTOM_MODELS` | No | `MyPackage` |
| `AZURE_SUBSCRIPTION` | No | Name of your Azure DevOps service connection |
| `AZURE_APP_SERVICE_NAME` | No | `xpp-mcp-server` |

### Uploading Standard Packages

The `d365fo-mcp-data-build-standard.yml` pipeline needs the raw `PackagesLocalDirectory`
from your D365FO VM as a zip in the `packages` container:

```powershell
# From your D365FO VM
Compress-Archive `
  -Path "K:\AosService\PackagesLocalDirectory" `
  -DestinationPath "PackagesLocalDirectory.zip"

az storage blob upload `
  --connection-string $env:AZURE_STORAGE_CONNECTION_STRING `
  --container-name packages `
  --name PackagesLocalDirectory.zip `
  --file PackagesLocalDirectory.zip `
  --overwrite
```

This only needs to be re-uploaded after a D365FO version upgrade or hotfix rollup.

---

## Updating the Server

When a new version of the MCP server is released:

```powershell
cd d365fo-mcp-server
git pull
npm install
npm run build

Compress-Archive -Path dist, package.json, package-lock.json, startup.sh `
  -DestinationPath deploy.zip

az webapp deployment source config-zip `
  --resource-group $RG --name $APP --src deploy.zip
```

The App Service restarts automatically after deployment. No database rebuild is required
unless the release notes say otherwise.

---

## Troubleshooting

### "Module did not self-register" on startup
The `node_modules` from a Windows machine were deployed instead of letting Oryx build them.
Redeploy without `node_modules` and confirm `SCM_DO_BUILD_DURING_DEPLOYMENT=true` is set.

### Database build fails with "FTS5 not available"
The SQLite installation lacks FTS5. Reinstall the native module:
```powershell
npm rebuild better-sqlite3
```

### No metadata found after extraction
- Check that `PACKAGES_PATH` points to the directory containing XML model files
- Check that `CUSTOM_MODELS` matches the actual folder names exactly (case-sensitive on Linux)
- Verify file permissions on the packages directory

### Slow response times
1. Enable Redis: set `REDIS_ENABLED=true` and configure `REDIS_URL` and `REDIS_PASSWORD`
2. Scale up the App Service Plan to B2 or P1v3
3. Check available memory — minimum 1.75 GB for B1, 3.5 GB for P0v3

### Server starts but returns no tools
Confirm `MCP_SERVER_MODE=read-only` is set. If it is not set, the server defaults to `full`
mode but on Azure the file-write tools will fail since there is no local D365FO filesystem.
