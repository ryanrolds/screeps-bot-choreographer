import {Process, Runnable, RunnableResult, running, sleeping, terminate} from "./os.process";
import {Tracer} from './lib.tracing';
import {Kingdom} from "./org.kingdom";
import {AllowedCostMatrixTypes} from "./lib.costmatrix_cache";
import {createCommonCostMatrix, createDefenderCostMatrix, createPartyCostMatrix} from "./lib.costmatrix";


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
      visualizeCostMatrix(this.roomId, this.costMatrix, trace);
    }

    return running();
  }

  debug(roomId: string, costMatrixType: AllowedCostMatrixTypes) {
    const trace = new Tracer('debug', 'costmatrix_debugger.debug')
    trace.log('debug matrix', {roomId, costMatrixType})

    let costMatrix: CostMatrix | boolean = new PathFinder.CostMatrix();

    switch (costMatrixType) {
      case AllowedCostMatrixTypes.PARTY:
        costMatrix = createPartyCostMatrix(roomId, trace);
        break;
      case AllowedCostMatrixTypes.COMMON:
        costMatrix = createCommonCostMatrix(roomId, trace);
        break;
      case AllowedCostMatrixTypes.BASE_DEFENSE:
        costMatrix = createDefenderCostMatrix(roomId, trace);
        break;
      default:
        trace.log('unexpected matrix type', {matrixType: costMatrixType})
    }

    if (typeof (costMatrix) !== "boolean") {
      this.costMatrix = costMatrix;
    } else {
      this.costMatrix = null;
    }
  }

  clear() {
    this.costMatrix = null;
  }
}

const visualizeCostMatrix = (roomName: string, costMatrix: CostMatrix, trace: Tracer) => {
  if (typeof (costMatrix) === "boolean") {
    trace.log('costmatrix is boolean', {roomName})
    return;
  }

  trace.log('show matrix', {roomName})

  const visual = new RoomVisual(roomName);

  for (let x = 0; x <= 49; x++) {
    for (let y = 0; y <= 49; y++) {
      const cost = costMatrix.get(x, y);
      visual.text((cost / 5).toString(), x, y);
    }
  }
}
