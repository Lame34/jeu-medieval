/**
 * Ground-plane vector in world metres. The core works on the (x, z) ground plane so that
 * rendering maps it to three.js as (x, height, z) with no axis swap.
 */
export interface Vec2 {
  readonly x: number;
  readonly z: number;
}

export function vec2(x: number, z: number): Vec2 {
  return { x, z };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, z: a.z + b.z };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, z: a.z - b.z };
}

export function scale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, z: a.z * s };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.z * b.z;
}

export function length(a: Vec2): number {
  return Math.hypot(a.x, a.z);
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function normalize(a: Vec2): Vec2 {
  const len = length(a);
  return len > 0 ? { x: a.x / len, z: a.z / len } : { x: 0, z: 0 };
}

export function lerpVec(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

export function equals(a: Vec2, b: Vec2, epsilon = 1e-9): boolean {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.z - b.z) <= epsilon;
}
