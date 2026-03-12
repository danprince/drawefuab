import settings from "./settings.json";
import {
  createCanvasPattern,
  floodfill,
  pointsToSmoothPath,
  rgbaToHex,
  sampleRgbaAtPoint,
  type Rectangle,
} from "./utils";
import hiddenSvg from "./assets/hidden.svg";

export type DrawingCommand =
  | {
      type: "pen";
      color: string;
      size: number;
      opacity: number;
      d: string;
      blend?: GlobalCompositeOperation;
    }
  | { type: "eraser"; size: number; d: string }
  | { type: "cover"; x: number; y: number; w: number; h: number }
  | { type: "fill"; color: string; opacity: number; x: number; y: number }
  | {
      type: "text";
      text: string;
      x: number;
      y: number;
      color: string;
      fontSize: number;
    };

type Point = { x: number; y: number };

type PenTool = {
  type: "pen";
  points: Point[];
  blend?: GlobalCompositeOperation;
};
type EraserTool = { type: "eraser"; points: Point[] };
type FillTool = { type: "fill" };
type TextTool = { type: "text"; text: string };
type CoverTool = { type: "cover"; start?: Point; end?: Point };
type Tool = PenTool | EraserTool | FillTool | TextTool | CoverTool;
type EditorMode = "draw" | "view";

type EditorConfig = {
  mode?: EditorMode;
  commands?: DrawingCommand[];
};

class Editor {
  mode: EditorMode = "draw";
  resolution: number = window.devicePixelRatio;
  color: string = settings.defaultColor;
  size: number = settings.defaultBrushSize;
  fontSize: number = settings.defaultFontSize;
  opacity: number = settings.defaultOpacity;
  tool: Tool = { type: "pen", points: [] };
  commands: DrawingCommand[] = [];
  lockIndex: number = 0;
  undos: DrawingCommand[] = [];
  cursor: Point = { x: 0, y: 0 };
  container: HTMLDivElement = document.createElement("div");
  input: HTMLInputElement = document.createElement("input");
  canvas: HTMLCanvasElement = document.createElement("canvas");
  ctx: CanvasRenderingContext2D = this.canvas.getContext("2d", {
    willReadFrequently: true,
  })!;

  constructor(config: EditorConfig = {}) {
    this.mode = config.mode ?? this.mode;
    this.commands = config.commands ?? this.commands;
    this.lockIndex = this.commands.length;

    this.input.type = "hidden";
    this.input.name = "commands";

    this.container.append(this.input, this.canvas);

    this.sync();
    this.refresh();
  }

  setTool(tool: Tool) {
    this.tool = tool;
    this.refresh();

    document
      .querySelectorAll(`[data-tool]`)
      .forEach((element) => element.removeAttribute("aria-pressed"));

    document
      .querySelectorAll(`[data-tool=${tool.type}]`)
      .forEach((element) => element.setAttribute("aria-pressed", ""));
  }

  setColor(color: string) {
    this.color = color;
    this.refresh();
  }

  resize(width: number, height: number): void {
    this.canvas.width = width * this.resolution;
    this.canvas.height = height * this.resolution;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.refresh();
  }

  addEventListeners() {
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("keydown", this.onKeyDown);
  }

  removeEventListeners() {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("keydown", this.onKeyDown);
  }

  undo() {
    if (this.commands.length <= this.lockIndex) {
      return;
    }

    let command = this.commands.pop();

    if (command) {
      this.undos.push(command);
      this.sync();
    }

    this.refresh();
  }

  redo() {
    let command = this.undos.pop();

    if (command) {
      this.commands.push(command);
      this.sync();
    }

    this.refresh();
  }

  private sync() {
    let json = JSON.stringify(this.commands);
    this.input.value = json;
  }

  private commit(command: DrawingCommand): void {
    this.undos = [];
    this.commands.push(command);
    this.sync();
    this.refresh();
  }

  private onPointerDown = (event: PointerEvent) => {
    if (this.mode === "view") return;

    let rect = this.canvas.getBoundingClientRect();
    let x = event.clientX - rect.x;
    let y = event.clientY - rect.y;
    this.cursor.x = x;
    this.cursor.y = y;

    if (event.altKey) {
      let point = {
        x: Math.floor(x * this.resolution),
        y: Math.floor(y * this.resolution),
      };
      let { r, g, b, a } = sampleRgbaAtPoint(this.ctx, point);
      this.color = `rgb(${r}, ${g}, ${b})`;
      this.opacity = a / 255;
      document
        .querySelectorAll(`input[type=color][data-event=set-color]`)
        .forEach((input) => {
          (input as HTMLInputElement).value = rgbaToHex({ r, g, b, a });
        });
    } else if (this.tool.type === "pen") {
      this.tool.points = [{ x, y }];
    } else if (this.tool.type === "eraser") {
      this.tool.points = [{ x, y }];
    } else if (this.tool.type === "text") {
      let { color, fontSize } = this;
      let { text } = this.tool;
      if (text) this.commit({ type: "text", text, x, y, fontSize, color });
      this.setTool({ type: "pen", points: [] });
    } else if (this.tool.type === "cover") {
      this.tool.start = { x, y };
    }

    this.refresh();
  };

  private onPointerUp = (event: PointerEvent) => {
    if (this.mode === "view") return;

    if (this.tool.type === "pen" && this.tool.points.length > 0) {
      this.commit(this.createPenCommand(this.tool));
      this.tool.points = [];
    } else if (this.tool.type === "eraser" && this.tool.points.length > 0) {
      this.commit(this.createEraserCommand(this.tool));
      this.tool.points = [];
    } else if (this.tool.type === "cover" && this.tool.start && this.tool.end) {
      this.commit(this.createCoverCommand(this.tool));
      this.tool.start = this.tool.end = undefined;
    } else if (this.tool.type === "fill") {
      // TODO: Only fill if the color under the cursor is different
      let { color, opacity } = this;
      let { x, y } = this.cursor;
      this.commit({ type: "fill", x, y, color, opacity });
    }

    this.refresh();
  };

  private onPointerMove = (event: PointerEvent) => {
    if (this.mode === "view") return;

    let rect = this.canvas.getBoundingClientRect();
    let x = event.clientX - rect.x;
    let y = event.clientY - rect.y;
    this.cursor.x = x;
    this.cursor.y = y;

    if (this.tool.type === "pen" && this.tool.points.length >= 1) {
      this.tool.points.push({ x, y });
    } else if (this.tool.type === "eraser" && this.tool.points.length >= 1) {
      this.tool.points.push({ x, y });
    } else if (this.tool.type === "cover") {
      this.tool.end = { x, y };
    }

    this.refresh();
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    if (event.metaKey && event.shiftKey && event.key === "z") {
      this.redo();
      event.preventDefault();
    } else if (event.metaKey && event.key === "z") {
      this.undo();
      event.preventDefault();
    } else if (event.metaKey) {
      return;
    } else if (event.key === "p") {
      this.setTool({ type: "pen", points: [] });
    } else if (event.key === "e") {
      this.setTool({ type: "eraser", points: [] });
    } else if (event.key === "f") {
      this.setTool({ type: "fill" });
    } else if (event.key === "t") {
      let text = prompt("Insert some text")?.trim();
      if (text) this.setTool({ type: "text", text });
    } else if (this.tool.type === "pen" && event.key === "s") {
      this.tool.blend = this.tool.blend ? undefined : "destination-over";
      this.refresh();
    } else if (event.key >= "0" && event.key <= "9") {
      let size = parseInt(event.key) * 3;
      this.setBrushSize(size);
      this.setFontSize(size * 2);
    }
  };

  setFontSize(size: number): void {
    this.fontSize = Math.min(
      Math.max(size, settings.minFontSize),
      settings.maxFontSize,
    );
    this.refresh();
  }

  setBrushSize(size: number): void {
    this.size = Math.min(
      Math.max(size, settings.minBrushSize),
      settings.maxBrushSize,
    );
    this.refresh();
  }

  refresh() {
    this.render();
  }

  render() {
    let { ctx } = this;

    ctx.save();
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.scale(this.resolution, this.resolution);

    applyDrawingCommands(
      ctx,
      this.commands.filter((command) => {
        if (this.mode === "view" && command.type === "cover") {
          return false;
        }

        return true;
      }),
      this.resolution,
    );

    if (this.mode === "draw") {
      this.renderToolPreview();
    }

    ctx.restore();
  }

  private renderToolPreview() {
    let { ctx } = this;

    if (this.tool.type === "pen" && this.tool.points.length >= 2) {
      applyDrawCommand(ctx, this.createPenCommand(this.tool), this.resolution);
    }

    if (this.tool.type === "eraser" && this.tool.points.length >= 2) {
      applyDrawCommand(
        ctx,
        this.createEraserCommand(this.tool),
        this.resolution,
      );
    }

    if (this.tool.type === "cover" && this.tool.start && this.tool.end) {
      applyDrawCommand(
        ctx,
        this.createCoverCommand(this.tool),
        this.resolution,
      );
    }

    this.renderCrosshair();
  }

  private renderCrosshair() {
    let { ctx } = this;

    ctx.save();

    if (this.tool.type === "text") {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = this.color;
      ctx.font = `${this.fontSize}px ${settings.fontFamily}`;
      ctx.globalAlpha = 0.5;
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillText(this.tool.text, this.cursor.x, this.cursor.y);
    } else {
      ctx.beginPath();
      ctx.arc(this.cursor.x, this.cursor.y, this.size / 2, 0, Math.PI * 2);
      ctx.lineCap = "round";
      ctx.strokeStyle = "white";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = "black";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.restore();
  }

  private createPenCommand(tool: PenTool): DrawingCommand {
    return {
      type: "pen",
      color: this.color,
      opacity: this.opacity,
      size: this.size,
      d: pointsToSmoothPath(tool.points),
      blend: tool.blend,
    };
  }

  private createEraserCommand(tool: EraserTool): DrawingCommand {
    return {
      type: "eraser",
      size: this.size,
      d: pointsToSmoothPath(tool.points),
    };
  }

  private createCoverCommand(tool: CoverTool): DrawingCommand {
    let { x, y, w, h } = this.getCoverRect(tool);
    return { type: "cover", x, y, w, h };
  }

  private getCoverRect(tool: CoverTool): Rectangle {
    let { start, end } = tool;
    if (!start || !end) return { x: 0, y: 0, w: 0, h: 0 };
    let x0 = Math.min(start.x, end.x);
    let y0 = Math.min(start.y, end.y);
    let x1 = Math.max(start.x, end.x);
    let y1 = Math.max(start.y, end.y);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
}

/**
 * Calculate a quick and dirty (non cryptographically secure) hash from a string.
 */
function hashString(str: string): number {
  let len = str.length;
  let h = 5381;

  for (let i = 0; i < len; i++) {
    h = (h * 33) ^ str.charCodeAt(i);
  }

  return h >>> 0;
}

let snapshots = new Map<number, ImageData>();

function applyDrawingCommands(
  ctx: CanvasRenderingContext2D,
  commands: DrawingCommand[],
  resolution: number,
) {
  let { width, height } = ctx.canvas;
  let hash = hashString(`${width}x${height}`);

  for (let command of commands) {
    hash = hashString(hash + JSON.stringify(command));

    if (snapshots.has(hash)) {
      let snapshot = snapshots.get(hash);
      ctx.putImageData(snapshot!, 0, 0);
    } else {
      applyDrawCommand(ctx, command, resolution);
      let snapshot = ctx.getImageData(0, 0, width, height);
      snapshots.set(hash, snapshot);
    }
  }
}

function applyDrawCommand(
  ctx: CanvasRenderingContext2D,
  command: DrawingCommand,
  resolution: number,
): void {
  ctx.save();

  if (command.type === "pen") {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = command.color;
    ctx.lineWidth = command.size;
    ctx.globalAlpha = command.opacity;
    if (command.blend) ctx.globalCompositeOperation = command.blend;
    ctx.stroke(new Path2D(command.d));
  } else if (command.type === "eraser") {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = command.size;
    ctx.strokeStyle = "red";
    ctx.globalCompositeOperation = "destination-out";
    ctx.stroke(new Path2D(command.d));
  } else if (command.type === "text") {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = command.color;
    ctx.font = `${command.fontSize}px ${settings.fontFamily}`;
    ctx.fillText(command.text, command.x, command.y);
  } else if (command.type === "cover") {
    renderCover(ctx, command);
  } else if (command.type === "fill") {
    let x = Math.floor(command.x * resolution);
    let y = Math.floor(command.y * resolution);
    floodfill(ctx, { x, y }, command.color, command.opacity);
  }

  ctx.restore();
}

let hatchPattern: CanvasPattern | undefined;
createCanvasPattern(hiddenSvg).then((pattern) => (hatchPattern = pattern));

function renderCover(ctx: CanvasRenderingContext2D, rect: Rectangle) {
  ctx.save();
  ctx.beginPath();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = "#ddd";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 4);
  ctx.stroke();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  if (hatchPattern) {
    ctx.fillStyle = hatchPattern;
    ctx.fill();
  }
  ctx.font = `20px ${settings.fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ccc";
  ctx.fillText("HIDDEN", rect.x + rect.w / 2, rect.y + rect.h / 2);
  ctx.restore();
}

class DrawingEditorElement extends HTMLElement {
  editor: Editor | undefined;

  connectedCallback() {
    let width = Number(this.getAttribute("width"));
    let height = Number(this.getAttribute("height"));
    let commands = JSON.parse(this.getAttribute("commands")!);
    let mode = this.getAttribute("mode") as EditorMode;
    this.editor = new Editor({ commands, mode });
    this.editor.resize(width, height);
    this.editor.addEventListeners();
    this.append(this.editor.container);
    window.addEventListener("set-tool", this.onToolChange);
    window.addEventListener("set-color", this.onColorChange);
  }

  disconnectedCallback() {
    this.editor?.removeEventListeners();
    window.removeEventListener("set-tool", this.onToolChange);
    window.removeEventListener("set-color", this.onColorChange);
  }

  private onToolChange = (event: CustomEvent) => {
    if (!this.editor) return;

    let tool = event.detail["data-tool"];

    if (tool === "pen") {
      this.editor.setTool({ type: "pen", points: [] });
    } else if (tool === "eraser") {
      this.editor.setTool({ type: "eraser", points: [] });
    } else if (tool === "fill") {
      this.editor.setTool({ type: "fill" });
    } else if (tool === "text") {
      let text = prompt("Insert text...")?.trim();
      if (text) this.editor.setTool({ type: "text", text });
    } else if (tool === "cover") {
      this.editor.setTool({ type: "cover" });
    }
  };

  private onColorChange = (event: CustomEvent) => {
    this.editor?.setColor(event.detail.value);
  };
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      ["drawing-editor"]: HtmlTag & {
        mode: EditorMode;
        width: string;
        height: string;
        commands: string;
      };
    }
  }
}

customElements.define("drawing-editor", DrawingEditorElement);
