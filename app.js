// @ts-check

import {
  assert,
  pointsToSmoothPath,
  addDragListeners,
  sampleRgbaAtPoint,
  floodfill,
  colorToRgba,
} from "./utils.js";

/**
 * @typedef {object} Point
 * @prop {number} x
 * @prop {number} y
 *
 * @typedef {(
 *   | { type: "stroke", points: Point[], color: string, size: number, opacity: number }
 *   | { type: "erase", points: Point[], size: number }
 *   | { type: "fill", point: Point, color: string, opacity: number }
 * )} DrawingCommand
 *
 * @typedef {"pen" | "eraser" | "eyedropper" | "fill"} Tool
 */

class Editor {
  /**
   * The canvas where we draw the committed contents of the editor.
   */
  contentCanvas = /** @type {HTMLCanvasElement} */ (
    document.getElementById("canvas")
  );

  /**
   * The canvas where we draw in-progress paths and tool states, such as pen
   * size previews.
   */
  previewCanvas = /** @type {HTMLCanvasElement} */ (
    document.getElementById("preview")
  );

  /**
   * The rendering context for the content canvas.
   */
  contentContext = /** @type {CanvasRenderingContext2D} */ (
    this.contentCanvas.getContext("2d", { willReadFrequently: true })
  );

  /**
   * The rendering context for the preview canvas.
   */
  previewContext = /** @type {CanvasRenderingContext2D} */ (
    this.previewCanvas.getContext("2d")
  );

  /**
   * The rendering resolution for the canvases.
   */
  resolution = window.devicePixelRatio;

  /**
   * The position of the mouse cursor, relative to the canvas. This can be
   * outside of the bounds of the canvas and if the mouse hasn't moved over the
   * canvas (or the user is on mobile) it can also be undefined.
   * @type {Point | undefined}
   */
  cursor;

  /**
   * The tool that the user currently has selected.
   * @type {Tool}
   */
  currentTool = "pen";

  /**
   * The colors available in the current palette.
   * @type {string[]}
   */
  colorPalette = [
    "#000000",
    "#666666",
    "#0050CD",
    "#FFFFFF",
    "#AAAAAA",
    "#26C9FF",
    "#017420",
    "#990000",
    "#964112",
    "#11B03C",
    "#FF0013",
    "#FF7829",
    "#B0701C",
    "#99004E",
    "#CB5A57",
    "#FFC126",
    "#FF008F",
    "#FEAFA8",
  ];

  /**
   * The pen sizes to show as explicit options in the UI.
   */
  penSizes = [2, 5, 10, 20, 30];

  /**
   * The color that is currently selected within the editor.
   * @type {string}
   */
  currentColor = this.colorPalette[0] ?? "#000000";

  /**
   * The radius of the current pen.
   */
  currentPenSize = 5;

  /**
   * The opacity of the current pen (0-1).
   */
  currentOpacity = 1;

  /**
   * The points within the current path when the user is drawing.
   * @type {Point[]}
   */
  currentPath = [];

  /**
   * The complete history of commands that were used in the current drawing.
   * @type {DrawingCommand[]}
   */
  commands = [];

  /**
   * The head is the (git style) index that points to the most recently
   * applied command. Moving the head backwards/forwards is how undo/redo
   * works.
   * @type {number}
   */
  head = 0;

  /**
   * Alpine calls this automatically.
   */
  init() {
    window.addEventListener("pointermove", (event) => {
      let bounds = this.contentCanvas.getBoundingClientRect();
      let x = Math.floor(event.clientX - bounds.x);
      let y = Math.floor(event.clientY - bounds.y);
      this.cursor = { x, y };
    });

    window.addEventListener("touchend", () => {
      // Remove the cursor when the touch finishes on mobile.
      this.cursor = undefined;
    });

    this.contentCanvas.addEventListener("pointerdown", (event) => {
      let bounds = this.contentCanvas.getBoundingClientRect();
      let x = Math.floor(event.clientX - bounds.x);
      let y = Math.floor(event.clientY - bounds.y);

      if (this.currentTool === "eyedropper") {
        let color = sampleRgbaAtPoint(this.contentContext, { x, y });
        this.currentColor = `rgb(${color.r}, ${color.g}, ${color.b})`;
        this.currentOpacity = color.a / 255;
      } else if (this.currentTool === "pen") {
        this.currentPath = [];
        addDragListeners(event, {
          onDrag: (point) => {
            this.currentPath.push(point);
          },
          onCommit: () => {
            this.commit({
              type: "stroke",
              points: this.currentPath,
              color: this.currentColor,
              size: this.currentPenSize,
              opacity: this.currentOpacity,
            });

            this.currentPath = [];
          },
          onCancel: () => {
            this.currentPath = [];
          },
        });
      } else if (this.currentTool === "eraser") {
        this.currentPath = [];
        addDragListeners(event, {
          onDrag: (point) => {
            this.currentPath.push(point);
          },
          onCommit: () => {
            this.commit({
              type: "erase",
              points: this.currentPath,
              size: this.currentPenSize,
            });

            this.currentPath = [];
          },
          onCancel: () => {
            this.currentPath = [];
          },
        });
      } else if (this.currentTool === "fill") {
        this.fill({ x, y });
      }
    });

    this.resize();
  }

  /**
   * @returns {import("./utils.js").Rgba}
   */
  getCurrentColorAsRgba() {
    return {
      ...colorToRgba(this.currentColor),
      a: Math.floor(this.currentOpacity * 255),
    };
  }

  /**
   * Fill the region around a point using the current color and opacity.
   * @param {Point} point
   */
  fill(point) {
    let sourceColor = sampleRgbaAtPoint(this.contentContext, point);
    let targetColor = this.getCurrentColorAsRgba();

    if (sourceColor === targetColor) {
      return;
    }

    this.commit({
      type: "fill",
      point: point,
      color: this.currentColor,
      opacity: this.currentOpacity,
    });
  }

  /**
   * @param {Tool} tool
   */
  setTool(tool) {
    this.currentTool = tool;
    this.currentPath = [];
  }

  /**
   * Commit a drawing command, discarding any pending redos.
   * @param {DrawingCommand} command
   */
  commit(command) {
    // Take the commands before HEAD, discarding any that came after.
    let activeCommands = this.commands.slice(0, this.head);
    this.commands = [...activeCommands, command];
    this.head = this.commands.length;
  }

  /**
   * Undo the last command, if possible.
   */
  undo() {
    if (this.canUndo()) {
      this.head -= 1;
    }
  }

  /**
   * Redo the last command, if possible.
   */
  redo() {
    if (this.canRedo()) {
      this.head += 1;
    }
  }

  /**
   * Check whether it's possible to undo the last command.
   * @returns {boolean}
   */
  canUndo() {
    return this.head > 0;
  }

  /**
   * Check whether it's possible to redo the last command.
   * @returns {boolean}
   */
  canRedo() {
    return this.head < this.commands.length;
  }

  /**
   * Resize the canvases to match the container/resolution of the device.
   */
  resize() {
    let viewport = this.contentCanvas.parentElement;

    if (!viewport) {
      throw new Error(
        "Can't resize canvas element because it does not have a parent!",
      );
    }

    let bounds = viewport.getBoundingClientRect();

    for (let ctx of [this.previewContext, this.contentContext]) {
      ctx.canvas.width = bounds.width * this.resolution;
      ctx.canvas.height = bounds.height * this.resolution;
    }
  }

  /**
   * The renderer keeps track of a separate HEAD so that it can draw the
   * minimum number of commands to sync up with the editor HEAD.
   */
  renderHead = 0;

  /**
   * Render state of the canvas after applying the list of active drawing commands.
   */
  renderContent() {
    let ctx = this.contentContext;

    // If the renderer is ahead of the editor, it means that the user has
    // undone some commands. Rendering to a canvas is an additive process
    // and we can't undo one step, so we have to just redraw the whole image
    // from scratch (by setting the render head back to zero).
    if (this.renderHead > this.head) {
      this.renderHead = 0;
    }

    // We only clear the canvas if we're actually rendering from scratch. In
    // all the other scenarios, we're just applying draw commands
    // incrementally.
    if (this.renderHead === 0) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }

    ctx.save();
    ctx.scale(this.resolution, this.resolution);

    for (let i = this.renderHead; i < this.head; i++) {
      let command = this.commands[i];
      applyDrawCommand(ctx, command);
    }

    ctx.restore();

    this.renderHead = this.head;
  }

  /**
   * Render the state of the preview canvas.
   */
  renderPreview() {
    let ctx = this.previewContext;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.save();
    ctx.scale(this.resolution, this.resolution);

    // Render current path
    if (this.currentPath.length > 0) {
      applyDrawCommand(ctx, {
        type: "stroke",
        points: this.currentPath,
        size: this.currentPenSize,
        opacity: this.currentOpacity,
        // If we're previewing an erase command, we can't actually use an
        // "erase" draw command because it relies on canvas compositing and
        // we're actually rendering to a separate canvas from the rest of the
        // content. We just draw a white path instead!
        color: this.currentTool === "pen" ? this.currentColor : "white",
      });
    }

    // Render crosshairs
    if (this.cursor) {
      let { x, y } = this.cursor;
      let radius = this.currentPenSize / 2;
      renderCrosshairs(ctx, x, y, radius);
    }

    ctx.restore();
  }

  save() {
    this.contentCanvas.toBlob((blob) => {
      assert(blob, "Canvas could not be converted to a blob!");
      let url = URL.createObjectURL(blob);
      let a = document.createElement("a");
      a.setAttribute("download", "drawing.png");
      a.setAttribute("href", url);
      a.click();
    });
  }

  /**
   * @param {PointerEvent} event
   * @param {(value: number) => void} callback
   */
  beginHorizontalDrag(event, callback) {
    addDragListeners(event, {
      onDrag({ x }, { width }) {
        callback(Math.max(0, Math.min(1, x / width)));
      },
    });
  }
}

/**
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 */
function renderCrosshairs(ctx, x, y, radius) {
  let gap = 4;
  let lineLength = 6;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);

  // Above
  ctx.moveTo(x, y - radius - gap);
  ctx.lineTo(x, y - radius - gap - lineLength);

  // Below
  ctx.moveTo(x, y + radius + gap);
  ctx.lineTo(x, y + radius + gap + lineLength);

  // Left
  ctx.moveTo(x - radius - gap, y);
  ctx.lineTo(x - radius - gap - lineLength, y);

  // Right
  ctx.moveTo(x + radius + gap, y);
  ctx.lineTo(x + radius + gap + lineLength, y);

  ctx.strokeStyle = "white";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.strokeStyle = "black";
  ctx.lineWidth = 1;
  ctx.stroke();
}

/**
 * Apply a draw command to a canvas context.
 * @param {CanvasRenderingContext2D} ctx
 * @param {DrawingCommand} command
 */
function applyDrawCommand(ctx, command) {
  ctx.save();

  if (command.type === "stroke") {
    let path = pointsToSmoothPath(command.points);
    ctx.lineWidth = command.size;
    ctx.globalAlpha = command.opacity;
    ctx.strokeStyle = command.color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke(path);
  } else if (command.type === "erase") {
    let path = pointsToSmoothPath(command.points);
    ctx.lineWidth = command.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = "destination-out";
    ctx.stroke(path);
  } else if (command.type === "fill") {
    floodfill(ctx, command.point, command.color, command.opacity);
  }

  ctx.restore();
}

Object.assign(window, { Editor });
