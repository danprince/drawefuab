import { signal } from "@preact/signals";
import type {
  ClientUpdate,
  ClientDrawState,
  ClientLobbyState,
  ClientMessage,
  ClientQueueState,
  ClientRevealState,
  ClientState,
} from "./server";
import { render, type SVGAttributes } from "preact";
import { useEffect, useMemo, useRef } from "preact/hooks";
import {
  createEditor,
  mount,
  setColor,
  setTool,
  type Editor,
  type Tool,
} from "./editor";

let clientId = getClientId();
let clientState = signal<ClientState>({ type: "queue", players: 0 });

let socket = new WebSocket(`?client=${clientId}`);

socket.onmessage = (event) => {
  let update = JSON.parse(event.data) as ClientUpdate;

  if (update.type === "error") {
    console.error(update.error);
  } else if (update.type === "state") {
    clientState.value = update.state;
  }
};

function getClientId(): string {
  let clientId = localStorage.getItem("client-id") ?? crypto.randomUUID();
  localStorage.setItem("client-id", clientId);
  return clientId;
}

function send(message: ClientMessage): void {
  socket.send(JSON.stringify(message));
}

let iconSpritesUrl = require("./icons.svg");

function Icon({
  name,
  width = 40,
  height = width,
  ...props
}: { name: string } & SVGAttributes<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      class="icon"
      fill="none"
      width={width}
      height={height}
      {...props}
    >
      <use href={`${iconSpritesUrl}#${name}`} />
    </svg>
  );
}

function App() {
  let state = clientState.value;

  if (state.type === "queue") {
    return <Queue state={state} />;
  }

  if (state.type === "lobby") {
    return <Lobby state={state} />;
  }

  if (state.type === "draw") {
    return <Draw state={state} />;
  }

  if (state.type === "reveal") {
    return <Reveal state={state} />;
  }
}

function Queue({ state }: { state: ClientQueueState }) {
  return (
    <>
      <h1>Drawefuab</h1>
      <div>
        <Icon name="player" />
        {state.players} players
      </div>
      <div>Game in progress</div>
    </>
  );
}

function Lobby({ state }: { state: ClientLobbyState }) {
  return (
    <>
      <h1 class="title">Drawefuab</h1>

      <p>
        <Icon width="32" name="player" />
        {state.players} players
      </p>

      <button onClick={() => send({ type: "start" })}>
        <Icon width={64} name="lets-go" />
      </button>
    </>
  );
}

function Draw({ state }: { state: ClientDrawState }) {
  let editor = useMemo(
    () => createEditor({ background: state.commands }),
    [state.turn],
  );

  function ready() {
    send({ type: "submit", commands: editor.commands });
  }

  function unready() {
    send({ type: "unsubmit" });
  }

  function selectTool(newTool: Tool) {
    if (editor.tool.value.type !== newTool.type) {
      setTool(editor, newTool);
    }
  }

  let tool = editor.tool.value;

  return (
    <>
      <header>
        <span>
          Turn {state.turn + 1}/{state.turns}
        </span>
        <span class="grow" />
        <span>
          Ready {state.readyCount}/{state.playerCount}
        </span>
      </header>

      <Canvas editor={editor} />

      <footer>
        <ColorPicker editor={editor} />

        <div class="grow"></div>

        <button
          aria-pressed={tool.type === "paint"}
          onClick={() => selectTool({ type: "paint" })}
        >
          <Icon name="pen" />
        </button>

        <button
          aria-pressed={tool.type === "erase"}
          onClick={() => selectTool({ type: "erase" })}
        >
          <Icon name="eraser" />
        </button>

        <button
          aria-pressed={tool.type === "fill"}
          onClick={() => selectTool({ type: "fill" })}
        >
          <Icon name="fill" />
        </button>

        <button
          aria-pressed={tool.type === "text"}
          onClick={() => selectTool({ type: "text", text: "" })}
        >
          <Icon name="text" />
        </button>

        <button
          aria-pressed={tool.type === "hide"}
          onClick={() => selectTool({ type: "hide" })}
        >
          <Icon name="cover" />
        </button>

        <div class="grow"></div>

        {state.ready ? (
          <button onClick={() => unready()}>
            <Icon name="not-done" />
          </button>
        ) : (
          <button onClick={() => ready()}>
            <Icon name="im-done" />
          </button>
        )}
      </footer>
    </>
  );
}

function ColorPicker({ editor }: { editor: Editor }) {
  return (
    <label style={{ display: "inline-block" }}>
      <input
        type="color"
        value={editor.color.value}
        style={{ visibility: "hidden", width: 0, padding: 0, height: 40 }}
        onInput={(event) =>
          setColor(editor, (event.target as HTMLInputElement).value)
        }
      />
      <Icon name="blob" fill={editor.color.value} />
    </label>
  );
}

function Reveal({ state }: { state: ClientRevealState }) {
  let editor = useMemo(
    () => createEditor({ background: state.commands }),
    [state.step],
  );

  return (
    <>
      <header>
        {state.step + 1} / {state.steps}
      </header>

      <Canvas editor={editor} />

      <footer>
        <button
          disabled={state.step <= 0}
          onClick={() => send({ type: "reveal", step: state.step - 1 })}
        >
          <Icon name="arrow-left" />
        </button>

        <div class="grow" />

        <button onClick={() => send({ type: "finish" })}>
          <Icon name="new-game" />
        </button>

        <div class="grow" />

        <button
          disabled={state.step >= state.steps - 1}
          onClick={() => send({ type: "reveal", step: state.step + 1 })}
        >
          <Icon name="arrow-right" />
        </button>
      </footer>
    </>
  );
}

function Canvas({ editor }: { editor: Editor }) {
  let containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      return mount(editor, containerRef.current);
    }
  }, [editor]);

  return <div ref={containerRef} />;
}

render(<App />, document.getElementById("app")!);
