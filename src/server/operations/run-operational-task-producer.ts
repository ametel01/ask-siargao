import { getDefaultDatabaseQueryClient } from "@/server/db/query-client";
import { type OperationalTaskType, operationalTaskTypes } from "@/server/operations/contracts";
import { enqueueDueOperationalTasks } from "@/server/operations/operational-task-producer";

if (import.meta.main) {
  const result = await enqueueDueOperationalTasks(
    parseOperationalTaskProducerArguments(process.argv.slice(2)),
    getDefaultDatabaseQueryClient(),
  );
  console.info(JSON.stringify({ checked: "operational-task-producer", enqueued: result }));
}

export function parseOperationalTaskProducerArguments(arguments_: string[]) {
  let cycleKey: string | undefined;
  let limitPerType = 100;
  let taskTypes: OperationalTaskType[] | undefined;
  for (const argument of arguments_) {
    if (argument.startsWith("--cycle-key=")) cycleKey = argument.slice(12);
    else if (argument.startsWith("--limit=")) limitPerType = positiveInteger(argument.slice(8));
    else if (argument.startsWith("--task=")) {
      const task = argument.slice(7);
      if (task === "all") taskTypes = undefined;
      else if (operationalTaskTypes.includes(task as OperationalTaskType)) {
        taskTypes = [task as OperationalTaskType];
      } else throw new Error("invalid_operational_task_type");
    } else throw new Error("invalid_operational_task_producer_argument");
  }
  return { cycleKey, limitPerType, taskTypes };
}

function positiveInteger(raw: string) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error("invalid_positive_integer");
  return value;
}
