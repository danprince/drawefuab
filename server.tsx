import { serve, type ServerWebSocket } from "bun";
import settings from "./settings.json";
import index from "./index.html";
import type { DrawingCommand } from "./editor";
import { assert, shuffle, toggle, type Rectangle } from "./utils";

export type Player = {
  clientId: string;
  name: string;
  connected: boolean;
};

export type Drawing = {
  steps: DrawingStep[];
};

export type DrawingStep = {
  clientId: string;
  commands: DrawingCommand[];
};

export type Settings = {
  rounds: number;
  width: number;
  height: number;
};

export type Phase =
  | { type: "lobby" }
  | {
      type: "draw";
      round: number;
      readyClientIds: string[];
    }
  | { type: "reveal"; step: number };

export type Game = {
  phase: Phase;
  settings: Settings;
  players: Player[];
  drawings: Drawing[];
  ordering: string[];
  /**
   * Players that joined whilst a game was in progress.
   */
  playerQueue: Player[];
};

export type Action =
  | { type: "start" }
  | { type: "unready" }
  | { type: "submit"; commands: string }
  | { type: "rename"; name: string }
  | { type: "settings"; settings: Settings }
  | { type: "reveal"; step: string }
  | { type: "finish" };

type WebSocketData = {
  clientId: string;
};

let game: Game = {
  phase: { type: "lobby" },
  settings: {
    rounds: settings.rounds,
    width: settings.width,
    height: settings.height,
  },
  players: [],
  playerQueue: [],
  drawings: [],
  ordering: [],
};

function randomName() {
  let { adjectives, animals } = settings.names;
  let adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  let animal = animals[Math.floor(Math.random() * animals.length)];
  return `${adjective} ${animal}`;
}

function findPlayerByClientId(
  game: Game,
  clientId: string,
): Player | undefined {
  return game.players.find((player) => player.clientId === clientId);
}

function getCurrentDrawing(game: Game, player: Player): Drawing | undefined {
  if (game.phase.type === "draw") {
    let index = game.ordering.indexOf(player.clientId) + game.phase.round;
    return game.drawings[index % game.drawings.length];
  }
}

function connect(game: Game, clientId: string): void {
  let player = findPlayerByClientId(game, clientId);

  if (!player) {
    player = {
      clientId,
      name: randomName(),
      connected: true,
    };

    if (game.phase.type === "lobby") {
      game.players.push(player);
    } else {
      game.playerQueue.push(player);
    }
  }

  sync(game);
}

function disconnect(game: Game, clientId: string): void {
  let player = findPlayerByClientId(game, clientId);

  if (!player) {
    return;
  }

  if (game.phase.type === "lobby") {
    game.players = game.players.filter((other) => other !== player);
  } else {
    player.connected = false;
  }

  sync(game);
}

function update(game: Game, player: Player, action: Action): void {
  if (action.type === "settings") {
    assert(game.phase.type === "lobby", "must be in lobby to change settings");
    game.settings = action.settings;
  }

  if (action.type === "rename") {
    assert(game.phase.type === "lobby", "must be in lobby to change name");
    player.name = action.name.trim();
  }

  if (action.type === "start") {
    assert(game.phase.type === "lobby", "must be in the lobby to start");
    assert(game.players.length >= 1, "must have at least one player");

    game.ordering = shuffle(game.players).map((player) => player.clientId);
    game.drawings = game.players.map(() => ({ steps: [] }));
    game.phase = { type: "draw", round: 0, readyClientIds: [] };
  }

  if (action.type === "unready") {
    assert(game.phase.type === "draw", "must be drawing to unready");

    game.phase.readyClientIds = toggle(
      game.phase.readyClientIds,
      player.clientId,
    );
  }

  if (action.type === "submit") {
    assert(game.phase.type === "draw", "must be drawing to submit");

    let commands = JSON.parse(action.commands);

    let drawing = getCurrentDrawing(game, player);
    assert(drawing);

    let step = (drawing.steps[game.phase.round] ??= {
      clientId: player.clientId,
      commands: [],
    });
    step.commands = commands;

    game.phase.readyClientIds = toggle(
      game.phase.readyClientIds,
      player.clientId,
    );

    if (isEveryPlayerReady(game)) {
      if (isFinalRound(game)) {
        game.phase = { type: "reveal", step: 0 };
      } else {
        game.phase = {
          type: "draw",
          round: game.phase.round + 1,
          readyClientIds: [],
        };
      }
    }
  }

  if (action.type === "reveal") {
    assert(game.phase.type === "reveal");

    let step = parseInt(action.step);
    assert(step >= 0);
    assert(step < game.drawings.length);
    game.phase.step = step;
  }

  if (action.type === "finish") {
    assert(game.phase.type === "reveal");
    game.phase = { type: "lobby" };
    game.players.push(...game.playerQueue);
    game.playerQueue = [];
  }
}

function isFinalRound(game: Game): boolean {
  return (
    game.phase.type === "draw" && game.phase.round === game.settings.rounds - 1
  );
}

function isEveryPlayerReady(game: Game): boolean {
  return (
    game.phase.type === "draw" &&
    game.phase.readyClientIds.length === game.ordering.length
  );
}

function sync(game: Game) {
  for (let player of game.players) {
    let socket = sockets.get(player.clientId);
    let html = render(game, player).toString();
    socket?.send(html);
  }
}

function render(game: Game, player: Player): JSX.Element {
  switch (game.phase.type) {
    case "lobby":
      return <Lobby game={game} player={player} />;
    case "draw":
      return <Draw game={game} player={player} />;
    case "reveal":
      return <Reveal game={game} player={player} />;
  }
}

function Lobby({ game, player }: { game: Game; player: Player }) {
  return (
    <div class="text-center">
      <h1>Drawefuab</h1>

      <h3>
        <span class="icon icon-player inline-icon" />
        {game.players.length} {game.players.length === 1 ? "player" : "players"}
      </h3>

      <form>
        <input type="hidden" name="type" value="start" />

        <button class="button">
          <span class="icon icon-lets-go" />
        </button>
      </form>
    </div>
  );
}

function Draw({ game, player }: { game: Game; player: Player }) {
  assert(game.phase.type === "draw");

  if (!game.players.includes(player)) {
    return <Queued />;
  }

  let currentDrawing = getCurrentDrawing(game, player);

  if (!currentDrawing) {
    return null;
  }

  let commands = currentDrawing.steps.flatMap((step) => step.commands);

  let totalPlayers = game.players.length;
  let readyPlayers = game.phase.readyClientIds.length;
  let isReady = game.phase.readyClientIds.includes(player.clientId);

  return (
    <div>
      <p class="flex space-between">
        <span>
          Round {game.phase.round + 1} / {game.settings.rounds}
        </span>

        <span>
          ({readyPlayers}/{totalPlayers} ready)
        </span>
      </p>

      <form>
        <input type="hidden" name="type" value="submit" />

        <drawing-editor
          id={game.phase.round}
          mode="draw"
          width={game.settings.width.toString()}
          height={game.settings.height.toString()}
          commands={JSON.stringify(commands)}
          data-skip-morph
        ></drawing-editor>
        <div class="flex space-between">
          <div class="flex">
            <input type="color" data-event="set-color" />
          </div>
          <div class="flex">
            <button class="button" data-event="set-tool" data-tool="pen">
              <span class="icon icon-pen"></span>
            </button>
            <button class="button" data-event="set-tool" data-tool="eraser">
              <span class="icon icon-eraser"></span>
            </button>
            <button class="button" data-event="set-tool" data-tool="fill">
              <span class="icon icon-fill"></span>
            </button>
            <button class="button" data-event="set-tool" data-tool="text">
              <span class="icon icon-text"></span>
            </button>
            <button class="button" data-event="set-tool" data-tool="cover">
              <span class="icon icon-cover"></span>
            </button>
          </div>
          <div class="flex">
            <button class="button">
              <span
                class={isReady ? "icon icon-not-done" : "icon icon-im-done"}
              />
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Queued() {
  return <div>You will join for the next game...</div>;
}

function Reveal({ game, player }: { game: Game; player: Player }) {
  assert(game.phase.type === "reveal");

  let drawing = game.drawings[game.phase.step]!;
  let commands = drawing.steps.flatMap((step) => step.commands);

  return (
    <>
      <drawing-editor
        mode="view"
        width={game.settings.width.toString()}
        height={game.settings.height.toString()}
        commands={JSON.stringify(commands)}
      ></drawing-editor>

      <div class="flex space-between">
        <form>
          <input type="hidden" name="type" value="reveal" />
          <input
            type="hidden"
            name="step"
            value={String(game.phase.step - 1)}
          />
          <button class="button" disabled={game.phase.step - 1 < 0}>
            <span class="icon icon-prev" />
          </button>
        </form>

        <form>
          <input type="hidden" name="type" value="finish" />
          <button class="button">
            <span class="icon icon-new-game" />
          </button>
        </form>

        <form>
          <input type="hidden" name="type" value="reveal" />
          <input
            type="hidden"
            name="step"
            value={String(game.phase.step + 1)}
          />
          <button
            class="button"
            disabled={game.phase.step + 1 >= game.drawings.length}
          >
            <span class="icon icon-next" />
          </button>
        </form>
      </div>
    </>
  );
}

let sockets = new Map<string, ServerWebSocket<WebSocketData>>();

let server = serve({
  routes: {
    "/": index,
  },

  websocket: {
    data: {} as WebSocketData,

    async open(ws) {
      sockets.set(ws.data.clientId, ws);
      connect(game, ws.data.clientId);
    },

    close(ws) {
      sockets.delete(ws.data.clientId);
      disconnect(game, ws.data.clientId);
    },

    async message(ws, message) {
      let action = JSON.parse(message.toString()) as Action;
      let player = findPlayerByClientId(game, ws.data.clientId);

      if (player) {
        update(game, player, action);
        sync(game);
      }
    },
  },

  fetch(req, server) {
    let clientId = new URL(req.url).searchParams.get("client");

    if (!clientId) {
      return new Response(
        "Websocket upgrade request must include a client parameter!",
        { status: 400 },
      );
    }

    let success = server.upgrade(req, { data: { clientId } });

    if (success) {
      return undefined;
    }

    return new Response();
  },
});

console.log(`Listening on http://${server.hostname}:${server.port}`);
