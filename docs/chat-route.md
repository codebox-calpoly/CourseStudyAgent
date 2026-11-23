# Chat route draft (#44)

This implementation is **not ready to merge or enable**. The public POST entry point intentionally returns 503 until real dependencies are connected. The tested orchestration is `createChatHandler`; `createProductionChatHandler` supplies membership checks, class scope, model calls, rate limiting, persistence and logging.

## Integration checklist

- Merge class scope (#45 / PR #55).
- Connect #41's signed-in user adapter; normalize its unauthenticated error to `ChatHttpError(401, ...)`. Do not convert network/server failures to authenticated users.
- Apply #47's chat-table migration (currently PR #54). The SQL store follows that proposed schema; verify against its final migration.
- Connect #49's retrieval function to the `Source` contract below.
- Connect #50's classifier only after Snehil reviews the scenarios in PR #56 and the classifier is implemented and tested.
- Tech leads choose `CHAT_MODEL` and the single `BACKUP_CHAT_MODEL` constant, plus their current token pricing for `estimateCost`. Unknown usage or pricing is reported as null, not zero.
- Coordinate this SSE/request format with #46 before the API spec is frozen.
- Replace the draft POST with the composed handler and run the HTTP acceptance cases against the real route.
- Run the opt-in PostgreSQL tests and a signed-in end-to-end conversation once the local DB/auth setup is available.

## Contracts for teammate review

`retrieve(classIds: string[], question: string): Promise<Source[]>`, where each source contains `id`, `text`, `fileId`, `fileName`, `uploadedBy`, `professorReleased`, `kind`, `date: Date`, and `similarity`. IDs/ownership are server-only. `date` should prefer the lecture date and fall back to upload date. The retrieval implementation must enforce the supplied class filter.

`classify({ message, recentMessages, files })` uses #44's exact shape, returning `answer`, `hint_only`, `embargoed`, or `confidential`. Files contain only the requesting student's retrieved uploads; excerpts are capped at 1,000 characters. History is limited to the last ten messages in the authorized conversation.

POST body: `{ message, idempotencyKey, conversationId? }`. Omit `conversationId` for a new conversation and reuse the returned ID for follow-ups. Use a fresh idempotency key for every new question; reuse it unchanged on a retry. Keys are scoped to the user and class. Reusing a key with another message or conversation returns 409.

Errors use `{ error: string }`: 400 malformed input, 401 signed out, 403 nonmember/foreign conversation, 409 key conflict, 429 rate limit, 503 unavailable model/storage/integration.

Successful response is `text/event-stream` with three named events:

```text
event: message
data: {"text":"Start with a base case. [1]"}

event: citations
data: {"citations":[{"number":1,"label":"a classmate's notes","date":"2026-11-01"}]}

event: done
data: {"conversationId":"..."}
```

Model output is buffered until privacy checks and the database commit. This is SSE delivery of a validated answer, **not live token-by-token generation**. This tradeoff needs review: streaming raw tokens would release unsafe text before it can be rejected and would complicate retries. No partial model answer is emitted on failure.

## Privacy and persistence decisions to review

Private filenames and text are withheld from the answer model; numbered source slots remain intact. Only own/professor-released source text reaches that model. Confidential/embargoed results are replaced with fixed refusals even if a fake model tries to disclose private content. An additional verbatim-overlap check rejects leaked private passages and filenames. That check is not a semantic paraphrase detector; withholding private text is the conservative defense. It limits the ability to learn from classmates' notes and should be reviewed before enabling the route. Fake tests do not prove real-model homework judgments.

The store holds a PostgreSQL transaction and user/class advisory lock during generation to serialize concurrent retries without adding tables beyond #47. It saves the user message, assistant response and citations in that transaction. Citation failure rolls everything back. Model attempts each time out after 30 seconds; primary gets one retry, then backup gets one attempt. Retrieval/classification time is additional. A future durable processing-state design could avoid holding a DB connection during generation. In-memory rate limits apply per process only.

Usage logs currently cover answer-model attempts. Retrieval embedding usage and classifier-model usage need accounting hooks from their adapters before claiming that every model call is covered. Failed/cancelled attempts may not expose provider token counts; those remain null.

## Validation

The unit tests use fake dependencies and a transactional database fake to test orchestration, privacy, retry timing, deduplication and rollback contracts. `store.integration.test.ts` additionally exercises actual PostgreSQL foreign-key rollback and duplicate requests when `CHAT_TEST_DATABASE_URL` points to a disposable local database. It uses temporary tables and is skipped without that explicit variable. Real sign-in, retrieval, classification and database migration compatibility remain integration checks, not claims made by the unit tests.
