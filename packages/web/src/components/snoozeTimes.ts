/**
 * When "later" is (ADR-0075).
 *
 * Worked out in the browser and sent as a moment, because "tomorrow morning" is
 * a question about the clock on somebody's desk and the browser is standing
 * next to it. The server would have to reconstruct the same answer from a
 * stored timezone that can be wrong, absent, or a week out of date because
 * somebody travelled.
 *
 * Three choices and no more. A snooze menu with eight entries is a decision
 * about scheduling where somebody wanted to get a row off their screen — and
 * the fourth choice people actually want is a date picker, which is a different
 * control and can be added beside these rather than smuggled into the list.
 *
 * Pure functions of "now", so the answers can be checked rather than believed.
 */

export type SnoozeChoice = 'later' | 'tomorrow' | 'nextWeek';

/** The hour a working day starts, for the two choices that name a morning. */
const MORNING = 9;

/**
 * Three hours from now.
 *
 * Not "this evening": somebody clearing an inbox at nine at night does not mean
 * eight tonight, and a choice that lands in the past for half the day is a
 * choice that has to be explained.
 */
function laterToday(now: Date): Date {
  return new Date(now.getTime() + 3 * 60 * 60 * 1000);
}

/**
 * Tomorrow at nine.
 *
 * Always tomorrow, even at two in the morning. "Tomorrow" said at 02:00 means
 * the day that has not started yet in every sense except the calendar's, and
 * a notification that came back seven hours later would be a surprise.
 */
function tomorrowMorning(now: Date): Date {
  const when = new Date(now);
  when.setDate(when.getDate() + 1);
  when.setHours(MORNING, 0, 0, 0);
  return when;
}

/**
 * The next Monday at nine.
 *
 * "Next week" on a Monday means the Monday after this one, not today — the
 * whole point of the choice is that the week in front of you is spoken for.
 */
function nextWeek(now: Date): Date {
  const when = new Date(now);
  const days = ((8 - when.getDay()) % 7) || 7;
  when.setDate(when.getDate() + days);
  when.setHours(MORNING, 0, 0, 0);
  return when;
}

export function snoozeUntil(choice: SnoozeChoice, now = new Date()): Date {
  if (choice === 'later') return laterToday(now);
  if (choice === 'tomorrow') return tomorrowMorning(now);
  return nextWeek(now);
}
