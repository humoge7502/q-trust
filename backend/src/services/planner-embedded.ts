/**
 * Embedded ONNX planner.
 *
 * The hosted API must not depend on an operator laptop behind a quick tunnel:
 * a dead tunnel turned every plan request into a 503. This module serves the
 * same exported GNN/RL checkpoints through ONNX Runtime Web (WASM) inside the
 * API process, with graph construction, ranking, scheduling and validation
 * matching the Python planner (`planner-service/lib/planner_core.py`).
 *
 * The Python service remains the reference implementation for self-hosting;
 * both consume the same SHA-256-pinned ONNX artifacts in `assets/planner/`.
 * Model integrity is verified before the first inference and fails closed.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import * as ort from "onnxruntime-web";

const requireFromHere = createRequire(import.meta.url);

const ASSETS_DIR =
  process.env.QTRUST_PLANNER_ASSETS ??
  fileURLToPath(new URL("../../assets/planner/", import.meta.url));

interface PlannerManifest {
  model_file: string;
  sha256: string;
  bytes: number;
  cfg: Record<string, unknown>;
  eval_metrics: Record<string, unknown>;
  rl: { model_file: string; sha256: string; bytes: number };
}

const MANIFEST = JSON.parse(
  readFileSync(path.join(ASSETS_DIR, "manifest.json"), "utf8"),
) as PlannerManifest;

const ALGORITHM_PROFILES = (
  JSON.parse(readFileSync(path.join(ASSETS_DIR, "algorithms.json"), "utf8")) as {
    algorithm_profiles?: Record<string, { migrate_days?: number }>;
  }
).algorithm_profiles ?? {};

const ALGORITHM_TYPE_MAP: Record<string, number> = {
  RSA: 0,
  ECC: 1,
  DSA: 2,
  DH: 3,
  ECDH: 4,
  ECDSA: 5,
  EdDSA: 6,
  SHA: 7,
  AES: 8,
  HMAC: 9,
  ChaCha20: 10,
  "ML-KEM": 11,
  "ML-DSA": 12,
  "SLH-DSA": 13,
  Unknown: 14,
};
const ALGORITHM_UPPER = new Map(
  Object.entries(ALGORITHM_TYPE_MAP).map(([k, v]) => [k.toUpperCase(), v]),
);

const CRITICALITY_W: Record<string, number> = {
  Critical: 5, High: 4, Medium: 3, Low: 2, Info: 1,
  critical: 5, high: 4, medium: 3, low: 2, info: 1,
};
const PQC_FAMILIES = new Set([
  "ML-KEM", "MLKEM", "ML-DSA", "MLDSA", "SLH-DSA", "SLHDSA", "HQC", "FALCON",
]);

const DEFAULT_MAX_CBOM_ASSETS = 5_000;
function maxCbomAssets(): number {
  const raw = Number.parseInt(process.env.QTRUST_MAX_CBOM_ASSETS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_CBOM_ASSETS;
}

const RL_BUDGET_MS = 2_000;

export class PlannerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlannerValidationError";
  }
}

export class PlannerIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlannerIntegrityError";
  }
}

// ── Algorithm encoding + heuristics (mirror qtrust_common.heuristics) ────────

export function encodeAlgorithmType(algorithm: string): number {
  const upper = algorithm.toUpperCase();
  const direct = ALGORITHM_UPPER.get(upper);
  if (direct !== undefined) return direct;
  if (upper.includes("WITHRSA") || upper.startsWith("RSA")) return 0;
  if (upper.includes("ECDSA")) return 5;
  if (upper.includes("ED25519") || upper.includes("ED448")) return 6;
  if (upper.includes("ID-ECPUBLICKEY") || upper === "EC") return 1;
  if (upper.includes("ML-KEM") || upper.includes("MLKEM") || upper === "KYBER") return 11;
  if (upper.includes("ML-DSA") || upper.includes("MLDSA") || upper === "DILITHIUM") return 12;
  if (upper.includes("SLH-DSA") || upper.includes("SLHDSA") || upper.includes("SPHINCS")) return 13;
  if (upper.includes("X25519") || upper.includes("X448")) return 4;
  for (const [prefix, code] of ALGORITHM_UPPER) {
    if (upper.startsWith(prefix)) return code;
  }
  return 14;
}

function family(algorithm: string): string {
  if (!algorithm) return "UNKNOWN";
  return algorithm.split("-")[0]!.split("_")[0]!.toUpperCase();
}

export function isPqcAlgorithm(algorithm: string): boolean {
  const fam = family(algorithm);
  for (const p of PQC_FAMILIES) {
    if (fam.includes(p) || p.includes(fam)) return true;
  }
  return algorithm.toUpperCase().includes("PQC");
}

interface AssetFacts {
  algorithm?: string | null;
  key_size?: number | string | null;
  criticality?: string | null;
  pqc_ready?: boolean;
}

export function pqcPriority(asset: AssetFacts): number {
  const crit = CRITICALITY_W[String(asset.criticality ?? "Medium")] ?? 3;
  const keySize = toKeySize(asset.key_size, 0);
  const pqcReady = Boolean(asset.pqc_ready);
  const algorithm = asString(asset.algorithm, "unknown");
  const fam = family(algorithm);
  let score = crit;
  if (!pqcReady && !isPqcAlgorithm(algorithm)) {
    if (["RSA", "ECC", "DSA", "DH", "ECDH", "ECDSA"].includes(fam)) score += 3;
    else if (fam === "EDDSA") score += 2;
    else score += 1;
  }
  if (keySize >= 4096) score += 2;
  else if (keySize >= 2048) score += 1;
  if (pqcReady || isPqcAlgorithm(algorithm)) score -= 2;
  return score;
}

export function pqcRisk(asset: AssetFacts): number {
  const algorithm = asString(asset.algorithm, "");
  if (Boolean(asset.pqc_ready) || isPqcAlgorithm(algorithm)) return 0.1;
  const crit = CRITICALITY_W[String(asset.criticality ?? "Medium")] ?? 3;
  let base = crit / 5;
  const alg = algorithm.toUpperCase();
  if (alg.includes("RSA") && toKeySize(asset.key_size, 2048) < 2048) base = Math.max(base, 0.9);
  return Math.min(base, 1);
}

// ── Request validation + graph construction (mirror planner predict) ────────

export interface PlannerAsset {
  asset_id?: string;
  algorithm?: string;
  host?: string;
  port?: number;
  key_size?: number | string | null;
  criticality?: string;
  pqc_ready?: boolean;
  [key: string]: unknown;
}

interface PlannerRecord {
  index: number;
  asset_id: string;
  algorithm: string;
  host: string;
  port: number;
  key_size: number;
  criticality: string;
  pqc_ready: boolean;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function toKeySize(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === false || value === "") return fallback;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return fallback;
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^[+-]?\d+$/.test(trimmed)) return fallback;
    return Number.parseInt(trimmed, 10);
  }
  if (value === true) return 1;
  return fallback;
}

export function parseAssets(cbom: Record<string, unknown>): PlannerAsset[] {
  const assets = cbom.assets;
  if (!Array.isArray(assets)) throw new PlannerValidationError("cbom.assets must be a list");
  if (assets.length === 0) throw new PlannerValidationError("CBOM has no assets");
  const cap = maxCbomAssets();
  if (assets.length > cap) {
    throw new PlannerValidationError(
      `CBOM has ${assets.length} assets; the service caps planning at ${cap} (set QTRUST_MAX_CBOM_ASSETS to adjust)`,
    );
  }
  return assets.map((raw, i) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new PlannerValidationError(
        `cbom.assets[${i}] must be an object, got ${raw === null ? "null" : Array.isArray(raw) ? "array" : typeof raw}`,
      );
    }
    const asset = raw as PlannerAsset;
    const key = asset.key_size;
    if (
      key !== undefined &&
      key !== null &&
      key !== "" &&
      typeof key !== "boolean" &&
      !(typeof key === "number" && Number.isFinite(key)) &&
      !(typeof key === "string" && /^[+-]?\d+$/.test(key.trim()))
    ) {
      throw new PlannerValidationError(
        `cbom.assets[${i}].key_size must be an integer, got ${JSON.stringify(key)}`,
      );
    }
    return { ...asset, key_size: toKeySize(key, 0) };
  });
}

function dependencyEdges(deps: unknown, nAssets: number): Array<[number, number]> {
  if (deps && typeof deps === "object" && !Array.isArray(deps)) {
    const edges = (deps as { edges?: unknown }).edges;
    const parsed: Array<[number, number]> = [];
    if (Array.isArray(edges)) {
      for (const edge of edges) {
        if (!Array.isArray(edge) || edge.length < 2) continue;
        const src = Number(edge[0]);
        const tgt = Number(edge[1]);
        if (!Number.isInteger(src) || !Number.isInteger(tgt)) continue;
        if (src < 0 || src >= nAssets || tgt < 0 || tgt >= nAssets || src === tgt) continue;
        parsed.push([src, tgt]);
      }
    }
    if (parsed.length) return parsed;
  }
  return Array.from({ length: Math.max(nAssets - 1, 0) }, (_, i) => [0, i + 1] as [number, number]);
}

function buildGraph(
  cbom: Record<string, unknown>,
  deps: unknown,
  assets: PlannerAsset[],
): { x: Float32Array; edgeIndex: BigInt64Array; records: PlannerRecord[] } {
  const n = assets.length;
  const daysToDeadline = Number(cbom.days_to_deadline ?? 0) || 0;
  const deadlinePressure =
    daysToDeadline > 0 && daysToDeadline < 180 ? 2 : daysToDeadline > 0 ? 1 : 0;

  const x = new Float32Array(n * 6);
  const records: PlannerRecord[] = [];
  assets.forEach((asset, i) => {
    const algorithm = asString(asset.algorithm, "unknown");
    const fam = algorithm.includes("-") ? algorithm.split("-")[0]! : algorithm;
    const typeCode = encodeAlgorithmType(fam);
    const keySize = toKeySize(asset.key_size, 0);
    const vendorPqcReady = Boolean(asset.pqc_ready);
    const criticality = CRITICALITY_W[String(asset.criticality ?? "Medium")] ?? 3;
    const requiredRate = Math.min((deadlinePressure * criticality) / 5, 1);
    x[i * 6] = typeCode / 14;
    x[i * 6 + 1] = Math.min(keySize / 4096, 1);
    x[i * 6 + 2] = vendorPqcReady ? 1 : 0;
    x[i * 6 + 3] = criticality / 5;
    x[i * 6 + 4] = Math.min(daysToDeadline / 730, 1);
    x[i * 6 + 5] = requiredRate;

    records.push({
      index: i,
      asset_id: asString(asset.asset_id, `asset-${String(i).padStart(4, "0")}`),
      algorithm,
      host: asString(asset.host, ""),
      port: typeof asset.port === "number" ? asset.port : 0,
      key_size: keySize,
      criticality: asString(asset.criticality, "Medium"),
      pqc_ready: vendorPqcReady,
    });
  });

  const edges = dependencyEdges(deps, n);
  const edgeIndex = new BigInt64Array(edges.length * 2);
  edges.forEach(([src, tgt], i) => {
    edgeIndex[i] = BigInt(src);
    edgeIndex[edges.length + i] = BigInt(tgt);
  });
  return { x, edgeIndex, records };
}

// ── ONNX sessions with fail-closed integrity verification ───────────────────

let gnnSession: Promise<ort.InferenceSession> | undefined;
let rlSession: Promise<ort.InferenceSession> | undefined;
let ortConfigured = false;

function configureOrt(): void {
  if (ortConfigured) return;
  // Serverless containers have one CPU and no worker pool; thread-spawning
  // WASM would either fail or add cold-start cost for a 7-node graph.
  ort.env.wasm.numThreads = 1;
  const entry = requireFromHere.resolve("onnxruntime-web");
  const wasmDir = process.env.QTRUST_ONNX_WASM_DIR ?? path.dirname(entry);
  ort.env.wasm.wasmPaths = pathToFileURL(wasmDir + path.sep).href;
  ortConfigured = true;
}

function verifyArtifact(file: string, expectedSha: string): Uint8Array {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path.join(ASSETS_DIR, file));
  } catch {
    throw new PlannerIntegrityError(`missing pinned artifact: ${file}`);
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expectedSha) {
    throw new PlannerIntegrityError(
      `${file} sha256 mismatch (expected ${expectedSha.slice(0, 12)}…, got ${actual.slice(0, 12)}…)`,
    );
  }
  return new Uint8Array(bytes);
}

function loadSession(kind: "gnn" | "rl"): Promise<ort.InferenceSession> {
  configureOrt();
  const entry = kind === "gnn" ? MANIFEST : MANIFEST.rl;
  if (!entry?.model_file || !entry.sha256) {
    return Promise.reject(new PlannerIntegrityError(`manifest has no ${kind} artifact`));
  }
  const bytes = verifyArtifact(entry.model_file, entry.sha256);
  return ort.InferenceSession.create(bytes, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
}

function session(kind: "gnn" | "rl"): Promise<ort.InferenceSession> {
  if (kind === "gnn") {
    gnnSession ??= loadSession("gnn").catch((err) => {
      gnnSession = undefined;
      throw err;
    });
    return gnnSession;
  }
  rlSession ??= loadSession("rl").catch((err) => {
    rlSession = undefined;
    throw err;
  });
  return rlSession;
}

export function modelInfo(): Record<string, unknown> {
  return {
    mode: "gnn-onnx",
    arch: "MigrationGNNv3",
    variant: "v3_real_onnx",
    path: MANIFEST.model_file,
    config: MANIFEST.cfg,
    eval_metrics: MANIFEST.eval_metrics,
    integrity: "sha256-pinned",
    runtime: "onnxruntime-web/wasm-node",
    served: true,
  };
}

async function predict(
  x: Float32Array,
  nAssets: number,
  edgeIndex: BigInt64Array,
  edgeCount: number,
): Promise<{ order: Float32Array; risk: Float32Array }> {
  const s = await session("gnn");
  const feeds: Record<string, ort.Tensor> = {
    x: new ort.Tensor("float32", x, [nAssets, 6]),
    edge_index: new ort.Tensor("int64", edgeIndex, [2, edgeCount]),
  };
  const out = await s.run(feeds);
  const names = s.outputNames;
  const order = (out[names[0]!]!.data as Float32Array) ?? new Float32Array(0);
  const risk = (out[names[1]!]!.data as Float32Array) ?? new Float32Array(0);
  return { order, risk };
}

// ── Scheduling (mirror planner _build_schedule) ─────────────────────────────

const DAY_MS = 86_400_000;

function todayUtc(): number {
  // Pinning the day makes schedule parity testable and replays reproducible.
  const pinned = /^(\d{4})-(\d{2})-(\d{2})$/.exec(
    (process.env.QTRUST_PLANNER_TODAY ?? "").trim(),
  );
  if (pinned) {
    return Date.UTC(Number(pinned[1]), Number(pinned[2]) - 1, Number(pinned[3]));
  }
  const now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

function parseDeadline(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new PlannerValidationError("deadline must be ISO date YYYY-MM-DD");
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(value.trim());
  if (!m) throw new PlannerValidationError("deadline must be ISO date YYYY-MM-DD");
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new PlannerValidationError("deadline must be ISO date YYYY-MM-DD");
  }
  return ms;
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function estimateMigrateDays(algorithm: string, keySize: number): number {
  const fam = algorithm.includes("-") ? algorithm.split("-")[0]! : algorithm;
  for (const [name, profile] of Object.entries(ALGORITHM_PROFILES)) {
    if (
      algorithm.toUpperCase() === name.toUpperCase() ||
      (algorithm.toUpperCase().startsWith(name.toUpperCase()) && algorithm.length <= name.length + 4)
    ) {
      return Number(profile.migrate_days ?? 1);
    }
  }
  if (["RSA", "ECC", "DSA", "DH", "ECDH", "ECDSA"].includes(fam)) return 1.5;
  return 0.5;
}

interface MigrationItem {
  asset_id: string;
  algorithm: string;
  host?: string;
  port?: number;
  key_size: number;
  criticality: string;
  pqc_ready: boolean;
  priority_score: number;
  risk_score: number;
  migrate_days: number;
  [key: string]: unknown;
}

export function buildSchedule(migrationOrder: MigrationItem[], deadlineMs: number): Record<string, unknown> {
  const today = todayUtc();
  const daysAvailable = Math.max(Math.floor((deadlineMs - today) / DAY_MS), 0);
  const totalEffort = migrationOrder.reduce((sum, a) => sum + a.migrate_days, 0);
  const feasible = totalEffort <= Math.max(daysAvailable, 1);
  const overflowDays = Math.max(0, totalEffort - Math.max(daysAvailable, 1));
  let cursor = deadlineMs;
  const windows: Array<Record<string, unknown>> = [];
  for (const asset of [...migrationOrder].reverse()) {
    // Python `date + timedelta` uses the timedelta's days component only.
    const days = Math.floor(asset.migrate_days);
    const start = cursor - days * DAY_MS;
    const clampedStart = Math.max(start, today);
    windows.push({
      asset_id: asset.asset_id,
      start: isoDate(clampedStart),
      end: isoDate(cursor),
      migrate_days: asset.migrate_days,
      clamped_to_today: clampedStart !== start,
    });
    cursor = start;
  }
  windows.reverse();
  const dailyRate = daysAvailable ? totalEffort / Math.max(daysAvailable, 1) : null;
  return {
    deadline: isoDate(deadlineMs),
    days_available: daysAvailable,
    total_effort_days: totalEffort,
    feasible,
    overflow_days: Math.round(overflowDays * 100) / 100,
    suggested_daily_rate: dailyRate === null ? null : Math.round(dailyRate * 100) / 100,
    windows,
  };
}

// ── Endpoint handlers ───────────────────────────────────────────────────────

interface PlannerPayload {
  cbom?: Record<string, unknown> | null;
  deps?: unknown;
  deadline?: unknown;
}

function payloadCbom(payload: PlannerPayload): Record<string, unknown> {
  const cbom = payload.cbom ?? {};
  if (cbom === null || typeof cbom !== "object" || Array.isArray(cbom)) {
    throw new PlannerValidationError("cbom must be an object");
  }
  return cbom as Record<string, unknown>;
}

function orderItems(
  records: PlannerRecord[],
  priority: ArrayLike<number>,
  risk: ArrayLike<number>,
): MigrationItem[] {
  const indices = records.map((_, i) => i);
  indices.sort((a, b) => Number(priority[b]) - Number(priority[a]));
  return indices.map((idx, rank) => {
    const asset = records[idx]!;
    return {
      rank: rank + 1,
      asset_id: asset.asset_id,
      algorithm: asset.algorithm,
      host: asset.host,
      port: asset.port,
      key_size: asset.key_size,
      criticality: asset.criticality,
      pqc_ready: asset.pqc_ready,
      priority_score: Number(priority[idx]),
      risk_score: Number(risk[idx]),
      migrate_days: estimateMigrateDays(asset.algorithm, asset.key_size),
    };
  });
}

export async function planEmbedded(payload: PlannerPayload): Promise<Record<string, unknown>> {
  const cbom = payloadCbom(payload);
  const assets = parseAssets(cbom);
  const deadline = parseDeadline(payload.deadline);
  const { x, edgeIndex, records } = buildGraph(cbom, payload.deps, assets);

  let priority: Float32Array | number[];
  let risk: Float32Array | number[];
  try {
    const prediction = await predict(x, records.length, edgeIndex, edgeIndex.length / 2);
    priority = prediction.order;
    risk = prediction.risk;
  } catch (err) {
    if (err instanceof PlannerIntegrityError) throw err;
    // An ONNX runtime failure must not take planning down. Ordering falls back
    // to the canonical heuristic; `model.runtime` still identifies the model,
    // and callers see `planner_mode` so a silent downgrade is observable.
    priority = records.map((a) => pqcPriority(a));
    risk = records.map((a) => pqcRisk(a));
  }

  const migrationOrder = orderItems(records, priority, risk);
  return {
    planner: "qtrust-planner",
    planner_mode: "embedded-onnx",
    model: modelInfo(),
    total_assets: records.length,
    deadline: deadline === null ? null : isoDate(deadline),
    migration_order: migrationOrder,
    schedule: deadline === null ? null : buildSchedule(migrationOrder, deadline),
  };
}

async function rlOrder(
  cbom: Record<string, unknown>,
  deps: unknown,
  assets: PlannerAsset[],
): Promise<MigrationItem[] | null> {
  const s = await session("rl");
  const n = assets.length;
  const x = new Float32Array(n * 6);
  const records: PlannerRecord[] = [];
  assets.forEach((a, i) => {
    const algorithm = asString(a.algorithm, "unknown");
    const keySize = toKeySize(a.key_size, 0);
    const critMap: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
    const crit = critMap[String(a.criticality ?? "Medium").toLowerCase()] ?? 2;
    x[i * 6] = encodeAlgorithmType(algorithm) / 14;
    x[i * 6 + 1] = Math.min(keySize / 4096, 1);
    x[i * 6 + 2] = a.pqc_ready ? 1 : 0;
    x[i * 6 + 3] = crit / 5;
    x[i * 6 + 4] = 365 / 3650;
    x[i * 6 + 5] = 0.5;
    records.push({
      index: i,
      asset_id: asString(a.asset_id, `asset-${String(i).padStart(4, "0")}`),
      algorithm,
      host: asString(a.host, ""),
      port: typeof a.port === "number" ? a.port : 0,
      key_size: keySize,
      criticality: asString(a.criticality, "Medium"),
      pqc_ready: Boolean(a.pqc_ready),
    });
  });

  const depPairs: Array<[number, number]> = [];
  if (deps && typeof deps === "object" && !Array.isArray(deps)) {
    const edges = (deps as { edges?: unknown }).edges;
    if (Array.isArray(edges)) {
      for (const edge of edges) {
        if (!Array.isArray(edge) || edge.length < 2) continue;
        const src = Number(edge[0]);
        const tgt = Number(edge[1]);
        if (!Number.isInteger(src) || !Number.isInteger(tgt)) continue;
        if (src < 0 || src >= n || tgt < 0 || tgt >= n || src === tgt) continue;
        depPairs.push([src, tgt]);
      }
    }
  }
  const edgeIndex = new BigInt64Array(depPairs.length * 2);
  depPairs.forEach(([src, tgt], i) => {
    edgeIndex[i] = BigInt(src);
    edgeIndex[depPairs.length + i] = BigInt(tgt);
  });

  const migrated = new Array<boolean>(n).fill(false);
  const orderIdx: number[] = [];
  const started = Date.now();
  let lastLogits: Float32Array | null = null;
  while (orderIdx.length < n) {
    if (Date.now() - started > RL_BUDGET_MS) return null;
    const out = await s.run({
      x: new ort.Tensor("float32", x, [n, 6]),
      edge_index: new ort.Tensor("int64", edgeIndex, [2, depPairs.length]),
    });
    const logits = out[s.outputNames[0]!]!.data as Float32Array;
    lastLogits = logits;
    let action = -1;
    let best = -Infinity;
    for (let i = 0; i < n; i += 1) {
      if (migrated[i]) continue;
      const blocked = depPairs.some(([src, tgt]) => tgt === i && !migrated[src]);
      if (blocked) continue;
      const value = logits[i]!;
      if (value > best) {
        best = value;
        action = i;
      }
    }
    if (action < 0) break;
    migrated[action] = true;
    orderIdx.push(action);
  }

  return orderIdx.map((idx, rank) => {
    const asset = records[idx]!;
    return {
      rank: rank + 1,
      asset_id: asset.asset_id,
      algorithm: asset.algorithm,
      host: asset.host,
      port: asset.port,
      key_size: asset.key_size,
      criticality: asset.criticality,
      pqc_ready: asset.pqc_ready,
      priority_score: lastLogits ? lastLogits[idx]! : 0,
      risk_score: pqcRisk(asset),
      migrate_days: estimateMigrateDays(asset.algorithm, asset.key_size),
    };
  });
}

export async function rlPlanEmbedded(payload: PlannerPayload): Promise<Record<string, unknown>> {
  const cbom = payloadCbom(payload);
  const assets = parseAssets(cbom);
  const deadline = parseDeadline(payload.deadline);

  let migrationOrder: MigrationItem[] | null = null;
  let method = "rl_policy_onnx";
  try {
    migrationOrder = await rlOrder(cbom, payload.deps, assets);
  } catch (err) {
    if (err instanceof PlannerIntegrityError) throw err;
    migrationOrder = null;
  }

  if (!migrationOrder) {
    const records: PlannerRecord[] = assets.map((a, i) => ({
      index: i,
      asset_id: asString(a.asset_id, `asset-${String(i).padStart(4, "0")}`),
      algorithm: asString(a.algorithm, "unknown"),
      host: asString(a.host, ""),
      port: typeof a.port === "number" ? a.port : 0,
      key_size: toKeySize(a.key_size, 0),
      criticality: asString(a.criticality, "Medium"),
      pqc_ready: Boolean(a.pqc_ready),
    }));
    const scores = records.map((a) => pqcPriority(a));
    const indices = records.map((_, i) => i);
    indices.sort((a, b) => scores[b]! - scores[a]!);
    migrationOrder = indices.map((idx, rank) => {
      const asset = records[idx]!;
      return {
        rank: rank + 1,
        asset_id: asset.asset_id,
        algorithm: asset.algorithm,
        host: asset.host,
        port: asset.port,
        key_size: asset.key_size,
        criticality: asset.criticality,
        pqc_ready: asset.pqc_ready,
        priority_score: scores[idx]!,
        risk_score: pqcRisk(asset),
        migrate_days: estimateMigrateDays(asset.algorithm, asset.key_size),
      };
    });
    method = "heuristic_fallback";
  }

  return {
    planner: "qtrust-planner",
    planner_mode: "embedded-onnx",
    model: modelInfo(),
    method,
    total_assets: migrationOrder.length,
    deadline: deadline === null ? null : isoDate(deadline),
    migration_order: migrationOrder,
    schedule: deadline === null ? null : buildSchedule(migrationOrder, deadline),
  };
}

export async function plannerHealth(): Promise<Record<string, unknown>> {
  let served = true;
  let integrity = "sha256-verified";
  try {
    await session("gnn");
  } catch (err) {
    served = false;
    integrity = `failed: ${err instanceof PlannerIntegrityError ? "PlannerIntegrityError" : (err as Error).name}`;
  }
  return {
    status: served ? "ok" : "error",
    model: { ...modelInfo(), integrity, served },
  };
}

/** Map embedded-planner failures onto the Python planner's HTTP contract. */
export function plannerErrorResponse(err: unknown): { status: number; body: Record<string, unknown> } {
  if (err instanceof PlannerValidationError) {
    return { status: 422, body: { detail: err.message } };
  }
  if (err instanceof PlannerIntegrityError) {
    return {
      status: 503,
      body: { error: "planner model integrity check failed", code: "planner_model_integrity_failed" },
    };
  }
  return { status: 500, body: { error: "planner inference failed", code: "planner_internal_error" } };
}

/**
 * Hosted/serverless deployments always plan in-process; the Python planner is
 * for self-hosting (docker compose) and receives remote traffic only there.
 */
export function embeddedPlannerEnabled(): boolean {
  return (
    process.env.QTRUST_PLANNER_MODE === "embedded" ||
    process.env.QTRUST_SERVERLESS === "1" ||
    Boolean(process.env.VERCEL)
  );
}
