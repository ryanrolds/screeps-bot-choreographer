import {
  createCommonCostMatrix, createDefenderCostMatrix, createOpenSpaceMatrix, createPartyCostMatrix, createSourceRoadMatrix, visualizeCostMatrix
} from '../lib/costmatrix';
import {AllowedCostMatrixTypes} from '../lib/costmatrix_cache';
import {Metrics} from '../lib/metrics';
import {Tracer} from '../lib/tracing';
import {Kernel} from '../os/kernel/kernel';
import {RunnableResult, running} from '../os/process';

export default class CostMatrixDebugger {
  id: string;
  roomId: string;
  costMatrix: CostMatrix;
  kernel: Kernel;

  constructor(id: string) {
    this.id = id;
    this.costMatrix = null;
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace.info('costmatrix debugger', {path: this.costMatrix});

    if (this.costMatrix) {
      // Display on the map
      visualizeCostMatrix(this.roomId, this.costMatrix, trace);
    }

    return running();
  }

  debug(roomId: string, costMatrixType: AllowedCostMatrixTypes) {
    const kernel = global.AI;
    const trace = new Tracer('costmatrix_debugger_debug', new Map(), new Metrics());
    trace.info('debug matrix', {roomId, costMatrixType});

    let costMatrix: CostMatrix | boolean = new PathFinder.CostMatrix();

    switch (costMatrixType) {
      case AllowedCostMatrixTypes.PARTY:
        costMatrix = createPartyCostMatrix(roomId, trace);
        break;
      case AllowedCostMatrixTypes.COMMON:
        costMatrix = createCommonCostMatrix(kernel, roomId, trace);
        break;
      case AllowedCostMatrixTypes.BASE_DEFENSE:
        costMatrix = createDefenderCostMatrix(roomId, trace);
        break;
      case AllowedCostMatrixTypes.SOURCE_ROAD:
        costMatrix = createSourceRoadMatrix(kernel, roomId, trace);
        break;
      case AllowedCostMatrixTypes.OPEN_SPACE:
        [costMatrix] = createOpenSpaceMatrix(roomId, trace);
        break;
      case AllowedCostMatrixTypes.DAMAGE:
        //costMatrix = createDamageMatrix(global.AI, roomId, trace);
        break;
      default:
        trace.error('unexpected matrix type', {matrixType: costMatrixType});
    }

    if (typeof (costMatrix) !== 'boolean') {
      this.costMatrix = costMatrix;
    } else {
      this.costMatrix = null;
    }
  }

  clear() {
    this.costMatrix = null;
  }
}
