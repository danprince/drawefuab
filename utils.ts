export type Point = { x: number; y: number };
export type Rectangle = { x: number; y: number; w: number; h: number };

type Rgba = { r: number; g: number; b: number; a: number };

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

export function shuffle<T>(array: T[]): T[] {
  array = [...array];
  for (let i = array.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j]!, array[i]!];
  }
  return array;
}

export function sampleRgbaAtPoint(
  ctx: CanvasRenderingContext2D,
  point: { x: any; y: any },
): Rgba {
  let imageData = ctx.getImageData(point.x, point.y, 1, 1);
  let [r, g, b, a] = imageData.data;
  return { r: r!, g: g!, b: b!, a: a! };
}

export function rgbaToHex({ r, g, b }: Rgba): string {
  let hexR = r.toString(16).padStart(2, "0");
  let hexG = g.toString(16).padStart(2, "0");
  let hexB = b.toString(16).padStart(2, "0");
  return `#${hexR}${hexG}${hexB}`;
}

let colorSamplingContext =
  typeof document !== "undefined"
    ? document
        .createElement("canvas")
        .getContext("2d", { willReadFrequently: true })
    : undefined;

function colorToRgba(color: string): Rgba {
  assert(colorSamplingContext);
  colorSamplingContext.fillStyle = color;
  colorSamplingContext.fillRect(0, 0, 10, 10);
  return sampleRgbaAtPoint(colorSamplingContext, { x: 0, y: 0 });
}

/**
 * Convert an array of points into a smooth SVG path data.
 */
export function pointsToSmoothPath(
  points: Point[],
  smoothing: number = 0.2,
): string {
  if (points.length === 0) {
    return "";
  }

  points = simplifyPoints(points);

  let start = points[0]!;
  // Ensure every path begins with at least one line command so that you always
  // see something, even if there was only one point.
  let commands = `M ${start.x} ${start.y} ${start.x} ${start.y}`;

  for (let i = 1; i < points.length - 1; i++) {
    let point = points[i]!;

    let cp1 = getControlPoint(
      points[i - 1]!,
      points[i - 2]!,
      point,
      smoothing,
      false,
    );

    let cp2 = getControlPoint(
      point,
      points[i - 1]!,
      points[i + 1]!,
      smoothing,
      true,
    );

    commands += `C ${cp1.x}, ${cp1.y} ${cp2.x}, ${cp2.y} ${point.x}, ${point.y}`;
  }

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
  let prev = stack.shift();
  assert(prev);

  let path = [prev];

  while (stack.length) {
    let point = stack.shift();
    assert(point);

    let dist = Math.hypot(point.x - prev.x, point.y - prev.y);

    if (dist < minDistance) {
      continue;
    }

    prev = point;
    path.push(point);
  }

  return path;
}

export function floodfill(
  ctx: CanvasRenderingContext2D,
  point: Point,
  color: string,
  opacity: number,
) {
  let sourceColor = sampleRgbaAtPoint(ctx, point);
  let targetColor = colorToRgba(color);
  targetColor.a = (opacity * 255) | 0;

  if (
    sourceColor.r === targetColor.r &&
    sourceColor.g === targetColor.g &&
    sourceColor.b === targetColor.b &&
    sourceColor.a === targetColor.a
  ) {
    return;
  }

  // Implementation of the algorithm described in this article:
  // https://www.williammalone.com/articles/html5-canvas-javascript-paint-bucket-tool/

  let { width, height } = ctx.canvas;
  let imageData = ctx.getImageData(0, 0, width, height);
  let initialPixel = point.x + point.y * width;
  let stack = [initialPixel];

  while (stack.length > 0) {
    let pixel = stack.pop();
    assert(pixel !== undefined);

    let x = pixel % width;
    let y = (pixel / width) | 0;

    // Scan upwards until we hit the boundaries or a pixel that is a different
    // color.
    while (y > 0) {
      let index = x + (y - 1) * width;

      if (!isSameColor(imageData, index, sourceColor)) {
        break;
      }

      y -= 1;
    }

    let reachLeft = false;
    let reachRight = false;

    // Scan downwards recoloring pixels as we go and marking neighbours for
    // subsequent scans.
    while (y < height) {
      let index = x + y * width;

      if (!isSameColor(imageData, index, sourceColor)) {
        break;
      }

      let offset = index * 4;
      imageData.data[offset + 0] = targetColor.r;
      imageData.data[offset + 1] = targetColor.g;
      imageData.data[offset + 2] = targetColor.b;
      imageData.data[offset + 3] = targetColor.a;

      let leftPixelIndex = index - 1;
      let rightPixelIndex = index + 1;

      if (x > 0 && isSameColor(imageData, leftPixelIndex, sourceColor)) {
        if (!reachLeft) {
          stack.push(leftPixelIndex);
          reachLeft = true;
        }
      } else if (reachLeft) {
        reachLeft = false;
      }

      if (
        x < width - 1 &&
        isSameColor(imageData, rightPixelIndex, sourceColor)
      ) {
        if (!reachRight) {
          stack.push(rightPixelIndex);
          reachRight = true;
        }
      } else if (reachRight) {
        reachRight = false;
      }

      y++;
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Check whether two pixels have the same color.
 */
function isSameColor(
  imageData: ImageData,
  pixelIndex: number,
  color: Rgba,
): boolean {
  let i = pixelIndex * 4;
  // TODO: This won't handle anti-aliasing very well, should switch to using a
  // tolerance based check once fill is working properly.
  return (
    imageData.data[i + 0] === color.r &&
    imageData.data[i + 1] === color.g &&
    imageData.data[i + 2] === color.b &&
    imageData.data[i + 3] === color.a
  );
}

export async function createCanvasPattern(src: string): Promise<CanvasPattern> {
  let image = new Image();
  image.src = src;
  await image.decode();
  let canvas = document.createElement("canvas");
  let ctx = canvas.getContext("2d")!;
  return ctx.createPattern(image, "repeat")!;
}
