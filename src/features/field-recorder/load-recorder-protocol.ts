import { baselineFieldProtocolPackage } from "@/features/field-protocol/field-protocol";

export type RecorderProtocol = typeof baselineFieldProtocolPackage;

export async function loadRecorderProtocol(): Promise<RecorderProtocol> {
  return baselineFieldProtocolPackage;
}

export function findRecorderAssignment(protocol: RecorderProtocol, assignmentId: string) {
  return protocol.campaign.assignments.find((assignment) => assignment.id === assignmentId);
}

export function findRecorderObjective(
  protocol: RecorderProtocol,
  assignmentId: string,
  objectiveId: string,
) {
  return findRecorderAssignment(protocol, assignmentId)?.objectives.find(
    (objective) => objective.id === objectiveId,
  );
}

export function recorderObservationKinds(protocol: RecorderProtocol) {
  return protocol.observationKinds.kinds;
}
