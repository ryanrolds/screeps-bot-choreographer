import {Kernel} from "./kernel";
import {Tracer} from "./lib.tracing";
import {sleeping} from "./os.process";
import {Runnable, RunnableResult} from "./os.runnable";
import {ThreadFunc} from "./os.thread";

const MEMORY_CLEANUP_TTL = 1000;
const MEMORY_OBJECT_TTL = 5000;

type MemoryObject = {
  id: string;
  time: number;
  stales: boolean;
  value: any;
}

export class PersistentMemory {
  memoryId: string;

  constructor(id: string) {
    this.memoryId = id;
  }

  getMemory(trace: Tracer): any {
    const memoryObject: MemoryObject = (Memory as any).proc[this.memoryId];
    if (!memoryObject) {
      return null;
    }

    if (typeof memoryObject.stales === 'undefined') {
      trace.warn('stale not set', {memoryObject});
      memoryObject.stales = true;
    }

    // Don't return exceptionally old memory objects
    if (memoryObject.stales && memoryObject.time < Game.time - MEMORY_OBJECT_TTL) {
      trace.warn('memory object is stale', {memoryObject});
      return null;
    }

    return memoryObject.value;
  }

  setMemory(value: any, stales: boolean = true): void {
    (Memory as any).proc[this.memoryId] = {
      id: this.memoryId,
      time: Game.time,
      stales: stales,
      value: value
    } as MemoryObject;
  }
}

export class MemoryManager implements Runnable {
  threadMemoryCleanup: ThreadFunc;

  constructor() {
    // Ensure Memory storage is ready
    if (!(Memory as any).proc) {
      (Memory as any).proc = {};
    }
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    const now = Game.time;
    const memory = Memory as any;
    const proc = memory.proc;

    for (const key in proc) {
      const obj: MemoryObject = proc[key];

      if (typeof obj.stales === 'undefined') {
        obj.stales = true;
      }

      if (obj.stales && obj.time < now - MEMORY_OBJECT_TTL) {
        delete proc[key];
      }
    }

    return sleeping(MEMORY_CLEANUP_TTL)
  }
}
