import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { posix } from "node:path";
import type { EntryReference } from "./model";

export type DeployStatus =
  | "queued"
  | "checking"
  | "building"
  | "committing"
  | "pushing"
  | "passed"
  | "failed";

export interface DeployJob {
  id: string;
  status: DeployStatus;
  output: string;
  sitePath: string;
  commit?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface DeployRequest {
  ref: EntryReference;
  repoPath: string;
  sitePath: string;
  title: string;
}

interface CommandResult {
  output: string;
  stdout: string;
}

export class DeployRunner {
  private readonly jobs = new Map<string, DeployJob>();
  private queue: Promise<void> = Promise.resolve();
  private latestId?: string;

  constructor(private readonly workspaceRoot: string) {}

  start(request: DeployRequest): DeployJob {
    const job: DeployJob = {
      id: randomUUID(),
      status: "queued",
      output: "等待发布任务开始……\n",
      sitePath: request.sitePath,
    };
    this.jobs.set(job.id, job);
    this.latestId = job.id;
    this.trimJobs();
    this.queue = this.queue.then(() => this.run(job, request)).catch((error) => {
      job.status = "failed";
      job.output += `\n发布失败：${error instanceof Error ? error.message : String(error)}\n`;
      job.finishedAt = new Date().toISOString();
    });
    return { ...job };
  }

  get(id?: string): DeployJob | undefined {
    const job = this.jobs.get(id ?? this.latestId ?? "");
    return job ? { ...job } : undefined;
  }

  private async run(job: DeployJob, request: DeployRequest): Promise<void> {
    job.startedAt = new Date().toISOString();
    job.status = "checking";
    job.output = "1/4 正在检查内容与站点……\n";
    await this.runPnpm(job, ["check"]);

    job.status = "building";
    job.output += "\n2/4 正在生成生产站点……\n";
    await this.runPnpm(job, ["build"]);

    job.status = "committing";
    job.output += "\n3/4 正在创建内容提交……\n";
    const branch = (await this.runCommand(job, "git", ["branch", "--show-current"], false)).stdout.trim();
    if (branch !== "main") {
      throw new Error(`一键发布只允许在 main 分支运行；当前分支是 ${branch || "未知"}。`);
    }

    const allowed = await publishPaths(this.workspaceRoot, request);
    const status = await this.runCommand(job, "git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], false);
    const changed = parseStatusPaths(status.stdout);
    const unrelated = changed.filter((path) => !isAllowedPublishPath(path, allowed));
    if (unrelated.length) {
      throw new Error(`工作区还有其他改动，请先处理后再发布：\n${unrelated.map((path) => `- ${path}`).join("\n")}`);
    }

    const paths = allowed.filter((path) => changed.some((changedPath) => isPathWithin(changedPath, path)));
    if (paths.length) {
      await this.runCommand(job, "git", ["add", "--", ...paths]);
      const staged = await this.runCommand(job, "git", ["diff", "--cached", "--name-only", "-z"], false);
      const stagedPaths = staged.stdout.split("\0").filter(Boolean).map(normalizeRepoPath);
      const unexpected = stagedPaths.filter((path) => !isAllowedPublishPath(path, allowed));
      if (unexpected.length) {
        throw new Error(`暂存区包含非本篇内容，已停止发布：\n${unexpected.map((path) => `- ${path}`).join("\n")}`);
      }
      await this.runCommand(job, "git", ["commit", "-m", `content: publish ${request.title}`, "--", ...paths]);
      job.commit = (await this.runCommand(job, "git", ["rev-parse", "--short", "HEAD"], false)).stdout.trim();
    } else {
      job.output += "当前文章没有新的本地改动，跳过提交。\n";
    }

    job.status = "pushing";
    job.output += "\n4/4 正在推送到 GitHub……\n";
    await this.runCommand(job, "git", ["push", "origin", "HEAD:main"]);
    job.status = "passed";
    job.finishedAt = new Date().toISOString();
    job.output += "\n已推送到 origin/main，外部托管平台将开始部署。\n";
  }

  private async runPnpm(job: DeployJob, args: string[]): Promise<CommandResult> {
    return process.platform === "win32"
      ? this.runCommand(job, process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `pnpm.cmd ${args.join(" ")}`])
      : this.runCommand(job, "pnpm", args);
  }

  private async runCommand(
    job: DeployJob,
    executable: string,
    args: string[],
    appendOutput = true,
  ): Promise<CommandResult> {
    return new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(executable, args, {
        cwd: this.workspaceRoot,
        env: normalizedEnvironment(),
        shell: false,
        windowsHide: true,
      });
      let stdout = "";
      let output = "";
      const append = (chunk: Buffer, isStdout: boolean) => {
        const text = stripAnsi(chunk.toString("utf8"));
        output += text;
        if (isStdout) stdout += text;
        if (appendOutput) job.output = `${job.output}${text}`.slice(-300_000);
      };
      child.stdout.on("data", (chunk: Buffer) => append(chunk, true));
      child.stderr.on("data", (chunk: Buffer) => append(chunk, false));
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) resolve({ output, stdout });
        else reject(new Error(`${executable} ${args[0] ?? ""} 执行失败（退出码 ${code ?? 1}）。${output.trim() ? `\n${output.trim()}` : ""}`));
      });
    });
  }

  private trimJobs(): void {
    while (this.jobs.size > 10) {
      const first = this.jobs.keys().next().value as string | undefined;
      if (!first) break;
      this.jobs.delete(first);
    }
  }
}

export async function publishPaths(workspaceRoot: string, request: DeployRequest): Promise<string[]> {
  const repoPath = normalizeRepoPath(request.repoPath);
  if (!repoPath.startsWith("src/content/") || repoPath.includes("../")) {
    throw new Error("发布路径不在内容目录中。");
  }
  const paths = [repoPath];
  if (request.ref.kind !== "course") {
    paths.push(posix.join(posix.dirname(repoPath), "assets", request.ref.id));
  }
  if (request.ref.kind === "note" && request.ref.course) {
    for (const extension of ["yaml", "yml"]) {
      const coursePath = `src/content/courses/${request.ref.course}.${extension}`;
      if (await exists(`${workspaceRoot}/${coursePath}`)) paths.push(coursePath);
    }
  }
  return [...new Set(paths.map(normalizeRepoPath))];
}

export function parseStatusPaths(output: string): string[] {
  const fields = output.split("\0").filter(Boolean);
  const paths: string[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    const status = field.slice(0, 2);
    if (status.includes("R") || status.includes("C")) {
      index += 1;
      if (fields[index]) paths.push(normalizeRepoPath(fields[index]));
    } else {
      paths.push(normalizeRepoPath(field.slice(3)));
    }
  }
  return paths;
}

export function isAllowedPublishPath(path: string, allowed: string[]): boolean {
  return allowed.some((candidate) => isPathWithin(normalizeRepoPath(path), candidate));
}

function isPathWithin(path: string, candidate: string): boolean {
  return path === candidate || path.startsWith(`${candidate}/`);
}

function normalizeRepoPath(value: string): string {
  return posix.normalize(value.replaceAll("\\", "/")).replace(/^\.\//, "");
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

function normalizedEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.toLowerCase() === "path") {
      if (environment.PATH === undefined) environment.PATH = value;
      continue;
    }
    environment[key] = value;
  }
  return environment;
}

function stripAnsi(value: string): string {
  return value.replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, "");
}
