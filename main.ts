// Sokoban solver for sokoban-solver-01-run-20261121.
//
// Method: the generator builds every level as a one-cell-wide hallway (where the
// player starts) with 1-4 rooms off it, each room holding 3-4 boxes and as many
// goals in a slot of at most 6x6. A box pushed out of its room through its door can
// never be pushed back, so every box stays in its room and the level's push-optimal
// count P* is the sum of its rooms' optima. We therefore solve each room separately
// with a push-optimal breadth-first search (dead-square + frozen-2x2 pruning), then
// concatenate the rooms' move strings. Steps never affect the score, only pushes do,
// so the walks between pushes are shortest paths and the player is free to travel
// the hallway between rooms. A room's search also requires the player to be able to
// walk back out to the hallway afterwards (except after the last room), so the
// player is never trapped inside a solved room.
//
// Node 22, standard library only; no network, no clock, no randomness: the search
// is bounded by a fixed node budget (never the clock), so two runs write identical
// bytes.
//
// Local run:
//   mkdir -p out scores
//   MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
//   MAKEFUN_OUTPUT_DIR=out MAKEFUN_REFERENCE_DIR=practice/reference MAKEFUN_SCORES_DIR=scores node program/scorer/score.ts
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** Directions: 0 up, 1 down, 2 left, 3 right. OPP[d] is the opposite direction. */
const DIRS = [
  { dx: 0, dy: -1, ch: 'u' },
  { dx: 0, dy: 1, ch: 'd' },
  { dx: -1, dy: 0, ch: 'l' },
  { dx: 1, dy: 0, ch: 'r' },
];
const OPP = [1, 0, 3, 2];
/** A room search gives up past this many popped states (a fixed work budget, never the clock). */
const EXPANSION_BUDGET = 200_000;

interface Level {
  w: number;
  h: number;
  wall: Uint8Array;
  goal: Uint8Array;
  boxes: number[];
  player: number;
  /** nbr[i][d] = the neighbour cell of i in direction d, or -1 at the board's edge. */
  nbr: number[][];
}

interface Room {
  cells: number[];
  boxes: number[];
  goals: number[];
}

interface Push {
  box: number;
  dir: number;
}

function parseLevel(text: string): Level {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  const wall = new Uint8Array(w * h).fill(1);
  const goal = new Uint8Array(w * h);
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goal[i] = 1;
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  boxes.sort((a, b) => a - b);
  const nbr: number[][] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      nbr[i] = [
        y > 0 ? i - w : -1,
        y < h - 1 ? i + w : -1,
        x > 0 ? i - 1 : -1,
        x < w - 1 ? i + 1 : -1,
      ];
    }
  }
  return { w, h, wall, goal, boxes, player, nbr };
}

/** The rooms: connected components of floor cells off the hallway row (the player's row). */
function findRooms(level: Level): Room[] {
  const { w, h, wall, nbr } = level;
  const hallRow = Math.floor(level.player / w);
  const seen = new Uint8Array(w * h);
  const rooms: Room[] = [];
  for (let i = 0; i < w * h; i++) {
    if (wall[i] || seen[i]) continue;
    if (Math.floor(i / w) === hallRow) continue;
    const cells: number[] = [];
    const stack = [i];
    seen[i] = 1;
    while (stack.length > 0) {
      const c = stack.pop()!;
      cells.push(c);
      for (let d = 0; d < 4; d++) {
        const n = nbr[c]![d]!;
        if (n < 0 || wall[n] || seen[n]) continue;
        if (Math.floor(n / w) === hallRow) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    const boxes = level.boxes.filter((b) => cells.indexOf(b) >= 0);
    const goals = cells.filter((c) => level.goal[c]);
    if (boxes.length > 0) rooms.push({ cells, boxes, goals });
  }
  rooms.sort((a, b) => Math.min(...a.cells) - Math.min(...b.cells));
  return rooms;
}

/**
 * Dead squares of a room: floor cells from which a box can never reach a goal.
 * Reverse box moves from the goals: a box at y came from x = y - d, with the player
 * standing at y - 2d (any floor cell, reachability ignored: a sound over-approximation).
 */
function deadSquares(level: Level, cells: number[], goals: number[]): boolean[] {
  const { w, h, wall, goal } = level;
  const local = new Map<number, number>();
  cells.forEach((c, i) => local.set(c, i));
  const live = new Uint8Array(cells.length);
  const queue: number[] = [];
  for (const g of goals) {
    const li = local.get(g)!;
    if (!live[li]) {
      live[li] = 1;
      queue.push(g);
    }
  }
  while (queue.length > 0) {
    const y = queue.pop()!;
    const yx = y % w;
    const yy = Math.floor(y / w);
    for (let d = 0; d < 4; d++) {
      const dx = DIRS[d]!.dx;
      const dy = DIRS[d]!.dy;
      const xx = yx - dx;
      const y2 = yy - dy;
      const sx = yx - 2 * dx;
      const sy = yy - 2 * dy;
      if (xx < 0 || xx >= w || y2 < 0 || y2 >= h) continue;
      if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
      const x = y2 * w + xx;
      const s = sy * w + sx;
      const xi = local.get(x);
      if (xi === undefined || live[xi]) continue;
      if (wall[s]) continue;
      live[xi] = 1;
      queue.push(x);
    }
  }
  return cells.map((c, i) => !goal[c] && !live[i]);
}

/** The player's reachable region from `start` over cells that are neither wall nor box. */
function floodRegion(level: Level, occ: Uint8Array, start: number): { mark: Uint8Array; min: number } {
  const mark = new Uint8Array(level.w * level.h);
  const q = [start];
  mark[start] = 1;
  let min = start;
  let head = 0;
  while (head < q.length) {
    const c = q[head++]!;
    if (c < min) min = c;
    for (let d = 0; d < 4; d++) {
      const n = level.nbr[c]![d]!;
      if (n < 0 || mark[n] || level.wall[n] || occ[n]) continue;
      mark[n] = 1;
      q.push(n);
    }
  }
  return { mark, min };
}

/** Shortest walk from `start` to `target` over free cells (never through a box), or null. */
function walkPath(level: Level, occ: Uint8Array, start: number, target: number): string | null {
  if (start === target) return '';
  const prev = new Int32Array(level.w * level.h).fill(-2);
  const prevDir = new Int8Array(level.w * level.h).fill(-1);
  const q = [start];
  prev[start] = -1;
  let head = 0;
  while (head < q.length) {
    const c = q[head++]!;
    for (let d = 0; d < 4; d++) {
      const n = level.nbr[c]![d]!;
      if (n < 0 || prev[n] !== -2 || level.wall[n] || occ[n]) continue;
      prev[n] = c;
      prevDir[n] = d;
      if (n === target) {
        let s = '';
        let t = n;
        while (t !== start) {
          s = DIRS[prevDir[t]!]!.ch + s;
          t = prev[t]!;
        }
        return s;
      }
      q.push(n);
    }
  }
  return null;
}

/**
 * Push-optimal BFS for one room. The state is the room's boxes (a bitmask over the
 * room's cells) plus the player's reachable region (keyed by its lowest cell); the
 * player may walk anywhere on the board, but only this room's boxes are ever pushed,
 * and only onto the room's own cells. Returns the room's moves, or null.
 */
function solveRoom(
  level: Level,
  room: Room,
  boxesGlobal: number[],
  playerGlobal: number,
  needExit: boolean,
  hallRow: number,
): { moves: string; pushes: number } | null {
  const { w, h, wall, goal, nbr } = level;
  const local = new Map<number, number>();
  room.cells.forEach((c, i) => local.set(c, i));
  const dead = deadSquares(level, room.cells, room.goals);
  const roomBoxSet = new Set(room.boxes);
  const otherBoxes = boxesGlobal.filter((b) => !roomBoxSet.has(b));

  let initMask = 0n;
  for (const b of room.boxes) initMask |= 1n << BigInt(local.get(b)!);

  const occOf = (mask: bigint): Uint8Array => {
    const occ = new Uint8Array(w * h);
    for (const b of otherBoxes) occ[b] = 1;
    for (let i = 0; i < room.cells.length; i++) {
      if ((mask >> BigInt(i)) & 1n) occ[room.cells[i]!] = 1;
    }
    return occ;
  };
  const solvedMask = (mask: bigint): boolean => {
    for (let i = 0; i < room.cells.length; i++) {
      if ((mask >> BigInt(i)) & 1n) {
        if (!goal[room.cells[i]!]) return false;
      }
    }
    return true;
  };
  /** A 2x2 block of walls/boxes holding a box off its goal can never move again. */
  const frozen = (occ: Uint8Array, around: number): boolean => {
    const ax = around % w;
    const ay = Math.floor(around / w);
    for (const [tx, ty] of [
      [ax - 1, ay - 1],
      [ax, ay - 1],
      [ax - 1, ay],
      [ax, ay],
    ]) {
      if (tx < 0 || ty < 0 || tx + 1 >= w || ty + 1 >= h) continue;
      const cs = [ty * w + tx, ty * w + tx + 1, (ty + 1) * w + tx, (ty + 1) * w + tx + 1];
      let allBlocked = true;
      let badBox = false;
      for (const c of cs) {
        if (!wall[c] && !occ[c]) {
          allBlocked = false;
          break;
        }
        if (occ[c] && !goal[c]) badBox = true;
      }
      if (allBlocked && badBox) return true;
    }
    return false;
  };

  const qMask: bigint[] = [initMask];
  const qPlayer: number[] = [playerGlobal];
  const qParent: number[] = [-1];
  const qPushBox: number[] = [-1];
  const qPushDir: number[] = [-1];
  const visited = new Set<bigint>();
  const occ0 = occOf(initMask);
  visited.add((initMask << 9n) | BigInt(floodRegion(level, occ0, playerGlobal).min));

  const finish = (s: number): { moves: string; pushes: number } => {
    const pushes: Push[] = [];
    for (let t = s; t > 0; t = qParent[t]!) pushes.push({ box: qPushBox[t]!, dir: qPushDir[t]! });
    pushes.reverse();
    let boxes = [...boxesGlobal];
    let player = playerGlobal;
    let moves = '';
    for (const p of pushes) {
      const b = p.box;
      const d = p.dir;
      const from = nbr[b]![OPP[d]!]!;
      const occNow = new Uint8Array(w * h);
      for (const bb of boxes) occNow[bb] = 1;
      const path = walkPath(level, occNow, player, from);
      if (path === null) throw new Error('replay walk failed');
      moves += path;
      moves += DIRS[d]!.ch;
      const to = nbr[b]![d]!;
      boxes[boxes.indexOf(b)] = to;
      boxes.sort((a, b2) => a - b2);
      player = b;
    }
    return { moves, pushes: pushes.length };
  };

  let head = 0;
  while (head < qMask.length) {
    if (head >= EXPANSION_BUDGET) return null;
    const s = head++;
    const mask = qMask[s]!;
    const player = qPlayer[s]!;
    const occ = occOf(mask);
    const reg = floodRegion(level, occ, player);
    if (solvedMask(mask)) {
      if (!needExit) return finish(s);
      let reachesHall = false;
      for (let x = 0; x < w; x++) {
        if (reg.mark[hallRow * w + x]) {
          reachesHall = true;
          break;
        }
      }
      if (reachesHall) return finish(s);
      continue;
    }
    for (let i = 0; i < room.cells.length; i++) {
      if (!((mask >> BigInt(i)) & 1n)) continue;
      const b = room.cells[i]!;
      for (let d = 0; d < 4; d++) {
        const from = nbr[b]![OPP[d]!]!;
        const to = nbr[b]![d]!;
        if (from < 0 || to < 0) continue;
        if (!reg.mark[from]) continue;
        if (wall[to] || occ[to]) continue;
        const toLocal = local.get(to);
        if (toLocal === undefined) continue;
        if (dead[toLocal]) continue;
        const nmask = (mask & ~(1n << BigInt(i))) | (1n << BigInt(toLocal));
        const nocc = occ.slice();
        nocc[b] = 0;
        nocc[to] = 1;
        if (frozen(nocc, to)) continue;
        const nreg = floodRegion(level, nocc, b);
        const key = (nmask << 9n) | BigInt(nreg.min);
        if (visited.has(key)) continue;
        visited.add(key);
        qMask.push(nmask);
        qPlayer.push(b);
        qParent.push(s);
        qPushBox.push(b);
        qPushDir.push(d);
      }
    }
  }
  return null;
}

/** Replay moves on the level; the new boxes and player, or null on an illegal step. */
function simulate(
  level: Level,
  boxes: number[],
  player: number,
  moves: string,
): { boxes: number[]; player: number } | null {
  const boxSet = new Set(boxes);
  let p = player;
  for (const ch of moves) {
    const d = 'udlr'.indexOf(ch.toLowerCase());
    if (d < 0) return null;
    const n = level.nbr[p]![d]!;
    if (n < 0 || level.wall[n]) return null;
    if (boxSet.has(n)) {
      const beyond = level.nbr[n]![d]!;
      if (beyond < 0 || level.wall[beyond] || boxSet.has(beyond)) return null;
      boxSet.delete(n);
      boxSet.add(beyond);
    }
    p = n;
  }
  return { boxes: [...boxSet].sort((a, b) => a - b), player: p };
}

function solveLevel(text: string): string {
  const level = parseLevel(text);
  const hallRow = Math.floor(level.player / level.w);
  let rooms = findRooms(level);
  const roomBoxes = rooms.reduce((a, r) => a + r.boxes.length, 0);
  if (rooms.length === 0 || roomBoxes !== level.boxes.length) {
    // Fallback: the whole level as one room (never expected for generated levels).
    const cells: number[] = [];
    for (let i = 0; i < level.w * level.h; i++) if (!level.wall[i]) cells.push(i);
    rooms = [{ cells, boxes: level.boxes, goals: cells.filter((c) => level.goal[c]) }];
  }
  let boxes = [...level.boxes];
  let player = level.player;
  let moves = '';
  for (let k = 0; k < rooms.length; k++) {
    const room = rooms[k]!;
    const needExit = k < rooms.length - 1;
    const res = solveRoom(level, room, boxes, player, needExit, hallRow);
    if (res === null) return '';
    const sim = simulate(level, boxes, player, res.moves);
    if (sim === null) return '';
    boxes = sim.boxes;
    player = sim.player;
    moves += res.moves;
  }
  if (!boxes.every((b) => level.goal[b])) return '';
  // Final safety: replay the whole answer from the start and check it solves.
  const check = simulate(level, level.boxes, level.player, moves);
  if (check === null || !check.boxes.every((b) => level.goal[b])) return '';
  return moves;
}

for (const id of readdirSync(I).sort()) {
  let moves = '';
  try {
    moves = solveLevel(readFileSync(join(I, id, 'level.txt'), 'utf8'));
  } catch {
    moves = '';
  }
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
