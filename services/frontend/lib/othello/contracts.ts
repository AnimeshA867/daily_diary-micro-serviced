import { z } from "zod";
import {
  type DomainEvent,
  type OthelloState,
  applyMove,
  declineRematch,
  requestRematch,
  resignGame,
} from "./engine";

const playerSchema = z.enum(["black", "white"]);

const playMoveIntentSchema = z.object({
  type: z.literal("play_move"),
  player: playerSchema,
  index: z.number().int().min(0).max(63),
  expectedRevision: z.number().int().min(0),
});

const requestRematchIntentSchema = z.object({
  type: z.literal("request_rematch"),
  player: playerSchema,
  expectedRevision: z.number().int().min(0),
});

const declineRematchIntentSchema = z.object({
  type: z.literal("decline_rematch"),
  player: playerSchema,
  expectedRevision: z.number().int().min(0),
});

const resignIntentSchema = z.object({
  type: z.literal("resign"),
  player: playerSchema,
  expectedRevision: z.number().int().min(0),
});

export const clientIntentSchema = z.discriminatedUnion("type", [
  playMoveIntentSchema,
  requestRematchIntentSchema,
  declineRematchIntentSchema,
  resignIntentSchema,
]);

export type ClientIntent = z.infer<typeof clientIntentSchema>;

export interface TransitionEnvelope {
  state: OthelloState;
  events: DomainEvent[];
}

function assertExpectedRevision(state: OthelloState, expectedRevision: number): void {
  if (state.revision !== expectedRevision) {
    throw new Error(
      `Revision mismatch: expected ${expectedRevision}, current ${state.revision}`
    );
  }
}

export function parseClientIntent(input: unknown): ClientIntent {
  return clientIntentSchema.parse(input);
}

export function applyClientIntent(
  state: OthelloState,
  rawIntent: unknown
): TransitionEnvelope {
  const intent = parseClientIntent(rawIntent);
  assertExpectedRevision(state, intent.expectedRevision);

  if (intent.type === "play_move") {
    return applyMove(state, { player: intent.player, index: intent.index });
  }

  if (intent.type === "request_rematch") {
    return requestRematch(state, intent.player);
  }

  if (intent.type === "decline_rematch") {
    return declineRematch(state, intent.player);
  }

  return resignGame(state, intent.player);
}
