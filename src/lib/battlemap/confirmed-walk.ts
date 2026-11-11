import type { XY } from "@/lib/battlemap/types";

const WALK_TTL_MS = 10_000;
const MAX_WALKS = 512;
declare global {
  var __odmConfirmedWalks: Map<string, { until: number; path: XY[] }> | undefined;
}

export function rememberWalk(tokenId: string, x: number, y: number, path?: XY[]): void {
  const walks = globalThis.__odmConfirmedWalks ??= new Map();
  if (!path || path.length < 2 || path.length > 128) {
    const last = walks.get(tokenId)?.path.at(-1);
    if (last && (last.x !== x || last.y !== y)) walks.delete(tokenId);
    return;
  }
  walks.delete(tokenId);
  walks.set(tokenId, { until: Date.now() + WALK_TTL_MS, path: path.map(({ x, y }) => ({ x, y })) });
  if (walks.size > MAX_WALKS) walks.delete(walks.keys().next().value!);
}

export function visibleWalk(tokenId: string, width: number, visible: Set<number>, fullVision: boolean): XY[] | undefined {
  const walk = globalThis.__odmConfirmedWalks?.get(tokenId);
  if (!walk || walk.until <= Date.now()) return;
  if (fullVision || walk.path.every(({ x, y }) => visible.has(y * width + x))) return walk.path;
}
