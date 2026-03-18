import type { Point } from "./server";

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

export function hashString(str: string): number {
  let len = str.length;
  let h = 5381;

  for (let i = 0; i < len; i++) {
    h = (h * 33) ^ str.charCodeAt(i);
  }

  return h >>> 0;
}

export function toggle<T>(array: T[], item: T): T[] {
  if (array.includes(item)) {
    return remove(array, item);
  } else {
    return add(array, item);
  }
}

export function remove<T>(array: T[], item: T): T[] {
  return array.filter((other) => other !== item);
}

export function add<T>(array: T[], item: T): T[] {
  return array.includes(item) ? array : [...array, item];
}

export function shuffle<T>(array: T[]): T[] {
  array = [...array];
  for (let i = array.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j]!, array[i]!];
  }
  return array;
}

export function pointsToFastPath(points: Point[]): string {
  points = simplifyPoints(points, 2);
  return `M ${points.map((p) => `${p.x} ${p.y}`).join(" ")}`;
}

/**
 * Convert an array of points into a smooth SVG path data.
 */
export function pointsToSmoothPath(
  points: Point[],
  smoothing: number = 0.2,
): string {
  points = simplifyPoints(points, 1);

  if (points.length === 0) {
    return "";
  }

  let start = points[0]!;

  // Ensure every path begins with at least one line command so that you always
  // see something, even if there was only one point.
  let commands = `M ${start.x} ${start.y} ${start.x} ${start.y}`;

  for (let i = 1; i < points.length - 1; i++) {
    let point = points[i]!;

    let c1 = getControlPoint(
      points[i - 1]!,
      points[i - 2]!,
      point,
      smoothing,
      false,
    );

    let c2 = getControlPoint(
      point,
      points[i - 1]!,
      points[i + 1]!,
      smoothing,
      true,
    );

    commands += `C ${c1.x}, ${c1.y} ${c2.x}, ${c2.y} ${point.x}, ${point.y}`;
  }

  // Round the precision of all numeric values to save bandwidth.
  commands = commands.replace(/-?\d*\.?\d+/g, (n) => {
    return parseFloat(n)
      .toFixed(1)
      .replace(/\.?0+$/, "");
  });

  return commands;
}

function getControlPoint(
  point: Point,
  previousPoint: Point | undefined = point,
  nextPoint: Point | undefined = point,
  smoothing: number,
  reverse: boolean = false,
): Point {
  let lineLengthX = nextPoint.x - previousPoint.x;
  let lineLengthY = nextPoint.y - previousPoint.y;
  let length = Math.hypot(lineLengthX, lineLengthY) * smoothing;
  let angle = Math.atan2(lineLengthY, lineLengthX) + (reverse ? Math.PI : 0);
  let x = point.x + Math.cos(angle) * length;
  let y = point.y + Math.sin(angle) * length;
  return { x, y };
}

/**
 * Simplify a continuous path by removing points that are close together points.
 */
function simplifyPoints(points: Point[], minDistance: number = 1): Point[] {
  if (points.length === 0) {
    return [];
  }

  let stack = [...points];
  let prev = stack.shift()!;
  let path = [prev];

  while (stack.length) {
    let point = stack.shift()!;
    let dist = Math.hypot(point.x - prev.x, point.y - prev.y);

    if (stack.length === 0 || dist > minDistance) {
      prev = point;
      path.push(point);
    }
  }

  return path;
}

export function floodfill(
  ctx: CanvasRenderingContext2D,
  point: Point,
  color: string,
) {
  let { width, height } = ctx.canvas;
  let imageData = ctx.getImageData(0, 0, width, height);
  let pixels = new Uint32Array(imageData.data.buffer);
  let origin = point.x + point.y * width;
  let source = pixels[origin]!;
  let target = colorToRgba(color);

  if (areColorsEqual(source, target)) {
    return;
  }

  let stack = [point.x, point.y];

  while (stack.length > 0) {
    let y = stack.pop()!;
    let x = stack.pop()!;

    // Scan upwards until we hit the boundaries or a pixel that is a different
    // color.
    while (y > 0) {
      let index = x + (y - 1) * width;

      if (!areColorsEqual(pixels[index]!, source)) {
        break;
      }

      y -= 1;
    }

    let left = false;
    let right = false;

    // Scan downwards recoloring pixels as we go and marking neighbours for
    // subsequent scans.
    while (y < height) {
      let index = x + y * width;

      if (!areColorsEqual(pixels[index]!, source)) {
        break;
      }

      pixels[index] = target;

      let colorLeft = x > 0 ? pixels[index - 1]! : target;
      let colorRight = x < width - 1 ? pixels[index + 1]! : target;

      if (areColorsEqual(colorLeft, source)) {
        if (!left) {
          stack.push(x - 1, y);
          left = true;
        }
      } else if (left) {
        left = false;
      }

      if (areColorsEqual(colorRight, source)) {
        if (!right) {
          stack.push(x + 1, y);
          right = true;
        }
      } else if (right) {
        right = false;
      }

      y += 1;
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Compare two u32 colors in ABGR format.
 */
function areColorsEqual(a: number, b: number): boolean {
  return a === b;
}

/**
 * Convert a color string into an ABGR u32.
 */
function colorToRgba(color: string): number {
  let c = new OffscreenCanvas(1, 1).getContext("2d")!;
  c.fillStyle = color;
  c.fillRect(0, 0, 1, 1);
  return new Uint32Array(c.getImageData(0, 0, 1, 1).data.buffer)[0]!;
}

/**
 * Get the color under a specific pixel of the canvas. Note that this needs to
 * be in pixel coordinates (e.g. accounting for high DPI resolution).
 */
export function sampleColor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
): string {
  let imageData = ctx.getImageData(x, y, 1, 1);
  let r = imageData.data[0]!;
  let g = imageData.data[1]!;
  let b = imageData.data[2]!;
  let a = imageData.data[3]!;
  return a ? `#${byteToHex(r)}${byteToHex(g)}${byteToHex(b)}` : `#ffffff`;
}

/**
 * Format a byte as a two digit hex string.
 */
function byteToHex(byte: number): string {
  return byte.toString(16).padStart(2, "0");
}
