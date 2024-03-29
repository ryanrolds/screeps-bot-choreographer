import {Tracer} from '../lib/tracing';
import {Kernel} from './kernel/kernel';
import {Runnable, RunnableResult, sleeping} from './process';

const MEMORY_CLEANUP_TTL = 1000;
const MEMORY_OBJECT_TTL = 5000;

type MemoryObject = {
  id: string;
  time: number;
  stales: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
}

export class PersistentMemory<T> {
  memoryId: string;

  constructor(id: string) {
    this.memoryId = id;
  }

  getMemory(trace: Tracer): T {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const memoryObject: MemoryObject = (Memory as any).proc[this.memoryId];
    if (!memoryObject) {
      return {} as T;
    }

    if (typeof memoryObject.stales === 'undefined') {
      trace.warn('stale not set', {memoryObject});
      memoryObject.stales = true;
    }

    // Don't return exceptionally old memory objects
    if (memoryObject.stales && memoryObject.time < Game.time - MEMORY_OBJECT_TTL) {
      trace.warn('memory object is stale', {memoryObject});
      return {} as T;
    }

    return memoryObject.value;
  }

  setMemory(value: T, stales = true): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Memory as any).proc[this.memoryId] = {
      id: this.memoryId,
      time: Game.time,
      stales: stales,
      value: value,
    } as MemoryObject;
  }
}

export class MemoryManager implements Runnable {
  constructor() {
    // Ensure Memory storage is ready
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(Memory as any).proc) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Memory as any).proc = {};
    }
  }

  run(_kernel: Kernel, _trace: Tracer): RunnableResult {
    const now = Game.time;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    return sleeping(MEMORY_CLEANUP_TTL);
  }
}
