# Large Image Handling

## Current Limitations
- **Worker Request Body Limit**: 500MB max per request (plan dependent)
- **Standard Docker Push**: Limited to layers ≤500MB
- **Workaround**: Use `./push` tool for layers >500MB

## Chunking Configuration
- `MINIMUM_CHUNK`: 5MiB (src/chunk.ts:6)
- `MAXIMUM_CHUNK`: 5GiB (src/chunk.ts:9)
- `MAXIMUM_CHUNK_UPLOAD_SIZE`: 100MB (src/chunk.ts:12)

## OCI Chunk Headers
Worker responds with chunking limits in upload creation:
- `OCI-Chunk-Min-Length`: Max of 5MiB or custom minimum
- `OCI-Chunk-Max-Length`: Min of 100MB or custom maximum

Located in:
- src/router.ts:379-383 (POST /v2/:name/blobs/uploads)
- src/router.ts:409-413 (GET /v2/:name/blobs/uploads/:uuid)

## Push Tool (`./push`)
- **Runtime**: Bun
- **Method**: Exports image via `docker save`, chunks layers, uploads via Registry V2 API
- **Chunking**: Respects `oci-chunk-max-length` header from registry
- **Authentication**: Basic auth only
- **Usage**: `echo $PASSWORD | USERNAME_REGISTRY=user bun run index.ts $IMAGE_URI`