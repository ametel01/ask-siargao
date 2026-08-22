// Generated from field-protocol/canonical/v1/observation-kinds.v1.json. Do not edit by hand.

export interface IdentityObservationValue {
  displayedName: string;
  officialName?: string;
  aliases: string[];
  category: "place" | "service" | "route" | "organisation";
  resolutionEvidence: "displayed_sign" | "receipt" | "source_statement" | "official_directory";
}

export interface OpeningSignalObservationValue {
  state: "open" | "closed" | "unknown";
  basis: "observed" | "posted" | "attempted";
  postedHoursSeparatelyEvidenced: boolean;
}

export interface PriceObservationValue {
  amount: string;
  currency: "PHP";
  item: string;
  pricingUnit: "item" | "person" | "party" | "journey" | "hour" | "day";
  partySize: number;
  inclusions: string[];
  basis: "posted" | "quoted" | "paid";
  taxesAndFees: "included" | "excluded" | "unknown";
  negotiated: boolean;
  paymentMethodAttempted?: "cash" | "card" | "gcash" | "maya" | "bank_transfer";
  receiptAssetId?: string;
}

export interface RouteDurationObservationValue {
  originSubjectId: string;
  destinationSubjectId: string;
  transportMode: "walk" | "bicycle" | "motorbike" | "tricycle" | "car" | "van" | "boat";
  durationSeconds: number;
}

export interface RouteWaitObservationValue {
  waitSeconds: number;
  transportMode: "tricycle" | "car" | "van" | "boat";
  queueState: "none" | "short" | "moderate" | "long";
}

export interface RoadConditionObservationValue {
  segmentId: string;
  surface: "paved" | "gravel" | "sand" | "mud" | "mixed";
  obstruction: "none" | "minor" | "partial" | "blocked" | "unknown";
  weatherContext: "dry" | "recent_rain" | "active_rain" | "unknown";
}

export interface FacilityObservationValue {
  facilityType:
    | "toilet"
    | "shower"
    | "shade"
    | "seating"
    | "parking"
    | "cash_machine"
    | "clinic"
    | "pharmacy"
    | "fuel";
  state: "present" | "absent" | "available" | "unavailable" | "inaccessible" | "unknown";
  accessConditions: string;
}

export interface AccessibilityObservationValue {
  feature:
    | "step"
    | "ramp"
    | "door_width"
    | "path_surface"
    | "toilet_access"
    | "transfer_barrier"
    | "shelter";
  state: "present" | "absent" | "usable" | "not_usable" | "not_tested" | "unknown";
  measurementBasis: "measured" | "observed" | "attempted";
  measuredValue?: number;
  unit?: "cm" | "degree";
}

export interface PaymentMethodObservationValue {
  method: "cash" | "card" | "gcash" | "maya" | "bank_transfer";
  outcome: "offered" | "accepted" | "rejected" | "not_offered" | "not_tested" | "unknown";
  transactionContext: string;
}

export interface ConnectivityObservationValue {
  network: string;
  deviceClass: "phone" | "tablet" | "laptop" | "dedicated_meter";
  zone: "indoors" | "outdoors" | "threshold" | "roadside";
  /**
   * @minItems 3
   */
  measurements: [
    {
      metric: "download" | "upload" | "latency";
      value: number;
      unit: "Mbps" | "ms";
    },
    {
      metric: "download" | "upload" | "latency";
      value: number;
      unit: "Mbps" | "ms";
    },
    {
      metric: "download" | "upload" | "latency";
      value: number;
      unit: "Mbps" | "ms";
    },
    ...{
      metric: "download" | "upload" | "latency";
      value: number;
      unit: "Mbps" | "ms";
    }[],
  ];
}

export interface PowerObservationValue {
  state: "available" | "unavailable" | "outage" | "unknown";
  socketPermission: "granted" | "denied" | "not_requested" | "not_applicable";
  basis: "direct_observation" | "attempted" | "source_stated";
  backupPowerStatementId?: string;
}

export interface CrowdSnapshotObservationValue {
  boundary: string;
  method: "counted" | "estimated_band";
  count?: number;
  band: "empty" | "quiet" | "moderate" | "busy" | "very_busy";
}

export interface NoiseSnapshotObservationValue {
  method: "measured_dba" | "subjective_band";
  dba?: number;
  band: "quiet" | "moderate" | "loud" | "very_loud";
  measurementPosition: string;
}

export interface WeatherConditionObservationValue {
  condition:
    | "clear"
    | "cloudy"
    | "light_rain"
    | "heavy_rain"
    | "thunderstorm"
    | "strong_wind"
    | "unknown";
  observationBasis: "direct" | "authoritative_source";
  authoritativeSourceId?: string;
}

export interface TideContextObservationValue {
  shorelineState: "low" | "rising" | "mid" | "falling" | "high" | "unknown";
  sourceId: string;
  sourceRetrievedAt: string;
}

export interface MenuItemObservationValue {
  itemName: string;
  amount: string;
  currency: "PHP";
  availability: "available" | "unavailable" | "unknown";
  dietaryDisclosureBasis: "menu_label" | "staff_statement" | "not_disclosed";
}

export interface ServiceStatusObservationValue {
  state: "operating" | "not_operating" | "limited" | "unknown";
  basis: "observed" | "attempted" | "posted" | "source_stated";
  limitations?: string;
}

export interface ContactChannelObservationValue {
  channelType: "phone" | "email" | "website" | "facebook" | "instagram";
  publicValue: string;
  verificationMethod: "displayed" | "called" | "messaged" | "official_directory";
  permission: "publicly_displayed" | "explicitly_granted" | "internal_only";
}

export interface LocalCaveatObservationValue {
  warning: string;
  /**
   * @minItems 1
   */
  appliesWhen: [
    (
      | "weather_change"
      | "tide_change"
      | "after_dark"
      | "crowd_peak"
      | "service_disruption"
      | "access_restriction"
    ),
    ...(
      | "weather_change"
      | "tide_change"
      | "after_dark"
      | "crowd_peak"
      | "service_disruption"
      | "access_restriction"
    )[],
  ];
  directness: "direct_observation" | "source_stated" | "derived";
  corroborationCount: number;
}

export interface ObservationValueByKind {
  identity: IdentityObservationValue;
  opening_signal: OpeningSignalObservationValue;
  price: PriceObservationValue;
  route_duration: RouteDurationObservationValue;
  route_wait: RouteWaitObservationValue;
  road_condition: RoadConditionObservationValue;
  facility: FacilityObservationValue;
  accessibility: AccessibilityObservationValue;
  payment_method: PaymentMethodObservationValue;
  connectivity: ConnectivityObservationValue;
  power: PowerObservationValue;
  crowd_snapshot: CrowdSnapshotObservationValue;
  noise_snapshot: NoiseSnapshotObservationValue;
  weather_condition: WeatherConditionObservationValue;
  tide_context: TideContextObservationValue;
  menu_item: MenuItemObservationValue;
  service_status: ServiceStatusObservationValue;
  contact_channel: ContactChannelObservationValue;
  local_caveat: LocalCaveatObservationValue;
}

export type ObservationKind = keyof ObservationValueByKind;
