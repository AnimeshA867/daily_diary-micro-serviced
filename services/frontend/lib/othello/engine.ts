export type PlayerColor = "black" | "white";

export type GamePhase = "active" | "finished";

export type FinishReason = "no-legal-moves" | "board-full" | "resign";

export type GameWinner = PlayerColor | "draw";

export interface OthelloMove {
  player: PlayerColor;
  index: number;
}

export interface GameResult {
  winner: GameWinner;
  reason: FinishReason;
  blackCount: number;
  whiteCount: number;
}

export interface RematchState {
  blackRequested: boolean;
  whiteRequested: boolean;
  declinedBy: PlayerColor | null;
}

export interface OthelloState {
  matchId: string;
  round: number;
  revision: number;
  phase: GamePhase;
  currentTurn: PlayerColor;
  black: bigint;
  white: bigint;
  consecutivePasses: number;
  rematch: RematchState;
  result: GameResult | null;
}

export type DomainEvent =
  | { type: "move_applied"; player: PlayerColor; index: number; flipped: number[] }
  | { type: "turn_passed"; player: PlayerColor }
  | { type: "game_finished"; result: GameResult }
  | { type: "rematch_requested"; player: PlayerColor }
  | { type: "rematch_declined"; player: PlayerColor }
  | { type: "rematch_started"; round: number };

export interface TransitionResult {
  state: OthelloState;
  events: DomainEvent[];
}

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const EIGHT = BigInt(8);
const SIXTY_FOUR = BigInt(64);
const BOARD_SIZE = 64;
const FULL_MASK = (ONE << SIXTY_FOUR) - ONE;

const DIRECTIONS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function coordToIndex(file: number, rank: number): number {
  return rank * 8 + file;
}

function indexToCoord(index: number): [number, number] {
  return [index % 8, Math.floor(index / 8)];
}

function isOnBoard(file: number, rank: number): boolean {
  return file >= 0 && file < 8 && rank >= 0 && rank < 8;
}

function bitAt(index: number): bigint {
  return ONE << BigInt(index);
}

function discAt(state: Pick<OthelloState, "black" | "white">, index: number): PlayerColor | null {
  const bit = bitAt(index);
  if ((state.black & bit) !== ZERO) return "black";
  if ((state.white & bit) !== ZERO) return "white";
  return null;
}

function opponent(player: PlayerColor): PlayerColor {
  return player === "black" ? "white" : "black";
}

function popCount(value: bigint): number {
  let count = 0;
  let v = value;
  while (v !== ZERO) {
    v &= v - ONE;
    count += 1;
  }
  return count;
}

function getFlipsForMove(state: OthelloState, player: PlayerColor, index: number): bigint {
  if (index < 0 || index >= BOARD_SIZE) return ZERO;
  if (discAt(state, index) !== null) return ZERO;

  const [startFile, startRank] = indexToCoord(index);
  let flipped = ZERO;
  const enemy = opponent(player);

  for (const [df, dr] of DIRECTIONS) {
    let file = startFile + df;
    let rank = startRank + dr;
    let ray = ZERO;
    let hasEnemy = false;

    while (isOnBoard(file, rank)) {
      const nextIndex = coordToIndex(file, rank);
      const disc = discAt(state, nextIndex);

      if (disc === enemy) {
        hasEnemy = true;
        ray |= bitAt(nextIndex);
      } else if (disc === player) {
        if (hasEnemy) {
          flipped |= ray;
        }
        break;
      } else {
        break;
      }

      file += df;
      rank += dr;
    }
  }

  return flipped;
}

function listBits(value: bigint): number[] {
  const out: number[] = [];
  for (let i = 0; i < BOARD_SIZE; i += 1) {
    if ((value & bitAt(i)) !== ZERO) {
      out.push(i);
    }
  }
  return out;
}

function toResult(state: OthelloState, reason: FinishReason): GameResult {
  const blackCount = popCount(state.black);
  const whiteCount = popCount(state.white);
  let winner: GameWinner = "draw";

  if (blackCount > whiteCount) winner = "black";
  if (whiteCount > blackCount) winner = "white";

  return {
    winner,
    reason,
    blackCount,
    whiteCount,
  };
}

function cloneState(state: OthelloState): OthelloState {
  return {
    ...state,
    rematch: { ...state.rematch },
    result: state.result ? { ...state.result } : null,
  };
}

export function createInitialState(matchId: string, round = 1): OthelloState {
  // Standard Othello opening: D4/W, E5/W, E4/B, D5/B
  const d4 = bitAt(coordToIndex(3, 3));
  const e5 = bitAt(coordToIndex(4, 4));
  const e4 = bitAt(coordToIndex(4, 3));
  const d5 = bitAt(coordToIndex(3, 4));

  return {
    matchId,
    round,
    revision: 0,
    phase: "active",
    currentTurn: "black",
    black: e4 | d5,
    white: d4 | e5,
    consecutivePasses: 0,
    rematch: {
      blackRequested: false,
      whiteRequested: false,
      declinedBy: null,
    },
    result: null,
  };
}

export function getLegalMovesBitboard(state: OthelloState, player: PlayerColor): bigint {
  if (state.phase !== "active") return ZERO;

  const occupied = state.black | state.white;
  const empty = FULL_MASK ^ occupied;
  let legal = ZERO;

  for (let i = 0; i < BOARD_SIZE; i += 1) {
    const bit = bitAt(i);
    if ((empty & bit) === ZERO) continue;
    if (getFlipsForMove(state, player, i) !== ZERO) {
      legal |= bit;
    }
  }

  return legal;
}

export function getLegalMoves(state: OthelloState, player: PlayerColor): number[] {
  return listBits(getLegalMovesBitboard(state, player));
}

export function isTerminal(state: OthelloState): boolean {
  if (state.phase === "finished") return true;

  const boardFull = (state.black | state.white) === FULL_MASK;
  if (boardFull) return true;

  const blackHas = getLegalMovesBitboard(state, "black") !== ZERO;
  const whiteHas = getLegalMovesBitboard(state, "white") !== ZERO;

  return !blackHas && !whiteHas;
}

export function applyMove(state: OthelloState, move: OthelloMove): TransitionResult {
  const next = cloneState(state);
  const events: DomainEvent[] = [];

  if (next.phase !== "active") {
    throw new Error("Cannot play move: game is already finished");
  }

  if (move.player !== next.currentTurn) {
    throw new Error("Cannot play move: not this player's turn");
  }

  const flips = getFlipsForMove(next, move.player, move.index);
  if (flips === ZERO) {
    throw new Error("Cannot play move: illegal move");
  }

  const placed = bitAt(move.index);
  const flippedIndices = listBits(flips);

  if (move.player === "black") {
    next.black |= placed | flips;
    next.white &= FULL_MASK ^ flips;
  } else {
    next.white |= placed | flips;
    next.black &= FULL_MASK ^ flips;
  }

  next.revision += 1;
  next.rematch.blackRequested = false;
  next.rematch.whiteRequested = false;
  next.rematch.declinedBy = null;

  events.push({
    type: "move_applied",
    player: move.player,
    index: move.index,
    flipped: flippedIndices,
  });

  const boardFull = (next.black | next.white) === FULL_MASK;
  if (boardFull) {
    next.phase = "finished";
    next.result = toResult(next, "board-full");
    events.push({ type: "game_finished", result: next.result });
    return { state: next, events };
  }

  const nextPlayer = opponent(move.player);
  const nextPlayerMoves = getLegalMovesBitboard(next, nextPlayer);

  if (nextPlayerMoves !== ZERO) {
    next.currentTurn = nextPlayer;
    next.consecutivePasses = 0;
    return { state: next, events };
  }

  const samePlayerMoves = getLegalMovesBitboard(next, move.player);
  if (samePlayerMoves !== ZERO) {
    next.currentTurn = move.player;
    next.consecutivePasses = 1;
    events.push({ type: "turn_passed", player: nextPlayer });
    return { state: next, events };
  }

  next.phase = "finished";
  next.consecutivePasses = 2;
  next.result = toResult(next, "no-legal-moves");
  events.push({ type: "game_finished", result: next.result });
  return { state: next, events };
}

export function resignGame(state: OthelloState, player: PlayerColor): TransitionResult {
  if (state.phase !== "active") {
    throw new Error("Cannot resign: game is already finished");
  }

  const next = cloneState(state);
  const winner = opponent(player);

  next.phase = "finished";
  next.revision += 1;

  const blackCount = popCount(next.black);
  const whiteCount = popCount(next.white);
  next.result = {
    winner,
    reason: "resign",
    blackCount,
    whiteCount,
  };

  return {
    state: next,
    events: [{ type: "game_finished", result: next.result }],
  };
}

export function requestRematch(state: OthelloState, player: PlayerColor): TransitionResult {
  if (state.phase !== "finished") {
    throw new Error("Cannot request rematch: game is still active");
  }

  const next = cloneState(state);

  if (player === "black") {
    next.rematch.blackRequested = true;
  } else {
    next.rematch.whiteRequested = true;
  }

  next.rematch.declinedBy = null;
  next.revision += 1;

  if (next.rematch.blackRequested && next.rematch.whiteRequested) {
    const restarted = createInitialState(next.matchId, next.round + 1);
    restarted.revision = next.revision;
    return {
      state: restarted,
      events: [{ type: "rematch_started", round: restarted.round }],
    };
  }

  return {
    state: next,
    events: [{ type: "rematch_requested", player }],
  };
}

export function declineRematch(state: OthelloState, player: PlayerColor): TransitionResult {
  if (state.phase !== "finished") {
    throw new Error("Cannot decline rematch: game is still active");
  }

  const next = cloneState(state);
  next.rematch.blackRequested = false;
  next.rematch.whiteRequested = false;
  next.rematch.declinedBy = player;
  next.revision += 1;

  return {
    state: next,
    events: [{ type: "rematch_declined", player }],
  };
}

export interface EncodedOthelloState {
  matchId: string;
  round: number;
  revision: number;
  phase: GamePhase;
  currentTurn: PlayerColor;
  black: string;
  white: string;
  consecutivePasses: number;
  rematch: RematchState;
  result: GameResult | null;
}

export function encodeState(state: OthelloState): EncodedOthelloState {
  return {
    matchId: state.matchId,
    round: state.round,
    revision: state.revision,
    phase: state.phase,
    currentTurn: state.currentTurn,
    black: state.black.toString(16),
    white: state.white.toString(16),
    consecutivePasses: state.consecutivePasses,
    rematch: { ...state.rematch },
    result: state.result ? { ...state.result } : null,
  };
}

export function decodeState(state: EncodedOthelloState): OthelloState {
  return {
    matchId: state.matchId,
    round: state.round,
    revision: state.revision,
    phase: state.phase,
    currentTurn: state.currentTurn,
    black: BigInt("0x" + state.black),
    white: BigInt("0x" + state.white),
    consecutivePasses: state.consecutivePasses,
    rematch: { ...state.rematch },
    result: state.result ? { ...state.result } : null,
  };
}
