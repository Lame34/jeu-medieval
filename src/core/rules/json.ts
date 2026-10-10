/**
 * Dependency-free readers of raw JSON data (the rule files, the campaign): each checks one value
 * and names its JSON path in the error, so a broken data file is diagnosed at load time.
 */
export class RulesValidationError extends Error {
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'RulesValidationError';
  }
}

export type Json = Record<string, unknown>;

export function obj(value: unknown, path: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RulesValidationError(path, 'expected an object');
  }
  return value as Json;
}

export function num(value: unknown, path: string, min = -Infinity, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new RulesValidationError(path, 'expected a finite number');
  if (value < min || value > max) throw new RulesValidationError(path, `expected a value in [${min}, ${max}], got ${value}`);
  return value;
}

export function integer(value: unknown, path: string, min = -Infinity, max = Infinity): number {
  const n = num(value, path, min, max);
  if (!Number.isInteger(n)) throw new RulesValidationError(path, `expected an integer, got ${n}`);
  return n;
}

export function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new RulesValidationError(path, 'expected a boolean');
  return value;
}

export function str(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new RulesValidationError(path, 'expected a non-empty string');
  return value;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new RulesValidationError(path, `expected one of ${allowed.join(', ')}`);
  }
  return value as T;
}

export function strings(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) throw new RulesValidationError(path, 'expected an array of strings');
  return value as string[];
}

export function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new RulesValidationError(path, 'expected a non-empty string');
  return value;
}
