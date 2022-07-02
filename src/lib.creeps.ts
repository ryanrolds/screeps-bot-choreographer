import {Kernel} from "./ai.kernel";
import {Base} from "./config";
import {MEMORY_BASE} from "./constants.memory";

export function getCreepBase(kernel: Kernel, creep: Creep): Base {
  const baseId = creep.memory[MEMORY_BASE];
  if (!baseId) {
    return null;
  }

  const base = kernel.getPlanning().getBaseById(baseId);
  if (!base) {
    return null;
  }

  return base;
}
