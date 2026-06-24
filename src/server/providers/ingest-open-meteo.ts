import postgres from "postgres";

import { buildOpenMeteoIngestionBatch } from "@/server/providers/open-meteo";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to ingest Open-Meteo forecasts.");
}

const sql = postgres(databaseUrl, { max: 1, prepare: false });

try {
  const batch = await buildOpenMeteoIngestionBatch({});

  await sql.begin(async (tx) => {
    await tx`
      insert into raw_snapshots (
        id,
        source_profile_id,
        fetched_at,
        content_hash,
        raw_payload,
        allowed_use
      )
      values (
        ${batch.rawSnapshot.id},
        ${batch.rawSnapshot.sourceProfileId},
        ${batch.rawSnapshot.fetchedAt},
        ${batch.rawSnapshot.contentHash},
        ${sql.json(batch.rawPayload as never)},
        ${batch.rawSnapshot.allowedUse}
      )
      on conflict (id) do update set
        fetched_at = excluded.fetched_at,
        content_hash = excluded.content_hash,
        raw_payload = excluded.raw_payload,
        allowed_use = excluded.allowed_use
    `;

    const writeSourceRecord = tx`
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
      values (
        ${batch.sourceRecord.id},
        ${batch.sourceRecord.sourceProfileId},
        ${batch.rawSnapshot.id},
        ${batch.sourceRecord.providerEntityId ?? null},
        ${batch.sourceRecord.entityType},
        ${batch.sourceRecord.name},
        ${sql.json(batch.sourceRecord.normalizedPayload as never)},
        ${batch.sourceRecord.sourceUrl ?? null},
        ${batch.sourceRecord.fetchedAt},
        ${batch.sourceRecord.allowedUse}
      )
      on conflict (id) do update set
        raw_snapshot_id = excluded.raw_snapshot_id,
        normalized_payload = excluded.normalized_payload,
        source_url = excluded.source_url,
        fetched_at = excluded.fetched_at,
        allowed_use = excluded.allowed_use
    `;

    const writeSourceCredibilityScore = tx`
      insert into source_credibility_scores (
        id,
        source_profile_id,
        score,
        label,
        drivers
      )
      values (
        ${batch.sourceCredibilityScore.id},
        ${batch.sourceCredibilityScore.sourceProfileId},
        ${batch.sourceCredibilityScore.score},
        ${batch.sourceCredibilityScore.label},
        ${sql.json(batch.sourceCredibilityScore.drivers as never)}
      )
      on conflict (id) do update set
        score = excluded.score,
        label = excluded.label,
        drivers = excluded.drivers,
        scored_at = now()
    `;

    await Promise.all([writeSourceRecord, writeSourceCredibilityScore]);

    await Promise.all(
      batch.facts.map(
        (fact) => tx`
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
          values (
            ${fact.id},
            ${fact.entityId ?? null},
            ${fact.claim},
            ${fact.factType},
            ${fact.sourceType},
            ${fact.sourceProfileId},
            ${fact.sourceRecordId},
            ${fact.fetchedAt},
            ${fact.verifiedAt ?? null},
            ${fact.expiresAt ?? null},
            ${fact.confidenceLabel},
            ${fact.sourceAuthority},
            ${fact.publicRepublishAllowed},
            ${fact.auditUseAllowed},
            ${fact.rawEvidenceAllowed},
            ${sql.json([] as never)},
            ${fact.notes ?? null}
          )
          on conflict (id) do update set
            claim = excluded.claim,
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
      ),
    );

    const writeEvidence = Promise.all(
      batch.evidence.map(
        (evidence) => tx`
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
          values (
            ${evidence.id},
            ${evidence.factId},
            ${evidence.sourceRecordId},
            ${evidence.label},
            ${evidence.citationUrl ?? null},
            ${evidence.citationText ?? null},
            ${evidence.allowedUse},
            ${evidence.publicRepublishAllowed}
          )
          on conflict (id) do update set
            label = excluded.label,
            citation_url = excluded.citation_url,
            citation_text = excluded.citation_text,
            allowed_use = excluded.allowed_use,
            public_republish_allowed = excluded.public_republish_allowed
        `,
      ),
    );

    const writeFactConfidenceScores = Promise.all(
      batch.factConfidenceScores.map(
        (score) => tx`
          insert into fact_confidence_scores (
            id,
            fact_id,
            score,
            label,
            drivers
          )
          values (
            ${score.id},
            ${score.factId},
            ${score.score},
            ${score.label},
            ${sql.json(score.drivers as never)}
          )
          on conflict (id) do update set
            score = excluded.score,
            label = excluded.label,
            drivers = excluded.drivers,
            scored_at = now()
        `,
      ),
    );

    await Promise.all([writeEvidence, writeFactConfidenceScores]);

    await tx`
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
      values (
        ${batch.refreshJob.id},
        ${batch.refreshJob.factId},
        ${batch.refreshJob.sourceProfileId},
        ${batch.refreshJob.refreshReason},
        ${batch.refreshJob.priority},
        ${sql.json(batch.refreshJob.providerBudget as never)},
        ${batch.refreshJob.scheduledAt},
        ${batch.refreshJob.resultStatus}
      )
      on conflict (id) do update set
        fact_id = excluded.fact_id,
        source_profile_id = excluded.source_profile_id,
        refresh_reason = excluded.refresh_reason,
        priority = excluded.priority,
        provider_budget = excluded.provider_budget,
        scheduled_at = excluded.scheduled_at,
        last_error = null,
        result_status = excluded.result_status
    `;
  });

  console.log(
    `Ingested Open-Meteo forecast: ${batch.facts.length} facts, ${batch.evidence.length} evidence rows, refresh scheduled at ${batch.refreshJob.scheduledAt}.`,
  );
} finally {
  await sql.end();
}
