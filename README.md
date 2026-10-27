# kcal

A food, nutrition, and weight tracker built with Preact, Express, and SQLite.
The app also exposes a scoped MCP connection for ChatGPT.

## Local development

Use Node.js 24 and install the committed dependency tree with `npm ci`. Copy `.env.example`
to `.env` and fill in the required settings; never commit credentials. Keep
`PORT=3000` for the development API.

Run these in separate terminals:

```sh
npm run server:dev
npm run dev
```

Vite serves the app on `http://localhost:5173` and proxies API requests to Express.
For the production topology, `npm start` builds the frontend and starts Express,
which serves both the app and API on the configured port.
Use `npm ci --include=dev` when installing a release: the current build/start
workflow needs development tooling, including `tsx`. Keep the committed
lockfile with the release rather than resolving dependencies on each startup.

## Checks

```sh
npm run check
npm run build
npm test
```

`check` runs the frontend, backend, and test TypeScript checks and validates the
journey catalogue against discovered Playwright test titles. It does not execute
the tests. `npm test` builds the production app and starts a fresh test backend.
Run Playwright commands sequentially: they share port 3001 and
`/tmp/kcal-e2e.db`, which is reset before each run.

## Project guidance

- [Repository conventions and invariants](AGENTS.md)
- [Test journeys](tests/JOURNEYS.md)
- [MCP setup and contracts](docs/mcp.md)
- [Themes](docs/themes.md)
- [Dependency maintenance](docs/dependency-upgrade.md)
- [Security controls](docs/security-hardening.md)
- [Refactoring history](docs/refactoring.md)

`src/` contains the app, `server/` the backend, and `shared/` the contracts and
calculations used by both. See the repository guidelines for module ownership.
