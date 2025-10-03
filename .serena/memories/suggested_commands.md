# Common Commands

## Development
```bash
# Install dependencies
pnpm install

# Local development with live reload
pnpm dev:miniflare

# Type checking
pnpm typecheck

# Run tests
pnpm test
```

## Deployment
```bash
# Deploy to production (with minification)
pnpm deploy

# Manual deploy
npx wrangler deploy --env production

# Create R2 bucket
npx wrangler --env production r2 bucket create r2-registry

# Set secrets
npx wrangler secret put USERNAME --env production
npx wrangler secret put PASSWORD --env production
npx wrangler secret put JWT_REGISTRY_TOKENS_PUBLIC_KEY --env production
```

## Push Tool (for large images)
```bash
cd push
bun install

# Push large image
docker tag my-image:latest $IMAGE_URI
echo $PASSWORD | USERNAME_REGISTRY=username bun run index.ts $IMAGE_URI
```

## Docker Usage
```bash
# Login
echo $PASSWORD | docker login --username $USERNAME --password-stdin $REGISTRY_URL

# Push/Pull
docker push $REGISTRY_URL/image:tag
docker pull $REGISTRY_URL/image:tag
```