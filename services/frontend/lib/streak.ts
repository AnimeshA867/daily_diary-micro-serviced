/**
 * Streak data interface definition
 */

export interface StreakData {
  currentStreak: number;
  longestStreak: number;
  lastEntryDate: string | null;
  totalEntries: number;
  streakActive: boolean;
}
