import { z } from "zod";
import { clientIntentSchema } from "./contracts";

const encodedStateSchema = z.object({
  matchId: z.string().min(1),
  round: z.number().int().min(1),
  revision: z.number().int().min(0),
  phase: z.enum(["active", "finished"]),
  currentTurn: z.enum(["black", "white"]),
  black: z.string().min(1),
  white: z.string().min(1),
  consecutivePasses: z.number().int().min(0).max(2),
  rematch: z.object({
    blackRequested: z.boolean(),
    whiteRequested: z.boolean(),
    declinedBy: z.enum(["black", "white"]).nullable(),
  }),
  result: z
    .object({
      winner: z.enum(["black", "white", "draw"]),
      reason: z.enum(["no-legal-moves", "board-full", "resign"]),
      blackCount: z.number().int().min(0).max(64),
      whiteCount: z.number().int().min(0).max(64),
    })
    .nullable(),
});

export const wsClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("join_match"),
    matchId: z.string().min(1),
    player: z.enum(["black", "white"]),
  }),
  z.object({
    type: z.literal("intent"),
    payload: clientIntentSchema,
  }),
  z.object({
    type: z.literal("sync_request"),
    matchId: z.string().min(1),
  }),
]);

export const wsServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("sync_state"),
    payload: encodedStateSchema,
  }),
  z.object({
    type: z.literal("state_updated"),
    payload: z.object({
      state: encodedStateSchema,
      events: z.array(z.unknown()),
    }),
  }),
  z.object({
    type: z.literal("intent_rejected"),
    reason: z.string().min(1),
  }),
]);

export type WsClientMessage = z.infer<typeof wsClientMessageSchema>;
export type WsServerMessage = z.infer<typeof wsServerMessageSchema>;

export function parseWsClientMessage(input: unknown): WsClientMessage {
  return wsClientMessageSchema.parse(input);
}

export function parseWsServerMessage(input: unknown): WsServerMessage {
  return wsServerMessageSchema.parse(input);
}
