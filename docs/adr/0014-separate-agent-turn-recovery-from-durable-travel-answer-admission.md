---
status: accepted
---

# Separate Agent Turn Recovery from durable Travel Answer admission

Agent Turn Recovery will classify in-process candidates and own bounded evidence, output, tool, and
model recovery, returning typed continuation, ordinary completion, Limited Answer Candidate, or
failure dispositions. It composes the Evidence Lifecycle and may finalize recovery-local evidence
and artifact decisions, while successful result construction, public assembly and sanitization,
durable storage and Usage settlement, and authentication, configuration, commercial, and emergency
refusals remain outside. This preserves bounded recovery without letting it decide durability or
billing.

The recovery seam is a per-turn lifecycle with a module-owned strategy catalog and
dependency-aware scheduling. It returns structured dispositions and reasons; terminal synthesis
cannot start more tools or recursively re-enter recovery.

Each lifecycle is request-scoped, serialized, and terminal after completion or failure; it is not
persisted for crash resumption. Only classified operational failures are recoverable—programming
errors and invariant violations remain visible to the outer runtime.

Client delivery cancellation does not cancel recovery or prevent an admitted paid result from
being stored, settled, and replayed. Only a server-owned generation abort may stop the lifecycle
without constructing a fallback.

The agent runtime will depend on one public recovery seam; evidence lifecycle, repair strategies,
and deterministic terminal construction remain behind it. A stored Travel Answer retains only its
public completion status and coarse reason, while detailed attempts, internal reasons, evidence
diagnostics, and upstream request identifiers remain telemetry. Migration characterizes intended
behavior first and never dual-runs provider work.

Limited outcomes map centrally to the existing public completion status and three coarse reasons;
failed recovery remains a generic generation failure that consumes no allowance or Usage. An
optional terminal model call runs only when commercially authorized, otherwise recovery uses
admissible deterministic construction. The outer runtime emits one content-free structured summary
for each terminal recovery outcome.
