import { signal, type Signal } from "@preact/signals";
import type {
  Point,
  DrawCommand,
  PaintCommand,
  EraseCommand,
  FillCommand,
  HideCommand,
  Rectangle,
  TextCommand,
} from "./server";
import settings from "./settings.json";
import {
  floodfill,
  hashString,
  pointsToSmoothPath,
  sampleColor,
} from "./utils";

export type ViewTool = { type: "view" };
export type PaintTool = { type: "paint"; points?: Point[] };
export type EraseTool = { type: "erase"; points?: Point[] };
export type FillTool = { type: "fill" };
export type TextTool = { type: "text"; text: string };
export type HideTool = { type: "hide"; start?: Point; end?: Point };
export type EyedropperTool = { type: "eyedropper" };
export type Tool =
  | ViewTool
  | PaintTool
  | EraseTool
  | FillTool
  | TextTool
  | HideTool
  | EyedropperTool;

export type Editor = {
  brushSize: Signal<number>;
  fontSize: Signal<number>;
  color: Signal<string>;
  tool: Signal<Tool>;

  resolution: number;
  background: DrawCommand[];
  commands: DrawCommand[];
  undos: DrawCommand[];
  cursor: Point | undefined;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
};

export type EditorParams = {
  background?: DrawCommand[];
};

export function createEditor(params: EditorParams = {}): Editor {
  let canvas = document.createElement("canvas");
  let ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  let editor: Editor = {
    brushSize: signal(settings.defaultBrushSize),
    fontSize: signal(settings.defaultFontSize),
    color: signal(settings.defaultColor),
    tool: signal({ type: "paint" }),
    background: params.background ?? [],
    commands: [],
    undos: [],
    resolution: window.devicePixelRatio,
    cursor: undefined,
    canvas,
    ctx,
  };

  let { width, height } = settings;
  editor.canvas.width = width * editor.resolution;
  editor.canvas.height = height * editor.resolution;
  editor.canvas.style.width = `${width}px`;
  editor.canvas.style.height = `${height}px`;

  render(editor);

  return editor;
}

export function setTool(editor: Editor, tool: Tool) {
  editor.tool.value = tool;
  render(editor);
}

export function setColor(editor: Editor, color: string) {
  editor.color.value = color;
  render(editor);
}

export function setBrushSize(editor: Editor, size: number) {
  editor.brushSize.value = size;
  render(editor);
}

export function setFontSize(editor: Editor, size: number) {
  editor.fontSize.value = size;
  render(editor);
}

function commit(editor: Editor, command: DrawCommand): void {
  editor.commands.push(command);
  editor.undos = [];
}

function undo(editor: Editor): void {
  let command = editor.commands.pop();

  if (command) {
    editor.undos.push(command);
  }
}

function redo(editor: Editor): void {
  let command = editor.undos.pop();

  if (command) {
    editor.commands.push(command);
  }
}

export function mount(editor: Editor, element: HTMLElement) {
  function handler(rawEvent: Event) {
    let event = toEditorEvent(editor, rawEvent);

    if (event) {
      dispatch(editor, event);
    }
  }

  render(editor);

  addEventListeners(editor, handler);
  element.append(editor.canvas);

  return () => {
    removeEventListeners(editor, handler);
    editor.canvas.remove();
  };
}

function addEventListeners(editor: Editor, handler: (event: Event) => void) {
  editor.canvas.addEventListener("pointerdown", handler);
  window.addEventListener("pointermove", handler);
  window.addEventListener("pointerup", handler);
  window.addEventListener("keydown", handler);
  window.addEventListener("keyup", handler);
}

function removeEventListeners(editor: Editor, handler: (event: Event) => void) {
  editor.canvas.removeEventListener("pointerdown", handler);
  window.removeEventListener("pointermove", handler);
  window.removeEventListener("pointerup", handler);
  window.removeEventListener("keydown", handler);
  window.removeEventListener("keyup", handler);
}

type EditorEvent =
  | { type: "pointerdown"; point: Point; pixel: Point; original: PointerEvent }
  | { type: "pointermove"; point: Point; pixel: Point; original: PointerEvent }
  | { type: "pointerup"; point: Point; pixel: Point; original: PointerEvent }
  | { type: "keydown"; key: string; original: KeyboardEvent }
  | { type: "keyup"; key: string; original: KeyboardEvent };

function toEditorEvent(editor: Editor, event: Event): EditorEvent | undefined {
  if (event instanceof PointerEvent) {
    let resolution = editor.resolution;
    let point = screenToEditor(editor, event.clientX, event.clientY);
    let pixel = { x: point.x * resolution, y: point.y * resolution };

    if (event.type === "pointerdown")
      return { type: "pointerdown", point, pixel, original: event };
    if (event.type === "pointerup")
      return { type: "pointerup", point, pixel, original: event };
    if (event.type === "pointermove")
      return { type: "pointermove", point, pixel, original: event };
  }

  if (event instanceof KeyboardEvent) {
    if (event.type === "keydown")
      return { type: "keydown", key: event.key, original: event };
    if (event.type === "keyup")
      return { type: "keyup", key: event.key, original: event };
  }
}

function screenToEditor(editor: Editor, x: number, y: number): Point {
  let rect = editor.canvas.getBoundingClientRect();
  return {
    x: Math.floor(x - rect.x),
    y: Math.floor(y - rect.y),
  };
}

function dispatch(editor: Editor, event: EditorEvent) {
  let tool = editor.tool.value;

  if (
    event.type === "pointermove" ||
    event.type === "pointerdown" ||
    event.type === "pointerup"
  ) {
    editor.cursor = event.point;
  }

  if (event.type === "keydown" && event.key === "t") {
    setTool(editor, { type: "text", text: "" });
  }

  if (event.type === "keydown" && (event.key === "p" || event.key === "b")) {
    setTool(editor, { type: "paint" });
  }

  if (event.type === "keydown" && event.key === "e") {
    setTool(editor, { type: "erase" });
  }

  if (event.type === "keydown" && event.key === "f") {
    setTool(editor, { type: "fill" });
  }

  if (event.type === "keydown" && event.key === "h") {
    setTool(editor, { type: "hide" });
  }

  if (event.type === "keydown" && event.key === "i") {
    setTool(editor, { type: "eyedropper" });
  }

  if (event.type === "keydown" && isUndoShortcut(event.original)) {
    event.original.preventDefault();
    undo(editor);
  }

  if (event.type === "keydown" && isRedoShortcut(event.original)) {
    event.original.preventDefault();
    redo(editor);
  }

  if (event.type === "keydown" && isSizeShortcut(event.original)) {
    let index = parseInt(event.key);

    if (tool.type === "text") {
      let fontSize = settings.fontSizes[index];
      if (fontSize) setFontSize(editor, fontSize);
    } else {
      let brushSize = settings.brushSizes[index];
      if (brushSize) setBrushSize(editor, brushSize);
    }
  }

  if (tool.type === "paint") {
    if (event.type === "pointerdown" && event.original.altKey) {
      let color = sampleColor(editor.ctx, event.pixel);
      setColor(editor, color);
    } else if (event.type === "pointerdown" && tool.points === undefined) {
      tool.points = [event.point];
    } else if (event.type === "pointermove" && tool.points) {
      tool.points.push(event.point);
    } else if (event.type === "pointerup" && tool.points) {
      let command = paint({
        size: editor.brushSize.value,
        color: editor.color.value,
        points: tool.points,
      });
      commit(editor, command);
      tool.points = undefined;
    } else if (event.type === "keydown" && event.key === "Escape") {
      tool.points = undefined;
    }
  }

  if (tool.type === "erase") {
    if (event.type === "pointerdown" && tool.points === undefined) {
      tool.points = [event.point];
    } else if (event.type === "pointermove" && tool.points) {
      tool.points.push(event.point);
    } else if (event.type === "pointerup" && tool.points) {
      let command = erase({
        size: editor.brushSize.value,
        points: tool.points,
      });
      commit(editor, command);
      tool.points = undefined;
    } else if (event.type === "keydown" && event.key === "Escape") {
      tool.points = [];
    }
  }

  if (tool.type === "hide") {
    if (event.type === "pointerdown" && tool.start === undefined) {
      tool.start = tool.end = event.point;
    } else if (event.type === "pointermove" && tool.start) {
      tool.end = event.point;
    } else if (event.type === "pointerup" && tool.start && tool.end) {
      let command = hide({ start: tool.start, end: tool.end });
      let { w, h } = command.rectangle;
      if (w * h > 20) commit(editor, command);
      tool.start = tool.end = undefined;
    } else if (event.type === "keydown" && event.key === "Escape") {
      tool.start = tool.end = undefined;
    }
  }

  if (tool.type === "text") {
    if (event.type === "pointerdown" && tool.text.length === 0) {
      let text = prompt("Insert text...")?.trim();
      if (text) tool.text = text;
    } else if (
      event.type === "pointerdown" &&
      tool.text.length > 0 &&
      editor.cursor
    ) {
      let command = write({
        text: tool.text,
        size: editor.fontSize.value,
        color: editor.color.value,
        point: editor.cursor,
      });
      commit(editor, command);
      tool.text = "";
    } else if (event.type === "keydown" && event.key === "Escape") {
      tool.text = "";
    }
  }

  if (tool.type === "eyedropper") {
    if (event.type === "pointerup") {
      let color = sampleColor(editor.ctx, event.pixel);
      setColor(editor, color);
    }
  }

  if (tool.type === "fill") {
    if (event.type === "pointerup" && event.original.target === editor.canvas) {
      let command = fill({ point: event.point, color: editor.color.value });
      commit(editor, command);
    }
  }

  render(editor);
}

function isUndoShortcut(event: KeyboardEvent): boolean {
  return (
    // MacOS
    (event.metaKey && !event.shiftKey && event.key === "z") ||
    // Windows/Linux
    (event.ctrlKey && !event.shiftKey && event.key === "z")
  );
}

function isRedoShortcut(event: KeyboardEvent): boolean {
  return (
    // MacOS
    (event.metaKey && event.shiftKey && event.key === "z") ||
    // Windows/Linux
    (event.ctrlKey && event.shiftKey && event.key === "z") ||
    (event.ctrlKey && event.key === "y")
  );
}

function isSizeShortcut(event: KeyboardEvent): boolean {
  return (
    !event.metaKey && !event.ctrlKey && event.key >= "0" && event.key <= "9"
  );
}

function paint(params: {
  size: number;
  color: string;
  points: Point[];
}): PaintCommand {
  return {
    type: "paint",
    color: params.color,
    size: params.size,
    path: pointsToSmoothPath(params.points),
  };
}

function erase(params: { size: number; points: Point[] }): EraseCommand {
  return {
    type: "erase",
    size: params.size,
    path: pointsToSmoothPath(params.points),
  };
}

function fill(params: { color: string; point: Point }): FillCommand {
  return {
    type: "fill",
    color: params.color,
    point: params.point,
  };
}

function write(params: {
  text: string;
  size: number;
  color: string;
  point: Point;
}): TextCommand {
  return {
    type: "text",
    size: params.size,
    text: params.text,
    color: params.color,
    point: params.point,
  };
}

function hide(params: { start: Point; end: Point }): HideCommand {
  let { start, end } = params;
  let x0 = Math.min(start.x, end.x);
  let y0 = Math.min(start.y, end.y);
  let x1 = Math.max(start.x, end.x);
  let y1 = Math.max(start.y, end.y);
  let rectangle: Rectangle = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };

  return {
    type: "hide",
    rectangle,
  };
}

function render(editor: Editor) {
  let { canvas, ctx } = editor;
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(editor.resolution, editor.resolution);
  let commands = [...editor.background, ...editor.commands];
  renderDrawCommands(editor, commands);
  renderToolPreview(editor);
  ctx.restore();
}

let renderCache = new Map<number, ImageData>();

function renderDrawCommands(editor: Editor, commands: DrawCommand[]): void {
  let { ctx } = editor;
  let hash = hashString(JSON.stringify(commands));
  let imageData = renderCache.get(hash);

  if (imageData) {
    ctx.putImageData(imageData, 0, 0);
    return;
  }

  for (let command of commands) {
    renderDrawCommand(editor, command);
  }

  imageData = ctx.getImageData(0, 0, editor.canvas.width, editor.canvas.height);
  renderCache.set(hash, imageData);
}

function renderDrawCommand(editor: Editor, command: DrawCommand): void {
  let { ctx } = editor;

  ctx.save();

  if (command.type === "paint") {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = command.size;
    ctx.strokeStyle = command.color;
    ctx.stroke(new Path2D(command.path));
  } else if (command.type === "erase") {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = command.size;
    ctx.globalCompositeOperation = "destination-out";
    ctx.stroke(new Path2D(command.path));
  } else if (command.type === "text") {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = command.color;
    ctx.font = `${command.size}px ${settings.fontFamily}`;
    ctx.fillText(command.text, command.point.x, command.point.y);
  } else if (command.type === "hide") {
    renderHider(ctx, command.rectangle);
  } else if (command.type === "fill") {
    let x = Math.floor(command.point.x * editor.resolution);
    let y = Math.floor(command.point.y * editor.resolution);
    floodfill(ctx, { x, y }, command.color);
  }

  ctx.restore();
}

function renderHider(
  ctx: CanvasRenderingContext2D,
  rectangle: Rectangle,
): void {
  let { x, y, w, h } = rectangle;

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 4);

  // Hide the content below
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "#fff";
  ctx.fill();

  // Render hatch pattern above
  ctx.globalCompositeOperation = "source-over";
  ctx.font = `20px ${settings.fontFamily}`;
  ctx.fillStyle = Patterns.hatch;
  ctx.fill();

  // Render white border
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#fff";
  ctx.stroke();

  // Render dotted border
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = "#ddd";
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ccc";
  ctx.fillText("HIDDEN", x + w / 2, y + h / 2);
}

let Patterns = {
  hatch: createPattern({
    width: 8,
    height: 8,
    color: "#eee",
    path: new Path2D(`
      M -8 0 0 8
      M 0 0 8 8
      M 8 0 16 8
    `),
  }),
};

function createPattern({
  width,
  height,
  color,
  path,
  strokeWidth = 2,
  lineCap = "square",
  lineJoin = "round",
}: {
  width: number;
  height: number;
  color: string;
  strokeWidth?: number;
  lineCap?: CanvasLineCap;
  lineJoin?: CanvasLineJoin;
  path: Path2D;
}): CanvasPattern {
  let canvas = document.createElement("canvas");
  let ctx = canvas.getContext("2d")!;
  canvas.width = width;
  canvas.height = height;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = lineCap;
  ctx.lineJoin = lineJoin;
  ctx.strokeStyle = color;
  ctx.stroke(path);
  return ctx.createPattern(canvas, "repeat")!;
}

function renderToolPreview(editor: Editor): void {
  let tool = editor.tool.value;
  let ctx = editor.ctx;
  let command = getPreviewCommand(editor);

  if (command) {
    renderDrawCommand(editor, command);
  }

  if (!editor.cursor) {
    return;
  }

  if (tool.type === "paint" || tool.type === "erase") {
    renderCursor(ctx, Paths.circle, editor.cursor, editor.brushSize.value);
  } else if (tool.type === "fill" || tool.type === "hide") {
    renderCursor(ctx, Paths.crosshair, editor.cursor, 20);
  } else if (tool.type === "text" && tool.text.length === 0) {
    renderCursor(ctx, Paths.caret, editor.cursor, editor.fontSize.value);
  } else if (tool.type === "eyedropper") {
    renderCursor(ctx, Paths.target, editor.cursor, 20);
  }
}

let Paths = {
  circle: new Path2D(`
    M 0.5 0
    A 0.5 0.5 0 1 0 -0.5 0
    A 0.5 0.5 0 1 0 0.5 0
  `),
  crosshair: new Path2D(`
    M 0 -0.5 0 0.5
    M -0.5 0 0.5 0
  `),
  caret: new Path2D(`
    M -0.2 -0.5 0.2 -0.5
    M 0 -0.5 0 0.5
    M -0.2 0.5 0.2 0.5
  `),
  target: new Path2D(`
    M 0.2 0
    A 0.2 0.2 0 1 0 -0.2 0
    A 0.2 0.2 0 1 0 0.2 0
    M 0 -0.5 0 -0.25
    M 0 0.25 0 0.5
    M -0.5 0 -0.25 0
    M 0.25 0 0.5 0
  `),
};

function renderCursor(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  point: Point,
  scale: number,
): void {
  ctx.save();

  ctx.translate(point.x, point.y);
  ctx.scale(scale, scale);

  ctx.strokeStyle = "white";
  ctx.lineWidth = 2 / scale;
  ctx.stroke(path);

  ctx.strokeStyle = "black";
  ctx.lineWidth = 1 / scale;
  ctx.stroke(path);

  ctx.restore();
}

function getPreviewCommand(editor: Editor): DrawCommand | undefined {
  let tool = editor.tool.value;

  if (tool.type === "paint" && tool.points) {
    return paint({
      size: editor.brushSize.value,
      color: editor.color.value,
      points: tool.points,
    });
  } else if (tool.type === "erase" && tool.points) {
    return erase({
      size: editor.brushSize.value,
      points: tool.points,
    });
  } else if (tool.type === "text" && tool.text && editor.cursor) {
    return write({
      size: editor.fontSize.value,
      color: editor.color.value,
      point: editor.cursor,
      text: tool.text,
    });
  } else if (tool.type === "hide" && tool.start && tool.end) {
    return hide({
      start: tool.start,
      end: tool.end,
    });
  }
}
