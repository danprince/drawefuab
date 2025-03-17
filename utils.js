// @ts-check

/**
 * @typedef {object} Point
 * @prop {number} x
 * @prop {number} y
 *
 * @typedef {object} Rgba
 * @prop {number} r
 * @prop {number} g
 * @prop {number} b
 * @prop {number} a
 */

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Point} point
 * @returns {Rgba}
 */
export function sampleRgbaAtPoint(ctx, point) {
  let imageData = ctx.getImageData(point.x, point.y, 1, 1);
  let [r, g, b, a] = imageData.data;
  return { r, g, b, a };
}

let colorSamplingContext = /** @type {CanvasRenderingContext2D} */ (
  document.createElement("canvas").getContext("2d")
);

/**
 * @param {string} color
 * @returns {Rgba}
 */
export function colorToRgba(color) {
  colorSamplingContext.fillStyle = color;
  colorSamplingContext.fillRect(0, 0, 10, 10);
  return sampleRgbaAtPoint(colorSamplingContext, { x: 0, y: 0 });
}

/**
 * Convert an array of points into a smooth Path2D.
 * @param {Point[]} points
 * @param {number} smoothing
 * @returns {Path2D}
 */
export function pointsToSmoothPath(points, smoothing = 0.2) {
  if (points.length === 0) {
    return new Path2D();
  }

  points = simplifyPoints(points);

  let start = points[0];
  // Ensure every path begins with at least one line command so that you always
  // see something, even if there was only one point.
  let commands = `M ${start.x} ${start.y} L ${start.x} ${start.y}`;

  for (let i = 1; i < points.length - 1; i++) {
    let point = points[i];

    let startControlPoint = getControlPoint(
      points[i - 1],
      points[i - 2],
      point,
      smoothing,
      false,
    );

    let endControlPoint = getControlPoint(
      point,
      points[i - 1],
      points[i + 1],
      smoothing,
      true,
    );

    commands += `C ${startControlPoint.x}, ${startControlPoint.y} ${endControlPoint.x}, ${endControlPoint.y} ${point.x}, ${point.y}`;
  }

  return new Path2D(commands);
}

/**
 * @param {Point} point
 * @param {Point | undefined} previousPoint
 * @param {Point | undefined} nextPoint
 * @param {number} smoothing,
 * @param {boolean} reverse
 * @returns {Point}
 */
function getControlPoint(
  point,
  previousPoint = point,
  nextPoint = point,
  smoothing,
  reverse = false,
) {
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
 * @param {Point[]} points
 * @param {number} minDistance
 * @returns {Point[]}
 */
export function simplifyPoints(points, minDistance = 1) {
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
    path.unshift(point);
  }

  return path;
}

/**
 * @param {any} condition
 * @param {string} [message]
 * @returns {asserts condition}
 */
export function assert(condition, message = "Assertion failed") {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Create the event listeners for handling a drag interaction that begins from
 * a pointerdown event.
 * @param {PointerEvent} event
 * @param {object} handlers
 * @param {(point: Point, bounds: DOMRect) => void} handlers.onDrag
 * Called for each pointer movement during the drag interaction with the
 * pointer's position _relative_ to the element that the initial event handler
 * was attached to. Also passes along the bounds of the element to make it a
 * bit easier to get a relative position/percentage when necessary.
 * @param {() => void} [handlers.onCommit]
 * Called if the user finishes dragging by releasing the pointer.
 * @param {() => void} [handlers.onCancel]
 * Called if the user finishes dragging by pressing escape or blurring the window.
 */
export function addDragListeners(event, handlers) {
  const element = event.currentTarget;

  if (!(element instanceof HTMLElement)) {
    throw new Error("Drag target is not an element!");
  }

  let bounds = element.getBoundingClientRect();
  element.setAttribute("data-active", "");

  const cancel = () => {
    handlers.onCancel?.();
    cleanup();
  };

  const commit = () => {
    handlers.onCommit?.();
    cleanup();
  };

  /**
   * @param {PointerEvent} event
   */
  const onPointerMove = (event) => {
    let x = event.clientX - bounds.x;
    let y = event.clientY - bounds.y;
    handlers.onDrag({ x, y }, bounds);
  };

  /**
   * @param {KeyboardEvent} event
   */
  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      cancel();
    }
  };

  const onPointerUp = () => {
    commit();
  };

  const onBlur = () => {
    cancel();
  };

  const cleanup = () => {
    element.removeAttribute("data-active");
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("keydown", onKeyDown);
  };

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("blur", onBlur);
  window.addEventListener("keydown", onKeyDown);
  onPointerMove(event);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Point} point
 * @param {string} color
 * @param {number} opacity
 */
export function floodfill(ctx, point, color, opacity) {
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

  let transform = ctx.getTransform();
  let { width, height } = ctx.canvas;
  let imageData = ctx.getImageData(0, 0, width, height);
  let initialPixel = point.x * transform.a + point.y * transform.d * width;
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
 * @param {ImageData} imageData
 * @param {number} pixelIndex
 * @param {Rgba} color
 * @returns {boolean}
 */
function isSameColor(imageData, pixelIndex, color) {
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
