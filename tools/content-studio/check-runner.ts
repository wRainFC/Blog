import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

export type CheckStatus = "queued" | "running" | "passed" | "failed";

export interface CheckJob {
  id: string;
  status: CheckStatus;
  output: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
}

export class CheckRunner {
  private readonly jobs = new Map<string, CheckJob>();
  private queue: Promise<void> = Promise.resolve();
  private latestId?: string;

  constructor(private readonly workspaceRoot: string) {}

  start(): CheckJob {
    const job: CheckJob = {
      id: randomUUID(),
      status: "queued",
      output: "等待前一个检查任务完成……",
    };
    this.jobs.set(job.id, job);
    this.latestId = job.id;
    this.trimJobs();
    this.queue = this.queue.then(() => this.run(job)).catch((error) => {
      job.status = "failed";
      job.output = `${job.output}\n无法启动检查：${error instanceof Error ? error.message : String(error)}\n`;
      job.finishedAt = new Date().toISOString();
    });
    return { ...job };
  }

  get(id?: string): CheckJob | undefined {
    const job = this.jobs.get(id ?? this.latestId ?? "");
    return job ? { ...job } : undefined;
  }

  private async run(job: CheckJob): Promise<void> {
    job.status = "running";
    job.output = "正在运行 pnpm check…\n";
    job.startedAt = new Date().toISOString();

    const { executable, args } = checkCommand();
    await new Promise<void>((resolve) => {
      const child = spawn(executable, args, {
        cwd: this.workspaceRoot,
        env: normalizedEnvironment(),
        // Windows cannot execute a .cmd shim with shell:false on Node 24;
        // invoke the system command interpreter explicitly instead.
        shell: false,
        windowsHide: true,
      });

      const append = (chunk: Buffer) => {
        job.output = `${job.output}${stripAnsi(chunk.toString("utf8"))}`.slice(-200_000);
      };
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      child.on("error", (error) => {
        job.status = "failed";
        job.output += `\n无法启动检查：${error.message}\n`;
        job.finishedAt = new Date().toISOString();
        resolve();
      });
      child.on("exit", (code) => {
        job.exitCode = code ?? 1;
        job.status = code === 0 ? "passed" : "failed";
        job.finishedAt = new Date().toISOString();
        resolve();
      });
    });
  }

  private trimJobs(): void {
    while (this.jobs.size > 20) {
      const first = this.jobs.keys().next().value as string | undefined;
      if (!first) break;
      this.jobs.delete(first);
    }
  }
}

export function checkCommand(
  platform: NodeJS.Platform = process.platform,
  comSpec = process.env.ComSpec,
): { executable: string; args: string[] } {
  return platform === "win32"
    ? { executable: comSpec || "cmd.exe", args: ["/d", "/s", "/c", "pnpm.cmd check"] }
    : { executable: "pnpm", args: ["check"] };
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
