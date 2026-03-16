import { serve, type ServerWebSocket } from "bun";
import index from "./index.html";
import settings from "./settings.json";
import { type Result, Ok, remove, Err, shuffle, toggle, add } from "./utils";

export type Point = { x: number; y: number };

export type Rectangle = { x: number; y: number; w: number; h: number };

export type PaintCommand = {
  type: "paint";
  size: number;
  color: string;
  path: string;
};

export type EraseCommand = { type: "erase"; size: number; path: string };

export type FillCommand = { type: "fill"; point: Point; color: string };

export type TextCommand = {
  type: "text";
  point: Point;
  text: string;
  size: number;
  color: string;
};

export type HideCommand = { type: "hide"; rectangle: Rectangle };

export type DrawCommand =
  | PaintCommand
  | EraseCommand
  | FillCommand
  | TextCommand
  | HideCommand;

type LobbyPhase = { type: "lobby" };

type DrawPhase = { type: "draw"; turn: number; readyClientIds: string[] };

type RevealPhase = { type: "reveal"; step: number };

type Phase = LobbyPhase | DrawPhase | RevealPhase;

export type Player = {
  /**
   * A unique ID that identifies this client.
   */
  clientId: string;
  /**
   * Whether this player is queued up to join the next round.
   */
  isQueuing: boolean;
  /**
   * Whether or not this player is currently connected.
   */
  isConnected: boolean;
};

export type Drawing = {
  steps: DrawingStep[];
};

export type DrawingStep = {
  /**
   * The commands that were added to the drawing during this turn.
   */
  commands: DrawCommand[];
};

export type Game = {
  /**
   * The phase the game is currently in.
   */
  phase: Phase;
  /**
   * The players in the game.
   */
  players: Player[];
  /**
   * The drawings that the players are creating.
   */
  drawings: Drawing[];
  /**
   * The order in which the players take turns (a list of client IDs).
   */
  ordering: string[];
};

export type ClientStartMessage = { type: "start" };

export type ClientSubmitMessage = { type: "submit"; commands: DrawCommand[] };

export type ClientUnsubmitMessage = { type: "unsubmit" };

export type ClientFinishMessage = { type: "finish" };

export type ClientRevealMessage = { type: "reveal"; step: number };

export type ClientMessage =
  | ClientStartMessage
  | ClientUnsubmitMessage
  | ClientSubmitMessage
  | ClientFinishMessage
  | ClientRevealMessage;

export type ClientUpdate =
  | { type: "error"; error: string }
  | { type: "state"; state: ClientState };

type WebSocketData = {
  readonly clientId: string;
};

export function update(
  game: Game,
  player: Player,
  message: ClientMessage,
): Result<Game> {
  switch (message.type) {
    case "start":
      return start(game);
    case "submit":
      return submit(game, player, message.commands);
    case "unsubmit":
      return unsubmit(game, player);
    case "reveal":
      return reveal(game, message.step);
    case "finish":
      return finish(game);
  }
}

export function join(game: Game, player: Player): Result<Game> {
  game.players.push(player);
  player.isQueuing = game.phase.type !== "lobby";
  return Ok(game);
}

export function leave(game: Game, player: Player): Result<Game> {
  if (game.phase.type === "lobby") {
    game.players = remove(game.players, player);
  } else {
    player.isConnected = false;
  }

  if (
    game.players.length === 0 ||
    game.players.every((player) => !player.isConnected)
  ) {
    return Ok(createGame());
  }

  return Ok(game);
}

function start(game: Game): Result<Game> {
  if (game.phase.type !== "lobby") {
    return Err("Game can only start from the lobby phase!");
  }

  if (game.players.length === 0) {
    return Err("Game cannot start without players!");
  }

  game.phase = { type: "draw", turn: 0, readyClientIds: [] };
  game.players = game.players.filter((player) => player.isConnected);
  game.ordering = shuffle(game.players).map((player) => player.clientId);
  game.drawings = game.players.map(() => createDrawing(settings.turns));

  return Ok(game);
}

function submit(
  game: Game,
  player: Player,
  commands: DrawCommand[],
): Result<Game> {
  if (game.phase.type !== "draw") {
    return Err("Submit is only allowed during draw phase!");
  }

  let drawing = getCurrentDrawing(game, player);
  let step = drawing?.steps[game.phase.turn];

  if (!step) {
    return Err("Missing drawing step! This is a bug!");
  }

  step.commands = commands;

  game.phase.readyClientIds = add(game.phase.readyClientIds, player.clientId);

  if (game.phase.readyClientIds.length === game.ordering.length) {
    if (game.phase.turn >= settings.turns - 1) {
      game.phase = { type: "reveal", step: 0 };
    } else {
      game.phase = {
        type: "draw",
        turn: game.phase.turn + 1,
        readyClientIds: [],
      };
    }
  }

  return Ok(game);
}

function unsubmit(game: Game, player: Player): Result<Game> {
  if (game.phase.type !== "draw") {
    return Err("Unsubmit is only allowed during drawing phase!");
  }

  game.phase.readyClientIds = remove(
    game.phase.readyClientIds,
    player.clientId,
  );

  return Ok(game);
}

function reveal(game: Game, step: number): Result<Game> {
  if (game.phase.type !== "reveal") {
    return Err("Reveal is only allowed during reveal phase!");
  }

  if (step < 0 || step >= game.drawings.length) {
    return Err("Attempting to reveal a drawing that does not exist!");
  }

  game.phase.step = step;

  return Ok(game);
}

function finish(game: Game): Result<Game> {
  game.phase = { type: "lobby" };
  game.players = game.players.filter((player) => player.isConnected);

  for (let player of game.players) {
    player.isQueuing = false;
  }

  return Ok(game);
}

export type ClientQueueState = { type: "queue"; players: number };

export type ClientLobbyState = { type: "lobby"; players: number };

export type ClientDrawState = {
  type: "draw";
  playerCount: number;
  turn: number;
  turns: number;
  readyCount: number;
  ready: boolean;
  commands: DrawCommand[];
};

export type ClientRevealState = {
  type: "reveal";
  step: number;
  steps: number;
  commands: DrawCommand[];
};

export type ClientState =
  | ClientQueueState
  | ClientLobbyState
  | ClientDrawState
  | ClientRevealState;

export function getClientState(game: Game, player: Player): ClientState {
  if (game.phase.type === "lobby") {
    return { type: "lobby", players: game.players.length };
  }

  if (game.phase.type === "draw") {
    if (player.isQueuing) {
      return { type: "queue", players: game.players.length };
    }

    let drawing = getCurrentDrawing(game, player);

    let commands =
      drawing?.steps
        .slice(0, game.phase.turn)
        .flatMap((step) => step.commands) ?? [];

    return {
      type: "draw",
      commands,
      turn: game.phase.turn,
      turns: settings.turns,
      playerCount: game.ordering.length,
      readyCount: game.phase.readyClientIds.length,
      ready: game.phase.readyClientIds.includes(player.clientId),
    };
  }

  if (game.phase.type === "reveal") {
    let drawing = game.drawings[game.phase.step];

    let commands =
      drawing?.steps
        .flatMap((step) => step.commands)
        .filter((command) => command.type !== "hide") ?? [];

    return {
      type: "reveal",
      step: game.phase.step,
      steps: game.drawings.length,
      commands,
    };
  }

  return game.phase;
}

function createDrawing(turns: number): Drawing {
  return {
    steps: Array.from({ length: turns }).map(() => ({ commands: [] })),
  };
}

function createPlayer(clientId: string): Player {
  return {
    clientId,
    isConnected: true,
    isQueuing: false,
  };
}

function getCurrentDrawing(game: Game, player: Player): Drawing | undefined {
  if (game.phase.type === "draw") {
    let index = game.ordering.indexOf(player.clientId) + game.phase.turn;
    return game.drawings[index % game.drawings.length];
  }
}

function findPlayerById(game: Game, clientId: string): Player | undefined {
  return game.players.find((player) => player.clientId === clientId);
}

function createGame(): Game {
  return {
    phase: { type: "lobby" },
    players: [],
    drawings: [],
    ordering: [],
  };
}

let game: Game = createGame();
let sockets = new Map<string, ServerWebSocket<WebSocketData>>();

function send(
  socket: ServerWebSocket<WebSocketData>,
  update: ClientUpdate,
): void {
  socket.send(JSON.stringify(update));
}

function synchronize(
  socket: ServerWebSocket<WebSocketData>,
  result: Result<Game>,
): void {
  if (!result.ok) {
    send(socket, { type: "error", error: result.error });
    return;
  }

  game = result.value;

  for (let player of game.players) {
    let state = getClientState(game, player);
    let socket = sockets.get(player.clientId);
    if (socket) send(socket, { type: "state", state });
  }
}

let server = serve({
  routes: {
    "/": index,
  },

  websocket: {
    data: {} as WebSocketData,
    open(socket) {
      sockets.set(socket.data.clientId, socket);
      let player = findPlayerById(game, socket.data.clientId);
      if (!player) {
        player = createPlayer(socket.data.clientId);
        synchronize(socket, join(game, player));
      }
    },
    close(socket) {
      sockets.delete(socket.data.clientId);
      let player = findPlayerById(game, socket.data.clientId);
      if (player) synchronize(socket, leave(game, player));
    },
    message(socket, rawMessage) {
      let message = JSON.parse(rawMessage.toString()) as ClientMessage;
      let player = findPlayerById(game, socket.data.clientId);
      if (message && player) synchronize(socket, update(game, player, message));
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

    if (!server.upgrade(req, { data: { clientId } })) {
      console.error("Could not upgrade socket!");
    }
  },
});

console.log(`Listening on http://${server.hostname}:${server.port}`);
