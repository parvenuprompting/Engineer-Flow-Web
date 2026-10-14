/** Small strict JSON schema parser, shared by the intake and evidence boundaries. */
export interface Schema<T> { readonly parse: (value: unknown, path: string) => T }
export class BoundaryError extends Error {
  constructor(readonly path: string, readonly code: string) { super(`${path}: ${code}`); }
}
export function reject(path: string, code: string): never { throw new BoundaryError(path, code); }
export const text = (max = 256): Schema<string> => ({ parse(value, path) {
  if (typeof value !== "string" || !value.trim() || value.length > max) reject(path, "invalid_string");
  return value;
} });
export const boolean: Schema<boolean> = { parse(value, path) {
  if (typeof value !== "boolean") reject(path, "invalid_boolean"); return value;
} };
export const number = (min = -Number.MAX_VALUE, max = Number.MAX_VALUE, integer = false): Schema<number> => ({ parse(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max
    || (integer && !Number.isSafeInteger(value))) reject(path, "invalid_number"); return value;
} });
export const enumeration = <T extends string | number>(...values: readonly T[]): Schema<T> => ({ parse(value, path) {
  const found = values.find(v => v === value);
  if (found === undefined) reject(path, "unknown_value"); return found;
} });
export const nullable = <T>(schema: Schema<T>): Schema<T | null> => ({ parse: (v, p) => v === null ? null : schema.parse(v, p) });
export const array = <T>(schema: Schema<T>, max = 1000): Schema<T[]> => ({ parse(value, path) {
  if (!Array.isArray(value) || value.length > max) reject(path, "invalid_array");
  return Array.from(value, (v: unknown, i) => schema.parse(v, `${path}[${i}]`));
} });
type Infer<S> = S extends Schema<infer T> ? T : never;
export const object = <S extends Record<string, Schema<unknown>>>(shape: S): Schema<{ [K in keyof S]: Infer<S[K]> }> => ({
  parse(value, path) {
    if (value === null || typeof value !== "object" || Array.isArray(value)
      || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null))
      reject(path, "invalid_object");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(value).length) reject(path, "symbol_key");
    for (const key of Object.keys(descriptors)) {
      if (!Object.hasOwn(shape, key)) reject(`${path}.${key}`, "unknown_field");
      if (!("value" in (descriptors[key] ?? {}))) reject(`${path}.${key}`, "accessor_not_allowed");
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(shape)) {
      const schema = shape[key];
      if (!schema || !Object.hasOwn(descriptors, key)) reject(`${path}.${key}`, "required_field");
      result[key] = schema.parse(descriptors[key]?.value, `${path}.${key}`);
    }
    // Each property was parsed by its corresponding schema above.
    return result as { [K in keyof S]: Infer<S[K]> };
  },
});
export const refine = <T>(schema: Schema<T>, predicate: (v: T) => boolean, code: string): Schema<T> => ({ parse(value, path) {
  const parsed = schema.parse(value, path); if (!predicate(parsed)) reject(path, code); return parsed;
} });
export const union = <T>(...schemas: readonly Schema<T>[]): Schema<T> => ({ parse(value, path) {
  for (const schema of schemas) {
    try { return schema.parse(value, path); } catch (error) { if (!(error instanceof BoundaryError)) throw error; }
  }
  return reject(path, "invalid_variant");
} });
export function freezeData<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeData(child);
    Object.freeze(value);
  }
  return value;
}
