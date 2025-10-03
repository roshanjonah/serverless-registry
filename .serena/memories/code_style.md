# Code Style and Conventions

## TypeScript Configuration
- Base config: `tsconfig.base.json`
- Strict mode enabled
- Node compatibility flag required for Workers

## Formatting
- **Tool**: Prettier 3.3.3
- **Config**: `.prettierrc.js`
- No explicit format command in package.json (manual prettier usage)

## Linting
- **Tool**: ESLint 8.57.0
- No explicit lint command in package.json

## Naming Conventions
- camelCase for variables/functions
- PascalCase for types/interfaces
- SCREAMING_SNAKE_CASE for constants (e.g., MINIMUM_CHUNK, MAXIMUM_CHUNK)

## Error Handling
- Custom error classes in `src/errors.ts` and `src/v2-errors.ts`
- Use `wrap()` helper for async error handling
- Return V2 Registry API compliant error responses

## Testing
- Framework: Vitest with Cloudflare Workers pool
- Test files: `test/` directory
- Config: `test/vitest.config.ts`
- Run: `pnpm test`