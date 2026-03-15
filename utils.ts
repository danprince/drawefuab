export type Ok<Value> = { ok: true; value: Value };
export type Err = { ok: false; error: string };

export type Result<Value> = Ok<Value> | Err;

export function Ok<Value>(value: Value): Ok<Value> {
  return { ok: true, value };
}

export function Err(error: string): Err {
  return { ok: false, error };
}

export function assert(
  condition: any,
  message = "Assertion failed",
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function toggle<T>(array: T[], item: T): T[] {
  if (array.includes(item)) {
    return array.filter((other) => other !== item);
  } else {
    return [...array, item];
  }
}

export function remove<T>(array: T[], item: T): T[] {
  return array.filter((other) => other !== item);
}

export function shuffle<T>(array: T[]): T[] {
  array = [...array];
  for (let i = array.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j]!, array[i]!];
  }
  return array;
}
