import {trace} from "console";
import {Tracer} from "./lib.tracing";

const MEMORY_OBJECT_TTL = 5000;

type MemoryObject = {
  id: string;
  time: number;
  stales: boolean;
  value: any;
}

export const prepareMemory = () => {
  // Ensure Memory storage is ready
  if (!(Memory as any).proc) {
    (Memory as any).proc = {};
  }
}

export const removeOldMemoryObjects = () => {
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
