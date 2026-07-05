import type { GovernedEvidence, GovernedFact, NormalizedSourceRecord } from "@/server/facts/types";

type QueryResult<T> = { rows: T[] };

export type ProviderBatchWriteDatabase = {
  query<T>(query: string, params?: unknown[]): Promise<QueryResult<T>>;
};

type RawSnapshotInput = {
  id: string;
  sourceProfileId: string;
  fetchedAt: string;
  contentHash: string;
  allowedUse: string;
};

type SourceCredibilityScoreInput = {
  id: string;
  sourceProfileId: string;
  score: number;
  label: string;
  drivers: readonly string[];
};

type FactConfidenceScoreInput = {
  id: string;
  factId: string;
  score: number;
  label: string;
  drivers: readonly string[];
};

export type ProviderFactGraphBatch = {
  rawSnapshot: RawSnapshotInput;
  rawPayload: unknown;
  sourceRecord: NormalizedSourceRecord;
  sourceCredibilityScore: SourceCredibilityScoreInput;
  facts: readonly GovernedFact[];
  evidence: readonly GovernedEvidence[];
  factConfidenceScores: readonly FactConfidenceScoreInput[];
  refreshJob: {
    id: string;
    factId: string;
    sourceProfileId: string;
    refreshReason: string;
    priority: number;
    providerBudget: Record<string, unknown>;
    scheduledAt: string;
    resultStatus: string;
  };
};

const providerWriteBatchSize = 100;

export async function upsertProviderFactGraphBatch(
  db: ProviderBatchWriteDatabase,
  batch: ProviderFactGraphBatch,
) {
  await upsertRawSnapshot(db, batch)
    .then(() =>
      Promise.all([
        upsertSourceRecord(db, batch.sourceRecord, batch.rawSnapshot.id),
        upsertSourceCredibilityScore(db, batch.sourceCredibilityScore),
      ]),
    )
    .then(() => upsertGovernedFacts(db, batch.facts))
    .then(() =>
      Promise.all([
        upsertGovernedEvidence(db, batch.evidence),
        upsertFactConfidenceScores(db, batch.factConfidenceScores),
        upsertRefreshJob(db, batch),
      ]),
    );
}

export async function upsertGovernedFacts(
  db: ProviderBatchWriteDatabase,
  facts: readonly GovernedFact[],
) {
  for (const chunk of chunks(dedupeById(facts), providerWriteBatchSize)) {
    const params: unknown[] = [];
    const valuesSql = chunk.map((fact) => {
      params.push(
        fact.id,
        fact.entityId ?? null,
        fact.claim,
        fact.factType,
        fact.sourceType,
        fact.sourceProfileId,
        fact.sourceRecordId,
        fact.fetchedAt,
        fact.verifiedAt ?? fact.fetchedAt,
        fact.expiresAt ?? null,
        fact.confidenceLabel,
        fact.sourceAuthority,
        fact.publicRepublishAllowed,
        fact.auditUseAllowed,
        fact.rawEvidenceAllowed,
        JSON.stringify([]),
        fact.notes ?? null,
      );
      const offset = params.length - 16;
      return `($${offset}, $${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15}::jsonb, $${offset + 16})`;
    });

    await db.query(
      `
        insert into facts (
          id,
          entity_id,
          claim,
          fact_type,
          source_type,
          source_profile_id,
          source_record_id,
          fetched_at,
          verified_at,
          expires_at,
          confidence_label,
          source_authority,
          public_republish_allowed,
          audit_use_allowed,
          raw_evidence_allowed,
          conflicts_with_fact_ids,
          notes
        )
        values ${valuesSql.join(",\n        ")}
        on conflict (id) do update set
          entity_id = excluded.entity_id,
          claim = excluded.claim,
          fact_type = excluded.fact_type,
          source_type = excluded.source_type,
          source_profile_id = excluded.source_profile_id,
          source_record_id = excluded.source_record_id,
          fetched_at = excluded.fetched_at,
          verified_at = excluded.verified_at,
          expires_at = excluded.expires_at,
          confidence_label = excluded.confidence_label,
          source_authority = excluded.source_authority,
          public_republish_allowed = excluded.public_republish_allowed,
          audit_use_allowed = excluded.audit_use_allowed,
          raw_evidence_allowed = excluded.raw_evidence_allowed,
          conflicts_with_fact_ids = excluded.conflicts_with_fact_ids,
          notes = excluded.notes
      `,
      params,
    );
  }
}

export async function upsertGovernedEvidence(
  db: ProviderBatchWriteDatabase,
  evidenceRows: readonly GovernedEvidence[],
) {
  for (const chunk of chunks(dedupeById(evidenceRows), providerWriteBatchSize)) {
    const params: unknown[] = [];
    const valuesSql = chunk.map((evidence) => {
      params.push(
        evidence.id,
        evidence.factId,
        evidence.sourceRecordId,
        evidence.label,
        evidence.citationUrl ?? null,
        evidence.citationText ?? null,
        evidence.allowedUse,
        evidence.publicRepublishAllowed,
      );
      const offset = params.length - 7;
      return `($${offset}, $${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`;
    });

    await db.query(
      `
        insert into evidence (
          id,
          fact_id,
          source_record_id,
          label,
          citation_url,
          citation_text,
          allowed_use,
          public_republish_allowed
        )
        values ${valuesSql.join(",\n        ")}
        on conflict (id) do update set
          source_record_id = excluded.source_record_id,
          label = excluded.label,
          citation_url = excluded.citation_url,
          citation_text = excluded.citation_text,
          allowed_use = excluded.allowed_use,
          public_republish_allowed = excluded.public_republish_allowed
      `,
      params,
    );
  }
}

async function upsertFactConfidenceScores(
  db: ProviderBatchWriteDatabase,
  scores: readonly FactConfidenceScoreInput[],
) {
  for (const chunk of chunks(dedupeById(scores), providerWriteBatchSize)) {
    const params: unknown[] = [];
    const valuesSql = chunk.map((score) => {
      params.push(score.id, score.factId, score.score, score.label, JSON.stringify(score.drivers));
      const offset = params.length - 4;
      return `($${offset}, $${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}::jsonb)`;
    });

    await db.query(
      `
        insert into fact_confidence_scores (
          id,
          fact_id,
          score,
          label,
          drivers
        )
        values ${valuesSql.join(",\n        ")}
        on conflict (id) do update set
          score = excluded.score,
          label = excluded.label,
          drivers = excluded.drivers,
          scored_at = now()
      `,
      params,
    );
  }
}

async function upsertRawSnapshot(
  db: ProviderBatchWriteDatabase,
  batch: Pick<ProviderFactGraphBatch, "rawPayload" | "rawSnapshot">,
) {
  await db.query(
    `
      insert into raw_snapshots (
        id,
        source_profile_id,
        fetched_at,
        content_hash,
        raw_payload,
        allowed_use
      )
      values ($1, $2, $3, $4, $5::jsonb, $6)
      on conflict (id) do update set
        fetched_at = excluded.fetched_at,
        content_hash = excluded.content_hash,
        raw_payload = excluded.raw_payload,
        allowed_use = excluded.allowed_use
    `,
    [
      batch.rawSnapshot.id,
      batch.rawSnapshot.sourceProfileId,
      batch.rawSnapshot.fetchedAt,
      batch.rawSnapshot.contentHash,
      JSON.stringify(batch.rawPayload),
      batch.rawSnapshot.allowedUse,
    ],
  );
}

async function upsertSourceRecord(
  db: ProviderBatchWriteDatabase,
  sourceRecord: NormalizedSourceRecord,
  rawSnapshotId: string,
) {
  await db.query(
    `
      insert into source_records (
        id,
        source_profile_id,
        raw_snapshot_id,
        provider_entity_id,
        entity_type,
        name,
        normalized_payload,
        source_url,
        fetched_at,
        allowed_use
      )
      values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
      on conflict (id) do update set
        raw_snapshot_id = excluded.raw_snapshot_id,
        normalized_payload = excluded.normalized_payload,
        source_url = excluded.source_url,
        fetched_at = excluded.fetched_at,
        allowed_use = excluded.allowed_use
    `,
    [
      sourceRecord.id,
      sourceRecord.sourceProfileId,
      rawSnapshotId,
      sourceRecord.providerEntityId ?? null,
      sourceRecord.entityType,
      sourceRecord.name,
      JSON.stringify(sourceRecord.normalizedPayload),
      sourceRecord.sourceUrl ?? null,
      sourceRecord.fetchedAt,
      sourceRecord.allowedUse,
    ],
  );
}

async function upsertSourceCredibilityScore(
  db: ProviderBatchWriteDatabase,
  score: SourceCredibilityScoreInput,
) {
  await db.query(
    `
      insert into source_credibility_scores (
        id,
        source_profile_id,
        score,
        label,
        drivers
      )
      values ($1, $2, $3, $4, $5::jsonb)
      on conflict (id) do update set
        score = excluded.score,
        label = excluded.label,
        drivers = excluded.drivers,
        scored_at = now()
    `,
    [score.id, score.sourceProfileId, score.score, score.label, JSON.stringify(score.drivers)],
  );
}

async function upsertRefreshJob(
  db: ProviderBatchWriteDatabase,
  batch: Pick<ProviderFactGraphBatch, "refreshJob">,
) {
  await db.query(
    `
      insert into refresh_jobs (
        id,
        fact_id,
        source_profile_id,
        refresh_reason,
        priority,
        provider_budget,
        scheduled_at,
        result_status
      )
      values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
      on conflict (id) do update set
        fact_id = excluded.fact_id,
        source_profile_id = excluded.source_profile_id,
        refresh_reason = excluded.refresh_reason,
        priority = excluded.priority,
        provider_budget = excluded.provider_budget,
        scheduled_at = excluded.scheduled_at,
        last_error = null,
        result_status = excluded.result_status
    `,
    [
      batch.refreshJob.id,
      batch.refreshJob.factId,
      batch.refreshJob.sourceProfileId,
      batch.refreshJob.refreshReason,
      batch.refreshJob.priority,
      JSON.stringify(batch.refreshJob.providerBudget),
      batch.refreshJob.scheduledAt,
      batch.refreshJob.resultStatus,
    ],
  );
}

function dedupeById<T extends { id: string }>(items: readonly T[]) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function chunks<T>(items: readonly T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}
