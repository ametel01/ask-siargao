# Use Clerk user IDs as account identifiers

Ask Siargao will continue using immutable Clerk user IDs as local Ask Siargao Account identifiers
for the production-readiness work instead of introducing a separate internal identifier and
migrating every ownership relationship. This accepts provider coupling and a more expensive future
identity-provider migration to avoid a broad, high-risk data migration during launch hardening;
Account Closure will replace the readable identifier with a versioned keyed-hash Closure Tombstone
for an approved retention period while other ownership links are removed or anonymized according
to policy.
