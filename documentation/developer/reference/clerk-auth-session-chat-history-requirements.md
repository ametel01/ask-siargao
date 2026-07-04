# Clerk Auth, Session, Chat History, Profile, And Rating Requirements

This document specifies the technical changes needed to add Clerk-backed
authentication, persisted user state, chat history, profile details, and AI response
ratings to Ask Siargao.

## Current State

Ask Siargao is a Next.js App Router app running on Next `16.2.9` with Bun,
Drizzle, and Postgres/PGlite test helpers. No Clerk package is installed today.

The current app is public-first:

- `/chat` renders `ChatWorkspace` as a client component.
- `/api/chat` accepts a strict JSON body with recent `user` and `assistant`
  messages plus optional browser geolocation context.
- The chat route is stateless. It validates input, runs the Ask Siargao agent,
  returns the assistant answer and public artifacts, and does not persist either
  user or assistant turns.
- Saved trip artifacts use browser local storage under
  `ask-siargao:saved-trip:v1`.
- Saved trip APIs persist selected recommendation cards, itineraries, and notes
  under an anonymous `local_trip_*` client key that is hashed on the server.
- Share schemas intentionally reject full chat transcripts, geolocation, tool-call
  arguments, raw provider payloads, Google review fields, and exact coordinates.

The database already includes `users`, `saved_trips`, `saved_trip_items`,
`shared_trip_plans`, and audit tables that reference `users.id`, but the app does
not currently create or authenticate those users.

## Available Clerk Skills

The relevant local Clerk skills are:

- `clerk-setup`: install and wire Clerk into a framework app.
- `clerk-nextjs-patterns`: Next.js App Router patterns for `proxy.ts`,
  `auth()`, protected routes, route handlers, Server Actions, and user-scoped
  caching.
- `clerk-webhooks`: webhook verification and user data sync.
- `clerk-custom-ui`: Clerk prebuilt component theming and custom sign-in flows.
- `clerk-cli`: Clerk CLI operations for linking apps, pulling env vars, and
  running `clerk doctor`.
- `clerk-backend-api`: authenticated Clerk Backend API calls for user/admin
  operations.
- `clerk-react-patterns`, `clerk-react-router-patterns`, and `clerk-orgs` are
  available but are not primary requirements for this Next.js App Router slice.

## Product Requirements

1. Users can sign in, sign up, and sign out with Clerk.
2. Clerk maintains browser session persistence; Ask Siargao must not implement
   custom password, session-cookie, or token storage.
3. Public chat may remain available to anonymous users, but signed-in users get
   server-persisted chat threads and saved trip state.
4. Signed-in users can resume previous chat threads from any browser session.
5. Signed-in users can start a new thread without deleting prior history.
6. Signed-in users can view and edit Ask Siargao profile details that are
   application-specific and not owned by Clerk identity fields.
7. Signed-in users can rate an assistant response once, and can update that
   rating later.
8. Shared trip links remain public token pages and must not expose the owner,
   full chat history, profile details, exact geolocation, or non-public provider
   data.

## Clerk Integration Requirements

Install `@clerk/nextjs`.

Add these environment variables to `.env.example` and
`documentation/developer/reference/environment.md`:

| Variable | Surface | Required For | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Public/client-safe | Clerk frontend SDK | Required by `ClerkProvider` and Clerk components. |
| `CLERK_SECRET_KEY` | Server only | `auth()`, route protection, backend API calls | Must not use the `NEXT_PUBLIC_` prefix. |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Server only | Clerk webhook verification | Required by `verifyWebhook()`. |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | Public/client-safe | Custom sign-in route | Set to `/sign-in` if custom auth pages are added. |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | Public/client-safe | Clerk redirects | Recommended default: `/chat`. |
| `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | Public/client-safe | Clerk redirects | Recommended default: `/chat`. |

Add `src/proxy.ts` because this app uses the `src` directory and Next 16.
The proxy must run on application and API routes, keep sign-in/sign-up and
webhooks public, and protect only the authenticated data surfaces.

Required public routes:

- `/`
- `/chat`
- `/sign-in(.*)`
- `/sign-up(.*)`
- `/trips/shared(.*)`
- `/api/chat`
- `/api/trips/saved(.*)`
- `/api/trips/share(.*)`
- `/api/public(.*)`
- `/api/stripe/webhook`
- `/api/clerk/webhooks`

Required protected routes:

- `/settings(.*)`
- `/profile(.*)`
- `/chat/history(.*)` if implemented as a page
- `/api/me(.*)`
- `/api/chat/threads(.*)`
- `/api/chat/ratings(.*)`

Wrap `src/app/layout.tsx` with `ClerkProvider` inside `<body>`, preserving the
existing font variables, `TooltipProvider`, and `Toaster`.

Add Clerk UI routes:

- `src/app/sign-in/[[...sign-in]]/page.tsx`
- `src/app/sign-up/[[...sign-up]]/page.tsx`

The `/chat` header should show signed-out actions and a signed-in user menu. Use
Clerk components first; only build custom flows if the prebuilt components cannot
meet the product design.

## Identity And User Sync

Use Clerk user IDs as `users.id` values for new authenticated users. This avoids a
mapping table and matches existing `saved_trips.user_id` and
`audit_requests.user_id` references.

Clerk remains the source of truth for authentication identity:

- email addresses
- verified email state
- passwordless/social identity
- session lifecycle
- account deletion events

The local database stores only data the app needs for joins, search, ownership,
and profile personalization.

Add a public webhook endpoint:

- `POST /api/clerk/webhooks`

The handler must:

- call `verifyWebhook(req)` from `@clerk/nextjs/webhooks`;
- process at least `user.created`, `user.updated`, and `user.deleted`;
- upsert local `users` rows for create/update events;
- soft-delete or anonymize local users on delete, depending on the retention
  policy chosen before implementation;
- return `2xx` only after the local mutation succeeds.

Webhook delivery is eventually consistent. Synchronous request paths that need
the current user must use `auth()` and session claims, not assume the webhook has
already created the local row.

## Database Requirements

### Changed `users`

Keep `users.id` as the primary key and store the Clerk user ID in it for all new
authenticated users.

Proposed Drizzle shape:

```ts
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    imageUrl: text("image_url"),
    clerkUpdatedAt: timestamp("clerk_updated_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("users_deleted_at_idx").on(table.deletedAt),
    index("users_last_seen_at_idx").on(table.lastSeenAt),
  ],
);
```

Migration SQL:

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS clerk_updated_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS users_deleted_at_idx ON users(deleted_at);
CREATE INDEX IF NOT EXISTS users_last_seen_at_idx ON users(last_seen_at);
```

### New `user_profiles`

`user_profiles` stores Ask Siargao-specific traveler profile details. Do not put
authentication identity fields here.

Proposed Drizzle shape:

```ts
export const userProfiles = pgTable(
  "user_profiles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id),
    displayName: text("display_name"),
    homeCountry: text("home_country"),
    travelStyle: text("travel_style"),
    budgetLevel: text("budget_level"),
    dietaryNotes: text("dietary_notes"),
    accessibilityNotes: text("accessibility_notes"),
    interestsJson: jsonb("interests_json").$type<string[]>().notNull().default([]),
    preferredAreasJson: jsonb("preferred_areas_json").$type<string[]>().notNull().default([]),
    tripContextJson: jsonb("trip_context_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    marketingConsent: boolean("marketing_consent").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("user_profiles_updated_at_idx").on(table.updatedAt)],
);
```

Migration SQL:

```sql
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id text PRIMARY KEY REFERENCES users(id),
  display_name text,
  home_country text,
  travel_style text,
  budget_level text,
  dietary_notes text,
  accessibility_notes text,
  interests_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  preferred_areas_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  trip_context_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  marketing_consent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_profiles_updated_at_idx ON user_profiles(updated_at);
```

### Changed `saved_trips`

Keep anonymous `client_trip_key_hash` support for public/anonymous saved plans.
For authenticated users, associate rows with `user_id` and support listing by
user. On sign-in, migrate the current browser `local_trip_*` row into the signed-in
user by setting `saved_trips.user_id` when it is null.

Migration SQL:

```sql
CREATE INDEX IF NOT EXISTS saved_trips_user_id_idx ON saved_trips(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS saved_trips_user_client_trip_key_hash_idx
  ON saved_trips(user_id, client_trip_key_hash)
  WHERE user_id IS NOT NULL;
```

### New `chat_threads`

`chat_threads` is the owner-scoped conversation container.

Proposed Drizzle shape:

```ts
export const chatThreads = pgTable(
  "chat_threads",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull().default("New Siargao chat"),
    summary: text("summary"),
    status: text("status").notNull().default("active"),
    source: text("source").notNull().default("chat_workspace"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("chat_threads_user_id_updated_at_idx").on(table.userId, table.updatedAt),
    index("chat_threads_user_id_deleted_at_idx").on(table.userId, table.deletedAt),
  ],
);
```

Migration SQL:

```sql
CREATE TABLE IF NOT EXISTS chat_threads (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  title text NOT NULL DEFAULT 'New Siargao chat',
  summary text,
  status text NOT NULL DEFAULT 'active',
  source text NOT NULL DEFAULT 'chat_workspace',
  last_message_at timestamptz,
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_threads_user_id_updated_at_idx
  ON chat_threads(user_id, updated_at);

CREATE INDEX IF NOT EXISTS chat_threads_user_id_deleted_at_idx
  ON chat_threads(user_id, deleted_at);
```

### New `chat_messages`

`chat_messages` stores user and assistant-visible turns. Persist public response
artifacts, not raw provider payloads or private tool inputs.

Proposed Drizzle shape:

```ts
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => chatThreads.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull(),
    content: text("content").notNull(),
    status: text("status").notNull().default("complete"),
    requestId: text("request_id"),
    model: text("model"),
    clientMessageId: text("client_message_id"),
    sourcesJson: jsonb("sources_json").$type<Record<string, unknown>[]>().notNull().default([]),
    cardsJson: jsonb("cards_json").$type<Record<string, unknown>[]>().notNull().default([]),
    actionsJson: jsonb("actions_json").$type<Record<string, unknown>[]>().notNull().default([]),
    itinerariesJson: jsonb("itineraries_json")
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default([]),
    toolCallsJson: jsonb("tool_calls_json")
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default([]),
    contextSummaryJson: jsonb("context_summary_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("chat_messages_thread_id_created_at_idx").on(table.threadId, table.createdAt),
    index("chat_messages_user_id_created_at_idx").on(table.userId, table.createdAt),
    index("chat_messages_request_id_idx").on(table.requestId),
  ],
);
```

Migration SQL:

```sql
CREATE TABLE IF NOT EXISTS chat_messages (
  id text PRIMARY KEY,
  thread_id text NOT NULL REFERENCES chat_threads(id),
  user_id text NOT NULL REFERENCES users(id),
  role text NOT NULL,
  content text NOT NULL,
  status text NOT NULL DEFAULT 'complete',
  request_id text,
  model text,
  client_message_id text,
  sources_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  cards_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  actions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  itineraries_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  tool_calls_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  context_summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_messages_thread_id_created_at_idx
  ON chat_messages(thread_id, created_at);

CREATE INDEX IF NOT EXISTS chat_messages_user_id_created_at_idx
  ON chat_messages(user_id, created_at);

CREATE INDEX IF NOT EXISTS chat_messages_request_id_idx ON chat_messages(request_id);
```

### New `chat_response_ratings`

`chat_response_ratings` stores one rating per user and assistant message.

Proposed Drizzle shape:

```ts
export const chatResponseRatings = pgTable(
  "chat_response_ratings",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => chatMessages.id),
    threadId: text("thread_id")
      .notNull()
      .references(() => chatThreads.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    rating: text("rating").notNull(),
    reasonCodesJson: jsonb("reason_codes_json").$type<string[]>().notNull().default([]),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("chat_response_ratings_user_id_created_at_idx").on(table.userId, table.createdAt),
    index("chat_response_ratings_thread_id_idx").on(table.threadId),
  ],
);
```

Migration SQL:

```sql
CREATE TABLE IF NOT EXISTS chat_response_ratings (
  id text PRIMARY KEY,
  message_id text NOT NULL REFERENCES chat_messages(id),
  thread_id text NOT NULL REFERENCES chat_threads(id),
  user_id text NOT NULL REFERENCES users(id),
  rating text NOT NULL,
  reason_codes_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, message_id)
);

CREATE INDEX IF NOT EXISTS chat_response_ratings_user_id_created_at_idx
  ON chat_response_ratings(user_id, created_at);

CREATE INDEX IF NOT EXISTS chat_response_ratings_thread_id_idx
  ON chat_response_ratings(thread_id);
```

Valid `rating` values:

- `up`
- `down`

Valid `reason_codes_json` values should be enforced in Zod at the route boundary:

- `helpful`
- `not_relevant`
- `incorrect`
- `stale`
- `unsafe`
- `missing_sources`
- `too_verbose`
- `other`

## API Requirements

### Existing `/api/chat`

Extend the request schema:

```ts
{
  threadId?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  clientContext?: {
    geolocation?: {
      latitude: number;
      longitude: number;
      accuracyMeters?: number;
      capturedAt: string;
      consentScope: "single_request" | "trip_session";
    };
  };
}
```

Behavior:

- Anonymous requests keep the current stateless behavior.
- Authenticated requests use `await auth()` and persist the latest user message
  and assistant response.
- If `threadId` is omitted for an authenticated request, create a new
  `chat_threads` row.
- If `threadId` is provided, verify ownership before appending messages.
- Store exact browser coordinates only in the in-memory request to the agent.
  Persist only a context summary such as geolocation status, source, consent
  scope, and whether location was used as a proximity anchor.
- Return `threadId`, `userMessageId`, and `assistantMessageId` for authenticated
  persisted turns.

### New `/api/chat/threads`

Methods:

- `GET`: list the authenticated user's non-deleted threads, newest first.
- `POST`: create an empty thread, optionally with a title.

### New `/api/chat/threads/[threadId]`

Methods:

- `GET`: return one authenticated user's thread and messages.
- `PATCH`: update title, archive status, or soft-delete status.
- `DELETE`: soft-delete the thread.

All methods must return `401` when unauthenticated and `404` when the thread does
not belong to the authenticated user.

### New `/api/chat/ratings`

Methods:

- `PUT`: create or update the authenticated user's rating for an assistant
  message.

Request shape:

```ts
{
  messageId: string;
  rating: "up" | "down";
  reasonCodes?: string[];
  comment?: string;
}
```

The handler must:

- require authentication;
- load the assistant message and verify ownership through its thread;
- reject ratings for user messages;
- upsert by `(user_id, message_id)`;
- cap comments at 1,000 characters.

### New `/api/me/profile`

Methods:

- `GET`: return Clerk-derived display identity plus `user_profiles`.
- `PATCH`: update Ask Siargao profile details only.

Use Clerk as the source for account identity fields. Do not let this endpoint
update Clerk email addresses or sign-in methods.

### Changed Saved Trip APIs

For authenticated users:

- `GET /api/trips/saved` can list by current Clerk user without requiring a
  `tripId` query parameter.
- `POST /api/trips/saved` should associate the saved trip with `user_id`.
- `DELETE /api/trips/saved/[itemId]` must verify either matching anonymous
  `tripId` ownership or authenticated user ownership.
- Share creation must verify selected items belong to the authenticated user when
  the trip has `user_id`.

For anonymous users, preserve the current `tripId`-based behavior.

## Frontend Requirements

`ChatWorkspace` should support three states:

- Anonymous: current behavior plus sign-in/sign-up affordances.
- Signed in with no selected thread: show composer and create a persisted thread
  on first send.
- Signed in with selected thread: hydrate messages from
  `/api/chat/threads/[threadId]` and append new persisted turns.

Add response rating controls to completed assistant messages:

- icon-only thumbs up/down buttons with accessible labels;
- disabled state while saving;
- selected state after saved rating;
- optional feedback reason/comment flow after thumbs down.

Add profile/settings UI:

- `/settings` page or account panel for Ask Siargao profile details, with `/profile` preserved as a
  compatibility alias when present;
- use Clerk `UserButton` or account portal for identity/account management;
- keep Ask Siargao profile edits separate from Clerk account edits.

Add history UI:

- thread list sorted by `updated_at` or `last_message_at`;
- rename/archive/delete actions;
- empty state for first signed-in chat;
- no history shown to anonymous users.

## Privacy And Security Requirements

- Do not persist exact browser geolocation by default.
- Do not store raw provider payloads in chat history.
- Do not store non-public Google review text or author attribution in chat
  history.
- Persist only public `toolCalls` already redacted by the current chat route.
- Protect all user-owned data routes with Clerk `auth()`.
- Never trust `userId` from request bodies. Always derive it from Clerk auth.
- Return `404`, not `403`, for authenticated access to another user's thread,
  message, saved trip, or rating.
- Keep `/api/clerk/webhooks` public at the Clerk middleware layer but verify the
  webhook signature inside the handler.
- Keep `CLERK_SECRET_KEY` and `CLERK_WEBHOOK_SIGNING_SECRET` server-only.

## Implementation Phases

1. Add Clerk package, env docs, `src/proxy.ts`, `ClerkProvider`, sign-in/sign-up
   pages, and basic signed-in/signed-out UI.
2. Add user sync webhook and extend `users` with Clerk identity cache fields.
3. Add profile schema, `/api/me/profile`, and profile UI.
4. Add chat thread/message schema and persistence inside `/api/chat` for
   authenticated users.
5. Add chat history list/detail APIs and frontend hydration.
6. Add response rating schema, API, and assistant-message controls.
7. Add authenticated saved trip ownership and local-to-account migration.

## Test Requirements

Add Bun tests for:

- `src/proxy.ts` route matcher behavior where practical;
- webhook verification success/failure using mocked Clerk events;
- user upsert/delete sync logic;
- profile `GET`/`PATCH` authorization and validation;
- chat persistence on authenticated `/api/chat`;
- anonymous `/api/chat` remains stateless;
- thread ownership checks return `404`;
- rating upsert rejects user messages and cross-user messages;
- saved trip migration from anonymous `local_trip_*` to authenticated `user_id`.

Update existing migration parity tests to include:

- `user_profiles`
- `chat_threads`
- `chat_messages`
- `chat_response_ratings`
- new indexes and changed `users`/`saved_trips` columns.

Add or update Playwright tests for:

- signed-out chat remains usable or prompts sign-in according to the final product
  choice;
- signed-in chat persists after reload;
- thread list opens previous messages;
- profile edits persist;
- thumbs up/down rating survives reload;
- shared trip links do not expose owner profile or chat transcript.

## Open Decisions

- Whether anonymous chat remains available after auth launches, or whether `/chat`
  should become a protected route.
- Whether `user.deleted` should soft-delete, anonymize, or hard-delete dependent
  user-owned rows.
- Whether assistant ratings are binary only or should support 1-5 scoring.
- Whether profile details should be used immediately in agent prompts or only
  stored for future personalization.
- Whether saved trip migration should happen automatically on first sign-in or
  only after explicit user confirmation.

## Implemented Decisions

- Anonymous `/chat` remains available; signed-in users get persisted owner-scoped
  chat, ratings, profile, and saved-trip behavior.
- `user.deleted` anonymizes local app-cached identity fields and marks the user
  row with `deleted_at` so dependent foreign keys remain valid.
- Assistant response ratings are binary `up` or `down`, with optional reason
  codes and comments.
- Profile details are stored and editable but are not injected into agent prompts
  in this implementation slice.
- Saved-trip migration happens during signed-in saved-trip sync. A local trip key
  can be claimed only when the matching saved trip is unowned or already owned by
  the current Clerk user; conflicting owner attempts fail safely.

## Source References

Official Clerk references checked for this requirements pass:

- `https://clerk.com/docs/nextjs/getting-started/quickstart`
- `https://clerk.com/docs/references/nextjs/clerk-middleware`
- `https://clerk.com/docs/webhooks/sync-data`

Repository references:

- `package.json`
- `src/app/layout.tsx`
- `src/app/chat/page.tsx`
- `src/features/chat/ChatWorkspace.tsx`
- `src/app/api/chat/chat-route.ts`
- `src/app/api/trips/trip-routes.ts`
- `src/server/trips/shared-trip-store.ts`
- `src/server/trips/shared-trip-types.ts`
- `src/server/db/schema.ts`
- `drizzle/0000_initial_schema.sql`
- `src/server/db/migration.test.ts`
- `documentation/developer/reference/routes-and-surfaces.md`
