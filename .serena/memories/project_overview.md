# CF Serverless Registry - Project Overview

## Purpose
A Docker container registry implementation running on Cloudflare Workers with R2 storage backend. Supports full Docker V2 Registry API for pushing and pulling container images.

## Tech Stack
- **Runtime**: Cloudflare Workers
- **Storage**: Cloudflare R2 (S3-compatible object storage)
- **Language**: TypeScript
- **Router**: itty-router v4
- **Auth**: JWT + Basic Auth (@tsndr/cloudflare-worker-jwt)
- **Testing**: Vitest with Cloudflare Workers pool
- **Package Manager**: pnpm (required)
- **Build**: Wrangler (Cloudflare CLI)

## Key Features
- Docker V2 Registry API compliance
- Username/Password and JWT public key authentication
- Pull fallback to other registries (Docker Hub, GCR, GitHub, etc.)
- Chunked upload support for large layers
- R2 multipart upload for layers >500MB

## Architecture
- `src/router.ts` - Main V2 API routes
- `src/registry/` - Registry implementations (R2, HTTP fallback)
- `src/chunk.ts` - Chunking logic for large uploads
- `push/` - Standalone tool for pushing large images via chunked uploads
- `src/auth.ts` - Authentication handling