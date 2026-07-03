CREATE TABLE IF NOT EXISTS public_page_facts (
  public_page_id text NOT NULL,
  fact_id text NOT NULL,
  position integer NOT NULL,
  CONSTRAINT public_page_facts_pkey PRIMARY KEY (public_page_id, fact_id),
  CONSTRAINT public_page_facts_public_page_id_fkey
    FOREIGN KEY (public_page_id) REFERENCES public_pages(id) ON DELETE CASCADE,
  CONSTRAINT public_page_facts_fact_id_fkey
    FOREIGN KEY (fact_id) REFERENCES facts(id) ON DELETE RESTRICT,
  CONSTRAINT public_page_facts_position_check CHECK (position >= 0),
  CONSTRAINT public_page_facts_public_page_position_key UNIQUE (public_page_id, position)
);

CREATE INDEX IF NOT EXISTS public_page_facts_ordered_page_idx
  ON public_page_facts(public_page_id, position, fact_id);

CREATE INDEX IF NOT EXISTS public_page_facts_fact_id_idx
  ON public_page_facts(fact_id, public_page_id);

CREATE TABLE IF NOT EXISTS public_evidence_bundle_evidence (
  evidence_bundle_id text NOT NULL,
  evidence_id text NOT NULL,
  position integer NOT NULL,
  CONSTRAINT public_evidence_bundle_evidence_pkey PRIMARY KEY (evidence_bundle_id, evidence_id),
  CONSTRAINT public_evidence_bundle_evidence_bundle_id_fkey
    FOREIGN KEY (evidence_bundle_id) REFERENCES public_evidence_bundles(id) ON DELETE CASCADE,
  CONSTRAINT public_evidence_bundle_evidence_evidence_id_fkey
    FOREIGN KEY (evidence_id) REFERENCES evidence(id) ON DELETE RESTRICT,
  CONSTRAINT public_evidence_bundle_evidence_position_check CHECK (position >= 0),
  CONSTRAINT public_evidence_bundle_evidence_bundle_position_key UNIQUE (
    evidence_bundle_id,
    position
  )
);

CREATE INDEX IF NOT EXISTS public_evidence_bundle_evidence_ordered_bundle_idx
  ON public_evidence_bundle_evidence(evidence_bundle_id, position, evidence_id);

CREATE INDEX IF NOT EXISTS public_evidence_bundle_evidence_evidence_id_idx
  ON public_evidence_bundle_evidence(evidence_id, evidence_bundle_id);

WITH legacy_page_facts AS (
  SELECT
    public_page_id,
    fact_id,
    position,
    ROW_NUMBER() OVER (
      PARTITION BY public_page_id, fact_id
      ORDER BY position
    ) AS duplicate_rank
  FROM (
    SELECT
      p.id AS public_page_id,
      legacy_fact.fact_id,
      (legacy_fact.ordinality - 1)::integer AS position
    FROM public_pages p
    CROSS JOIN LATERAL jsonb_array_elements_text(p.generation_source_fact_ids)
      WITH ORDINALITY AS legacy_fact(fact_id, ordinality)
  ) ordered_legacy_page_facts
)
INSERT INTO public_page_facts (public_page_id, fact_id, position)
SELECT public_page_id, fact_id, position
FROM legacy_page_facts
WHERE duplicate_rank = 1;

WITH legacy_bundle_evidence AS (
  SELECT
    evidence_bundle_id,
    evidence_id,
    position,
    ROW_NUMBER() OVER (
      PARTITION BY evidence_bundle_id, evidence_id
      ORDER BY position
    ) AS duplicate_rank
  FROM (
    SELECT
      b.id AS evidence_bundle_id,
      legacy_evidence.evidence_id,
      (legacy_evidence.ordinality - 1)::integer AS position
    FROM public_evidence_bundles b
    CROSS JOIN LATERAL jsonb_array_elements_text(b.evidence_ids)
      WITH ORDINALITY AS legacy_evidence(evidence_id, ordinality)
  ) ordered_legacy_bundle_evidence
)
INSERT INTO public_evidence_bundle_evidence (evidence_bundle_id, evidence_id, position)
SELECT evidence_bundle_id, evidence_id, position
FROM legacy_bundle_evidence
WHERE duplicate_rank = 1;
