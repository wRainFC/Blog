import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AstroMarkdownOptions } from "@astrojs/markdown-remark";
import { createMarkdownProcessor } from "@astrojs/markdown-remark";
import { CheckRunner } from "./check-runner";
import { ContentStore } from "./content-store";
import { DeployRunner } from "./deploy-runner";
import {
  parseDraft,
  parseReference,
  StudioError,
  type EntryReference,
} from "./model";

interface MiddlewareOptions {
  workspaceRoot: string;
  token: string;
  markdown: AstroMarkdownOptions;
  refreshContent?: () => Promise<void>;
}

type Next = (error?: unknown) => void;

const responseMime: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};

export function createStudioMiddleware(options: MiddlewareOptions) {
  const store = new ContentStore(options.workspaceRoot);
  const checks = new CheckRunner(options.workspaceRoot);
  const deploys = new DeployRunner(options.workspaceRoot);
  let processorPromise: ReturnType<typeof createMarkdownProcessor> | undefined;

  const renderMarkdown = async (body: string) => {
    processorPromise ??= createMarkdownProcessor(options.markdown);
    return (await processorPromise).render(body);
  };

  return async (request: IncomingMessage, response: ServerResponse, next: Next) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    const isApi = url.pathname.startsWith("/__content-studio/api/");
    const isAsset = url.pathname === "/__content-studio/asset";
    if (!isApi && !isAsset) return next();

    try {
      assertLocalHost(request.headers.host);
      if (isAsset) {
        assertToken(url.searchParams.get("token"), options.token);
        if (request.method !== "GET") throw new StudioError("方法不允许。", 405);
        const ref = referenceFromSearch(url.searchParams);
        const source = requiredSearch(url.searchParams, "path");
        const path = await store.resolvePreviewAsset(ref, source);
        const mime = responseMime[extname(path).toLowerCase()];
        if (!mime) throw new StudioError("资源类型不受支持。", 415);
        response.statusCode = 200;
        response.setHeader("Content-Type", mime);
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.end(await readFile(path));
        return;
      }

      assertToken(request.headers["x-content-studio-token"], options.token);
      if (request.method !== "GET") assertSameOrigin(request);
      response.setHeader("Cache-Control", "no-store");

      const action = url.pathname.slice("/__content-studio/api/".length);
      if (action === "catalog" && request.method === "GET") {
        return json(response, 200, await store.catalog());
      }

      if (action === "entry" && request.method === "GET") {
        return json(response, 200, await store.getEntry(referenceFromSearch(url.searchParams)));
      }

      if (action === "entry" && request.method === "PUT") {
        const payload = await readJson(request, 2 * 1024 * 1024);
        if (!isRecord(payload)) throw new StudioError("保存请求格式不正确。");
        const mode = payload.mode === "create" || payload.mode === "update" ? payload.mode : undefined;
        if (!mode) throw new StudioError("保存模式不正确。");
        const draft = parseDraft(payload.draft);
        const ref = payload.ref == null ? undefined : parseReference(payload.ref);
        const expectedRevision = typeof payload.expectedRevision === "string"
          ? payload.expectedRevision
          : undefined;
        const saved = await store.save({ mode, draft, ref, expectedRevision });
        let refreshWarning: string | undefined;
        try {
          await options.refreshContent?.();
        } catch (error) {
          refreshWarning = error instanceof Error ? error.message : String(error);
        }
        const checkJob = payload.runCheck === false ? undefined : checks.start();
        return json(response, 200, { ...saved, checkJob, refreshWarning });
      }

      if (action === "deploy" && request.method === "POST") {
        const payload = await readJson(request, 32 * 1024);
        if (!isRecord(payload)) throw new StudioError("发布请求格式不正确。");
        const ref = parseReference(payload.ref);
        const expectedRevision = typeof payload.expectedRevision === "string"
          ? payload.expectedRevision
          : undefined;
        if (!expectedRevision) throw new StudioError("发布请求缺少 revision。", 400);
        const entry = await store.getEntry(ref);
        if (entry.revision !== expectedRevision) {
          throw new StudioError("文件已在工作台之外发生变化，请重新加载后发布。", 409);
        }
        if (entry.draft.kind !== "course" && entry.draft.draft) {
          throw new StudioError("草稿不能发布，请先切换为公开状态。", 422);
        }
        return json(response, 202, deploys.start({
          ref,
          repoPath: entry.repoPath,
          sitePath: entry.sitePath,
          title: entry.draft.title,
        }));
      }

      if (action === "deploy" && request.method === "GET") {
        const job = deploys.get(url.searchParams.get("id") ?? undefined);
        if (!job) throw new StudioError("没有找到发布任务。", 404);
        return json(response, 200, job);
      }

      if (action === "preview" && request.method === "POST") {
        const payload = await readJson(request, 2 * 1024 * 1024);
        if (!isRecord(payload) || typeof payload.body !== "string") {
          throw new StudioError("预览请求格式不正确。");
        }
        const ref = payload.ref == null ? undefined : parseReference(payload.ref);
        try {
          const result = await renderMarkdown(payload.body);
          const code = ref
            ? rewriteRelativeImages(result.code, ref, options.token)
            : result.code;
          return json(response, 200, { html: code, headings: result.metadata.headings, diagnostics: [] });
        } catch (error) {
          return json(response, 200, {
            html: "",
            headings: [],
            diagnostics: [error instanceof Error ? error.message : String(error)],
          });
        }
      }

      if (action === "asset" && request.method === "POST") {
        const ref = referenceFromSearch(url.searchParams);
        const filename = requiredSearch(url.searchParams, "filename");
        const mime = String(request.headers["content-type"] ?? "").split(";", 1)[0].trim();
        const contents = await readBuffer(request, 10 * 1024 * 1024);
        const result = await store.saveAsset(ref, filename, mime, contents);
        return json(response, 200, result);
      }

      if (action === "check" && request.method === "POST") {
        return json(response, 202, checks.start());
      }

      if (action === "check" && request.method === "GET") {
        const job = checks.get(url.searchParams.get("id") ?? undefined);
        if (!job) throw new StudioError("没有找到校验任务。", 404);
        return json(response, 200, job);
      }

      throw new StudioError("接口不存在。", 404);
    } catch (error) {
      const studioError = error instanceof StudioError
        ? error
        : new StudioError(error instanceof Error ? error.message : String(error), 500);
      return json(response, studioError.status, {
        error: studioError.message,
        details: studioError.details,
      });
    }
  };
}

function rewriteRelativeImages(html: string, ref: EntryReference, token: string): string {
  return html.replace(
    /(<img\b[^>]*?\bsrc=)(["'])([^"']+)(\2)/gi,
    (match, prefix: string, quote: string, source: string) => {
      if (/^(?:[a-z]+:|\/\/|\/|#)/i.test(source)) return match;
      const params = new URLSearchParams({
        token,
        kind: ref.kind,
        id: ref.id,
        path: source.replaceAll("&amp;", "&"),
      });
      if (ref.course) params.set("course", ref.course);
      return `${prefix}${quote}/__content-studio/asset?${params}${quote}`;
    },
  );
}

function referenceFromSearch(params: URLSearchParams): EntryReference {
  return parseReference({
    kind: requiredSearch(params, "kind"),
    id: requiredSearch(params, "id"),
    course: params.get("course") || undefined,
  });
}

function requiredSearch(params: URLSearchParams, key: string): string {
  const value = params.get(key);
  if (!value) throw new StudioError(`缺少参数 ${key}。`);
  return value;
}

async function readJson(request: IncomingMessage, limit: number): Promise<unknown> {
  const contents = await readBuffer(request, limit);
  try {
    return JSON.parse(contents.toString("utf8"));
  } catch {
    throw new StudioError("请求正文不是有效 JSON。");
  }
}

async function readBuffer(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > limit) throw new StudioError("请求内容过大。", 413);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(value));
}

function assertLocalHost(host?: string): void {
  const hostname = (host ?? "").replace(/^\[|\]$|:\d+$/g, "").toLowerCase();
  if (hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "::1") {
    throw new StudioError("内容工作台只接受本机请求。", 403);
  }
}

function assertSameOrigin(request: IncomingMessage): void {
  const origin = request.headers.origin;
  if (!origin) throw new StudioError("缺少请求来源。", 403);
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    throw new StudioError("请求来源不合法。", 403);
  }
  if (originUrl.host !== request.headers.host) throw new StudioError("请求来源不匹配。", 403);
}

function assertToken(candidate: string | string[] | null | undefined, expected: string): void {
  const value = Array.isArray(candidate) ? candidate[0] : candidate ?? "";
  const left = Buffer.from(value);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new StudioError("内容工作台令牌无效。", 403);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
