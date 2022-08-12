import * as MEMORY from './constants.memory';
import {Tracer} from './lib.tracing';

// TODO replace with PDI class and method to reset
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const globalAny: any = global;
globalAny.RESET_PIDS = false;

export const setup = (memory: Map<string, number>, setPoint: number, p: number,
  i: number, d: number) => {
  if (!p) {
    throw new Error('missing p');
  }

  memory.set(MEMORY.PID_SUFFIX_SETPOINT, setPoint);
  memory.set(MEMORY.PID_SUFFIX_P, p);
  memory.set(MEMORY.PID_SUFFIX_I, i || 0);
  memory.set(MEMORY.PID_SUFFIX_D, d || 0);
};

export const update = (memory: Map<string, number>, value: number,
  time: number, _trace: Tracer) => {
  if (globalAny.RESET_PIDS) {
    memory.set(MEMORY.PID_SUFFIX_ERROR, 0);
    memory.set(MEMORY.PID_SUFFIX_TIME, time);
    memory.set(MEMORY.PID_SUFFIX_INTEGRAL, 0);
  }

  const setPoint = memory.get(MEMORY.PID_SUFFIX_SETPOINT);
  const p = memory.get(MEMORY.PID_SUFFIX_P) || 0.4;
  const i = memory.get(MEMORY.PID_SUFFIX_I) || 0.001;
  const d = memory.get(MEMORY.PID_SUFFIX_D) || 0;

  if (!p) {
    throw new Error('update: missing p');
  }

  const err = value - setPoint;

  const prevTime = memory.get(MEMORY.PID_SUFFIX_TIME) || time;
  const dt = time - prevTime;

  const prevIntegral = memory.get(MEMORY.PID_SUFFIX_INTEGRAL) || 0;
  let integral = prevIntegral + (err * dt * i);

  // Bootstrapping can require a lot of workers/haulers. 10 was too few (Jan 2022)
  // 50 seems too much
  if (integral > 40) {
    integral = 40;
  } else if (integral < -10) {
    integral = -10;
  }

  const prevErr = memory.get(MEMORY.PID_SUFFIX_ERROR) || err;

  let det = 0;
  if (dt > 0) {
    det = -((err - prevErr) / dt);
  }

  memory.set(MEMORY.PID_SUFFIX_ERROR, err);
  memory.set(MEMORY.PID_SUFFIX_TIME, time);
  memory.set(MEMORY.PID_SUFFIX_INTEGRAL, integral);

  const result = p * err + integral + d * det;

  // TODO move to HUD
  // const roomVisual = new RoomVisual(roomId);
  // roomVisual.text(`PID: ${result} = ${p} * ${err} + ${integral} + ${d} * ${det}`, 0, 1,
  //  {align: 'left'});

  return result;
};
