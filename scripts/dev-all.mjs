import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;

const processes = [
  {
    name: "next",
    command: node,
    args: [path.join(root, "node_modules", "next", "dist", "bin", "next"), "dev"],
  },
  {
    name: "worker",
    command: node,
    args: [path.join(root, "scripts", "automation-worker.mjs")],
  },
];

let shuttingDown = false;
const children = processes.map((item) => {
  const child = spawn(item.command, item.args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[dev:all] ${item.name} exited (${signal ?? code ?? 0}); stopping the other process.`);
    stopAll();
    process.exit(code ?? 0);
  });

  return child;
});

function stopAll() {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("[dev:all] stopping...");
    stopAll();
  });
}
