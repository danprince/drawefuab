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
import { render } from "preact";

/**
 * A persistent client ID that uniquely identifies this client.
 */
let clientId = localStorage.getItem("client-id") ?? crypto.randomUUID();
localStorage.setItem("client-id", clientId);

let socket = new WebSocket(`?client=${clientId}`);

let clientState = signal<ClientState>({ type: "queue", players: 0 });

socket.onmessage = (event) => {
  let update = JSON.parse(event.data) as ClientUpdate;

  if (update.type === "error") {
    console.error(update.error);
  } else if (update.type === "state") {
    clientState.value = update.state;
  }
};

function send(message: ClientMessage): void {
  socket.send(JSON.stringify(message));
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

  return state;
}

function Queue({ state }: { state: ClientQueueState }) {
  return <div>Game in progress with {state.players} players.</div>;
}

function Lobby({ state }: { state: ClientLobbyState }) {
  return (
    <div>
      {state.players} players
      <button onClick={() => send({ type: "start" })}>Let's go</button>
    </div>
  );
}

function Draw({ state }: { state: ClientDrawState }) {
  return (
    <div>
      <header>
        <div>
          Round {state.round + 1}/{state.rounds}
        </div>
        <div>
          {state.readyCount}/{state.playerCount} ready
        </div>
      </header>
      Editor goes here
      <button onClick={() => send({ type: "ready" })}>Ready</button>
    </div>
  );
}

function Reveal({ state }: { state: ClientRevealState }) {
  return (
    <div>
      <header>
        {state.step + 1} / {state.steps}
      </header>
      Reveal goes here
      <footer>
        <button
          disabled={state.step > 0}
          onClick={() => send({ type: "reveal", step: state.step - 1 })}
        >
          Prev
        </button>
        <button onClick={() => send({ type: "finish" })}>New game</button>
        <button
          disabled={state.step >= state.steps - 1}
          onClick={() => send({ type: "reveal", step: state.step + 1 })}
        >
          Next
        </button>
      </footer>
    </div>
  );
}

render(<App />, document.getElementById("app")!);
