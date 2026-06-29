# 003 - Stop Logging Plaintext Chat Previews

Status: ready  
Priority: P1  
Effort: small  
Risk: low  
Depends on: none  
Category: privacy and observability  
Planned at: `2026-06-30` against `e8b08d4`

## Goal

Remove plaintext chat-message previews from server logs while preserving useful operational
signals such as message length, hash, model, route status, and latency.

## Current Evidence

`src/app/api/chat/chat-route.ts` logs a summarized latest user message:

- log call around the chat route includes `latestUserMessage: summarizeMessageForLogs(...)`;
- `summarizeMessageForLogs()` returns `length`, `hash`, and `preview`.

The hash and length are useful for correlation. The preview can include user-entered travel
details and should not be written to logs.

Existing tests in `src/app/api/chat/route.test.ts` already include logger capture helpers that
can be extended to assert the preview is absent.

## In Scope

- `src/app/api/chat/chat-route.ts`
- `src/app/api/chat/route.test.ts`
- Documentation only if there is an existing logging/privacy reference that mentions previews.

## Out of Scope

- Changing chat request/response payloads.
- Removing hashes or length metrics.
- Redesigning the audit logger.
- Provider-specific redaction outside this route.

## Implementation Steps

1. Create a branch:

   ```sh
   git switch -c advisor/003-no-chat-preview-logs
   ```

2. Inspect current logging and tests:

   ```sh
   rg -n "summarizeMessageForLogs|latestUserMessage|captureLogger|preview" src/app/api/chat
   ```

3. Change `summarizeMessageForLogs()` so it no longer returns plaintext `preview`.

   Keep low-risk metadata, for example:

   - `length`;
   - `hash`;
   - optionally `lineCount` or `containsAttachment` only if already easy to derive without content.

4. Update the route log shape if needed:

   - keep the field name if compatibility matters;
   - or rename to `latestUserMessageMetadata` if tests and logs become clearer.

5. Add a regression test in `src/app/api/chat/route.test.ts`:

   - send a prompt with a distinctive sensitive phrase;
   - capture emitted logs;
   - assert logs include non-sensitive metadata such as length/hash;
   - assert the distinctive phrase does not appear anywhere in logged arguments.

6. Search for other direct chat preview logging in the same route and remove it if found.

## Verification

Run:

```sh
bun test src/app/api/chat/route.test.ts
bun run lint
bun run typecheck --incremental false
rg -n "preview" src/app/api/chat/chat-route.ts
```

Expected:

- chat route tests pass;
- lint and typecheck pass;
- `rg` shows no plaintext chat preview field in `chat-route.ts`, or only unrelated non-message
  usage with an obvious reason.

## Done Criteria

- No plaintext latest-user-message preview is logged by the chat route.
- A regression test fails if a distinctive prompt phrase reaches logs.
- Operational correlation still has non-content metadata.
- Verification commands pass.

## Stop Conditions

Stop and update this plan if:

- downstream log consumers require the exact `preview` field name and need a compatibility
  migration;
- another logging layer outside this route reintroduces message content and needs a broader
  privacy review.

## Suggested Commit

```text
Remove chat preview logging
```
