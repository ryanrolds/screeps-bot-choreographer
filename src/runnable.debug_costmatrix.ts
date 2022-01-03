import {
  createCommonCostMatrix, createDefenderCostMatrix, createOpenSpaceMatrix, createPartyCostMatrix, createSourceRoadMatrix, visualizeCostMatrix
} from "./lib.costmatrix";
import {AllowedCostMatrixTypes} from "./lib.costmatrix_cache";
import {Tracer} from './lib.tracing';
import {Kingdom} from "./org.kingdom";
import {running} from "./os.process";
import {RunnableResult} from "./os.runnable";

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
    const kingdom = global.AI.getKingdom();
    const trace = new Tracer('costmatrix_debugger_debug', {}, 0)
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
      case AllowedCostMatrixTypes.SOURCE_ROAD:
        costMatrix = createSourceRoadMatrix(kingdom, roomId, trace);
        break;
      case AllowedCostMatrixTypes.OPEN_SPACE:
        [costMatrix] = createOpenSpaceMatrix(roomId, trace);
        break;
      default:
        trace.error('unexpected matrix type', {matrixType: costMatrixType})
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
