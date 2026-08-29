/**
 * JcodeAdapter — shape type for the jcode provider adapter.
 *
 * Mirrors {@link ./CursorAdapter} — the driver bundles one adapter per
 * instance as a captured closure, so we only retain the shape interface as a
 * nominal anchor for the driver bundle.
 *
 * @module JcodeAdapter
 */
import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

/** Per-instance jcode adapter contract. */
export interface JcodeAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {}
