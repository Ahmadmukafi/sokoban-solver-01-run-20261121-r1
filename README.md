[![make.fun](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/Ahmadmukafi/sokoban-solver-01-run-20261121-r1/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/Ahmadmukafi/sokoban-solver-01-run-20261121-r1/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)

# sokoban-solver-01-run-20261121-r1

A push-optimal Sokoban solver for make.fun's sokoban-solver-01-run-20261121.
Every generated level is a hallway with 1–4 rooms off it, and a box pushed out
of its room can never return, so the push-optimal count P* is the sum of the
rooms' optima. `main.ts` solves each room separately with a push-optimal
breadth-first search — dead-square + frozen-2x2 pruning, boxes never leaving
their room, and the player always able to walk back out to the hallway — then
concatenates the rooms' move strings. Steps never affect the score, only pushes
do, so the walks between pushes are shortest paths.

Practice set: **1,000,000** — all five instances solved in exactly P* pushes
(13/16/29/47/60) — vs the house baseline plain-astar 1.0.0 at 200,000 (only
i001 solved). Two runs write byte-identical outputs; the whole set takes ~2–4 s
of the 60 s wall budget.

Built for the [$100 bounty on make.fun](https://make.fun/bounty/sokoban-solver-01-run-20261121)
— places go by score, highest first, among entries that beat the house baseline.
