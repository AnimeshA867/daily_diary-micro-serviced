import test from "node:test";
import assert from "node:assert/strict";

import {
  applyMove,
  createInitialState,
  getLegalMoves,
  requestRematch,
} from "./engine";

test("opening legal moves for black are deterministic", () => {
  const state = createInitialState("m1");
  const legal = getLegalMoves(state, "black");
  assert.deepEqual(legal.sort((a, b) => a - b), [19, 26, 37, 44]);
});

test("applying a legal move increments revision and rotates turn", () => {
  const state = createInitialState("m1");
  const result = applyMove(state, { player: "black", index: 19 });

  assert.equal(result.state.revision, 1);
  assert.equal(result.state.currentTurn, "white");
  assert.equal(result.state.phase, "active");
  assert.equal(result.events[0]?.type, "move_applied");
});

test("illegal move throws", () => {
  const state = createInitialState("m1");
  assert.throws(() => applyMove(state, { player: "black", index: 0 }));
});

test("rematch requires both players and starts next round", () => {
  let state = createInitialState("m1");
  state = {
    ...state,
    phase: "finished",
    result: {
      winner: "black",
      reason: "no-legal-moves",
      blackCount: 40,
      whiteCount: 24,
    },
  };

  const first = requestRematch(state, "black");
  assert.equal(first.state.round, 1);
  assert.equal(first.events[0]?.type, "rematch_requested");

  const second = requestRematch(first.state, "white");
  assert.equal(second.state.round, 2);
  assert.equal(second.state.phase, "active");
  assert.equal(second.events[0]?.type, "rematch_started");
});
