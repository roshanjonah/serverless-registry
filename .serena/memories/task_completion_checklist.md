# Task Completion Checklist

When completing a task, ensure:

## Code Quality
- [ ] Type checking passes: `pnpm typecheck`
- [ ] Tests pass: `pnpm test`
- [ ] Code follows existing patterns in codebase
- [ ] Error handling implemented for edge cases

## Registry-Specific
- [ ] V2 Registry API compliance maintained
- [ ] Chunking logic respects size limits
- [ ] Authentication properly handled
- [ ] R2 storage operations use correct paths

## Deployment Considerations
- [ ] Changes tested with `pnpm dev:miniflare`
- [ ] wrangler.toml updated if new bindings/vars needed
- [ ] Secrets management via `wrangler secret put` (never in wrangler.toml)
- [ ] Consider Worker request/response size limits (500MB)

## Documentation
- [ ] Update README.md if public API changes
- [ ] Update push/README.md if push tool changes
- [ ] Add comments for complex chunking/streaming logic