# Environment configuration

Install dependencies with `pnpm install` (Node.js 24 and pnpm 11).
Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, and `pnpm format` to verify changes.

`src/lib/env.ts` exports `getEnv(source = process.env)`. Call it when runtime
configuration is needed. It returns `DATABASE_URL`, `AI_GATEWAY_API_KEY`, and
`AUTH_SECRET`, or throws an error listing every missing or empty value. It never
validates at import time and does not include secret values in errors.

`.env.example` lists the required variables with empty placeholders. Provide real
values through your runtime environment. The helper validates supplied values; it
does not read `.env` files itself. Tests pass sample values directly and require no
accounts, database connection, API keys, or `.env.local` file.

```ts
import { getEnv } from "./src/lib/env.js";

const env = getEnv({
  DATABASE_URL: "postgresql://localhost/course_study_test",
  AI_GATEWAY_API_KEY: "example-key",
  AUTH_SECRET: "example-secret",
});
```
