/**
 * 2D Vector Math Utilities
 * Using victor library for core operations
 */

import Victor from 'victor';

export type Vector2D = { x: number; y: number };

/**
 * Create a new vector
 */
export function vec(x: number, y: number): Vector2D {
  return { x, y };
}

/**
 * Create vector from Victor instance
 */
export function fromVictor(v: Victor): Vector2D {
  return { x: v.x, y: v.y };
}

/**
 * Convert to Victor for complex operations
 */
export function toVictor(v: Vector2D): Victor {
  return new Victor(v.x, v.y);
}

/**
 * Vector addition
 */
export function add(a: Vector2D, b: Vector2D): Vector2D {
  return { x: a.x + b.x, y: a.y + b.y };
}

/**
 * Vector subtraction
 */
export function subtract(a: Vector2D, b: Vector2D): Vector2D {
  return { x: a.x - b.x, y: a.y - b.y };
}

/**
 * Scalar multiplication
 */
export function scale(v: Vector2D, s: number): Vector2D {
  return { x: v.x * s, y: v.y * s };
}

/**
 * Vector magnitude (length)
 */
export function magnitude(v: Vector2D): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

/**
 * Normalize vector (unit vector)
 */
export function normalize(v: Vector2D): Vector2D {
  const mag = magnitude(v);
  if (mag === 0) return { x: 0, y: 0 };
  return { x: v.x / mag, y: v.y / mag };
}

/**
 * Distance between two points
 */
export function distance(a: Vector2D, b: Vector2D): number {
  return magnitude(subtract(b, a));
}

/**
 * Dot product
 */
export function dot(a: Vector2D, b: Vector2D): number {
  return a.x * b.x + a.y * b.y;
}

/**
 * Angle of vector in radians
 */
export function angle(v: Vector2D): number {
  return Math.atan2(v.y, v.x);
}

/**
 * Create vector from angle and magnitude
 */
export function fromAngle(radians: number, mag: number = 1): Vector2D {
  return {
    x: Math.cos(radians) * mag,
    y: Math.sin(radians) * mag,
  };
}

/**
 * Rotate vector by angle in radians
 */
export function rotate(v: Vector2D, radians: number): Vector2D {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: v.x * cos - v.y * sin,
    y: v.x * sin + v.y * cos,
  };
}

/**
 * Linear interpolation between two vectors
 */
export function lerp(a: Vector2D, b: Vector2D, t: number): Vector2D {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

/**
 * Clamp vector magnitude
 */
export function clampMagnitude(v: Vector2D, maxMag: number): Vector2D {
  const mag = magnitude(v);
  if (mag <= maxMag) return v;
  return scale(normalize(v), maxMag);
}

/**
 * Random vector within bounds
 */
export function randomInBounds(width: number, height: number): Vector2D {
  return {
    x: Math.random() * width,
    y: Math.random() * height,
  };
}

/**
 * Random unit vector (direction)
 */
export function randomDirection(): Vector2D {
  const angle = Math.random() * Math.PI * 2;
  return fromAngle(angle);
}

/**
 * Random vector within radius of center
 */
export function randomInRadius(center: Vector2D, radius: number): Vector2D {
  const angle = Math.random() * Math.PI * 2;
  const r = Math.random() * radius;
  return add(center, fromAngle(angle, r));
}

/**
 * Check if point is within bounds
 */
export function inBounds(
  v: Vector2D,
  width: number,
  height: number,
  margin: number = 0
): boolean {
  return (
    v.x >= margin &&
    v.x <= width - margin &&
    v.y >= margin &&
    v.y <= height - margin
  );
}

/**
 * Wrap position around bounds (toroidal)
 */
export function wrap(v: Vector2D, width: number, height: number): Vector2D {
  return {
    x: ((v.x % width) + width) % width,
    y: ((v.y % height) + height) % height,
  };
}

/**
 * Reflect vector off boundary
 */
export function reflect(v: Vector2D, normal: Vector2D): Vector2D {
  const d = 2 * dot(v, normal);
  return subtract(v, scale(normal, d));
}

/**
 * Steering behavior: seek target
 */
export function seek(
  position: Vector2D,
  target: Vector2D,
  currentVelocity: Vector2D,
  maxSpeed: number,
  maxForce: number
): Vector2D {
  const desired = subtract(target, position);
  const desiredNorm = normalize(desired);
  const desiredVel = scale(desiredNorm, maxSpeed);
  const steer = subtract(desiredVel, currentVelocity);
  return clampMagnitude(steer, maxForce);
}

/**
 * Steering behavior: flee from target
 */
export function flee(
  position: Vector2D,
  target: Vector2D,
  currentVelocity: Vector2D,
  maxSpeed: number,
  maxForce: number
): Vector2D {
  return scale(seek(position, target, currentVelocity, maxSpeed, maxForce), -1);
}

/**
 * Steering behavior: wander (random exploration)
 */
export function wander(
  direction: Vector2D,
  wanderStrength: number = 0.3
): Vector2D {
  const randomAngle = (Math.random() - 0.5) * Math.PI * wanderStrength;
  return normalize(rotate(direction, randomAngle));
}
