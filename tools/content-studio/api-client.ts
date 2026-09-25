import type { CheckJob } from "./check-runner";
import type { DeployJob } from "./deploy-runner";
import type {
  EditorEntry,
  DeleteEntryResult,
  EntryReference,
  StructurePreview,
  StructurePreviewRequest,
  WorkspaceSnapshot,
} from "./model";
import type { SaveResult, StructureResult } from "./content-store";

declare global { interface Window { __CONTENT_STUDIO_TOKEN__: string } }

export interface SaveResponse extends SaveResult { checkJob?: CheckJob; refreshWarning?: string }
export interface DeleteEntryResponse extends DeleteEntryResult { checkJob?: CheckJob; refreshWarning?: string }
export interface ApplyStructureResponse extends StructureResult { checkJob?: CheckJob; refreshWarning?: string }

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly details?: unknown) {
    super(message);
  }
}

export function loadWorkspace(): Promise<WorkspaceSnapshot> {
  return request("/__content-studio/api/workspace");
}

export function loadEntry(ref: EntryReference): Promise<EditorEntry> {
  return request(`/__content-studio/api/entry?${referenceParams(ref)}`);
}

export function saveEntry(payload: unknown): Promise<SaveResponse> {
  return request("/__content-studio/api/entry", { method: "PUT", body: JSON.stringify(payload) });
}

export function deleteEntry(ref: EntryReference, expectedRevision: string): Promise<DeleteEntryResponse> {
  return request("/__content-studio/api/entry", {
    method: "DELETE",
    body: JSON.stringify({ ref, expectedRevision }),
  });
}

export function previewStructure(payload: StructurePreviewRequest): Promise<StructurePreview> {
  return request("/__content-studio/api/structure/preview", { method: "POST", body: JSON.stringify(payload) });
}

export function applyStructure(changeSetId: string): Promise<ApplyStructureResponse> {
  return request("/__content-studio/api/structure/apply", { method: "POST", body: JSON.stringify({ changeSetId }) });
}

export function renderMarkdown(body: string, ref?: EntryReference): Promise<{ html: string; diagnostics: string[] }> {
  return request("/__content-studio/api/preview", { method: "POST", body: JSON.stringify({ body, ref }) });
}

export function startCheck(): Promise<CheckJob> {
  return request("/__content-studio/api/check", { method: "POST", body: "{}" });
}

export function getCheck(id: string): Promise<CheckJob> {
  return request(`/__content-studio/api/check?id=${encodeURIComponent(id)}`);
}

export function startDeploy(ref: EntryReference, expectedRevision: string): Promise<DeployJob> {
  return request("/__content-studio/api/deploy", { method: "POST", body: JSON.stringify({ ref, expectedRevision }) });
}

export function getDeploy(id: string): Promise<DeployJob> {
  return request(`/__content-studio/api/deploy?id=${encodeURIComponent(id)}`);
}

export async function uploadImage(ref: EntryReference, file: File) {
  return request<{ filename: string; markdownPath: string; repoPath: string }>(
    `/__content-studio/api/asset?${referenceParams(ref)}&filename=${encodeURIComponent(file.name)}`,
    { method: "POST", headers: { "Content-Type": file.type }, body: file },
  );
}

export function errorText(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) return `${error.message} 本地草稿仍然保留。`;
  return error instanceof Error ? error.message : String(error);
}

function referenceParams(ref: EntryReference): string {
  const params = new URLSearchParams({ kind: ref.kind, id: ref.id });
  if (ref.course) params.set("course", ref.course);
  return params.toString();
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-Content-Studio-Token", window.__CONTENT_STUDIO_TOKEN__);
  if (typeof init.body === "string") headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...init, headers });
  const result = await response.json();
  if (!response.ok) throw new ApiError(result.error ?? "请求失败。", response.status, result.details);
  return result as T;
}
