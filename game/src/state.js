// One state object for the whole match. Every module reads or writes through here
// so the simulation, HUD and shot mode never drift apart.
export const PHASE = {
  BUY: 'buy',
  LIVE: 'live',
  PLANTED: 'planted',
  ROUND_END: 'round_end',
  MATCH_END: 'match_end',
};

export function createState() {
  return {
    phase: PHASE.BUY,
    round: 1,
    maxRounds: 9,
    winsToTake: 5,
    roundWins: { vanguard: 0, ember: 0 },
    roundTime: 0,
    buyTime: 15,
    roundLength: 100,
    plantTime: 35,
    plantTimer: 0,
    plantedSite: null,
    money: { player: 800 },
    kills: { player: 0 },
    deaths: { player: 0 },
    feed: [],
    winner: null,
    winReason: '',
    elapsed: 0,
  };
}

// Breadth-first search over the waypoint graph. Returns an array of waypoint ids
// from `from` to `to` (excluding `from`), or [] when unreachable.
export function findPath(waypoints, from, to) {
  if (from === to) return [];
  const prev = new Map([[from, -1]]);
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of waypoints[current].neighbors) {
      if (prev.has(next)) continue;
      prev.set(next, current);
      if (next === to) {
        const path = [];
        let node = to;
        while (node !== from) {
          path.unshift(node);
          node = prev.get(node);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return [];
}
