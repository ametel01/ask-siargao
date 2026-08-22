// Generated from field-protocol/canonical/v1. Do not edit by hand.
export const baselineFieldProtocolPackageData = {
  campaign: {
    schemaVersion: "field-campaign.v1",
    componentVersion: "1.0.0",
    campaignId: "campaign_island_baseline",
    name: "Siargao island baseline",
    purpose:
      "Build reviewed first-hand visitor-planning evidence without binding fieldwork to predetermined dates.",
    methodologyVersion: "1.0.0",
    baselineOrigin: {
      replaces: "former-14-day-itinerary",
      representation: "unscheduled-coverage-and-eligibility",
    },
    objectiveActions: ["observe", "measure", "attempt", "ask", "traverse", "document", "repeat"],
    permissionDefaults: {
      llmUse: false,
      articleUse: false,
      quotationUse: false,
      publicUse: false,
      preciseLocation: "denied",
    },
    branchingRules: [
      {
        when: "hard_gate_unsafe_or_ineligible",
        action: "record_capture_exception_and_offer_safe_fallback",
      },
      {
        when: "schema_cannot_represent_reality",
        action: "record_schema_gap_without_best_fit_value",
      },
      {
        when: "partial_coverage_set_selected",
        action: "preserve_unselected_objectives_as_outstanding",
      },
      {
        when: "required_coverage_blocked",
        action: "close_with_gaps_and_create_unscheduled_follow_up",
      },
      {
        when: "captured_record_needs_correction",
        action: "supersede_without_rewriting_original",
      },
    ],
    assignments: [
      {
        id: "assignment_home_base_readiness",
        state: "unscheduled",
        title: "Home-base readiness and practicalities",
        geography: {
          form: "governed_area",
          areaId: "area_del_carmen",
          privateLocation: true,
        },
        estimatedMinutes: 150,
        eligibilityWindows: [
          {
            kind: "daypart",
            values: ["morning", "evening"],
          },
          {
            kind: "changed_conditions",
            values: ["power", "weather", "crowd"],
          },
        ],
        safeFallbackAssignmentId: "assignment_del_carmen_essentials",
        objectives: [
          {
            id: "objective_home_observe_utilities",
            action: "observe",
            observationKinds: ["power", "facility"],
            coverage: {
              required: true,
              minimumRecords: 2,
              supportingAsset: "optional",
              repetition: {
                minimumDistinctWindows: 2,
              },
            },
          },
          {
            id: "objective_home_measure_environment",
            action: "measure",
            observationKinds: ["connectivity", "noise_snapshot"],
            coverage: {
              required: true,
              minimumRecords: 2,
              supportingAsset: "not_required",
              repetition: {
                minimumDistinctWindows: 2,
              },
            },
          },
        ],
        partialCoverageSets: [
          {
            id: "partial_home_connectivity",
            objectiveIds: ["objective_home_measure_environment"],
          },
        ],
      },
      {
        id: "assignment_del_carmen_essentials",
        state: "unscheduled",
        title: "Del Carmen visitor essentials",
        geography: {
          form: "governed_area",
          areaId: "area_del_carmen",
          privateLocation: false,
        },
        estimatedMinutes: 210,
        eligibilityWindows: [
          {
            kind: "weekday_class",
            values: ["weekday", "weekend"],
          },
          {
            kind: "operating_state",
            values: ["open"],
          },
        ],
        safeFallbackAssignmentId: "assignment_home_base_readiness",
        objectives: [
          {
            id: "objective_del_carmen_observe_services",
            action: "observe",
            observationKinds: ["identity", "facility", "payment_method", "connectivity"],
            coverage: {
              required: true,
              minimumRecords: 4,
              supportingAsset: "required_for_posted_information",
              repetition: {
                minimumDistinctWindows: 1,
              },
            },
          },
          {
            id: "objective_del_carmen_ask_service_leads",
            action: "ask",
            recordKinds: ["source-statement.v1"],
            coverage: {
              required: true,
              minimumRecords: 1,
              supportingAsset: "not_required",
              repetition: {
                minimumDistinctWindows: 1,
              },
            },
          },
        ],
        partialCoverageSets: [
          {
            id: "partial_del_carmen_wayfinding",
            objectiveIds: ["objective_del_carmen_observe_services"],
          },
        ],
      },
      {
        id: "assignment_airport_arrival",
        state: "unscheduled",
        title: "Sayak Airport arrival journey",
        geography: {
          form: "origin_destination_route",
          routeId: "route_airport_del_carmen",
          originSubjectId: "subject_sayak_airport",
          destinationSubjectId: "subject_area_del_carmen",
        },
        estimatedMinutes: 180,
        eligibilityWindows: [
          {
            kind: "arrival_window",
            values: ["genuine_arrival"],
          },
          {
            kind: "transport_state",
            values: ["operating"],
          },
        ],
        safeFallbackAssignmentId: "assignment_del_carmen_essentials",
        objectives: [
          {
            id: "objective_airport_traverse_arrival",
            action: "traverse",
            recordKinds: ["route-run.v1"],
            coverage: {
              required: true,
              minimumRecords: 1,
              supportingAsset: "optional",
              repetition: {
                minimumDistinctWindows: 1,
              },
            },
          },
          {
            id: "objective_airport_document_signage",
            action: "document",
            recordKinds: ["evidence-asset.v1"],
            coverage: {
              required: true,
              minimumRecords: 1,
              supportingAsset: "required",
              repetition: {
                minimumDistinctWindows: 1,
              },
            },
          },
        ],
        partialCoverageSets: [
          {
            id: "partial_airport_signage",
            objectiveIds: ["objective_airport_document_signage"],
          },
        ],
      },
      {
        id: "assignment_general_luna_journey",
        state: "unscheduled",
        title: "General Luna and Catangnan visitor journey",
        geography: {
          form: "governed_area",
          areaId: "area_general_luna",
          privateLocation: false,
        },
        estimatedMinutes: 240,
        eligibilityWindows: [
          {
            kind: "weekday_class",
            values: ["weekday", "weekend"],
          },
          {
            kind: "daypart",
            values: ["daytime", "evening"],
          },
        ],
        safeFallbackAssignmentId: "assignment_connectivity_transect",
        objectives: [
          {
            id: "objective_general_luna_attempt_arrival",
            action: "attempt",
            observationKinds: ["payment_method", "facility", "accessibility"],
            coverage: {
              required: true,
              minimumRecords: 3,
              supportingAsset: "optional",
              repetition: {
                minimumDistinctWindows: 2,
              },
            },
          },
          {
            id: "objective_general_luna_repeat_crowd",
            action: "repeat",
            observationKinds: ["crowd_snapshot", "connectivity"],
            coverage: {
              required: true,
              minimumRecords: 4,
              supportingAsset: "not_required",
              repetition: {
                minimumDistinctWindows: 2,
              },
            },
          },
        ],
        partialCoverageSets: [
          {
            id: "partial_general_luna_access",
            objectiveIds: ["objective_general_luna_attempt_arrival"],
          },
        ],
      },
      {
        id: "assignment_connectivity_transect",
        state: "unscheduled",
        title: "Connectivity transect",
        geography: {
          form: "route_corridor",
          areaIds: ["area_del_carmen", "area_general_luna"],
        },
        estimatedMinutes: 180,
        eligibilityWindows: [
          {
            kind: "changed_conditions",
            values: ["crowd", "weather", "zone"],
          },
        ],
        safeFallbackAssignmentId: "assignment_home_base_readiness",
        objectives: [
          {
            id: "objective_connectivity_measure_sets",
            action: "measure",
            observationKinds: ["connectivity", "power", "noise_snapshot"],
            coverage: {
              required: true,
              minimumRecords: 6,
              supportingAsset: "not_required",
              repetition: {
                minimumDistinctWindows: 2,
              },
            },
          },
        ],
        partialCoverageSets: [
          {
            id: "partial_connectivity_one_zone",
            objectiveIds: ["objective_connectivity_measure_sets"],
            coverageLimit: "one_governed_zone_only",
          },
        ],
      },
      {
        id: "assignment_dapa_hub",
        state: "unscheduled",
        title: "Dapa port and service hub",
        geography: {
          form: "route_corridor",
          areaIds: ["area_dapa", "area_central_corridor"],
        },
        estimatedMinutes: 300,
        eligibilityWindows: [
          {
            kind: "transport_window",
            values: ["arrival", "departure"],
          },
          {
            kind: "operating_state",
            values: ["open"],
          },
        ],
        safeFallbackAssignmentId: "assignment_del_carmen_essentials",
        objectives: [
          {
            id: "objective_dapa_traverse_port",
            action: "traverse",
            recordKinds: ["route-run.v1"],
            coverage: {
              required: true,
              minimumRecords: 1,
              supportingAsset: "optional",
              repetition: {
                minimumDistinctWindows: 1,
              },
            },
          },
          {
            id: "objective_dapa_observe_services",
            action: "observe",
            observationKinds: [
              "price",
              "payment_method",
              "facility",
              "accessibility",
              "service_status",
            ],
            coverage: {
              required: true,
              minimumRecords: 5,
              supportingAsset: "required_for_posted_information",
              repetition: {
                minimumDistinctWindows: 1,
              },
            },
          },
        ],
        partialCoverageSets: [
          {
            id: "partial_dapa_service_hub",
            objectiveIds: ["objective_dapa_observe_services"],
          },
        ],
      },
      {
        id: "assignment_south_central_corridor",
        state: "unscheduled",
        title: "South and central corridor",
        geography: {
          form: "route_corridor",
          areaIds: ["area_south_central"],
        },
        estimatedMinutes: 360,
        eligibilityWindows: [
          {
            kind: "safe_route_state",
            values: ["daylight", "passable"],
          },
        ],
        safeFallbackAssignmentId: "assignment_general_luna_journey",
        objectives: [
          {
            id: "objective_south_traverse_twice",
            action: "repeat",
            recordKinds: ["route-run.v1"],
            observationKinds: ["road_condition", "route_duration", "connectivity"],
            coverage: {
              required: true,
              minimumRecords: 6,
              supportingAsset: "optional",
              repetition: {
                minimumDistinctWindows: 2,
              },
            },
          },
        ],
        partialCoverageSets: [
          {
            id: "partial_south_one_route",
            objectiveIds: ["objective_south_traverse_twice"],
            coverageLimit: "one_run_does_not_complete_repetition",
          },
        ],
      },
      {
        id: "assignment_northbound_services",
        state: "unscheduled",
        title: "Northbound services and access",
        geography: {
          form: "route_corridor",
          areaIds: ["area_north"],
        },
        estimatedMinutes: 420,
        eligibilityWindows: [
          {
            kind: "weekday_class",
            values: ["weekday", "weekend"],
          },
          {
            kind: "daypart",
            values: ["daytime"],
          },
        ],
        safeFallbackAssignmentId: "assignment_del_carmen_essentials",
        objectives: [
          {
            id: "objective_north_observe_services",
            action: "observe",
            observationKinds: [
              "route_duration",
              "road_condition",
              "price",
              "facility",
              "service_status",
              "connectivity",
            ],
            coverage: {
              required: true,
              minimumRecords: 6,
              supportingAsset: "optional",
              repetition: {
                minimumDistinctWindows: 2,
              },
            },
          },
        ],
        partialCoverageSets: [
          {
            id: "partial_north_services",
            objectiveIds: ["objective_north_observe_services"],
            coverageLimit: "one_governed_area",
          },
        ],
      },
      {
        id: "assignment_santa_monica_alegria",
        state: "unscheduled",
        title: "Santa Monica and Alegria route",
        geography: {
          form: "origin_destination_route",
          routeId: "route_santa_monica_alegria",
          originSubjectId: "subject_route_northbound",
          destinationSubjectId: "subject_route_santa_monica_alegria",
        },
        estimatedMinutes: 360,
        eligibilityWindows: [
          {
            kind: "safe_route_state",
            values: ["daylight", "return_transport_available"],
          },
        ],
        safeFallbackAssignmentId: "assignment_northbound_services",
        objectives: [
          {
            id: "objective_north_route_traverse",
            action: "traverse",
            recordKinds: ["route-run.v1"],
            coverage: {
              required: true,
              minimumRecords: 1,
              supportingAsset: "optional",
              repetition: {
                minimumDistinctWindows: 1,
              },
            },
          },
          {
            id: "objective_north_route_repeat_gap",
            action: "repeat",
            observationKinds: ["route_wait", "facility", "connectivity"],
            coverage: {
              required: true,
              minimumRecords: 1,
              supportingAsset: "not_required",
              repetition: {
                minimumDistinctWindows: 2,
              },
            },
          },
        ],
        partialCoverageSets: [
          {
            id: "partial_north_route_repeat",
            objectiveIds: ["objective_north_route_repeat_gap"],
          },
        ],
      },
      {
        id: "assignment_pilar_access",
        state: "unscheduled",
        title: "Pilar and condition-dependent access",
        geography: {
          form: "access_point",
          areaId: "area_pilar",
          subjectId: "subject_area_pilar",
        },
        estimatedMinutes: 300,
        eligibilityWindows: [
          {
            kind: "tide_context",
            values: ["safe_for_declared_access"],
          },
          {
            kind: "access_state",
            values: ["open", "permitted"],
          },
        ],
        safeFallbackAssignmentId: "assignment_south_central_corridor",
        objectives: [
          {
            id: "objective_pilar_observe_conditions",
            action: "observe",
            observationKinds: [
              "tide_context",
              "road_condition",
              "price",
              "facility",
              "accessibility",
              "service_status",
            ],
            coverage: {
              required: true,
              minimumRecords: 6,
              supportingAsset: "optional",
              repetition: {
                minimumDistinctWindows: 1,
              },
            },
          },
        ],
        partialCoverageSets: [
          {
            id: "partial_pilar_non_access",
            objectiveIds: ["objective_pilar_observe_conditions"],
            coverageLimit: "no_destination_access_claim",
          },
        ],
      },
      {
        id: "assignment_del_carmen_boat",
        state: "unscheduled",
        title: "Del Carmen departure and boat journey",
        geography: {
          form: "access_point",
          areaId: "area_del_carmen",
          subjectId: "subject_del_carmen_departure_points",
        },
        estimatedMinutes: 360,
        eligibilityWindows: [
          {
            kind: "provider_state",
            values: ["authorized", "operating"],
          },
          {
            kind: "safe_marine_state",
            values: ["suitable"],
          },
        ],
        safeFallbackAssignmentId: "assignment_del_carmen_essentials",
        objectives: [
          {
            id: "objective_boat_attempt_booking",
            action: "attempt",
            observationKinds: [
              "price",
              "payment_method",
              "route_wait",
              "facility",
              "service_status",
            ],
            coverage: {
              required: true,
              minimumRecords: 5,
              supportingAsset: "optional",
              repetition: {
                minimumDistinctWindows: 1,
              },
            },
          },
          {
            id: "objective_boat_traverse_journey",
            action: "traverse",
            recordKinds: ["route-run.v1"],
            coverage: {
              required: true,
              minimumRecords: 1,
              supportingAsset: "optional",
              repetition: {
                minimumDistinctWindows: 1,
              },
            },
          },
          {
            id: "objective_boat_ask_policy",
            action: "ask",
            recordKinds: ["source-statement.v1"],
            coverage: {
              required: true,
              minimumRecords: 1,
              supportingAsset: "not_required",
              repetition: {
                minimumDistinctWindows: 1,
              },
            },
          },
        ],
        partialCoverageSets: [
          {
            id: "partial_boat_booking",
            objectiveIds: ["objective_boat_attempt_booking", "objective_boat_ask_policy"],
          },
        ],
      },
      {
        id: "assignment_no_scooter_accessibility",
        state: "unscheduled",
        title: "No-scooter accessibility journey",
        geography: {
          form: "route_corridor",
          areaIds: ["area_del_carmen", "area_dapa", "area_general_luna"],
        },
        estimatedMinutes: 300,
        eligibilityWindows: [
          {
            kind: "transport_state",
            values: ["realistic_no_scooter_option"],
          },
          {
            kind: "safety_state",
            values: ["no_created_health_or_safety_risk"],
          },
        ],
        safeFallbackAssignmentId: "assignment_del_carmen_essentials",
        objectives: [
          {
            id: "objective_accessibility_attempt_journey",
            action: "attempt",
            observationKinds: ["accessibility", "price", "facility", "route_wait"],
            coverage: {
              required: true,
              minimumRecords: 4,
              supportingAsset: "optional",
              repetition: {
                minimumDistinctWindows: 1,
              },
            },
          },
          {
            id: "objective_accessibility_traverse_journey",
            action: "traverse",
            recordKinds: ["route-run.v1"],
            coverage: {
              required: true,
              minimumRecords: 1,
              supportingAsset: "optional",
              repetition: {
                minimumDistinctWindows: 1,
              },
            },
          },
        ],
        partialCoverageSets: [
          {
            id: "partial_accessibility_booking",
            objectiveIds: ["objective_accessibility_attempt_journey"],
          },
        ],
      },
      {
        id: "assignment_conflict_follow_up",
        state: "unscheduled",
        title: "Conflict and freshness follow-up",
        geography: {
          form: "governed_subject_subset",
          selectionRule: "nearest_travel_compatible_unresolved_subject",
        },
        estimatedMinutes: 180,
        eligibilityWindows: [
          {
            kind: "source_coverage",
            values: ["original_requirement_window", "changed_condition"],
          },
        ],
        safeFallbackAssignmentId: "assignment_connectivity_transect",
        objectives: [
          {
            id: "objective_follow_up_repeat_evidence",
            action: "repeat",
            observationKinds: [
              "price",
              "route_duration",
              "opening_signal",
              "connectivity",
              "identity",
              "local_caveat",
            ],
            coverage: {
              required: true,
              minimumRecords: 1,
              supportingAsset: "depends_on_original_requirement",
              repetition: {
                minimumDistinctWindows: 2,
              },
            },
          },
        ],
        partialCoverageSets: [
          {
            id: "partial_follow_up_one_conflict",
            objectiveIds: ["objective_follow_up_repeat_evidence"],
            coverageLimit: "one_original_requirement",
          },
        ],
      },
    ],
  },
  distributionSchemas: {
    schemaVersion: "field-protocol-distribution-schemas.v1",
    componentVersion: "1.0.0",
    schemas: {
      packageManifest: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "https://asksiargao.com/schemas/field-protocol-package-manifest.v1.json",
        title: "FieldProtocolPackageManifest",
        type: "object",
        additionalProperties: false,
        required: [
          "schemaVersion",
          "packageId",
          "packageVersion",
          "createdAt",
          "signerKeyId",
          "componentVersions",
          "compatibility",
          "migrationDeclaration",
          "files",
          "signature",
        ],
        properties: {
          schemaVersion: {
            const: "field-protocol-package-manifest.v1",
          },
          packageId: {
            type: "string",
            pattern: "^field-protocol-[a-z0-9-]+$",
          },
          packageVersion: {
            type: "string",
            pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
          },
          createdAt: {
            type: "string",
            pattern:
              "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
          },
          signerKeyId: {
            type: "string",
            minLength: 1,
          },
          componentVersions: {
            type: "object",
            additionalProperties: false,
            required: [
              "schemas",
              "distributionSchemas",
              "observationKinds",
              "methodProfiles",
              "subjects",
              "geography",
              "campaign",
              "help",
              "migration",
              "examples",
            ],
            properties: {
              schemas: {
                type: "string",
              },
              distributionSchemas: {
                type: "string",
              },
              observationKinds: {
                type: "string",
              },
              methodProfiles: {
                type: "string",
              },
              subjects: {
                type: "string",
              },
              geography: {
                type: "string",
              },
              campaign: {
                type: "string",
              },
              help: {
                type: "string",
              },
              migration: {
                type: "string",
              },
              examples: {
                type: "string",
              },
            },
          },
          compatibility: {
            type: "object",
            additionalProperties: false,
            required: ["minimumApplicationVersion", "maximumApplicationVersionExclusive"],
            properties: {
              minimumApplicationVersion: {
                type: "string",
                pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
              },
              maximumApplicationVersionExclusive: {
                type: "string",
                pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
              },
            },
          },
          migrationDeclaration: {
            type: "object",
            additionalProperties: false,
            required: ["strategy", "supportedFromVersions", "migrationIds"],
            properties: {
              strategy: {
                enum: ["initial_install", "explicit_preview_required"],
              },
              supportedFromVersions: {
                type: "array",
                items: {
                  type: "string",
                  pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
                },
                uniqueItems: true,
              },
              migrationIds: {
                type: "array",
                items: {
                  type: "string",
                  pattern: "^migration_[a-z0-9_]+$",
                },
                uniqueItems: true,
              },
            },
          },
          files: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["path", "sha256"],
              properties: {
                path: {
                  type: "string",
                  pattern: "^canonical/v1/[a-z0-9.-]+\\.json$",
                },
                sha256: {
                  type: "string",
                  pattern: "^[a-f0-9]{64}$",
                },
              },
            },
          },
          signature: {
            type: "object",
            additionalProperties: false,
            required: ["algorithm", "value"],
            properties: {
              algorithm: {
                const: "Ed25519",
              },
              value: {
                type: "string",
                minLength: 1,
              },
            },
          },
        },
      },
      protocolMigration: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "https://asksiargao.com/schemas/protocol-migration.v1.json",
        title: "ProtocolMigration",
        type: "object",
        additionalProperties: false,
        required: [
          "schemaVersion",
          "componentVersion",
          "migrationId",
          "fromPackageVersion",
          "toPackageVersion",
          "kindMappings",
          "subjectMappings",
          "ambiguousKinds",
          "unsupportedKinds",
        ],
        properties: {
          schemaVersion: {
            const: "protocol-migration.v1",
          },
          componentVersion: {
            type: "string",
            pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
          },
          migrationId: {
            type: "string",
            pattern: "^migration_[a-z0-9_]+$",
          },
          fromPackageVersion: {
            type: "string",
            pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
          },
          toPackageVersion: {
            type: "string",
            pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
          },
          kindMappings: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["from", "to"],
              properties: {
                from: {
                  type: "string",
                  minLength: 1,
                },
                to: {
                  type: "string",
                  minLength: 1,
                },
              },
            },
            uniqueItems: true,
          },
          subjectMappings: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["from", "to"],
              properties: {
                from: {
                  type: "string",
                  minLength: 1,
                },
                to: {
                  type: "string",
                  pattern: "^subject_[a-z0-9_]+$",
                },
              },
            },
            uniqueItems: true,
          },
          ambiguousKinds: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["kind", "reason"],
              properties: {
                kind: {
                  type: "string",
                  minLength: 1,
                },
                reason: {
                  type: "string",
                  minLength: 1,
                },
              },
            },
            uniqueItems: true,
          },
          unsupportedKinds: {
            type: "array",
            items: {
              type: "string",
              minLength: 1,
            },
            uniqueItems: true,
          },
        },
      },
    },
  },
  examples: {
    schemaVersion: "field-protocol-examples.v1",
    componentVersion: "1.0.0",
    examples: {
      fieldVisit: {
        schemaVersion: "field-visit.v1",
        id: "0192f060-4f41-7aa1-b322-4aa9fc9f1501",
        protocolPackageId: "field-protocol-siargao-baseline",
        protocolPackageVersion: "1.0.0",
        campaignId: "campaign_island_baseline",
        assignmentId: "assignment_del_carmen_essentials",
        researcherId: "researcher_example",
        deviceId: "device_example",
        recordedAt: "2026-08-22T09:00:00+08:00",
        localTimezone: "Asia/Manila",
        captureState: "captured",
        startedAt: "2026-08-22T08:30:00+08:00",
        endedAt: "2026-08-22T09:30:00+08:00",
        target: {
          kind: "governed_subject",
          subjectId: "subject_area_del_carmen",
        },
        locationPermissionState: "coarse",
        publicLocationPrecision: "governed_area",
        conditions: {
          tags: ["weather_cloudy", "road_dry", "crowd_moderate", "access_open"],
        },
        objectiveIds: ["objective_del_carmen_observe_services"],
        assetIds: [],
      },
      fieldObservation: {
        schemaVersion: "field-observation.v1",
        id: "0192f060-4f41-7aa1-b322-4aa9fc9f1502",
        protocolPackageId: "field-protocol-siargao-baseline",
        protocolPackageVersion: "1.0.0",
        campaignId: "campaign_island_baseline",
        assignmentId: "assignment_del_carmen_essentials",
        visitId: "0192f060-4f41-7aa1-b322-4aa9fc9f1501",
        objectiveId: "objective_del_carmen_observe_services",
        researcherId: "researcher_example",
        deviceId: "device_example",
        recordedAt: "2026-08-22T09:05:00+08:00",
        localTimezone: "Asia/Manila",
        captureState: "captured",
        subject: {
          kind: "governed",
          subjectId: "subject_area_del_carmen",
        },
        observationKind: "price",
        valueSchemaVersion: "1.0.0",
        directness: "transaction_record",
        observedAt: "2026-08-22T09:04:00+08:00",
        utcOffsetMinutes: 480,
        timeCorrected: false,
        value: {
          amount: "50",
          currency: "PHP",
          item: "Tricycle journey",
          pricingUnit: "journey",
          partySize: 1,
          inclusions: [],
          basis: "paid",
          taxesAndFees: "included",
          negotiated: false,
          paymentMethodAttempted: "cash",
        },
        methodProfileId: "method_posted_or_paid_price@1.0.0",
        conditions: ["weather_cloudy", "crowd_moderate", "access_open"],
        captureConfidence: "high",
        reviewDueAt: "2026-08-29T09:04:00+08:00",
        permissions: {
          llmUse: false,
          articleUse: false,
          quotationUse: false,
          publicUse: false,
        },
        assetIds: [],
        contradictsObservationIds: [],
      },
      routeRun: {
        schemaVersion: "route-run.v1",
        id: "0192f060-4f41-7aa1-b322-4aa9fc9f1503",
        protocolPackageId: "field-protocol-siargao-baseline",
        protocolPackageVersion: "1.0.0",
        campaignId: "campaign_island_baseline",
        assignmentId: "assignment_airport_arrival",
        visitId: "0192f060-4f41-7aa1-b322-4aa9fc9f1501",
        researcherId: "researcher_example",
        deviceId: "device_example",
        recordedAt: "2026-08-22T09:35:00+08:00",
        localTimezone: "Asia/Manila",
        captureState: "captured",
        originSubjectId: "subject_sayak_airport",
        destinationSubjectId: "subject_area_del_carmen",
        transportMode: "van",
        requestedAt: "2026-08-22T08:30:00+08:00",
        queueStartedAt: "2026-08-22T08:32:00+08:00",
        departedAt: "2026-08-22T08:45:00+08:00",
        arrivedAt: "2026-08-22T09:30:00+08:00",
        stops: [],
        partyContext: "One adult",
        luggageContext: "One cabin bag",
        accessContext: "Walk-up curbside pickup",
        bookingMethod: "walk_up",
        distanceMeters: 18000,
        methodProfileId: "method_timed_route@1.0.0",
        price: {
          amount: "300",
          currency: "PHP",
          basis: "paid",
        },
        conditions: ["weather_cloudy", "road_dry"],
        signalCheckpoints: ["airport", "arrival"],
        barriers: ["vehicle step"],
        notTested: ["wheelchair transfer"],
      },
      sourceStatement: {
        schemaVersion: "source-statement.v1",
        id: "0192f060-4f41-7aa1-b322-4aa9fc9f1504",
        protocolPackageId: "field-protocol-siargao-baseline",
        protocolPackageVersion: "1.0.0",
        campaignId: "campaign_island_baseline",
        assignmentId: "assignment_del_carmen_essentials",
        visitId: "0192f060-4f41-7aa1-b322-4aa9fc9f1501",
        objectiveId: "objective_del_carmen_ask_service_leads",
        researcherId: "researcher_example",
        deviceId: "device_example",
        recordedAt: "2026-08-22T09:15:00+08:00",
        localTimezone: "Asia/Manila",
        captureState: "captured",
        subjectId: "subject_area_del_carmen",
        sourceRole: "staff",
        basisOfKnowledge: "direct_responsibility",
        questionAsked: "Which payment methods are accepted today?",
        originalLanguage: "en",
        statementForm: "labelled_paraphrase",
        originalStatement: "Cash is accepted; card was not offered.",
        attribution: "role_only",
        captureContext: "Asked at the service counter before any transaction.",
        consents: {
          participation: true,
          llmUse: false,
          articleUse: false,
          quotationUse: false,
          publicUse: false,
        },
        consentMethod: "verbal",
        consentRecordedAt: "2026-08-22T09:14:00+08:00",
        withdrawalRoute: "Contact the Ask Siargao research owner.",
        translationIds: [],
        assetIds: [],
      },
      evidenceAsset: {
        schemaVersion: "evidence-asset.v1",
        id: "0192f060-4f41-7aa1-b322-4aa9fc9f1505",
        protocolPackageId: "field-protocol-siargao-baseline",
        protocolPackageVersion: "1.0.0",
        campaignId: "campaign_island_baseline",
        assignmentId: "assignment_del_carmen_essentials",
        visitId: "0192f060-4f41-7aa1-b322-4aa9fc9f1501",
        researcherId: "researcher_example",
        deviceId: "device_example",
        recordedAt: "2026-08-22T09:10:00+08:00",
        localTimezone: "Asia/Manila",
        captureState: "captured",
        assetKind: "receipt_scan",
        byteSize: 2048,
        mediaType: "image/jpeg",
        contentSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        capturedAt: "2026-08-22T09:09:00+08:00",
        purpose: "transaction_receipt",
        objectiveIds: ["objective_del_carmen_observe_services"],
        recordIds: ["0192f060-4f41-7aa1-b322-4aa9fc9f1502"],
        permittedLocation: "governed_area",
        peoplePresent: "none",
        rights: "research_internal",
        consentState: "not_required",
        redactionState: "not_required",
        retentionState: "active",
      },
      captureException: {
        schemaVersion: "capture-exception.v1",
        id: "0192f060-4f41-7aa1-b322-4aa9fc9f1506",
        protocolPackageId: "field-protocol-siargao-baseline",
        protocolPackageVersion: "1.0.0",
        campaignId: "campaign_island_baseline",
        assignmentId: "assignment_pilar_access",
        objectiveId: "objective_pilar_observe_conditions",
        researcherId: "researcher_example",
        deviceId: "device_example",
        recordedAt: "2026-08-22T10:00:00+08:00",
        localTimezone: "Asia/Manila",
        captureState: "captured",
        reason: "unsafe_conditions",
        reasonDetails: "The declared access route was unsafe under observed conditions.",
        context: "planning",
      },
      schemaGap: {
        schemaVersion: "schema-gap.v1",
        id: "0192f060-4f41-7aa1-b322-4aa9fc9f1507",
        protocolPackageId: "field-protocol-siargao-baseline",
        protocolPackageVersion: "1.0.0",
        campaignId: "campaign_island_baseline",
        assignmentId: "assignment_del_carmen_essentials",
        objectiveId: "objective_del_carmen_observe_services",
        visitId: "0192f060-4f41-7aa1-b322-4aa9fc9f1501",
        researcherId: "researcher_example",
        deviceId: "device_example",
        recordedAt: "2026-08-22T09:20:00+08:00",
        localTimezone: "Asia/Manila",
        captureState: "captured",
        subject: {
          kind: "governed",
          subjectId: "subject_area_del_carmen",
        },
        attemptedAt: "2026-08-22T09:18:00+08:00",
        permittedLocation: "governed_area",
        description:
          "The controlled facility states cannot represent the observed shared-access restriction without distortion.",
        resolutionState: "blocked_pending_protocol",
      },
      fieldReview: {
        schemaVersion: "field-review.v1",
        id: "0192f060-4f41-7aa1-b322-4aa9fc9f1508",
        protocolPackageId: "field-protocol-siargao-baseline",
        protocolPackageVersion: "1.0.0",
        recordId: "0192f060-4f41-7aa1-b322-4aa9fc9f1502",
        reviewerId: "reviewer_example",
        researcherId: "researcher_example",
        reviewerMatchesResearcher: false,
        reviewedAt: "2026-08-23T09:00:00+08:00",
        decision: "include",
        reason: "The typed capture, permissions, and lineage are complete.",
      },
      fieldRecoveryExport: {
        schemaVersion: "field-recovery-export.v1",
        filename: "ask-siargao-field-recovery-abcdef123456.asfrecovery",
        createdAt: "2026-08-23T10:00:00+08:00",
        encryption: "xchacha20-poly1305",
        ciphertextBytes: 4096,
        ciphertextSha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        keyId: "field-recovery-key-example",
        restoreInstructionsVersion: "1.0.0",
      },
      fieldBatch: {
        schemaVersion: "field-batch.v2",
        filename: "ask-siargao-field-batch-abcdef123456.asfbatch",
        batchId: "0192f060-4f41-7aa1-b322-4aa9fc9f1509",
        protocolPackages: [
          {
            packageId: "field-protocol-siargao-baseline",
            version: "1.0.0",
          },
        ],
        createdAt: "2026-08-23T11:00:00+08:00",
        recordIds: ["0192f060-4f41-7aa1-b322-4aa9fc9f1502"],
        reviewIds: ["0192f060-4f41-7aa1-b322-4aa9fc9f1508"],
        assetReferences: ["0192f060-4f41-7aa1-b322-4aa9fc9f1505"],
        referentialClosureSha256:
          "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        payloadSha256: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        encryption: "xchacha20-poly1305",
      },
    },
  },
  geography: {
    schemaVersion: "travel-compatibility-graph.v1",
    componentVersion: "1.0.0",
    areas: [
      {
        id: "area_del_carmen",
        classification: "town_and_airport_cluster",
      },
      {
        id: "area_general_luna",
        classification: "visitor_service_cluster",
      },
      {
        id: "area_dapa",
        classification: "port_and_service_cluster",
      },
      {
        id: "area_central_corridor",
        classification: "transfer_corridor",
      },
      {
        id: "area_south_central",
        classification: "route_corridor",
      },
      {
        id: "area_north",
        classification: "remote_route_corridor",
      },
      {
        id: "area_pilar",
        classification: "condition_dependent_access",
      },
    ],
    transportModes: ["walk", "bicycle", "motorbike", "tricycle", "car", "van", "boat"],
    edges: [
      {
        from: "area_del_carmen",
        to: "area_central_corridor",
        modes: ["motorbike", "tricycle", "car", "van"],
        durationBandMinutes: [25, 50],
        transferBoundary: false,
      },
      {
        from: "area_central_corridor",
        to: "area_general_luna",
        modes: ["motorbike", "tricycle", "car", "van"],
        durationBandMinutes: [30, 60],
        transferBoundary: false,
      },
      {
        from: "area_central_corridor",
        to: "area_dapa",
        modes: ["motorbike", "tricycle", "car", "van"],
        durationBandMinutes: [20, 45],
        transferBoundary: false,
      },
      {
        from: "area_general_luna",
        to: "area_south_central",
        modes: ["motorbike", "tricycle", "car"],
        durationBandMinutes: [20, 55],
        transferBoundary: false,
      },
      {
        from: "area_del_carmen",
        to: "area_north",
        modes: ["motorbike", "tricycle", "car", "van"],
        durationBandMinutes: [45, 105],
        transferBoundary: false,
      },
      {
        from: "area_central_corridor",
        to: "area_pilar",
        modes: ["motorbike", "tricycle", "car"],
        durationBandMinutes: [30, 75],
        transferBoundary: false,
      },
      {
        from: "area_del_carmen",
        to: "area_del_carmen",
        modes: ["boat"],
        durationBandMinutes: [15, 180],
        transferBoundary: true,
      },
    ],
  },
  help: {
    schemaVersion: "field-protocol-help.v1",
    componentVersion: "1.0.0",
    entries: {
      "assignment.unscheduled":
        "Assignments stay unscheduled until a Field Researcher assembles one outing. Eligibility is a condition, not a calendar date.",
      "objective.coverage":
        "Coverage comes from linked typed records or an exact Capture Exception. There is no manual done checkbox.",
      "observation.subject":
        "Select exactly one governed Subject or create one structured Provisional Subject.",
      "observation.schema_gap":
        "If the protocol cannot represent reality without distortion, record a Schema Gap instead of choosing a placeholder or arbitrary value.",
      "measurement.lineage":
        "Keep the instrument value and unit as the Raw Measurement. Store any converted value separately with its conversion version and raw-measurement link.",
      "source.consent":
        "Participation, quotation, article, LLM, and public-use consent are independent. Preserve original language; translations are separate attributed derivatives.",
      "export.recovery":
        "A Field Recovery Export is a private encrypted backup and may contain unfinished or unresolved work. It is not a Field Batch.",
      "export.batch":
        "A Field Batch contains an explicit, reviewed, referentially closed selection. Creating it does not upload or admit Facts.",
      "migration.preview":
        "A Protocol Migration never rewrites originals. Preview every result and quarantine ambiguity or failure before activation.",
    },
  },
  manifest: {
    schemaVersion: "field-protocol-package-manifest.v1",
    packageId: "field-protocol-siargao-baseline",
    packageVersion: "1.0.0",
    createdAt: "2026-08-22T00:00:00.000Z",
    signerKeyId: "ask-siargao-field-protocol-2026-01",
    componentVersions: {
      schemas: "1.0.0",
      distributionSchemas: "1.0.0",
      observationKinds: "1.0.0",
      methodProfiles: "1.0.0",
      subjects: "1.0.0",
      geography: "1.0.0",
      campaign: "1.0.0",
      help: "1.0.0",
      migration: "1.0.0",
      examples: "1.0.0",
    },
    compatibility: {
      minimumApplicationVersion: "0.1.0",
      maximumApplicationVersionExclusive: "1.0.0",
    },
    migrationDeclaration: {
      strategy: "explicit_preview_required",
      supportedFromVersions: ["0.9.0"],
      migrationIds: ["migration_legacy_0_9_0_to_baseline_1_0_0"],
    },
    files: [
      {
        path: "canonical/v1/campaign-island-baseline.v1.json",
        sha256: "5f5710d977a8373559ff8681b7613681cf75150038ad19118d530eaa9970281b",
      },
      {
        path: "canonical/v1/distribution-schemas.v1.json",
        sha256: "e197bd0fca5a9c18be2cfb3b7d2cab1a436dd494fa8a9364edf566a2c045e5e5",
      },
      {
        path: "canonical/v1/examples.v1.json",
        sha256: "eec7bfde731ef55655c867c91ac97c2ca6bd848a1a25443d377aec3e56c221f1",
      },
      {
        path: "canonical/v1/geography.v1.json",
        sha256: "c2575f96996f2a966b5227bef05a26e7055c66289f89e7a92155bfe857b051e0",
      },
      {
        path: "canonical/v1/help.v1.json",
        sha256: "a8ae4351d831e922c7329be2482001d83b289e5a76d93b2fe009b02bf27f1d76",
      },
      {
        path: "canonical/v1/method-profiles.v1.json",
        sha256: "45271502a94c39b1432b17d370cc2695556e41ef3591e0f70aa8bb6fac18f22f",
      },
      {
        path: "canonical/v1/migration-legacy-0.9.0.v1.json",
        sha256: "65aae9c90166df9bd127e7b0cb45ee021faa08d475bdc788b142cbb8cff1176c",
      },
      {
        path: "canonical/v1/observation-kinds.v1.json",
        sha256: "7d0560f35f202bc445e1ff1ea696f26a6f50007ffcce242c15a9b2da3a5ec2c3",
      },
      {
        path: "canonical/v1/schemas.v1.json",
        sha256: "75130663fe91caa03d4fceaa0f16760d1e9ee26396fb3cbaa251721d7267c229",
      },
      {
        path: "canonical/v1/subjects.v1.json",
        sha256: "0e907f8f2ab1c1066be81d9d972025a1fa5ca30b88d797f31fa6200588b4cd60",
      },
    ],
    signature: {
      algorithm: "Ed25519",
      value:
        "XRv1goo00ySRuapFzUk+QchYNtS+RadZYRKQSffN/DCjbJHeCWr2dN+XWmbdkXf3whDiv5c52DIsXwYGJDm5BQ==",
    },
  },
  methodProfiles: {
    schemaVersion: "method-profile-registry.v1",
    componentVersion: "1.0.0",
    profiles: [
      {
        id: "method_structured_visual_check@1.0.0",
        procedure:
          "Observe one bounded state, record the instant and governed conditions, and avoid inferring unobserved facts.",
        supportedKinds: [
          "identity",
          "opening_signal",
          "road_condition",
          "facility",
          "accessibility",
          "power",
          "weather_condition",
          "service_status",
          "contact_channel",
          "local_caveat",
        ],
        supportedUnits: [],
        deviceRequirements: [],
      },
      {
        id: "method_posted_or_paid_price@1.0.0",
        procedure:
          "Record the displayed, quoted, or paid amount with its exact basis, inclusions, party size, and receipt linkage.",
        supportedKinds: ["price", "menu_item"],
        supportedUnits: [],
        deviceRequirements: [],
      },
      {
        id: "method_timed_route@1.0.0",
        procedure:
          "Use device timestamps at the declared origin, queue, departure, and destination points without editing elapsed time.",
        supportedKinds: ["route_duration", "route_wait"],
        supportedUnits: ["s"],
        deviceRequirements: ["monotonic_clock"],
      },
      {
        id: "method_payment_attempt@1.0.0",
        procedure:
          "Attempt a genuine appropriate transaction and record the method offered and observed outcome.",
        supportedKinds: ["payment_method"],
        supportedUnits: [],
        deviceRequirements: [],
      },
      {
        id: "method_network_three_test@1.0.0",
        procedure:
          "Run at least three declared upload, download, or latency measurements in the same recorded zone and conditions.",
        supportedKinds: ["connectivity"],
        supportedUnits: ["Mbps", "ms"],
        deviceRequirements: ["network_test_capability"],
      },
      {
        id: "method_manual_crowd_count@1.0.0",
        procedure:
          "Declare the observation boundary, count or select the controlled band, and record the instant.",
        supportedKinds: ["crowd_snapshot"],
        supportedUnits: ["person"],
        deviceRequirements: [],
      },
      {
        id: "method_sound_meter@1.0.0",
        procedure:
          "Record the measurement position and either an instrument dBA reading or the controlled subjective band.",
        supportedKinds: ["noise_snapshot"],
        supportedUnits: ["dBA"],
        deviceRequirements: ["sound_meter_or_declared_subjective_mode"],
      },
      {
        id: "method_tide_source_and_shoreline@1.0.0",
        procedure:
          "Record the observed shoreline state and preserve the cited tide source and retrieval instant separately.",
        supportedKinds: ["tide_context"],
        supportedUnits: [],
        deviceRequirements: [],
      },
      {
        id: "method_source_question@1.0.0",
        procedure:
          "Ask the declared question, preserve basis of knowledge and original language, and record each consent independently.",
        supportedKinds: ["power", "service_status", "local_caveat"],
        supportedUnits: [],
        deviceRequirements: [],
      },
    ],
  },
  migration: {
    schemaVersion: "protocol-migration.v1",
    componentVersion: "1.0.0",
    migrationId: "migration_legacy_0_9_0_to_baseline_1_0_0",
    fromPackageVersion: "0.9.0",
    toPackageVersion: "1.0.0",
    kindMappings: [
      {
        from: "opening_hours",
        to: "opening_signal",
      },
      {
        from: "internet_speed",
        to: "connectivity",
      },
    ],
    subjectMappings: [
      {
        from: "legacy_del_carmen",
        to: "subject_area_del_carmen",
      },
      {
        from: "legacy_general_luna",
        to: "subject_area_general_luna",
      },
    ],
    ambiguousKinds: [
      {
        kind: "free_text_observation",
        reason:
          "Free text cannot be mapped to one controlled Observation Kind without human interpretation.",
      },
    ],
    unsupportedKinds: ["legacy_arbitrary_json"],
  },
  observationKinds: {
    schemaVersion: "observation-kind-registry.v1",
    componentVersion: "1.0.0",
    kinds: [
      {
        kind: "identity",
        valueSchemaVersion: "1.0.0",
        allowedUnits: [],
        requiredContext: ["displayedName", "category", "resolutionEvidence"],
        freshness: {
          defaultReviewMinutes: 259200,
          maximumReviewMinutes: 259200,
        },
        valueSchema: {
          type: "object",
          additionalProperties: false,
          required: ["displayedName", "aliases", "category", "resolutionEvidence"],
          properties: {
            displayedName: {
              type: "string",
              minLength: 1,
            },
            officialName: {
              type: "string",
              minLength: 1,
            },
            aliases: {
              type: "array",
              items: {
                type: "string",
                minLength: 1,
              },
              uniqueItems: true,
            },
            category: {
              enum: ["place", "service", "route", "organisation"],
            },
            resolutionEvidence: {
              enum: ["displayed_sign", "receipt", "source_statement", "official_directory"],
            },
          },
        },
      },
      {
        kind: "opening_signal",
        valueSchemaVersion: "1.0.0",
        allowedUnits: [],
        requiredContext: ["state", "basis", "postedHoursSeparatelyEvidenced"],
        freshness: {
          defaultReviewMinutes: 10080,
          maximumReviewMinutes: 43200,
        },
        valueSchema: {
          type: "object",
          additionalProperties: false,
          required: ["state", "basis", "postedHoursSeparatelyEvidenced"],
          properties: {
            state: {
              enum: ["open", "closed", "unknown"],
            },
            basis: {
              enum: ["observed", "posted", "attempted"],
            },
            postedHoursSeparatelyEvidenced: {
              type: "boolean",
            },
          },
        },
      },
      {
        kind: "price",
        valueSchemaVersion: "1.0.0",
        allowedUnits: [],
        requiredContext: [
          "amount",
          "currency",
          "item",
          "pricingUnit",
          "partySize",
          "inclusions",
          "basis",
        ],
        freshness: {
          defaultReviewMinutes: 10080,
          maximumReviewMinutes: 43200,
        },
        valueSchema: {
          type: "object",
          additionalProperties: false,
          required: [
            "amount",
            "currency",
            "item",
            "pricingUnit",
            "partySize",
            "inclusions",
            "basis",
            "taxesAndFees",
            "negotiated",
          ],
          properties: {
            amount: {
              type: "string",
              pattern: "^(0|[1-9][0-9]*)(\\.[0-9]{1,2})?$",
            },
            currency: {
              const: "PHP",
            },
            item: {
              type: "string",
              minLength: 1,
            },
            pricingUnit: {
              enum: ["item", "person", "party", "journey", "hour", "day"],
            },
            partySize: {
              type: "integer",
              minimum: 1,
            },
            inclusions: {
              type: "array",
              items: {
                type: "string",
                minLength: 1,
              },
            },
            basis: {
              enum: ["posted", "quoted", "paid"],
            },
            taxesAndFees: {
              enum: ["included", "excluded", "unknown"],
            },
            negotiated: {
              type: "boolean",
            },
            paymentMethodAttempted: {
              enum: ["cash", "card", "gcash", "maya", "bank_transfer"],
            },
            receiptAssetId: {
              type: "string",
              format: "uuid",
            },
          },
        },
      },
      {
        kind: "route_duration",
        valueSchemaVersion: "1.0.0",
        allowedUnits: ["s"],
        requiredContext: [
          "originSubjectId",
          "destinationSubjectId",
          "transportMode",
          "durationSeconds",
        ],
        freshness: {
          defaultReviewMinutes: 43200,
          maximumReviewMinutes: 129600,
        },
        valueSchema: {
          type: "object",
          additionalProperties: false,
          required: ["originSubjectId", "destinationSubjectId", "transportMode", "durationSeconds"],
          properties: {
            originSubjectId: {
              type: "string",
              pattern: "^subject_[a-z0-9_]+$",
            },
            destinationSubjectId: {
              type: "string",
              pattern: "^subject_[a-z0-9_]+$",
            },
            transportMode: {
              enum: ["walk", "bicycle", "motorbike", "tricycle", "car", "van", "boat"],
            },
            durationSeconds: {
              type: "integer",
              minimum: 0,
            },
          },
        },
      },
      {
        kind: "route_wait",
        valueSchemaVersion: "1.0.0",
        allowedUnits: ["s"],
        requiredContext: ["waitSeconds", "transportMode", "queueState"],
        freshness: {
          defaultReviewMinutes: 10080,
          maximumReviewMinutes: 43200,
        },
        valueSchema: {
          type: "object",
          additionalProperties: false,
          required: ["waitSeconds", "transportMode", "queueState"],
          properties: {
            waitSeconds: {
              type: "integer",
              minimum: 0,
            },
            transportMode: {
              enum: ["tricycle", "car", "van", "boat"],
            },
            queueState: {
              enum: ["none", "short", "moderate", "long"],
            },
          },
        },
      },
      {
        kind: "road_condition",
        valueSchemaVersion: "1.0.0",
        allowedUnits: [],
        requiredContext: ["segmentId", "surface", "obstruction", "weatherContext"],
        freshness: {
          defaultReviewMinutes: 10080,
          maximumReviewMinutes: 43200,
        },
        valueSchema: {
          type: "object",
          additionalProperties: false,
          required: ["segmentId", "surface", "obstruction", "weatherContext"],
          properties: {
            segmentId: {
              type: "string",
              pattern: "^segment_[a-z0-9_]+$",
            },
            surface: {
              enum: ["paved", "gravel", "sand", "mud", "mixed"],
            },
            obstruction: {
              enum: ["none", "minor", "partial", "blocked", "unknown"],
            },
            weatherContext: {
              enum: ["dry", "recent_rain", "active_rain", "unknown"],
            },
          },
        },
      },
      {
        kind: "facility",
        valueSchemaVersion: "1.0.0",
        allowedUnits: [],
        requiredContext: ["facilityType", "state", "accessConditions"],
        freshness: {
          defaultReviewMinutes: 43200,
          maximumReviewMinutes: 129600,
        },
        valueSchema: {
          type: "object",
          additionalProperties: false,
          required: ["facilityType", "state", "accessConditions"],
          properties: {
            facilityType: {
              enum: [
                "toilet",
                "shower",
                "shade",
                "seating",
                "parking",
                "cash_machine",
                "clinic",
                "pharmacy",
                "fuel",
              ],
            },
            state: {
              enum: ["present", "absent", "available", "unavailable", "inaccessible", "unknown"],
            },
            accessConditions: {
              type: "string",
              minLength: 1,
            },
          },
        },
      },
      {
        kind: "accessibility",
        valueSchemaVersion: "1.0.0",
        allowedUnits: ["cm", "degree"],
        requiredContext: ["feature", "state", "measurementBasis"],
        freshness: {
          defaultReviewMinutes: 43200,
          maximumReviewMinutes: 129600,
        },
        valueSchema: {
          type: "object",
          additionalProperties: false,
          required: ["feature", "state", "measurementBasis"],
          properties: {
            feature: {
              enum: [
                "step",
                "ramp",
                "door_width",
                "path_surface",
                "toilet_access",
                "transfer_barrier",
                "shelter",
              ],
            },
            state: {
              enum: ["present", "absent", "usable", "not_usable", "not_tested", "unknown"],
            },
            measurementBasis: {
              enum: ["measured", "observed", "attempted"],
            },
            measuredValue: {
              type: "number",
            },
            unit: {
              enum: ["cm", "degree"],
            },
          },
        },
      },
      {
        kind: "payment_method",
        valueSchemaVersion: "1.0.0",
        allowedUnits: [],
        requiredContext: ["method", "outcome", "transactionContext"],
        freshness: {
          defaultReviewMinutes: 43200,
          maximumReviewMinutes: 43200,
        },
        valueSchema: {
          type: "object",
          additionalProperties: false,
          required: ["method", "outcome", "transactionContext"],
          properties: {
            method: {
              enum: ["cash", "card", "gcash", "maya", "bank_transfer"],
            },
            outcome: {
              enum: ["offered", "accepted", "rejected", "not_offered", "not_tested", "unknown"],
            },
            transactionContext: {
              type: "string",
              minLength: 1,
            },
          },
        },
      },
      {
        kind: "connectivity",
        valueSchemaVersion: "1.0.0",
        allowedUnits: ["Mbps", "ms"],
        requiredContext: ["network", "deviceClass", "zone", "measurements"],
        freshness: {
          defaultReviewMinutes: 10080,
          maximumReviewMinutes: 43200,
        },
        valueSchema: {
          type: "object",
          additionalProperties: false,
          required: ["network", "deviceClass", "zone", "measurements"],
          properties: {
            network: {
              type: "string",
              minLength: 1,
            },
            deviceClass: {
              enum: ["phone", "tablet", "laptop", "dedicated_meter"],
            },
            zone: {
              enum: ["indoors", "outdoors", "threshold", "roadside"],
            },
            measurements: {
              type: "array",
              minItems: 3,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["metric", "value", "unit"],
                properties: {
                  metric: {
                    enum: ["download", "upload", "latency"],
                  },
                  value: {
                    type: "number",
                    minimum: 0,
                  },
                  unit: {
                    enum: ["Mbps", "ms"],
                  },
                },
              },
            },
          },
        },
      },
      {
        kind: "power",
        valueSchemaVersion: "1.0.0",
        allowedUnits: [],
        requiredContext: ["state", "socketPermission", "basis"],
        freshness: {
          defaultReviewMinutes: 10080,
          maximumReviewMinutes: 43200,
        },
        valueSchema: {
          type: "object",
          additionalProperties: false,
          required: ["state", "socketPermission", "basis"],
          properties: {
            state: {
              enum: ["available", "unavailable", "outage", "unknown"],
            },
            socketPermission: {
              enum: ["granted", "denied", "not_requested", "not_applicable"],
            },
            basis: {
              enum: ["direct_observation", "attempted", "source_stated"],
            },
            backupPowerStatementId: {
              type: "string",
              format: "uuid",
            },
          },
        },
      },
      {
        kind: "crowd_snapshot",
        valueSchemaVersion: "1.0.0",
        allowedUnits: ["person"],
        requiredContext: ["boundary", "method", "band"],
        freshness: {
          defaultReviewMinutes: 10080,
          maximumReviewMinutes: 10080,
        },
        valueSchema: {
          type: "object",
          additionalProperties: false,
          required: ["boundary", "method", "band"],
          properties: {
            boundary: {
              type: "string",
              minLength: 1,
            },
            method: {
              enum: ["counted", "estimated_band"],
            },
            count: {
              type: "integer",
              minimum: 0,
            },
            band: {
              enum: ["empty", "quiet", "moderate", "busy", "very_busy"],
            },
          },
        },
      },
      {
        kind: "noise_snapshot",
        valueSchemaVersion: "1.0.0",
        allowedUnits: ["dBA"],
        requiredContext: ["method", "band", "measurementPosition"],
        freshness: {
          defaultReviewMinutes: 10080,
          maximumReviewMinutes: 10080,
        },
        valueSchema: {
          type: "object",
          additionalProperties: false,
          required: ["method", "band", "measurementPosition"],
          properties: {
            method: {
              enum: ["measured_dba", "subjective_band"],
            },
            dba: {
              type: "number",
              minimum: 0,
              maximum: 180,
            },
            band: {
              enum: ["quiet", "moderate", "loud", "very_loud"],
            },
            measurementPosition: {
              type: "string",
              minLength: 1,
            },
          },
        },
      },
      {
        kind: "weather_condition",
        valueSchemaVersion: "1.0.0",
        allowedUnits: [],
        requiredContext: ["condition", "observationBasis"],
        freshness: {
          defaultReviewMinutes: 180,
          maximumReviewMinutes: 720,
        },
        valueSchema: {
          type: "object",
          additionalProperties: false,
          required: ["condition", "observationBasis"],
          properties: {
            condition: {
              enum: [
                "clear",
                "cloudy",
                "light_rain",
                "heavy_rain",
                "thunderstorm",
                "strong_wind",
                "unknown",
              ],
            },
            observationBasis: {
              enum: ["direct", "authoritative_source"],
            },
            authoritativeSourceId: {
              type: "string",
              minLength: 1,
            },
          },
        },
      },
      {
        kind: "tide_context",
        valueSchemaVersion: "1.0.0",
        allowedUnits: [],
        requiredContext: ["shorelineState", "sourceId", "sourceRetrievedAt"],
        freshness: {
          defaultReviewMinutes: 180,
          maximumReviewMinutes: 720,
        },
        valueSchema: {
          type: "object",
          additionalProperties: false,
          required: ["shorelineState", "sourceId", "sourceRetrievedAt"],
          properties: {
            shorelineState: {
              enum: ["low", "rising", "mid", "falling", "high", "unknown"],
            },
            sourceId: {
              type: "string",
              minLength: 1,
            },
            sourceRetrievedAt: {
              type: "string",
              pattern:
                "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
            },
          },
        },
      },
      {
        kind: "menu_item",
        valueSchemaVersion: "1.0.0",
        allowedUnits: [],
        requiredContext: [
          "itemName",
          "amount",
          "currency",
          "availability",
          "dietaryDisclosureBasis",
        ],
        freshness: {
          defaultReviewMinutes: 10080,
          maximumReviewMinutes: 43200,
        },
        valueSchema: {
          type: "object",
          additionalProperties: false,
          required: ["itemName", "amount", "currency", "availability", "dietaryDisclosureBasis"],
          properties: {
            itemName: {
              type: "string",
              minLength: 1,
            },
            amount: {
              type: "string",
              pattern: "^(0|[1-9][0-9]*)(\\.[0-9]{1,2})?$",
            },
            currency: {
              const: "PHP",
            },
            availability: {
              enum: ["available", "unavailable", "unknown"],
            },
            dietaryDisclosureBasis: {
              enum: ["menu_label", "staff_statement", "not_disclosed"],
            },
          },
        },
      },
      {
        kind: "service_status",
        valueSchemaVersion: "1.0.0",
        allowedUnits: [],
        requiredContext: ["state", "basis"],
        freshness: {
          defaultReviewMinutes: 1440,
          maximumReviewMinutes: 10080,
        },
        valueSchema: {
          type: "object",
          additionalProperties: false,
          required: ["state", "basis"],
          properties: {
            state: {
              enum: ["operating", "not_operating", "limited", "unknown"],
            },
            basis: {
              enum: ["observed", "attempted", "posted", "source_stated"],
            },
            limitations: {
              type: "string",
              minLength: 1,
            },
          },
        },
      },
      {
        kind: "contact_channel",
        valueSchemaVersion: "1.0.0",
        allowedUnits: [],
        requiredContext: ["channelType", "publicValue", "verificationMethod", "permission"],
        freshness: {
          defaultReviewMinutes: 43200,
          maximumReviewMinutes: 129600,
        },
        valueSchema: {
          type: "object",
          additionalProperties: false,
          required: ["channelType", "publicValue", "verificationMethod", "permission"],
          properties: {
            channelType: {
              enum: ["phone", "email", "website", "facebook", "instagram"],
            },
            publicValue: {
              type: "string",
              minLength: 1,
            },
            verificationMethod: {
              enum: ["displayed", "called", "messaged", "official_directory"],
            },
            permission: {
              enum: ["publicly_displayed", "explicitly_granted", "internal_only"],
            },
          },
        },
      },
      {
        kind: "local_caveat",
        valueSchemaVersion: "1.0.0",
        allowedUnits: [],
        requiredContext: ["warning", "appliesWhen", "directness", "corroborationCount"],
        freshness: {
          defaultReviewMinutes: 10080,
          maximumReviewMinutes: 129600,
        },
        valueSchema: {
          type: "object",
          additionalProperties: false,
          required: ["warning", "appliesWhen", "directness", "corroborationCount"],
          properties: {
            warning: {
              type: "string",
              minLength: 1,
            },
            appliesWhen: {
              type: "array",
              items: {
                enum: [
                  "weather_change",
                  "tide_change",
                  "after_dark",
                  "crowd_peak",
                  "service_disruption",
                  "access_restriction",
                ],
              },
              minItems: 1,
              uniqueItems: true,
            },
            directness: {
              enum: ["direct_observation", "source_stated", "derived"],
            },
            corroborationCount: {
              type: "integer",
              minimum: 0,
            },
          },
        },
      },
    ],
  },
  schemas: {
    schemaVersion: "field-protocol-schemas.v1",
    componentVersion: "1.0.0",
    records: {
      fieldVisit: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "https://asksiargao.com/schemas/field-visit.v1.json",
        title: "FieldVisit",
        type: "object",
        additionalProperties: false,
        required: [
          "schemaVersion",
          "id",
          "protocolPackageId",
          "protocolPackageVersion",
          "campaignId",
          "assignmentId",
          "researcherId",
          "deviceId",
          "recordedAt",
          "localTimezone",
          "captureState",
          "startedAt",
          "target",
          "locationPermissionState",
          "publicLocationPrecision",
          "conditions",
          "objectiveIds",
          "assetIds",
        ],
        properties: {
          schemaVersion: {
            const: "field-visit.v1",
          },
          id: {
            type: "string",
            format: "uuid",
          },
          protocolPackageId: {
            type: "string",
            pattern: "^field-protocol-[a-z0-9-]+$",
          },
          protocolPackageVersion: {
            type: "string",
            pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
          },
          campaignId: {
            type: "string",
            pattern: "^campaign_[a-z0-9_]+$",
          },
          assignmentId: {
            type: "string",
            pattern: "^assignment_[a-z0-9_]+$",
          },
          researcherId: {
            type: "string",
            minLength: 1,
          },
          deviceId: {
            type: "string",
            minLength: 1,
          },
          recordedAt: {
            type: "string",
            pattern:
              "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
          },
          localTimezone: {
            type: "string",
            const: "Asia/Manila",
          },
          supersedesId: {
            type: "string",
            format: "uuid",
          },
          captureState: {
            enum: ["draft", "captured"],
          },
          startedAt: {
            type: "string",
            pattern:
              "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
          },
          endedAt: {
            type: "string",
            pattern:
              "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
          },
          target: {
            $ref: "#/$defs/visitTarget",
          },
          locationPermissionState: {
            enum: ["denied", "coarse", "precise_active_visit"],
          },
          publicLocationPrecision: {
            enum: ["withheld", "governed_area", "route_corridor", "approximate_100m"],
          },
          conditions: {
            $ref: "#/$defs/conditions",
          },
          objectiveIds: {
            type: "array",
            items: {
              type: "string",
              pattern: "^objective_[a-z0-9_]+$",
            },
            minItems: 1,
            uniqueItems: true,
          },
          assetIds: {
            type: "array",
            items: {
              type: "string",
              format: "uuid",
            },
            uniqueItems: true,
          },
          privateContextNote: {
            type: "string",
            minLength: 1,
            maxLength: 2000,
          },
        },
        $defs: {
          visitTarget: {
            oneOf: [
              {
                type: "object",
                additionalProperties: false,
                required: ["kind", "subjectId"],
                properties: {
                  kind: {
                    const: "governed_subject",
                  },
                  subjectId: {
                    type: "string",
                    pattern: "^subject_[a-z0-9_]+$",
                  },
                },
              },
              {
                type: "object",
                additionalProperties: false,
                required: ["kind", "areaId"],
                properties: {
                  kind: {
                    const: "governed_area",
                  },
                  areaId: {
                    type: "string",
                    pattern: "^area_[a-z0-9_]+$",
                  },
                },
              },
              {
                type: "object",
                additionalProperties: false,
                required: ["kind", "routeId"],
                properties: {
                  kind: {
                    const: "governed_route",
                  },
                  routeId: {
                    type: "string",
                    pattern: "^route_[a-z0-9_]+$",
                  },
                },
              },
              {
                type: "object",
                additionalProperties: false,
                required: ["kind", "provisionalSubject"],
                properties: {
                  kind: {
                    const: "provisional_subject",
                  },
                  provisionalSubject: {
                    $ref: "#/$defs/provisionalSubject",
                  },
                },
              },
            ],
          },
          provisionalSubject: {
            type: "object",
            additionalProperties: false,
            required: [
              "id",
              "displayedName",
              "category",
              "governedAreaId",
              "distinguishingDetails",
            ],
            properties: {
              id: {
                type: "string",
                format: "uuid",
              },
              displayedName: {
                type: "string",
                minLength: 1,
              },
              category: {
                enum: ["place", "service", "route", "organisation"],
              },
              governedAreaId: {
                type: "string",
                pattern: "^area_[a-z0-9_]+$",
              },
              distinguishingDetails: {
                type: "string",
                minLength: 1,
              },
            },
          },
          conditions: {
            type: "object",
            additionalProperties: false,
            required: ["tags"],
            properties: {
              tags: {
                type: "array",
                uniqueItems: true,
                items: {
                  enum: [
                    "weather_clear",
                    "weather_cloudy",
                    "weather_rain",
                    "tide_low",
                    "tide_mid",
                    "tide_high",
                    "road_dry",
                    "road_wet",
                    "crowd_quiet",
                    "crowd_moderate",
                    "crowd_busy",
                    "noise_quiet",
                    "noise_moderate",
                    "noise_loud",
                    "power_available",
                    "power_outage",
                    "access_open",
                    "access_restricted",
                    "disruption_none",
                    "disruption_active",
                  ],
                },
              },
            },
          },
        },
      },
      fieldObservation: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "https://asksiargao.com/schemas/field-observation.v1.json",
        title: "FieldObservation",
        type: "object",
        additionalProperties: false,
        required: [
          "schemaVersion",
          "id",
          "protocolPackageId",
          "protocolPackageVersion",
          "campaignId",
          "assignmentId",
          "visitId",
          "objectiveId",
          "researcherId",
          "deviceId",
          "recordedAt",
          "localTimezone",
          "captureState",
          "subject",
          "observationKind",
          "valueSchemaVersion",
          "directness",
          "observedAt",
          "utcOffsetMinutes",
          "timeCorrected",
          "value",
          "methodProfileId",
          "conditions",
          "captureConfidence",
          "reviewDueAt",
          "permissions",
        ],
        properties: {
          schemaVersion: {
            const: "field-observation.v1",
          },
          id: {
            type: "string",
            format: "uuid",
          },
          protocolPackageId: {
            type: "string",
            pattern: "^field-protocol-[a-z0-9-]+$",
          },
          protocolPackageVersion: {
            type: "string",
            pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
          },
          campaignId: {
            type: "string",
            pattern: "^campaign_[a-z0-9_]+$",
          },
          assignmentId: {
            type: "string",
            pattern: "^assignment_[a-z0-9_]+$",
          },
          visitId: {
            type: "string",
            format: "uuid",
          },
          objectiveId: {
            type: "string",
            pattern: "^objective_[a-z0-9_]+$",
          },
          researcherId: {
            type: "string",
            minLength: 1,
          },
          deviceId: {
            type: "string",
            minLength: 1,
          },
          recordedAt: {
            type: "string",
            pattern:
              "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
          },
          localTimezone: {
            type: "string",
            const: "Asia/Manila",
          },
          supersedesId: {
            type: "string",
            format: "uuid",
          },
          captureState: {
            enum: ["draft", "captured"],
          },
          subject: {
            oneOf: [
              {
                type: "object",
                additionalProperties: false,
                required: ["kind", "subjectId"],
                properties: {
                  kind: {
                    const: "governed",
                  },
                  subjectId: {
                    type: "string",
                    pattern: "^subject_[a-z0-9_]+$",
                  },
                },
              },
              {
                type: "object",
                additionalProperties: false,
                required: ["kind", "provisionalSubjectId"],
                properties: {
                  kind: {
                    const: "provisional",
                  },
                  provisionalSubjectId: {
                    type: "string",
                    format: "uuid",
                  },
                },
              },
            ],
          },
          observationKind: {
            type: "string",
            pattern: "^[a-z][a-z0-9_]+$",
          },
          valueSchemaVersion: {
            type: "string",
            pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
          },
          directness: {
            enum: [
              "direct_observation",
              "instrument_measurement",
              "transaction_record",
              "posted_notice",
              "source_stated",
              "derived",
            ],
          },
          observedAt: {
            type: "string",
            pattern:
              "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
          },
          utcOffsetMinutes: {
            type: "integer",
            minimum: -720,
            maximum: 840,
          },
          timeCorrected: {
            type: "boolean",
          },
          value: {
            type: "object",
          },
          methodProfileId: {
            type: "string",
            pattern: "^method_[a-z0-9_]+@[0-9]+\\.[0-9]+\\.[0-9]+$",
          },
          conditions: {
            type: "array",
            uniqueItems: true,
            items: {
              enum: [
                "weather_clear",
                "weather_cloudy",
                "weather_rain",
                "tide_low",
                "tide_mid",
                "tide_high",
                "road_dry",
                "road_wet",
                "crowd_quiet",
                "crowd_moderate",
                "crowd_busy",
                "noise_quiet",
                "noise_moderate",
                "noise_loud",
                "power_available",
                "power_outage",
                "access_open",
                "access_restricted",
                "disruption_none",
                "disruption_active",
              ],
            },
          },
          rawMeasurement: {
            type: "object",
            additionalProperties: false,
            required: ["id", "value", "unit"],
            properties: {
              id: {
                type: "string",
                format: "uuid",
              },
              value: {
                type: "number",
              },
              unit: {
                type: "string",
                minLength: 1,
              },
            },
          },
          normalizedMeasurement: {
            type: "object",
            additionalProperties: false,
            required: ["value", "unit", "sourceRawMeasurementId", "conversionVersion"],
            properties: {
              value: {
                type: "number",
              },
              unit: {
                type: "string",
                minLength: 1,
              },
              sourceRawMeasurementId: {
                type: "string",
                format: "uuid",
              },
              conversionVersion: {
                type: "string",
                pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
              },
            },
          },
          captureConfidence: {
            enum: ["high", "medium", "low"],
          },
          captureConfidenceReason: {
            type: "string",
            minLength: 1,
          },
          caveat: {
            type: "string",
            minLength: 1,
          },
          validUntil: {
            type: "string",
            pattern:
              "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
          },
          reviewDueAt: {
            type: "string",
            pattern:
              "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
          },
          permissions: {
            type: "object",
            additionalProperties: false,
            required: ["llmUse", "articleUse", "quotationUse", "publicUse"],
            properties: {
              llmUse: {
                const: false,
              },
              articleUse: {
                const: false,
              },
              quotationUse: {
                const: false,
              },
              publicUse: {
                const: false,
              },
            },
          },
          assetIds: {
            type: "array",
            items: {
              type: "string",
              format: "uuid",
            },
            uniqueItems: true,
          },
          contradictsObservationIds: {
            type: "array",
            items: {
              type: "string",
              format: "uuid",
            },
            uniqueItems: true,
          },
          comparisonGroupId: {
            type: "string",
            format: "uuid",
          },
        },
      },
      routeRun: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "https://asksiargao.com/schemas/route-run.v1.json",
        title: "RouteRun",
        type: "object",
        additionalProperties: false,
        required: [
          "schemaVersion",
          "id",
          "protocolPackageId",
          "protocolPackageVersion",
          "campaignId",
          "assignmentId",
          "visitId",
          "researcherId",
          "deviceId",
          "recordedAt",
          "localTimezone",
          "captureState",
          "originSubjectId",
          "destinationSubjectId",
          "transportMode",
          "requestedAt",
          "departedAt",
          "arrivedAt",
          "stops",
          "partyContext",
          "luggageContext",
          "accessContext",
          "bookingMethod",
          "methodProfileId",
          "conditions",
          "signalCheckpoints",
          "barriers",
          "notTested",
        ],
        properties: {
          schemaVersion: {
            const: "route-run.v1",
          },
          id: {
            type: "string",
            format: "uuid",
          },
          protocolPackageId: {
            type: "string",
            pattern: "^field-protocol-[a-z0-9-]+$",
          },
          protocolPackageVersion: {
            type: "string",
            pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
          },
          campaignId: {
            type: "string",
            pattern: "^campaign_[a-z0-9_]+$",
          },
          assignmentId: {
            type: "string",
            pattern: "^assignment_[a-z0-9_]+$",
          },
          visitId: {
            type: "string",
            format: "uuid",
          },
          researcherId: {
            type: "string",
            minLength: 1,
          },
          deviceId: {
            type: "string",
            minLength: 1,
          },
          recordedAt: {
            type: "string",
            pattern:
              "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
          },
          localTimezone: {
            const: "Asia/Manila",
          },
          captureState: {
            enum: ["draft", "captured"],
          },
          supersedesId: {
            type: "string",
            format: "uuid",
          },
          originSubjectId: {
            type: "string",
            pattern: "^subject_[a-z0-9_]+$",
          },
          destinationSubjectId: {
            type: "string",
            pattern: "^subject_[a-z0-9_]+$",
          },
          transportMode: {
            enum: ["walk", "bicycle", "motorbike", "tricycle", "car", "van", "boat"],
          },
          requestedAt: {
            type: "string",
            pattern:
              "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
          },
          queueStartedAt: {
            type: "string",
            pattern:
              "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
          },
          departedAt: {
            type: "string",
            pattern:
              "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
          },
          arrivedAt: {
            type: "string",
            pattern:
              "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
          },
          stops: {
            type: "array",
            items: {
              type: "string",
              minLength: 1,
            },
          },
          partyContext: {
            type: "string",
            minLength: 1,
          },
          luggageContext: {
            type: "string",
            minLength: 1,
          },
          accessContext: {
            type: "string",
            minLength: 1,
          },
          bookingMethod: {
            enum: ["walk_up", "phone", "web", "app", "prearranged", "not_applicable"],
          },
          distanceMeters: {
            type: "number",
            minimum: 0,
          },
          methodProfileId: {
            type: "string",
            pattern: "^method_[a-z0-9_]+@[0-9]+\\.[0-9]+\\.[0-9]+$",
          },
          price: {
            type: "object",
            additionalProperties: false,
            required: ["amount", "currency", "basis"],
            properties: {
              amount: {
                type: "string",
                pattern: "^(0|[1-9][0-9]*)(\\.[0-9]{1,2})?$",
              },
              currency: {
                const: "PHP",
              },
              basis: {
                enum: ["posted", "quoted", "paid"],
              },
              receiptAssetId: {
                type: "string",
                format: "uuid",
              },
            },
          },
          conditions: {
            type: "array",
            items: {
              type: "string",
              minLength: 1,
            },
            uniqueItems: true,
          },
          signalCheckpoints: {
            type: "array",
            items: {
              type: "string",
              minLength: 1,
            },
          },
          barriers: {
            type: "array",
            items: {
              type: "string",
              minLength: 1,
            },
          },
          notTested: {
            type: "array",
            items: {
              type: "string",
              minLength: 1,
            },
          },
        },
      },
      sourceStatement: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "https://asksiargao.com/schemas/source-statement.v1.json",
        title: "SourceStatement",
        type: "object",
        additionalProperties: false,
        required: [
          "schemaVersion",
          "id",
          "protocolPackageId",
          "protocolPackageVersion",
          "campaignId",
          "assignmentId",
          "visitId",
          "objectiveId",
          "researcherId",
          "deviceId",
          "recordedAt",
          "localTimezone",
          "captureState",
          "subjectId",
          "sourceRole",
          "basisOfKnowledge",
          "questionAsked",
          "originalLanguage",
          "statementForm",
          "originalStatement",
          "attribution",
          "captureContext",
          "consents",
          "consentMethod",
          "consentRecordedAt",
          "withdrawalRoute",
          "translationIds",
          "assetIds",
        ],
        properties: {
          schemaVersion: {
            const: "source-statement.v1",
          },
          id: {
            type: "string",
            format: "uuid",
          },
          protocolPackageId: {
            type: "string",
            pattern: "^field-protocol-[a-z0-9-]+$",
          },
          protocolPackageVersion: {
            type: "string",
            pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
          },
          campaignId: {
            type: "string",
            pattern: "^campaign_[a-z0-9_]+$",
          },
          assignmentId: {
            type: "string",
            pattern: "^assignment_[a-z0-9_]+$",
          },
          visitId: {
            type: "string",
            format: "uuid",
          },
          objectiveId: {
            type: "string",
            pattern: "^objective_[a-z0-9_]+$",
          },
          researcherId: {
            type: "string",
            minLength: 1,
          },
          deviceId: {
            type: "string",
            minLength: 1,
          },
          recordedAt: {
            type: "string",
            pattern:
              "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
          },
          localTimezone: {
            const: "Asia/Manila",
          },
          captureState: {
            enum: ["draft", "captured"],
          },
          supersedesId: {
            type: "string",
            format: "uuid",
          },
          subjectId: {
            type: "string",
            pattern: "^subject_[a-z0-9_]+$",
          },
          sourceRole: {
            enum: [
              "owner",
              "manager",
              "staff",
              "driver",
              "resident",
              "visitor",
              "official",
              "other_governed",
            ],
          },
          basisOfKnowledge: {
            enum: [
              "direct_responsibility",
              "direct_experience",
              "posted_policy",
              "second_hand",
              "unknown",
            ],
          },
          questionAsked: {
            type: "string",
            minLength: 1,
          },
          originalLanguage: {
            type: "string",
            pattern: "^[a-z]{2,3}(-[A-Z]{2})?$",
          },
          statementForm: {
            enum: ["exact_quotation", "labelled_paraphrase"],
          },
          originalStatement: {
            type: "string",
            minLength: 1,
          },
          attribution: {
            enum: ["named", "role_only", "anonymous", "not_for_publication"],
          },
          captureContext: {
            type: "string",
            minLength: 1,
          },
          consents: {
            type: "object",
            additionalProperties: false,
            required: ["participation", "llmUse", "articleUse", "quotationUse", "publicUse"],
            properties: {
              participation: {
                type: "boolean",
              },
              llmUse: {
                type: "boolean",
              },
              articleUse: {
                type: "boolean",
              },
              quotationUse: {
                type: "boolean",
              },
              publicUse: {
                type: "boolean",
              },
            },
          },
          consentMethod: {
            enum: ["verbal", "written", "recorded_form"],
          },
          consentRecordedAt: {
            type: "string",
            pattern:
              "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
          },
          validUntil: {
            type: "string",
            pattern:
              "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
          },
          recontactAfter: {
            type: "string",
            pattern:
              "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
          },
          withdrawalRoute: {
            type: "string",
            minLength: 1,
          },
          translationIds: {
            type: "array",
            items: {
              type: "string",
              format: "uuid",
            },
            uniqueItems: true,
          },
          assetIds: {
            type: "array",
            items: {
              type: "string",
              format: "uuid",
            },
            uniqueItems: true,
          },
        },
      },
      evidenceAsset: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "https://asksiargao.com/schemas/evidence-asset.v1.json",
        title: "EvidenceAsset",
        type: "object",
        additionalProperties: false,
        required: [
          "schemaVersion",
          "id",
          "protocolPackageId",
          "protocolPackageVersion",
          "campaignId",
          "assignmentId",
          "visitId",
          "researcherId",
          "deviceId",
          "recordedAt",
          "localTimezone",
          "captureState",
          "assetKind",
          "byteSize",
          "mediaType",
          "contentSha256",
          "capturedAt",
          "purpose",
          "objectiveIds",
          "recordIds",
          "permittedLocation",
          "peoplePresent",
          "rights",
          "consentState",
          "redactionState",
          "retentionState",
        ],
        properties: {
          schemaVersion: {
            const: "evidence-asset.v1",
          },
          id: {
            type: "string",
            format: "uuid",
          },
          protocolPackageId: {
            type: "string",
            pattern: "^field-protocol-[a-z0-9-]+$",
          },
          protocolPackageVersion: {
            type: "string",
            pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
          },
          campaignId: {
            type: "string",
            pattern: "^campaign_[a-z0-9_]+$",
          },
          assignmentId: {
            type: "string",
            pattern: "^assignment_[a-z0-9_]+$",
          },
          visitId: {
            type: "string",
            format: "uuid",
          },
          researcherId: {
            type: "string",
            minLength: 1,
          },
          deviceId: {
            type: "string",
            minLength: 1,
          },
          recordedAt: {
            type: "string",
            pattern:
              "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
          },
          localTimezone: {
            const: "Asia/Manila",
          },
          captureState: {
            enum: ["draft", "captured"],
          },
          supersedesId: {
            type: "string",
            format: "uuid",
          },
          assetKind: {
            enum: ["photo", "receipt_scan", "document_scan"],
          },
          byteSize: {
            type: "integer",
            minimum: 1,
          },
          mediaType: {
            enum: ["image/jpeg", "image/png", "application/pdf"],
          },
          contentSha256: {
            type: "string",
            pattern: "^[a-f0-9]{64}$",
          },
          capturedAt: {
            type: "string",
            pattern:
              "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
          },
          purpose: {
            enum: [
              "orientation",
              "measurement_context",
              "posted_information",
              "transaction_receipt",
              "consent_record",
            ],
          },
          objectiveIds: {
            type: "array",
            items: {
              type: "string",
              pattern: "^objective_[a-z0-9_]+$",
            },
            minItems: 1,
            uniqueItems: true,
          },
          recordIds: {
            type: "array",
            items: {
              type: "string",
              format: "uuid",
            },
            uniqueItems: true,
          },
          permittedLocation: {
            enum: ["withheld", "governed_area", "route_corridor", "approximate_100m"],
          },
          peoplePresent: {
            enum: ["none", "researcher_only", "consenting_people", "bystanders_present"],
          },
          rights: {
            enum: ["research_internal", "licensed_internal", "public_use_granted"],
          },
          consentState: {
            enum: ["not_required", "denied", "granted", "withdrawn"],
          },
          redactionState: {
            enum: ["not_required", "pending", "complete", "blocked"],
          },
          retentionState: {
            enum: ["active", "pending_deletion", "deleted"],
          },
          redactedDerivativeId: {
            type: "string",
            format: "uuid",
          },
          sourceAssetId: {
            type: "string",
            format: "uuid",
          },
        },
      },
      captureException: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "https://asksiargao.com/schemas/capture-exception.v1.json",
        title: "CaptureException",
        type: "object",
        additionalProperties: false,
        required: [
          "schemaVersion",
          "id",
          "protocolPackageId",
          "protocolPackageVersion",
          "campaignId",
          "assignmentId",
          "objectiveId",
          "researcherId",
          "deviceId",
          "recordedAt",
          "localTimezone",
          "captureState",
          "reason",
          "reasonDetails",
          "context",
        ],
        properties: {
          schemaVersion: {
            const: "capture-exception.v1",
          },
          id: {
            type: "string",
            format: "uuid",
          },
          protocolPackageId: {
            type: "string",
            pattern: "^field-protocol-[a-z0-9-]+$",
          },
          protocolPackageVersion: {
            type: "string",
            pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
          },
          campaignId: {
            type: "string",
            pattern: "^campaign_[a-z0-9_]+$",
          },
          assignmentId: {
            type: "string",
            pattern: "^assignment_[a-z0-9_]+$",
          },
          objectiveId: {
            type: "string",
            pattern: "^objective_[a-z0-9_]+$",
          },
          visitId: {
            type: "string",
            format: "uuid",
          },
          researcherId: {
            type: "string",
            minLength: 1,
          },
          deviceId: {
            type: "string",
            minLength: 1,
          },
          recordedAt: {
            type: "string",
            pattern:
              "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
          },
          localTimezone: {
            const: "Asia/Manila",
          },
          captureState: {
            enum: ["draft", "captured"],
          },
          reason: {
            enum: [
              "access_denied",
              "unsafe_conditions",
              "permission_declined",
              "subject_unavailable",
              "equipment_failure",
              "eligibility_changed",
              "interrupted",
              "not_applicable",
            ],
          },
          reasonDetails: {
            type: "string",
            minLength: 1,
          },
          context: {
            enum: ["planning", "visit"],
          },
        },
      },
      schemaGap: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "https://asksiargao.com/schemas/schema-gap.v1.json",
        title: "SchemaGap",
        type: "object",
        additionalProperties: false,
        required: [
          "schemaVersion",
          "id",
          "protocolPackageId",
          "protocolPackageVersion",
          "campaignId",
          "assignmentId",
          "objectiveId",
          "researcherId",
          "deviceId",
          "recordedAt",
          "localTimezone",
          "captureState",
          "subject",
          "attemptedAt",
          "permittedLocation",
          "description",
          "resolutionState",
        ],
        properties: {
          schemaVersion: {
            const: "schema-gap.v1",
          },
          id: {
            type: "string",
            format: "uuid",
          },
          protocolPackageId: {
            type: "string",
            pattern: "^field-protocol-[a-z0-9-]+$",
          },
          protocolPackageVersion: {
            type: "string",
            pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
          },
          campaignId: {
            type: "string",
            pattern: "^campaign_[a-z0-9_]+$",
          },
          assignmentId: {
            type: "string",
            pattern: "^assignment_[a-z0-9_]+$",
          },
          objectiveId: {
            type: "string",
            pattern: "^objective_[a-z0-9_]+$",
          },
          visitId: {
            type: "string",
            format: "uuid",
          },
          researcherId: {
            type: "string",
            minLength: 1,
          },
          deviceId: {
            type: "string",
            minLength: 1,
          },
          recordedAt: {
            type: "string",
            pattern:
              "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
          },
          localTimezone: {
            const: "Asia/Manila",
          },
          captureState: {
            enum: ["draft", "captured"],
          },
          subject: {
            oneOf: [
              {
                type: "object",
                additionalProperties: false,
                required: ["kind", "subjectId"],
                properties: {
                  kind: {
                    const: "governed",
                  },
                  subjectId: {
                    type: "string",
                    pattern: "^subject_[a-z0-9_]+$",
                  },
                },
              },
              {
                type: "object",
                additionalProperties: false,
                required: ["kind", "provisionalSubjectId"],
                properties: {
                  kind: {
                    const: "provisional",
                  },
                  provisionalSubjectId: {
                    type: "string",
                    format: "uuid",
                  },
                },
              },
            ],
          },
          attemptedAt: {
            type: "string",
            pattern:
              "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
          },
          permittedLocation: {
            enum: ["withheld", "governed_area", "route_corridor", "approximate_100m"],
          },
          description: {
            type: "string",
            minLength: 1,
            maxLength: 1000,
          },
          assetId: {
            type: "string",
            format: "uuid",
          },
          resolutionState: {
            const: "blocked_pending_protocol",
          },
        },
      },
      fieldReview: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "https://asksiargao.com/schemas/field-review.v1.json",
        title: "FieldReview",
        type: "object",
        additionalProperties: false,
        required: [
          "schemaVersion",
          "id",
          "protocolPackageId",
          "protocolPackageVersion",
          "recordId",
          "reviewerId",
          "researcherId",
          "reviewerMatchesResearcher",
          "reviewedAt",
          "decision",
        ],
        properties: {
          schemaVersion: {
            const: "field-review.v1",
          },
          id: {
            type: "string",
            format: "uuid",
          },
          protocolPackageId: {
            type: "string",
            pattern: "^field-protocol-[a-z0-9-]+$",
          },
          protocolPackageVersion: {
            type: "string",
            pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
          },
          recordId: {
            type: "string",
            format: "uuid",
          },
          reviewerId: {
            type: "string",
            minLength: 1,
          },
          researcherId: {
            type: "string",
            minLength: 1,
          },
          reviewerMatchesResearcher: {
            type: "boolean",
          },
          reviewedAt: {
            type: "string",
            pattern:
              "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
          },
          decision: {
            enum: ["include", "exclude", "needs_more_evidence", "correct_by_supersession"],
          },
          reason: {
            type: "string",
            minLength: 1,
          },
          supersedingRecordId: {
            type: "string",
            format: "uuid",
          },
        },
      },
      fieldRecoveryExport: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "https://asksiargao.com/schemas/field-recovery-export.v1.json",
        title: "FieldRecoveryExport",
        type: "object",
        additionalProperties: false,
        required: [
          "schemaVersion",
          "filename",
          "createdAt",
          "encryption",
          "ciphertextBytes",
          "ciphertextSha256",
          "keyId",
          "restoreInstructionsVersion",
        ],
        properties: {
          schemaVersion: {
            const: "field-recovery-export.v1",
          },
          filename: {
            type: "string",
            pattern: "^ask-siargao-field-recovery-[a-f0-9]{12}\\.asfrecovery$",
          },
          createdAt: {
            type: "string",
            pattern:
              "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
          },
          encryption: {
            const: "xchacha20-poly1305",
          },
          ciphertextBytes: {
            type: "integer",
            minimum: 1,
          },
          ciphertextSha256: {
            type: "string",
            pattern: "^[a-f0-9]{64}$",
          },
          keyId: {
            type: "string",
            minLength: 1,
          },
          restoreInstructionsVersion: {
            const: "1.0.0",
          },
        },
      },
      fieldBatch: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "https://asksiargao.com/schemas/field-batch.v2.json",
        title: "FieldBatch",
        type: "object",
        additionalProperties: false,
        required: [
          "schemaVersion",
          "filename",
          "batchId",
          "protocolPackages",
          "createdAt",
          "recordIds",
          "reviewIds",
          "assetReferences",
          "referentialClosureSha256",
          "payloadSha256",
          "encryption",
        ],
        properties: {
          schemaVersion: {
            const: "field-batch.v2",
          },
          filename: {
            type: "string",
            pattern: "^ask-siargao-field-batch-[a-f0-9]{12}\\.asfbatch$",
          },
          batchId: {
            type: "string",
            format: "uuid",
          },
          protocolPackages: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["packageId", "version"],
              properties: {
                packageId: {
                  type: "string",
                  pattern: "^field-protocol-[a-z0-9-]+$",
                },
                version: {
                  type: "string",
                  pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
                },
              },
            },
            minItems: 1,
            uniqueItems: true,
          },
          createdAt: {
            type: "string",
            pattern:
              "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
          },
          recordIds: {
            type: "array",
            items: {
              type: "string",
              format: "uuid",
            },
            minItems: 1,
            uniqueItems: true,
          },
          reviewIds: {
            type: "array",
            items: {
              type: "string",
              format: "uuid",
            },
            minItems: 1,
            uniqueItems: true,
          },
          assetReferences: {
            type: "array",
            items: {
              type: "string",
              format: "uuid",
            },
            uniqueItems: true,
          },
          referentialClosureSha256: {
            type: "string",
            pattern: "^[a-f0-9]{64}$",
          },
          payloadSha256: {
            type: "string",
            pattern: "^[a-f0-9]{64}$",
          },
          encryption: {
            enum: ["none_no_protected_data", "xchacha20-poly1305"],
          },
        },
      },
    },
  },
  subjects: {
    schemaVersion: "governed-subject-registry.v1",
    componentVersion: "1.0.0",
    provisionalSubjectRules: {
      allowedCategories: ["place", "service", "route", "organisation"],
      requiredFields: ["displayedName", "category", "governedAreaId", "distinguishingDetails"],
      resolutionRequiredBeforeBatch: true,
    },
    subjects: [
      {
        id: "subject_area_del_carmen",
        kind: "area",
        name: "Del Carmen",
        governedAreaId: "area_del_carmen",
      },
      {
        id: "subject_area_general_luna",
        kind: "area",
        name: "General Luna and Catangnan",
        governedAreaId: "area_general_luna",
      },
      {
        id: "subject_sayak_airport",
        kind: "point",
        name: "Sayak Airport",
        governedAreaId: "area_del_carmen",
      },
      {
        id: "subject_area_dapa",
        kind: "area",
        name: "Dapa",
        governedAreaId: "area_dapa",
      },
      {
        id: "subject_route_airport_del_carmen",
        kind: "route",
        name: "Sayak Airport to Del Carmen",
        governedAreaId: "area_del_carmen",
      },
      {
        id: "subject_route_del_carmen_general_luna",
        kind: "route",
        name: "Del Carmen to General Luna",
        governedAreaId: "area_central_corridor",
      },
      {
        id: "subject_route_del_carmen_dapa",
        kind: "route",
        name: "Del Carmen to Dapa",
        governedAreaId: "area_central_corridor",
      },
      {
        id: "subject_route_south_central",
        kind: "route",
        name: "South and central corridor",
        governedAreaId: "area_south_central",
      },
      {
        id: "subject_route_northbound",
        kind: "route",
        name: "Northbound services and access",
        governedAreaId: "area_north",
      },
      {
        id: "subject_route_santa_monica_alegria",
        kind: "route",
        name: "Santa Monica and Alegria route",
        governedAreaId: "area_north",
      },
      {
        id: "subject_area_pilar",
        kind: "area",
        name: "Pilar",
        governedAreaId: "area_pilar",
      },
      {
        id: "subject_del_carmen_departure_points",
        kind: "area",
        name: "Del Carmen governed departure points",
        governedAreaId: "area_del_carmen",
      },
    ],
  },
} as const;
export const trustedFieldProtocolSignersData = {
  schemaVersion: "field-protocol-trusted-signers.v1",
  signers: [
    {
      keyId: "ask-siargao-field-protocol-2026-01",
      algorithm: "Ed25519",
      publicKeySpkiBase64: "MCowBQYDK2VwAyEAMs3+5zTuOC5NacZj6NS1Wlu6dI1etPNFhsxhLXfcqJo=",
      status: "trusted",
    },
  ],
} as const;
