import {
  type DomainEvent,
  type OthelloState,
  createInitialState,
  encodeState,
} from "./engine";
import { applyClientIntent, type ClientIntent } from "./contracts";

export interface MatchRecord {
  state: OthelloState;
  events: DomainEvent[];
}

export class InMemoryMatchService {
  private readonly matches = new Map<string, MatchRecord>();

  createMatch(matchId: string): MatchRecord {
    const existing = this.matches.get(matchId);
    if (existing) {
      return existing;
    }

    const record: MatchRecord = {
      state: createInitialState(matchId),
      events: [],
    };

    this.matches.set(matchId, record);
    return record;
  }

  getMatch(matchId: string): MatchRecord {
    const record = this.matches.get(matchId);
    if (!record) {
      throw new Error(`Unknown match: ${matchId}`);
    }
    return record;
  }

  applyIntent(matchId: string, intent: ClientIntent): MatchRecord {
    const record = this.getMatch(matchId);
    const { state, events } = applyClientIntent(record.state, intent);

    const updated: MatchRecord = {
      state,
      events: [...record.events, ...events],
    };

    this.matches.set(matchId, updated);
    return updated;
  }

  getEncodedSnapshot(matchId: string) {
    const record = this.getMatch(matchId);
    return {
      state: encodeState(record.state),
      events: [...record.events],
    };
  }
}
