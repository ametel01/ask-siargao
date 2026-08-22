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
    planningRules: {
      selectionOrder: [
        "eligibility_window_rarity",
        "travel_compatibility",
        "outstanding_required_coverage",
        "editorial_priority",
        "oldest_admissible_evidence",
        "time_fit",
        "assignment_id",
      ],
      eligibilityWindowKinds: [
        {
          kind: "access_state",
          rarityRank: 2,
          maximumAgeMinutes: 720,
          hardGate: true,
        },
        {
          kind: "arrival_window",
          rarityRank: 1,
          maximumAgeMinutes: 180,
          hardGate: true,
        },
        {
          kind: "changed_conditions",
          rarityRank: 1,
          maximumAgeMinutes: 180,
          hardGate: true,
        },
        {
          kind: "daypart",
          rarityRank: 3,
          maximumAgeMinutes: 720,
          hardGate: true,
        },
        {
          kind: "operating_state",
          rarityRank: 2,
          maximumAgeMinutes: 180,
          hardGate: true,
        },
        {
          kind: "provider_state",
          rarityRank: 1,
          maximumAgeMinutes: 180,
          hardGate: true,
        },
        {
          kind: "safe_marine_state",
          rarityRank: 1,
          maximumAgeMinutes: 180,
          hardGate: true,
        },
        {
          kind: "safe_route_state",
          rarityRank: 1,
          maximumAgeMinutes: 180,
          hardGate: true,
        },
        {
          kind: "safety_state",
          rarityRank: 2,
          maximumAgeMinutes: 180,
          hardGate: true,
        },
        {
          kind: "source_coverage",
          rarityRank: 1,
          maximumAgeMinutes: 10080,
          hardGate: true,
        },
        {
          kind: "tide_context",
          rarityRank: 1,
          maximumAgeMinutes: 180,
          hardGate: true,
        },
        {
          kind: "transport_state",
          rarityRank: 2,
          maximumAgeMinutes: 180,
          hardGate: true,
        },
        {
          kind: "transport_window",
          rarityRank: 1,
          maximumAgeMinutes: 180,
          hardGate: true,
        },
        {
          kind: "weekday_class",
          rarityRank: 3,
          maximumAgeMinutes: 1440,
          hardGate: true,
        },
      ],
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
          anchorAreaId: "area_del_carmen",
          privateLocation: true,
        },
        estimatedMinutes: 150,
        editorialPriority: 2,
        evidenceFreshnessReviewMinutes: 10080,
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
            observationKinds: ["power"],
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
            id: "objective_home_observe_practical_essentials",
            action: "observe",
            observationKinds: ["facility"],
            facilityTypes: ["drinking_water", "waste_disposal", "food"],
            coverage: {
              required: true,
              minimumRecords: 3,
              supportingAsset: "optional",
              repetition: {
                minimumDistinctWindows: 1,
              },
            },
          },
          {
            id: "objective_home_measure_environment",
            action: "measure",
            observationKinds: ["noise_snapshot", "connectivity"],
            coverage: {
              required: true,
              minimumRecords: 2,
              supportingAsset: "not_required",
              repetition: {
                minimumDistinctWindows: 2,
              },
            },
          },
          {
            id: "objective_home_attempt_offline_readiness",
            action: "attempt",
            observationKinds: ["connectivity", "power"],
            workflowRequirements: ["offline_field_readiness"],
            coverage: {
              required: true,
              minimumRecords: 2,
              supportingAsset: "not_required",
              repetition: {
                minimumDistinctWindows: 1,
              },
            },
          },
        ],
        coverageRequirements: [
          {
            id: "coverage_offline_readiness",
            labelKey: "offline_readiness",
            objectiveId: "objective_home_attempt_offline_readiness",
            minimumRecords: 1,
            required: true,
            supportingAsset: "not_required",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["connectivity", "power"],
          },
          {
            id: "coverage_water",
            labelKey: "water",
            objectiveId: "objective_home_observe_practical_essentials",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["facility"],
          },
          {
            id: "coverage_power",
            labelKey: "power",
            objectiveId: "objective_home_observe_utilities",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["power"],
          },
          {
            id: "coverage_waste",
            labelKey: "waste",
            objectiveId: "objective_home_observe_practical_essentials",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["facility"],
          },
          {
            id: "coverage_noise",
            labelKey: "noise",
            objectiveId: "objective_home_measure_environment",
            minimumRecords: 1,
            required: true,
            supportingAsset: "not_required",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["noise_snapshot"],
          },
          {
            id: "coverage_connectivity",
            labelKey: "connectivity",
            objectiveId: "objective_home_measure_environment",
            minimumRecords: 1,
            required: true,
            supportingAsset: "not_required",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["connectivity"],
          },
          {
            id: "coverage_nearby_essentials",
            labelKey: "nearby_essentials",
            objectiveId: "objective_home_observe_practical_essentials",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["facility"],
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
          anchorAreaId: "area_del_carmen",
          privateLocation: false,
        },
        estimatedMinutes: 210,
        editorialPriority: 1,
        evidenceFreshnessReviewMinutes: 10080,
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
            observationKinds: [
              "identity",
              "local_caveat",
              "facility",
              "payment_method",
              "price",
              "accessibility",
              "road_condition",
              "service_status",
              "connectivity",
              "opening_signal",
            ],
            coverage: {
              required: true,
              minimumRecords: 4,
              supportingAsset: "required_for_posted_information",
              repetition: {
                minimumDistinctWindows: 1,
              },
            },
            recordKinds: ["evidence-asset.v1"],
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
            observationKinds: ["facility"],
          },
        ],
        coverageRequirements: [
          {
            id: "coverage_identity",
            labelKey: "identity",
            objectiveId: "objective_del_carmen_observe_services",
            minimumRecords: 1,
            required: true,
            supportingAsset: "required_for_posted_information",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["identity"],
          },
          {
            id: "coverage_wayfinding",
            labelKey: "wayfinding",
            objectiveId: "objective_del_carmen_observe_services",
            minimumRecords: 1,
            required: true,
            supportingAsset: "required_for_posted_information",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1", "evidence-asset.v1"],
            admissibleObservationKinds: ["identity", "local_caveat"],
          },
          {
            id: "coverage_cash",
            labelKey: "cash",
            objectiveId: "objective_del_carmen_observe_services",
            minimumRecords: 1,
            required: true,
            supportingAsset: "required_for_posted_information",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["facility", "payment_method"],
          },
          {
            id: "coverage_payment",
            labelKey: "payment",
            objectiveId: "objective_del_carmen_observe_services",
            minimumRecords: 1,
            required: true,
            supportingAsset: "required_for_posted_information",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1", "evidence-asset.v1"],
            admissibleObservationKinds: ["payment_method", "price"],
          },
          {
            id: "coverage_pharmacy_clinic_leads",
            labelKey: "pharmacy_clinic_leads",
            objectiveId: "objective_del_carmen_ask_service_leads",
            minimumRecords: 1,
            required: true,
            supportingAsset: "not_required",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1", "source-statement.v1"],
            admissibleObservationKinds: ["facility"],
          },
          {
            id: "coverage_fuel",
            labelKey: "fuel",
            objectiveId: "objective_del_carmen_observe_services",
            minimumRecords: 1,
            required: true,
            supportingAsset: "required_for_posted_information",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["facility"],
          },
          {
            id: "coverage_food",
            labelKey: "food",
            objectiveId: "objective_del_carmen_observe_services",
            minimumRecords: 1,
            required: true,
            supportingAsset: "required_for_posted_information",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["facility"],
          },
          {
            id: "coverage_toilets",
            labelKey: "toilets",
            objectiveId: "objective_del_carmen_observe_services",
            minimumRecords: 1,
            required: true,
            supportingAsset: "required_for_posted_information",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["facility"],
          },
          {
            id: "coverage_shade",
            labelKey: "shade",
            objectiveId: "objective_del_carmen_observe_services",
            minimumRecords: 1,
            required: true,
            supportingAsset: "required_for_posted_information",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["facility"],
          },
          {
            id: "coverage_access",
            labelKey: "access",
            objectiveId: "objective_del_carmen_observe_services",
            minimumRecords: 1,
            required: true,
            supportingAsset: "required_for_posted_information",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["accessibility", "road_condition", "service_status"],
          },
          {
            id: "coverage_connectivity",
            labelKey: "connectivity",
            objectiveId: "objective_del_carmen_observe_services",
            minimumRecords: 1,
            required: true,
            supportingAsset: "required_for_posted_information",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["connectivity"],
          },
          {
            id: "coverage_opening",
            labelKey: "opening",
            objectiveId: "objective_del_carmen_observe_services",
            minimumRecords: 1,
            required: true,
            supportingAsset: "required_for_posted_information",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["opening_signal"],
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
          anchorAreaId: "area_del_carmen",
          originSubjectId: "subject_sayak_airport",
          destinationSubjectId: "subject_area_del_carmen",
        },
        estimatedMinutes: 180,
        editorialPriority: 1,
        evidenceFreshnessReviewMinutes: 43200,
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
            observationKinds: ["route_duration"],
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
            observationKinds: ["identity", "local_caveat"],
          },
          {
            id: "objective_airport_observe_arrival_conditions",
            action: "observe",
            observationKinds: [
              "route_wait",
              "price",
              "accessibility",
              "road_condition",
              "service_status",
              "connectivity",
              "payment_method",
            ],
            coverage: {
              required: true,
              minimumRecords: 5,
              supportingAsset: "required_for_posted_information",
              repetition: {
                minimumDistinctWindows: 1,
              },
            },
            recordKinds: ["route-run.v1"],
          },
        ],
        coverageRequirements: [
          {
            id: "coverage_pickup",
            labelKey: "pickup",
            objectiveId: "objective_airport_traverse_arrival",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1", "route-run.v1"],
            admissibleObservationKinds: ["route_duration"],
          },
          {
            id: "coverage_signage",
            labelKey: "signage",
            objectiveId: "objective_airport_document_signage",
            minimumRecords: 1,
            required: true,
            supportingAsset: "required",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1", "evidence-asset.v1"],
            admissibleObservationKinds: ["identity", "local_caveat"],
          },
          {
            id: "coverage_wait",
            labelKey: "wait",
            objectiveId: "objective_airport_observe_arrival_conditions",
            minimumRecords: 1,
            required: true,
            supportingAsset: "required_for_posted_information",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1", "route-run.v1"],
            admissibleObservationKinds: ["route_wait"],
          },
          {
            id: "coverage_luggage",
            labelKey: "luggage",
            objectiveId: "objective_airport_traverse_arrival",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1", "route-run.v1"],
            admissibleObservationKinds: ["route_duration"],
          },
          {
            id: "coverage_fare_basis",
            labelKey: "fare_basis",
            objectiveId: "objective_airport_observe_arrival_conditions",
            minimumRecords: 1,
            required: true,
            supportingAsset: "required_for_posted_information",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["price", "payment_method"],
          },
          {
            id: "coverage_route_time",
            labelKey: "route_time",
            objectiveId: "objective_airport_traverse_arrival",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1", "route-run.v1"],
            admissibleObservationKinds: ["route_duration"],
          },
          {
            id: "coverage_access",
            labelKey: "access",
            objectiveId: "objective_airport_observe_arrival_conditions",
            minimumRecords: 1,
            required: true,
            supportingAsset: "required_for_posted_information",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["accessibility", "road_condition", "service_status"],
          },
          {
            id: "coverage_signal",
            labelKey: "signal",
            objectiveId: "objective_airport_observe_arrival_conditions",
            minimumRecords: 1,
            required: true,
            supportingAsset: "required_for_posted_information",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["connectivity"],
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
          anchorAreaId: "area_general_luna",
          privateLocation: false,
        },
        estimatedMinutes: 240,
        editorialPriority: 1,
        evidenceFreshnessReviewMinutes: 10080,
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
            observationKinds: [
              "route_duration",
              "accessibility",
              "facility",
              "identity",
              "local_caveat",
              "price",
              "road_condition",
              "service_status",
            ],
            coverage: {
              required: true,
              minimumRecords: 3,
              supportingAsset: "optional",
              repetition: {
                minimumDistinctWindows: 2,
              },
            },
            recordKinds: ["route-run.v1", "evidence-asset.v1"],
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
        coverageRequirements: [
          {
            id: "coverage_arrival",
            labelKey: "arrival",
            objectiveId: "objective_general_luna_attempt_arrival",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1", "route-run.v1"],
            admissibleObservationKinds: ["route_duration"],
          },
          {
            id: "coverage_parking_dropoff",
            labelKey: "parking_dropoff",
            objectiveId: "objective_general_luna_attempt_arrival",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1", "route-run.v1"],
            admissibleObservationKinds: ["accessibility", "facility"],
          },
          {
            id: "coverage_wayfinding",
            labelKey: "wayfinding",
            objectiveId: "objective_general_luna_attempt_arrival",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1", "evidence-asset.v1"],
            admissibleObservationKinds: ["identity", "local_caveat"],
          },
          {
            id: "coverage_price_payment",
            labelKey: "price_payment",
            objectiveId: "objective_general_luna_attempt_arrival",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["price"],
          },
          {
            id: "coverage_facilities",
            labelKey: "facilities",
            objectiveId: "objective_general_luna_attempt_arrival",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["facility"],
          },
          {
            id: "coverage_access_barriers",
            labelKey: "access_barriers",
            objectiveId: "objective_general_luna_attempt_arrival",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["accessibility", "road_condition", "service_status"],
          },
          {
            id: "coverage_crowd",
            labelKey: "crowd",
            objectiveId: "objective_general_luna_repeat_crowd",
            minimumRecords: 2,
            required: true,
            supportingAsset: "not_required",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["crowd_snapshot"],
          },
          {
            id: "coverage_connectivity",
            labelKey: "connectivity",
            objectiveId: "objective_general_luna_repeat_crowd",
            minimumRecords: 2,
            required: true,
            supportingAsset: "not_required",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["connectivity"],
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
          anchorAreaId: "area_del_carmen",
          areaIds: ["area_del_carmen", "area_general_luna"],
        },
        estimatedMinutes: 180,
        editorialPriority: 1,
        evidenceFreshnessReviewMinutes: 10080,
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
            observationKinds: ["connectivity", "power", "noise_snapshot", "facility"],
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
        coverageRequirements: [
          {
            id: "coverage_three_test_measurement_sets",
            labelKey: "three_test_measurement_sets",
            objectiveId: "objective_connectivity_measure_sets",
            minimumRecords: 3,
            required: true,
            supportingAsset: "not_required",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["connectivity"],
          },
          {
            id: "coverage_device_network_method",
            labelKey: "device_network_method",
            objectiveId: "objective_connectivity_measure_sets",
            minimumRecords: 1,
            required: true,
            supportingAsset: "not_required",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["connectivity"],
          },
          {
            id: "coverage_power",
            labelKey: "power",
            objectiveId: "objective_connectivity_measure_sets",
            minimumRecords: 1,
            required: true,
            supportingAsset: "not_required",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["power"],
          },
          {
            id: "coverage_socket_permission",
            labelKey: "socket_permission",
            objectiveId: "objective_connectivity_measure_sets",
            minimumRecords: 1,
            required: true,
            supportingAsset: "not_required",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["power"],
          },
          {
            id: "coverage_noise",
            labelKey: "noise",
            objectiveId: "objective_connectivity_measure_sets",
            minimumRecords: 1,
            required: true,
            supportingAsset: "not_required",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["noise_snapshot"],
          },
          {
            id: "coverage_seating",
            labelKey: "seating",
            objectiveId: "objective_connectivity_measure_sets",
            minimumRecords: 1,
            required: true,
            supportingAsset: "not_required",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["facility"],
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
          anchorAreaId: "area_central_corridor",
          areaIds: ["area_dapa", "area_central_corridor"],
        },
        estimatedMinutes: 300,
        editorialPriority: 1,
        evidenceFreshnessReviewMinutes: 10080,
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
            observationKinds: ["route_duration"],
          },
          {
            id: "objective_dapa_observe_services",
            action: "observe",
            observationKinds: [
              "identity",
              "local_caveat",
              "payment_method",
              "price",
              "facility",
              "accessibility",
              "road_condition",
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
            recordKinds: ["evidence-asset.v1", "source-statement.v1"],
          },
        ],
        coverageRequirements: [
          {
            id: "coverage_port_journey",
            labelKey: "port_journey",
            objectiveId: "objective_dapa_traverse_port",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1", "route-run.v1"],
            admissibleObservationKinds: ["route_duration"],
          },
          {
            id: "coverage_luggage",
            labelKey: "luggage",
            objectiveId: "objective_dapa_traverse_port",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1", "route-run.v1"],
            admissibleObservationKinds: ["route_duration"],
          },
          {
            id: "coverage_signs",
            labelKey: "signs",
            objectiveId: "objective_dapa_observe_services",
            minimumRecords: 1,
            required: true,
            supportingAsset: "required_for_posted_information",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1", "evidence-asset.v1"],
            admissibleObservationKinds: ["identity", "local_caveat"],
          },
          {
            id: "coverage_transport_transaction",
            labelKey: "transport_transaction",
            objectiveId: "objective_dapa_observe_services",
            minimumRecords: 1,
            required: true,
            supportingAsset: "required_for_posted_information",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["payment_method", "price"],
          },
          {
            id: "coverage_cash",
            labelKey: "cash",
            objectiveId: "objective_dapa_observe_services",
            minimumRecords: 1,
            required: true,
            supportingAsset: "required_for_posted_information",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["facility", "payment_method"],
          },
          {
            id: "coverage_market",
            labelKey: "market",
            objectiveId: "objective_dapa_observe_services",
            minimumRecords: 1,
            required: true,
            supportingAsset: "required_for_posted_information",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["facility"],
          },
          {
            id: "coverage_health_leads",
            labelKey: "health_leads",
            objectiveId: "objective_dapa_observe_services",
            minimumRecords: 1,
            required: true,
            supportingAsset: "required_for_posted_information",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1", "source-statement.v1"],
            admissibleObservationKinds: ["facility"],
          },
          {
            id: "coverage_fuel",
            labelKey: "fuel",
            objectiveId: "objective_dapa_observe_services",
            minimumRecords: 1,
            required: true,
            supportingAsset: "required_for_posted_information",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["facility"],
          },
          {
            id: "coverage_toilets",
            labelKey: "toilets",
            objectiveId: "objective_dapa_observe_services",
            minimumRecords: 1,
            required: true,
            supportingAsset: "required_for_posted_information",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["facility"],
          },
          {
            id: "coverage_shade",
            labelKey: "shade",
            objectiveId: "objective_dapa_observe_services",
            minimumRecords: 1,
            required: true,
            supportingAsset: "required_for_posted_information",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["facility"],
          },
          {
            id: "coverage_access",
            labelKey: "access",
            objectiveId: "objective_dapa_observe_services",
            minimumRecords: 1,
            required: true,
            supportingAsset: "required_for_posted_information",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["accessibility", "road_condition", "service_status"],
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
          anchorAreaId: "area_south_central",
          areaIds: ["area_south_central"],
        },
        estimatedMinutes: 360,
        editorialPriority: 2,
        evidenceFreshnessReviewMinutes: 10080,
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
            recordKinds: ["route-run.v1", "evidence-asset.v1"],
            observationKinds: [
              "road_condition",
              "route_duration",
              "accessibility",
              "service_status",
              "price",
              "facility",
              "connectivity",
              "identity",
              "local_caveat",
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
        coverageRequirements: [
          {
            id: "coverage_route_segments",
            labelKey: "route_segments",
            objectiveId: "objective_south_traverse_twice",
            minimumRecords: 2,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1", "route-run.v1"],
            admissibleObservationKinds: ["road_condition", "route_duration"],
          },
          {
            id: "coverage_surface",
            labelKey: "surface",
            objectiveId: "objective_south_traverse_twice",
            minimumRecords: 2,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1", "route-run.v1"],
            admissibleObservationKinds: ["road_condition", "route_duration"],
          },
          {
            id: "coverage_stops",
            labelKey: "stops",
            objectiveId: "objective_south_traverse_twice",
            minimumRecords: 2,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1", "route-run.v1"],
            admissibleObservationKinds: ["route_duration"],
          },
          {
            id: "coverage_access",
            labelKey: "access",
            objectiveId: "objective_south_traverse_twice",
            minimumRecords: 2,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["accessibility", "road_condition", "service_status"],
          },
          {
            id: "coverage_price",
            labelKey: "price",
            objectiveId: "objective_south_traverse_twice",
            minimumRecords: 2,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["price"],
          },
          {
            id: "coverage_facilities",
            labelKey: "facilities",
            objectiveId: "objective_south_traverse_twice",
            minimumRecords: 2,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["facility"],
          },
          {
            id: "coverage_signal",
            labelKey: "signal",
            objectiveId: "objective_south_traverse_twice",
            minimumRecords: 2,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["connectivity"],
          },
          {
            id: "coverage_map_discrepancies",
            labelKey: "map_discrepancies",
            objectiveId: "objective_south_traverse_twice",
            minimumRecords: 2,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1", "evidence-asset.v1"],
            admissibleObservationKinds: ["identity", "local_caveat"],
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
          anchorAreaId: "area_north",
          areaIds: ["area_north"],
        },
        estimatedMinutes: 420,
        editorialPriority: 2,
        evidenceFreshnessReviewMinutes: 10080,
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
              "facility",
              "payment_method",
              "accessibility",
              "service_status",
              "contact_channel",
              "local_caveat",
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
            recordKinds: ["route-run.v1", "source-statement.v1"],
          },
        ],
        coverageRequirements: [
          {
            id: "coverage_route_time",
            labelKey: "route_time",
            objectiveId: "objective_north_observe_services",
            minimumRecords: 2,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1", "route-run.v1"],
            admissibleObservationKinds: ["route_duration"],
          },
          {
            id: "coverage_road",
            labelKey: "road",
            objectiveId: "objective_north_observe_services",
            minimumRecords: 2,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1", "route-run.v1"],
            admissibleObservationKinds: ["road_condition", "route_duration"],
          },
          {
            id: "coverage_food",
            labelKey: "food",
            objectiveId: "objective_north_observe_services",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["facility"],
          },
          {
            id: "coverage_fuel",
            labelKey: "fuel",
            objectiveId: "objective_north_observe_services",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["facility"],
          },
          {
            id: "coverage_cash",
            labelKey: "cash",
            objectiveId: "objective_north_observe_services",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["facility", "payment_method"],
          },
          {
            id: "coverage_health_leads",
            labelKey: "health_leads",
            objectiveId: "objective_north_observe_services",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1", "source-statement.v1"],
            admissibleObservationKinds: ["facility"],
          },
          {
            id: "coverage_beach_access",
            labelKey: "beach_access",
            objectiveId: "objective_north_observe_services",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["accessibility", "road_condition", "service_status"],
          },
          {
            id: "coverage_service",
            labelKey: "service",
            objectiveId: "objective_north_observe_services",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1", "source-statement.v1"],
            admissibleObservationKinds: ["service_status", "contact_channel", "local_caveat"],
          },
          {
            id: "coverage_remote_work_checks",
            labelKey: "remote_work_checks",
            objectiveId: "objective_north_observe_services",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["connectivity"],
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
          anchorAreaId: "area_north",
          originSubjectId: "subject_route_northbound",
          destinationSubjectId: "subject_route_santa_monica_alegria",
        },
        estimatedMinutes: 360,
        editorialPriority: 2,
        evidenceFreshnessReviewMinutes: 10080,
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
            recordKinds: ["route-run.v1", "source-statement.v1"],
            coverage: {
              required: true,
              minimumRecords: 1,
              supportingAsset: "optional",
              repetition: {
                minimumDistinctWindows: 1,
              },
            },
            observationKinds: [
              "route_duration",
              "service_status",
              "contact_channel",
              "local_caveat",
            ],
          },
          {
            id: "objective_north_route_repeat_gap",
            action: "repeat",
            observationKinds: [
              "service_status",
              "contact_channel",
              "local_caveat",
              "facility",
              "payment_method",
              "connectivity",
            ],
            coverage: {
              required: true,
              minimumRecords: 1,
              supportingAsset: "not_required",
              repetition: {
                minimumDistinctWindows: 2,
              },
            },
            recordKinds: ["source-statement.v1"],
          },
        ],
        coverageRequirements: [
          {
            id: "coverage_full_route",
            labelKey: "full_route",
            objectiveId: "objective_north_route_traverse",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1", "route-run.v1"],
            admissibleObservationKinds: ["route_duration"],
          },
          {
            id: "coverage_return_constraints",
            labelKey: "return_constraints",
            objectiveId: "objective_north_route_traverse",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1", "source-statement.v1"],
            admissibleObservationKinds: ["service_status", "contact_channel", "local_caveat"],
          },
          {
            id: "coverage_transport_availability",
            labelKey: "transport_availability",
            objectiveId: "objective_north_route_repeat_gap",
            minimumRecords: 1,
            required: true,
            supportingAsset: "not_required",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1", "source-statement.v1"],
            admissibleObservationKinds: ["service_status", "contact_channel", "local_caveat"],
          },
          {
            id: "coverage_facilities",
            labelKey: "facilities",
            objectiveId: "objective_north_route_repeat_gap",
            minimumRecords: 1,
            required: true,
            supportingAsset: "not_required",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["facility"],
          },
          {
            id: "coverage_cash",
            labelKey: "cash",
            objectiveId: "objective_north_route_repeat_gap",
            minimumRecords: 1,
            required: true,
            supportingAsset: "not_required",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["facility", "payment_method"],
          },
          {
            id: "coverage_fuel",
            labelKey: "fuel",
            objectiveId: "objective_north_route_repeat_gap",
            minimumRecords: 1,
            required: true,
            supportingAsset: "not_required",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["facility"],
          },
          {
            id: "coverage_signal",
            labelKey: "signal",
            objectiveId: "objective_north_route_repeat_gap",
            minimumRecords: 1,
            required: true,
            supportingAsset: "not_required",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["connectivity"],
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
          anchorAreaId: "area_pilar",
          subjectId: "subject_area_pilar",
        },
        estimatedMinutes: 300,
        editorialPriority: 2,
        evidenceFreshnessReviewMinutes: 720,
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
              "route_duration",
              "accessibility",
              "road_condition",
              "service_status",
              "price",
              "facility",
            ],
            coverage: {
              required: true,
              minimumRecords: 6,
              supportingAsset: "optional",
              repetition: {
                minimumDistinctWindows: 1,
              },
            },
            recordKinds: ["route-run.v1"],
          },
        ],
        coverageRequirements: [
          {
            id: "coverage_tide_context",
            labelKey: "tide_context",
            objectiveId: "objective_pilar_observe_conditions",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["tide_context"],
          },
          {
            id: "coverage_route",
            labelKey: "route",
            objectiveId: "objective_pilar_observe_conditions",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1", "route-run.v1"],
            admissibleObservationKinds: ["route_duration"],
          },
          {
            id: "coverage_entrance",
            labelKey: "entrance",
            objectiveId: "objective_pilar_observe_conditions",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["accessibility", "road_condition", "service_status"],
          },
          {
            id: "coverage_paid_amount",
            labelKey: "paid_amount",
            objectiveId: "objective_pilar_observe_conditions",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["price"],
          },
          {
            id: "coverage_facilities",
            labelKey: "facilities",
            objectiveId: "objective_pilar_observe_conditions",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["facility"],
          },
          {
            id: "coverage_surface",
            labelKey: "surface",
            objectiveId: "objective_pilar_observe_conditions",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1", "route-run.v1"],
            admissibleObservationKinds: ["road_condition", "route_duration"],
          },
          {
            id: "coverage_access_state",
            labelKey: "access_state",
            objectiveId: "objective_pilar_observe_conditions",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["accessibility", "road_condition", "service_status"],
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
          anchorAreaId: "area_del_carmen",
          subjectId: "subject_del_carmen_departure_points",
        },
        estimatedMinutes: 360,
        editorialPriority: 2,
        evidenceFreshnessReviewMinutes: 720,
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
              "service_status",
              "contact_channel",
              "local_caveat",
              "route_wait",
              "price",
              "facility",
            ],
            coverage: {
              required: true,
              minimumRecords: 5,
              supportingAsset: "optional",
              repetition: {
                minimumDistinctWindows: 1,
              },
            },
            recordKinds: ["source-statement.v1", "route-run.v1"],
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
            observationKinds: ["route_duration"],
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
            observationKinds: ["service_status", "contact_channel", "local_caveat"],
          },
        ],
        coverageRequirements: [
          {
            id: "coverage_booking",
            labelKey: "booking",
            objectiveId: "objective_boat_attempt_booking",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1", "source-statement.v1"],
            admissibleObservationKinds: ["service_status", "contact_channel", "local_caveat"],
          },
          {
            id: "coverage_check_in",
            labelKey: "check_in",
            objectiveId: "objective_boat_attempt_booking",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1", "source-statement.v1"],
            admissibleObservationKinds: ["service_status", "contact_channel", "local_caveat"],
          },
          {
            id: "coverage_wait",
            labelKey: "wait",
            objectiveId: "objective_boat_attempt_booking",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1", "route-run.v1"],
            admissibleObservationKinds: ["route_wait"],
          },
          {
            id: "coverage_price",
            labelKey: "price",
            objectiveId: "objective_boat_attempt_booking",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["price"],
          },
          {
            id: "coverage_boarding",
            labelKey: "boarding",
            objectiveId: "objective_boat_traverse_journey",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1", "route-run.v1"],
            admissibleObservationKinds: ["route_duration"],
          },
          {
            id: "coverage_transfers",
            labelKey: "transfers",
            objectiveId: "objective_boat_traverse_journey",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1", "route-run.v1"],
            admissibleObservationKinds: ["route_duration"],
          },
          {
            id: "coverage_facilities",
            labelKey: "facilities",
            objectiveId: "objective_boat_attempt_booking",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["facility"],
          },
          {
            id: "coverage_operating_policy_statement",
            labelKey: "operating_policy_statement",
            objectiveId: "objective_boat_ask_policy",
            minimumRecords: 1,
            required: true,
            supportingAsset: "not_required",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1", "source-statement.v1"],
            admissibleObservationKinds: ["service_status", "contact_channel", "local_caveat"],
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
          anchorAreaId: "area_del_carmen",
          areaIds: ["area_del_carmen", "area_dapa", "area_general_luna"],
        },
        estimatedMinutes: 300,
        editorialPriority: 1,
        evidenceFreshnessReviewMinutes: 10080,
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
            observationKinds: [
              "service_status",
              "contact_channel",
              "local_caveat",
              "price",
              "accessibility",
              "road_condition",
              "facility",
            ],
            coverage: {
              required: true,
              minimumRecords: 4,
              supportingAsset: "optional",
              repetition: {
                minimumDistinctWindows: 1,
              },
            },
            recordKinds: ["source-statement.v1"],
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
            observationKinds: ["route_duration", "accessibility", "facility"],
          },
        ],
        coverageRequirements: [
          {
            id: "coverage_booking_burden",
            labelKey: "booking_burden",
            objectiveId: "objective_accessibility_attempt_journey",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1", "source-statement.v1"],
            admissibleObservationKinds: ["service_status", "contact_channel", "local_caveat"],
          },
          {
            id: "coverage_pickup",
            labelKey: "pickup",
            objectiveId: "objective_accessibility_traverse_journey",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1", "route-run.v1"],
            admissibleObservationKinds: ["route_duration"],
          },
          {
            id: "coverage_fare",
            labelKey: "fare",
            objectiveId: "objective_accessibility_attempt_journey",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["price"],
          },
          {
            id: "coverage_transfers",
            labelKey: "transfers",
            objectiveId: "objective_accessibility_traverse_journey",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1", "route-run.v1"],
            admissibleObservationKinds: ["route_duration"],
          },
          {
            id: "coverage_surfaces",
            labelKey: "surfaces",
            objectiveId: "objective_accessibility_attempt_journey",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["accessibility", "road_condition", "service_status"],
          },
          {
            id: "coverage_steps",
            labelKey: "steps",
            objectiveId: "objective_accessibility_attempt_journey",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["accessibility", "road_condition", "service_status"],
          },
          {
            id: "coverage_toilets",
            labelKey: "toilets",
            objectiveId: "objective_accessibility_attempt_journey",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["facility"],
          },
          {
            id: "coverage_shelter",
            labelKey: "shelter",
            objectiveId: "objective_accessibility_attempt_journey",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["facility"],
          },
          {
            id: "coverage_luggage_barriers",
            labelKey: "luggage_barriers",
            objectiveId: "objective_accessibility_traverse_journey",
            minimumRecords: 1,
            required: true,
            supportingAsset: "optional",
            repetition: {
              minimumDistinctWindows: 1,
            },
            admissibleRecordKinds: ["field-observation.v1", "route-run.v1"],
            admissibleObservationKinds: ["accessibility", "facility"],
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
          anchorResolution: "coverage_snapshot_required",
          selectionRule: "nearest_travel_compatible_unresolved_subject",
        },
        estimatedMinutes: 180,
        editorialPriority: 1,
        evidenceFreshnessReviewMinutes: 10080,
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
              "route_wait",
              "road_condition",
              "facility",
              "accessibility",
              "payment_method",
              "power",
              "crowd_snapshot",
              "noise_snapshot",
              "weather_condition",
              "tide_context",
              "menu_item",
              "service_status",
              "contact_channel",
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
            recordKinds: ["route-run.v1"],
          },
        ],
        coverageRequirements: [
          {
            id: "coverage_volatile_price",
            labelKey: "volatile_price",
            objectiveId: "objective_follow_up_repeat_evidence",
            minimumRecords: 2,
            required: true,
            supportingAsset: "depends_on_original_requirement",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["price"],
          },
          {
            id: "coverage_route",
            labelKey: "route",
            objectiveId: "objective_follow_up_repeat_evidence",
            minimumRecords: 2,
            required: true,
            supportingAsset: "depends_on_original_requirement",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1", "route-run.v1"],
            admissibleObservationKinds: ["route_duration"],
          },
          {
            id: "coverage_opening",
            labelKey: "opening",
            objectiveId: "objective_follow_up_repeat_evidence",
            minimumRecords: 2,
            required: true,
            supportingAsset: "depends_on_original_requirement",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["opening_signal"],
          },
          {
            id: "coverage_connectivity",
            labelKey: "connectivity",
            objectiveId: "objective_follow_up_repeat_evidence",
            minimumRecords: 2,
            required: true,
            supportingAsset: "depends_on_original_requirement",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["connectivity"],
          },
          {
            id: "coverage_provisional_identity",
            labelKey: "provisional_identity",
            objectiveId: "objective_follow_up_repeat_evidence",
            minimumRecords: 2,
            required: true,
            supportingAsset: "depends_on_original_requirement",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: ["identity"],
          },
          {
            id: "coverage_contradiction",
            labelKey: "contradiction",
            objectiveId: "objective_follow_up_repeat_evidence",
            minimumRecords: 2,
            required: true,
            supportingAsset: "depends_on_original_requirement",
            repetition: {
              minimumDistinctWindows: 2,
            },
            admissibleRecordKinds: ["field-observation.v1"],
            admissibleObservationKinds: [
              "identity",
              "opening_signal",
              "price",
              "route_duration",
              "route_wait",
              "road_condition",
              "facility",
              "accessibility",
              "payment_method",
              "connectivity",
              "power",
              "crowd_snapshot",
              "noise_snapshot",
              "weather_condition",
              "tide_context",
              "menu_item",
              "service_status",
              "contact_channel",
              "local_caveat",
            ],
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
          "sourceSchemaVersions",
          "targetProtocolPackageId",
          "targetCampaignId",
          "kindMappings",
          "subjectMappings",
          "legacyObservationRoutes",
          "methodMappings",
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
          sourceSchemaVersions: {
            type: "array",
            items: {
              type: "string",
              minLength: 1,
            },
            minItems: 1,
            uniqueItems: true,
          },
          targetProtocolPackageId: {
            type: "string",
            pattern: "^field-protocol-[a-z0-9-]+$",
          },
          targetCampaignId: {
            type: "string",
            pattern: "^campaign_[a-z0-9_]+$",
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
          legacyObservationRoutes: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "subjectId",
                "observationKind",
                "assignmentId",
                "objectiveId",
                "coverageRequirementId",
              ],
              properties: {
                subjectId: {
                  type: "string",
                  pattern: "^subject_[a-z0-9_]+$",
                },
                observationKind: {
                  type: "string",
                  minLength: 1,
                },
                assignmentId: {
                  type: "string",
                  pattern: "^assignment_[a-z0-9_]+$",
                },
                objectiveId: {
                  type: "string",
                  pattern: "^objective_[a-z0-9_]+$",
                },
                coverageRequirementId: {
                  type: "string",
                  pattern: "^coverage_[a-z0-9_]+$",
                },
              },
            },
            uniqueItems: true,
          },
          methodMappings: {
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
                  pattern: "^method_[a-z0-9_]+@[0-9]+\\.[0-9]+\\.[0-9]+$",
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
      fieldPlanningInputs: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "https://asksiargao.com/schemas/field-planning-inputs.v1.json",
        title: "FieldPlanningInputs",
        type: "object",
        additionalProperties: false,
        required: [
          "schemaVersion",
          "protocolPackageId",
          "protocolPackageVersion",
          "coverageSnapshotId",
          "coverageSnapshotVersion",
          "planningAt",
          "startingAreaId",
          "transportMode",
          "availableMinutes",
          "reserveMinutes",
          "assignmentGates",
          "eligibilityEvidence",
        ],
        properties: {
          schemaVersion: {
            const: "field-planning-inputs.v1",
          },
          protocolPackageId: {
            type: "string",
            pattern: "^field-protocol-[a-z0-9-]+$",
          },
          protocolPackageVersion: {
            type: "string",
            pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
          },
          coverageSnapshotId: {
            type: "string",
            minLength: 1,
          },
          coverageSnapshotVersion: {
            type: "string",
            minLength: 1,
          },
          planningAt: {
            type: "string",
            format: "date-time",
          },
          startingAreaId: {
            type: "string",
            pattern: "^area_[a-z0-9_]+$",
          },
          transportMode: {
            type: "string",
            minLength: 1,
          },
          availableMinutes: {
            type: "integer",
            minimum: 0,
          },
          reserveMinutes: {
            type: "object",
            additionalProperties: false,
            required: ["safety", "documentation", "rest", "daylight"],
            properties: {
              safety: {
                type: "integer",
                minimum: 0,
              },
              documentation: {
                type: "integer",
                minimum: 0,
              },
              rest: {
                type: "integer",
                minimum: 0,
              },
              daylight: {
                type: "integer",
                minimum: 0,
              },
            },
          },
          preciseLocation: {
            type: "object",
            additionalProperties: false,
            required: ["label", "permission"],
            properties: {
              label: {
                type: "string",
                minLength: 1,
              },
              permission: {
                const: "granted",
              },
            },
          },
          assignmentGates: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "id",
                "assignmentId",
                "safety",
                "permission",
                "access",
                "sourceId",
                "retrievedAt",
                "validUntil",
                "fingerprint",
              ],
              properties: {
                id: {
                  type: "string",
                  minLength: 1,
                },
                assignmentId: {
                  type: "string",
                  pattern: "^assignment_[a-z0-9_]+$",
                },
                safety: {
                  enum: ["allowed", "blocked", "unknown"],
                },
                permission: {
                  enum: ["allowed", "blocked", "unknown"],
                },
                access: {
                  enum: ["allowed", "blocked", "unknown"],
                },
                sourceId: {
                  type: "string",
                  minLength: 1,
                },
                retrievedAt: {
                  type: "string",
                  format: "date-time",
                },
                validUntil: {
                  type: "string",
                  format: "date-time",
                },
                fingerprint: {
                  type: "string",
                  minLength: 1,
                },
              },
            },
          },
          eligibilityEvidence: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "id",
                "assignmentId",
                "kind",
                "value",
                "state",
                "sourceId",
                "retrievedAt",
                "validUntil",
                "fingerprint",
              ],
              properties: {
                id: {
                  type: "string",
                  minLength: 1,
                },
                assignmentId: {
                  type: "string",
                  pattern: "^assignment_[a-z0-9_]+$",
                },
                kind: {
                  type: "string",
                  minLength: 1,
                },
                value: {
                  type: "string",
                  minLength: 1,
                },
                state: {
                  enum: ["allowed", "blocked", "unknown"],
                },
                sourceId: {
                  type: "string",
                  minLength: 1,
                },
                retrievedAt: {
                  type: "string",
                  format: "date-time",
                },
                validUntil: {
                  type: "string",
                  format: "date-time",
                },
                fingerprint: {
                  type: "string",
                  minLength: 1,
                },
              },
            },
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
        coverageRequirementId: "coverage_payment",
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
        objectiveId: "objective_airport_traverse_arrival",
        coverageRequirementId: "coverage_route_time",
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
        coverageRequirementId: "coverage_pharmacy_clinic_leads",
        researcherId: "researcher_example",
        deviceId: "device_example",
        recordedAt: "2026-08-22T09:15:00+08:00",
        localTimezone: "Asia/Manila",
        captureState: "captured",
        subjectId: "subject_area_del_carmen",
        sourceRole: "staff",
        basisOfKnowledge: "direct_responsibility",
        questionAsked: "Where is the nearest operating clinic or pharmacy?",
        originalLanguage: "en",
        statementForm: "labelled_paraphrase",
        originalStatement:
          "The clinic is beside the municipal hall; the pharmacy is across the road.",
        attribution: "role_only",
        captureContext: "Asked at the service counter before any transaction.",
        consents: {
          participation: {
            decision: "granted",
            method: "verbal",
            recordedAt: "2026-08-22T09:14:00+08:00",
          },
          llmUse: {
            decision: "denied",
            method: "verbal",
            recordedAt: "2026-08-22T09:14:00+08:00",
          },
          articleUse: {
            decision: "denied",
            method: "verbal",
            recordedAt: "2026-08-22T09:14:00+08:00",
          },
          quotationUse: {
            decision: "denied",
            method: "verbal",
            recordedAt: "2026-08-22T09:14:00+08:00",
          },
          publicUse: {
            decision: "denied",
            method: "verbal",
            recordedAt: "2026-08-22T09:14:00+08:00",
          },
        },
        withdrawalRoute: "Contact the Ask Siargao research owner.",
        translationIds: ["0192f060-4f41-7aa1-b322-4aa9fc9f1510"],
        assetIds: [],
      },
      statementTranslation: {
        schemaVersion: "statement-translation.v1",
        id: "0192f060-4f41-7aa1-b322-4aa9fc9f1510",
        protocolPackageId: "field-protocol-siargao-baseline",
        protocolPackageVersion: "1.0.0",
        sourceStatementId: "0192f060-4f41-7aa1-b322-4aa9fc9f1504",
        originalLanguage: "en",
        targetLanguage: "fil",
        translatedText: "Katabi ng munisipyo ang klinika; nasa tapat ng kalsada ang botika.",
        translator: {
          kind: "human",
          identityOrMethod: "researcher_example",
        },
        recordedAt: "2026-08-22T09:16:00+08:00",
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
        coverageRequirementIds: ["coverage_payment"],
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
        coverageRequirementId: "coverage_access_state",
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
        coverageRequirementId: "coverage_access",
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
          },
        ],
        createdAt: "2026-08-23T11:00:00+08:00",
        recordCounts: {
          fieldVisit: 1,
          fieldObservation: 1,
          routeRun: 0,
          sourceStatement: 1,
          statementTranslation: 1,
          evidenceAsset: 1,
          captureException: 0,
          schemaGap: 0,
          fieldReview: 1,
        },
        files: [
          {
            recordType: "fieldVisit",
            filename: "field-visits.jsonl",
            byteSize: 1024,
            sha256: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            recordCount: 1,
          },
          {
            recordType: "fieldObservation",
            filename: "field-observations.jsonl",
            byteSize: 2048,
            sha256: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            recordCount: 1,
          },
          {
            recordType: "sourceStatement",
            filename: "source-statements.jsonl",
            byteSize: 1024,
            sha256: "1111111111111111111111111111111111111111111111111111111111111111",
            recordCount: 1,
          },
          {
            recordType: "statementTranslation",
            filename: "statement-translations.jsonl",
            byteSize: 512,
            sha256: "2222222222222222222222222222222222222222222222222222222222222222",
            recordCount: 1,
          },
          {
            recordType: "evidenceAsset",
            filename: "evidence-assets.jsonl",
            byteSize: 1024,
            sha256: "3333333333333333333333333333333333333333333333333333333333333333",
            recordCount: 1,
          },
          {
            recordType: "fieldReview",
            filename: "field-reviews.jsonl",
            byteSize: 512,
            sha256: "4444444444444444444444444444444444444444444444444444444444444444",
            recordCount: 1,
          },
        ],
        reviewerSummary: {
          reviewerIds: ["reviewer_example"],
          includesSelfReview: false,
          independentReviewCount: 1,
        },
        lineage: {
          campaignIds: ["campaign_island_baseline"],
          assignmentIds: ["assignment_del_carmen_essentials"],
          visitIds: ["0192f060-4f41-7aa1-b322-4aa9fc9f1501"],
          researcherIds: ["researcher_example"],
          supersessionRecordIds: [],
          conflictRecordIds: [],
          reviewIds: ["0192f060-4f41-7aa1-b322-4aa9fc9f1508"],
        },
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
    routes: [
      {
        id: "route_airport_del_carmen",
        subjectId: "subject_route_airport_del_carmen",
        originSubjectId: "subject_sayak_airport",
        destinationSubjectId: "subject_area_del_carmen",
        areaIds: ["area_del_carmen"],
      },
      {
        id: "route_santa_monica_alegria",
        subjectId: "subject_route_santa_monica_alegria",
        originSubjectId: "subject_route_northbound",
        destinationSubjectId: "subject_route_santa_monica_alegria",
        areaIds: ["area_north"],
      },
    ],
    edges: [
      {
        from: "area_del_carmen",
        to: "area_central_corridor",
        modes: ["motorbike", "tricycle", "car", "van"],
        durationBandMinutes: [25, 50],
        direction: "bidirectional",
        transferBoundary: false,
      },
      {
        from: "area_central_corridor",
        to: "area_general_luna",
        modes: ["motorbike", "tricycle", "car", "van"],
        durationBandMinutes: [30, 60],
        direction: "bidirectional",
        transferBoundary: false,
      },
      {
        from: "area_central_corridor",
        to: "area_dapa",
        modes: ["motorbike", "tricycle", "car", "van"],
        durationBandMinutes: [20, 45],
        direction: "bidirectional",
        transferBoundary: false,
      },
      {
        from: "area_general_luna",
        to: "area_south_central",
        modes: ["motorbike", "tricycle", "car"],
        durationBandMinutes: [20, 55],
        direction: "bidirectional",
        transferBoundary: false,
      },
      {
        from: "area_del_carmen",
        to: "area_north",
        modes: ["motorbike", "tricycle", "car", "van"],
        durationBandMinutes: [45, 105],
        direction: "bidirectional",
        transferBoundary: false,
      },
      {
        from: "area_central_corridor",
        to: "area_pilar",
        modes: ["motorbike", "tricycle", "car"],
        durationBandMinutes: [30, 75],
        direction: "bidirectional",
        transferBoundary: false,
      },
      {
        from: "area_del_carmen",
        to: "area_del_carmen",
        modes: ["boat"],
        durationBandMinutes: [15, 180],
        direction: "bidirectional",
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
    sourceSchemaVersions: ["field-record.v1"],
    targetProtocolPackageId: "field-protocol-siargao-baseline",
    targetCampaignId: "campaign_island_baseline",
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
    legacyObservationRoutes: [
      {
        subjectId: "subject_area_del_carmen",
        observationKind: "opening_signal",
        assignmentId: "assignment_del_carmen_essentials",
        objectiveId: "objective_del_carmen_observe_services",
        coverageRequirementId: "coverage_opening",
      },
      {
        subjectId: "subject_area_del_carmen",
        observationKind: "connectivity",
        assignmentId: "assignment_del_carmen_essentials",
        objectiveId: "objective_del_carmen_observe_services",
        coverageRequirementId: "coverage_connectivity",
      },
      {
        subjectId: "subject_area_general_luna",
        observationKind: "connectivity",
        assignmentId: "assignment_general_luna_journey",
        objectiveId: "objective_general_luna_repeat_crowd",
        coverageRequirementId: "coverage_connectivity",
      },
    ],
    methodMappings: [
      {
        from: "structured_visual_check",
        to: "method_structured_visual_check@1.0.0",
      },
      {
        from: "network_test",
        to: "method_network_three_test@1.0.0",
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
                "drinking_water",
                "waste_disposal",
                "food",
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
          "coverageRequirementId",
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
          coverageRequirementId: {
            type: "string",
            pattern: "^coverage_[a-z0-9_]+$",
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
                type: "boolean",
                default: false,
              },
              articleUse: {
                type: "boolean",
                default: false,
              },
              quotationUse: {
                type: "boolean",
                default: false,
              },
              publicUse: {
                type: "boolean",
                default: false,
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
          "objectiveId",
          "coverageRequirementId",
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
          objectiveId: {
            type: "string",
            pattern: "^objective_[a-z0-9_]+$",
          },
          coverageRequirementId: {
            type: "string",
            pattern: "^coverage_[a-z0-9_]+$",
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
          "coverageRequirementId",
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
          coverageRequirementId: {
            type: "string",
            pattern: "^coverage_[a-z0-9_]+$",
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
                $ref: "#/$defs/consentDecision",
              },
              llmUse: {
                $ref: "#/$defs/consentDecision",
              },
              articleUse: {
                $ref: "#/$defs/consentDecision",
              },
              quotationUse: {
                $ref: "#/$defs/consentDecision",
              },
              publicUse: {
                $ref: "#/$defs/consentDecision",
              },
            },
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
        $defs: {
          consentDecision: {
            type: "object",
            additionalProperties: false,
            required: ["decision", "method", "recordedAt"],
            properties: {
              decision: {
                enum: ["granted", "denied", "withdrawn"],
              },
              method: {
                enum: ["verbal", "written", "recorded_form"],
              },
              recordedAt: {
                type: "string",
                pattern:
                  "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
              },
            },
          },
        },
      },
      statementTranslation: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "https://asksiargao.com/schemas/statement-translation.v1.json",
        title: "StatementTranslation",
        type: "object",
        additionalProperties: false,
        required: [
          "schemaVersion",
          "id",
          "protocolPackageId",
          "protocolPackageVersion",
          "sourceStatementId",
          "originalLanguage",
          "targetLanguage",
          "translatedText",
          "translator",
          "recordedAt",
        ],
        properties: {
          schemaVersion: {
            const: "statement-translation.v1",
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
          sourceStatementId: {
            type: "string",
            format: "uuid",
          },
          originalLanguage: {
            type: "string",
            pattern: "^[a-z]{2,3}(-[A-Z]{2})?$",
          },
          targetLanguage: {
            type: "string",
            pattern: "^[a-z]{2,3}(-[A-Z]{2})?$",
          },
          translatedText: {
            type: "string",
            minLength: 1,
          },
          translator: {
            type: "object",
            additionalProperties: false,
            required: ["kind", "identityOrMethod"],
            properties: {
              kind: {
                enum: ["human", "machine"],
              },
              identityOrMethod: {
                type: "string",
                minLength: 1,
              },
            },
          },
          recordedAt: {
            type: "string",
            pattern:
              "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
          },
          supersedesId: {
            type: "string",
            format: "uuid",
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
          "coverageRequirementIds",
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
          coverageRequirementIds: {
            type: "array",
            items: {
              type: "string",
              pattern: "^coverage_[a-z0-9_]+$",
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
          "coverageRequirementId",
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
          coverageRequirementId: {
            type: "string",
            pattern: "^coverage_[a-z0-9_]+$",
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
          "coverageRequirementId",
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
          coverageRequirementId: {
            type: "string",
            pattern: "^coverage_[a-z0-9_]+$",
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
          "recordCounts",
          "files",
          "reviewerSummary",
          "lineage",
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
              required: ["packageId", "version", "componentVersions"],
              properties: {
                packageId: {
                  type: "string",
                  pattern: "^field-protocol-[a-z0-9-]+$",
                },
                version: {
                  type: "string",
                  pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
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
                      pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
                    },
                    distributionSchemas: {
                      type: "string",
                      pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
                    },
                    observationKinds: {
                      type: "string",
                      pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
                    },
                    methodProfiles: {
                      type: "string",
                      pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
                    },
                    subjects: {
                      type: "string",
                      pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
                    },
                    geography: {
                      type: "string",
                      pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
                    },
                    campaign: {
                      type: "string",
                      pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
                    },
                    help: {
                      type: "string",
                      pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
                    },
                    migration: {
                      type: "string",
                      pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
                    },
                    examples: {
                      type: "string",
                      pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$",
                    },
                  },
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
          recordCounts: {
            type: "object",
            additionalProperties: false,
            required: [
              "fieldVisit",
              "fieldObservation",
              "routeRun",
              "sourceStatement",
              "statementTranslation",
              "evidenceAsset",
              "captureException",
              "schemaGap",
              "fieldReview",
            ],
            properties: {
              fieldVisit: {
                type: "integer",
                minimum: 0,
              },
              fieldObservation: {
                type: "integer",
                minimum: 0,
              },
              routeRun: {
                type: "integer",
                minimum: 0,
              },
              sourceStatement: {
                type: "integer",
                minimum: 0,
              },
              statementTranslation: {
                type: "integer",
                minimum: 0,
              },
              evidenceAsset: {
                type: "integer",
                minimum: 0,
              },
              captureException: {
                type: "integer",
                minimum: 0,
              },
              schemaGap: {
                type: "integer",
                minimum: 0,
              },
              fieldReview: {
                type: "integer",
                minimum: 0,
              },
            },
          },
          files: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["recordType", "filename", "byteSize", "sha256", "recordCount"],
              properties: {
                recordType: {
                  enum: [
                    "fieldVisit",
                    "fieldObservation",
                    "routeRun",
                    "sourceStatement",
                    "statementTranslation",
                    "evidenceAsset",
                    "captureException",
                    "schemaGap",
                    "fieldReview",
                  ],
                },
                filename: {
                  type: "string",
                  pattern: "^[a-z][a-z0-9-]*\\.jsonl$",
                },
                byteSize: {
                  type: "integer",
                  minimum: 1,
                },
                sha256: {
                  type: "string",
                  pattern: "^[a-f0-9]{64}$",
                },
                recordCount: {
                  type: "integer",
                  minimum: 1,
                },
              },
            },
            minItems: 1,
            uniqueItems: true,
          },
          reviewerSummary: {
            type: "object",
            additionalProperties: false,
            required: ["reviewerIds", "includesSelfReview", "independentReviewCount"],
            properties: {
              reviewerIds: {
                type: "array",
                items: {
                  type: "string",
                  minLength: 1,
                },
                minItems: 1,
                uniqueItems: true,
              },
              includesSelfReview: {
                type: "boolean",
              },
              independentReviewCount: {
                type: "integer",
                minimum: 0,
              },
            },
          },
          lineage: {
            type: "object",
            additionalProperties: false,
            required: [
              "campaignIds",
              "assignmentIds",
              "visitIds",
              "researcherIds",
              "supersessionRecordIds",
              "conflictRecordIds",
              "reviewIds",
            ],
            properties: {
              campaignIds: {
                type: "array",
                items: {
                  type: "string",
                  pattern: "^campaign_[a-z0-9_]+$",
                },
                minItems: 1,
                uniqueItems: true,
              },
              assignmentIds: {
                type: "array",
                items: {
                  type: "string",
                  pattern: "^assignment_[a-z0-9_]+$",
                },
                minItems: 1,
                uniqueItems: true,
              },
              visitIds: {
                type: "array",
                items: {
                  type: "string",
                  format: "uuid",
                },
                minItems: 1,
                uniqueItems: true,
              },
              researcherIds: {
                type: "array",
                items: {
                  type: "string",
                  minLength: 1,
                },
                minItems: 1,
                uniqueItems: true,
              },
              supersessionRecordIds: {
                type: "array",
                items: {
                  type: "string",
                  format: "uuid",
                },
                uniqueItems: true,
              },
              conflictRecordIds: {
                type: "array",
                items: {
                  type: "string",
                  format: "uuid",
                },
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
            },
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
  manifest: {
    schemaVersion: "field-protocol-package-manifest.v1",
    packageId: "field-protocol-siargao-baseline",
    packageVersion: "1.0.0",
    createdAt: "2026-08-22T00:00:00.000Z",
    signerKeyId: "ask-siargao-field-protocol-2026-02",
    componentVersions: {
      campaign: "1.0.0",
      distributionSchemas: "1.0.0",
      examples: "1.0.0",
      geography: "1.0.0",
      help: "1.0.0",
      methodProfiles: "1.0.0",
      migration: "1.0.0",
      observationKinds: "1.0.0",
      schemas: "1.0.0",
      subjects: "1.0.0",
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
        sha256: "c534586923e9454d3866f8d0055fa6fe19c59c2745af2fe8c230ad92b34ba0bf",
      },
      {
        path: "canonical/v1/distribution-schemas.v1.json",
        sha256: "8b9bc6ee1dbba025ec01cd49c0aaf745a8f6ebd9cb42e2e5a92fa1806207e8f7",
      },
      {
        path: "canonical/v1/examples.v1.json",
        sha256: "a8be0c3d6aec9b12dc268bee0bd5496eaaf297ee5b336b64509941f70232db97",
      },
      {
        path: "canonical/v1/geography.v1.json",
        sha256: "f088e04fd68dd85c6af6dba60348f39971f4afe9898c54dd6fb592a6cff46352",
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
        sha256: "754e9d551edf346d4caeaa7dd027bf097c007afc18fdc5af67fe3591defaf18f",
      },
      {
        path: "canonical/v1/observation-kinds.v1.json",
        sha256: "23790ca38729ebb0666aa078091065ff4ef0ada9339b6f64320284aad2e88e1f",
      },
      {
        path: "canonical/v1/schemas.v1.json",
        sha256: "e178c4fd5c673cce7e202d2d252bbb889b1c556a7856c99f9f1a29116048a31d",
      },
      {
        path: "canonical/v1/subjects.v1.json",
        sha256: "0e907f8f2ab1c1066be81d9d972025a1fa5ca30b88d797f31fa6200588b4cd60",
      },
    ],
    signature: {
      algorithm: "Ed25519",
      value:
        "TrCfArM8UaTAZurHqu13dpjDdXZ9yX3ai1wJAT53lNne2d+C/6TPngSydkUD8vsmqhyEqTQyp0BCG3Fh12K5Cw==",
    },
  },
} as const;
export const trustedFieldProtocolSignersData = {
  schemaVersion: "field-protocol-trusted-signers.v1",
  signers: [
    {
      keyId: "ask-siargao-field-protocol-2026-01",
      algorithm: "Ed25519",
      publicKeySpkiBase64: "MCowBQYDK2VwAyEAHz50PLHM25xqjJvMus5IfgdveJKGCsQbRCQp7s5d1IA=",
      status: "trusted",
    },
    {
      keyId: "ask-siargao-field-protocol-2026-02",
      algorithm: "Ed25519",
      publicKeySpkiBase64: "MCowBQYDK2VwAyEAMnIejrkV/CCZHZpQiXE+ZW5x/l1dRspg+oHU1+W1lcg=",
      status: "trusted",
    },
  ],
} as const;
