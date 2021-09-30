import {Process, Runnable, RunnableResult, running, sleeping, terminate} from "./os.process";
import {Tracer} from './lib.tracing';
import {Kingdom} from "./org.kingdom";
import {AllowedCostMatrixTypes} from "./lib.costmatrix_cache";


export default class CostMatrixDebugger {
  id: string;
  roomId: string;
  costMatrix: CostMatrix;
  kingdom: Kingdom;

  constructor(id: string, kingdom: Kingdom) {
    this.id = id;
    this.costMatrix = null;
    this.kingdom = kingdom;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace.log("costmatrix debugger", {path: this.costMatrix})

    if (this.costMatrix) {
      // Display on the map
      visualizeCostMatrix(this.roomId, this.costMatrix);
    }

    return running();
  }

  debug(roomId: string, costMatrixType: AllowedCostMatrixTypes) {
    const costMatrix = this.kingdom.getCostMatrixCache().getCostMatrix(roomId, costMatrixType)
    if (costMatrix) {
      this.costMatrix = costMatrix;
      this.roomId = roomId;
    }
  }

  clear() {
    this.costMatrix = null;
  }
}

const visualizeCostMatrix = (roomName: string, costMatrix: CostMatrix) => {
  const visual = new RoomVisual(roomName);

  for (let x = 0; x <= 49; x++) {
    for (let y = 0; y <= 49; y++) {
      const cost = costMatrix.get(x, y);
      visual.text((cost / 5).toString(), x, y);
    }
  }
}
