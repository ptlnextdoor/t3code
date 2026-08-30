#!/usr/bin/env node
/**
 * One-command remote provisioner for a t3code server on Hetzner Cloud.
 *
 * Automates the manual build we did by hand: create a cx23 Ubuntu 24.04 box in
 * nbg1, inject a fresh per-box ed25519 key via cloud-init, wait for ssh, then
 * run the setup (Node 24, build-essential, ufw, Tailscale, systemd unit) — all
 * idempotently, so a crash halfway and a re-run converge to the same state.
 *
 * Zero npm dependencies, in the style of scripts/verify.mjs. The Hetzner token
 * lives at ~/.config/hetzner/token (mode 600) and is NEVER printed.
 *
 * Commands:
 *   node scripts/provision-remote.mjs create  --name <n> [--yes]
 *   node scripts/provision-remote.mjs destroy --name <n> [--yes]
 *   node scripts/provision-remote.mjs status
 *
 * Env:
 *   TS_AUTHKEY   Tailscale auth key. If set, the box joins the tailnet headless;
 *                otherwise we print the manual `tailscale up` one-liner.
 *
 * Safety rails:
 *   - PROTECTED servers (the live box) can never be destroyed by this script.
 *   - The test flow (create t3code-test, prove ssh + node 24, destroy) is what
 *     `--test` runs end to end.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------- constants
const API = "https://api.hetzner.cloud/v1";
const TOKEN_PATH = join(homedir(), ".config", "hetzner", "token");
const SSH_DIR = join(homedir(), ".ssh");
const SSH_CONFIG = join(SSH_DIR, "config");

const SERVER_TYPE = "cx23"; // Intel 2 vCPU / 4 GB, ~€0.006/hr
const IMAGE = "ubuntu-24.04";
const LOCATION = "nbg1";

// Servers this script must never touch, no matter what --name is passed.
const PROTECTED = new Set(["ubuntu-4gb-nbg1-1"]);

const REMOTE_DIR = "/opt/t3code";
const REMOTE_HOME = "/var/lib/t3code";
const PORT = process.env.T3CODE_REMOTE_PORT ?? "3773";

// ---------------------------------------------------------------- tiny utils
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const say = (s) => console.log(`\n${bold(s)}`);
const step = (s) => console.log(`  ${s}`);
const die = (s) => {
  console.error(`\nFAIL: ${s}`);
  process.exit(1);
};

function token() {
  if (!existsSync(TOKEN_PATH)) die(`Hetzner token not found at ${TOKEN_PATH}`);
  const t = readFileSync(TOKEN_PATH, "utf8").trim();
  if (!t) die("Hetzner token file is empty");
  return t;
}

/** Hetzner REST call. Returns parsed JSON (or {} for 204). Never logs the token. */
async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return {};
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    die(`Hetzner API ${method} ${path}: non-JSON reply (${res.status})`);
  }
  if (!res.ok) {
    const msg = json?.error?.message ?? text ?? res.statusText;
    die(`Hetzner API ${method} ${path} -> ${res.status}: ${msg}`);
  }
  return json;
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yes" || a === "-y") out.yes = true;
    else if (a === "--test") out.test = true;
    else if (a === "--name") out.name = argv[++i];
    else out._.push(a);
  }
  return out;
}

function confirm(question) {
  // Synchronous y/N read so we can gate a destroy without adding a dep.
  process.stdout.write(`${question} [y/N] `);
  let answer = "";
  const buf = Buffer.alloc(1);
  while (true) {
    let n;
    try {
      n = readSync(0, buf, 0, 1, null);
    } catch {
      break;
    }
    if (n === 0) break;
    const ch = buf.toString("utf8");
    if (ch === "\n") break;
    answer += ch;
  }
  return /^y(es)?$/i.test(answer.trim());
}

// ---------------------------------------------------------------- ssh keys
function keyPaths(name) {
  return {
    priv: join(SSH_DIR, `t3code_${name}`),
    pub: join(SSH_DIR, `t3code_${name}.pub`),
  };
}

/** Idempotent: reuse an existing per-box key, else generate a passphrase-less one. */
function ensureKeypair(name) {
  const { priv, pub } = keyPaths(name);
  if (existsSync(priv) && existsSync(pub)) {
    step(`ssh key exists: ${priv}`);
    return { priv, pub, pubText: readFileSync(pub, "utf8").trim() };
  }
  if (!existsSync(SSH_DIR)) mkdirSync(SSH_DIR, { recursive: true, mode: 0o700 });
  const r = spawnSync(
    "ssh-keygen",
    ["-t", "ed25519", "-N", "", "-C", `t3code-${name}`, "-f", priv],
    { stdio: "pipe" },
  );
  if (r.status !== 0) die(`ssh-keygen failed: ${r.stderr?.toString() ?? ""}`);
  chmodSync(priv, 0o600);
  step(`ssh key generated: ${priv}`);
  return { priv, pub, pubText: readFileSync(pub, "utf8").trim() };
}

const CONFIG_BEGIN = (name) => `# >>> t3code provisioner: ${name} >>>`;
const CONFIG_END = (name) => `# <<< t3code provisioner: ${name} <<<`;

/** Idempotent: rewrite (or add) a marked Host block for this box in ~/.ssh/config. */
function upsertSshConfig(name, ip, privPath) {
  const alias = `t3code-${name}`;
  const block = [
    CONFIG_BEGIN(name),
    `Host ${alias}`,
    `  HostName ${ip}`,
    `  User root`,
    `  IdentityFile ${privPath.replace(homedir(), "~")}`,
    `  IdentitiesOnly yes`,
    `  StrictHostKeyChecking accept-new`,
    `  UserKnownHostsFile ~/.ssh/known_hosts`,
    CONFIG_END(name),
  ].join("\n");

  let cfg = existsSync(SSH_CONFIG) ? readFileSync(SSH_CONFIG, "utf8") : "";
  const stripped = removeConfigBlock(cfg, name);
  cfg = `${stripped.replace(/\n+$/, "")}\n\n${block}\n`;
  writeFileSync(SSH_CONFIG, cfg, { mode: 0o600 });
  step(`ssh config: Host ${alias} -> ${ip}`);
  return alias;
}

function removeConfigBlock(cfg, name) {
  const begin = CONFIG_BEGIN(name);
  const end = CONFIG_END(name);
  const re = new RegExp(
    `\\n*${escapeRe(begin)}[\\s\\S]*?${escapeRe(end)}\\n*`,
    "g",
  );
  return cfg.replace(re, "\n");
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------------------------------------------------------------- cloud-init
/** Minimal user_data: drop the pubkey for root so ssh works the moment it boots. */
function cloudInit(pubText) {
  return [
    "#cloud-config",
    // Top-level key applies to the image's default user (root on Hetzner Ubuntu).
    "ssh_authorized_keys:",
    `  - ${pubText}`,
    "disable_root: false",
    "ssh_pwauth: false",
    // Do NOT leave an expired password: a forced change blocks non-interactive ssh.
    "chpasswd:",
    "  expire: false",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------- ssh runner
function ssh(alias, cmd, { quiet = false } = {}) {
  const args = [
    "-o",
    "ConnectTimeout=10",
    "-o",
    "BatchMode=yes",
    alias,
    cmd,
  ];
  const r = spawnSync("ssh", args, { stdio: quiet ? "pipe" : "inherit", encoding: "utf8" });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

async function waitForSsh(alias, timeoutMs = 180_000) {
  const start = Date.now();
  process.stdout.write("  waiting for ssh");
  while (Date.now() - start < timeoutMs) {
    const r = ssh(alias, "true", { quiet: true });
    if (r.status === 0) {
      process.stdout.write(" up\n");
      return true;
    }
    process.stdout.write(".");
    await sleep(5000);
  }
  process.stdout.write(" timeout\n");
  return false;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- setup steps
/**
 * The whole box setup as one idempotent bash script, run over ssh. Every step
 * checks before it acts (command -v, dpkg -s, ufw status, systemctl) so re-runs
 * are cheap no-ops. Tailscale joins only if TS_AUTHKEY is set.
 */
function setupScript() {
  const tsAuth = process.env.TS_AUTHKEY ?? "";
  return `set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

echo "== apt base =="
if ! dpkg -s build-essential >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq build-essential curl ufw >/dev/null
else
  echo "  build-essential present"
fi

echo "== node 24 =="
if command -v node >/dev/null 2>&1 && node -v | grep -q '^v24'; then
  echo "  node $(node -v) present"
else
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null
  echo "  installed node $(node -v)"
fi

echo "== ufw =="
ufw allow OpenSSH >/dev/null 2>&1 || ufw allow 22/tcp >/dev/null 2>&1 || true
ufw allow 41641/udp >/dev/null 2>&1 || true   # tailscale
yes | ufw enable >/dev/null 2>&1 || true
echo "  ufw: $(ufw status | head -1)"

echo "== tailscale =="
if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh >/dev/null 2>&1
  echo "  installed tailscale"
else
  echo "  tailscale present"
fi
systemctl enable --now tailscaled >/dev/null 2>&1 || true
if tailscale status >/dev/null 2>&1; then
  echo "  tailscale already up: $(tailscale ip -4 2>/dev/null | head -1)"
elif [ -n "${tsAuth}" ]; then
  tailscale up --authkey "${tsAuth}" --ssh --hostname t3code-remote >/dev/null 2>&1 || true
  echo "  tailscale up: $(tailscale ip -4 2>/dev/null | head -1)"
else
  echo "  NOT joined — run: tailscale up --ssh"
fi

echo "== dirs + systemd unit =="
mkdir -p ${REMOTE_DIR} ${REMOTE_HOME}/knowledge-org ${REMOTE_HOME}/secrets
NODE_BIN="$(command -v node)"
cat >/etc/systemd/system/t3code.service <<UNIT
[Unit]
Description=T3 Code server (remote agent execution)
After=network-online.target

[Service]
Type=simple
ExecStart=\${NODE_BIN} ${REMOTE_DIR}/bin.mjs serve --host 0.0.0.0 --port ${PORT} --no-browser
Environment=T3CODE_HOME=${REMOTE_HOME}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
# NOTE: not enabled/started here — the bundle (bin.mjs) is deployed separately.
echo "  wrote /etc/systemd/system/t3code.service ($([ -f ${REMOTE_DIR}/bin.mjs ] && echo bundle-present || echo awaiting-bundle))"

echo "== done =="
`;
}

// ---------------------------------------------------------------- commands
async function findServer(name) {
  const j = await api("GET", `/servers?name=${encodeURIComponent(name)}`);
  return (j.servers ?? [])[0] ?? null;
}

async function cmdCreate(name) {
  if (!name) die("create needs --name <n>");
  if (PROTECTED.has(name)) die(`refusing to create over protected name ${name}`);

  say(`Provisioning ${name} (${SERVER_TYPE} / ${IMAGE} / ${LOCATION})`);

  // 1) fresh per-box keypair
  const { priv, pubText } = ensureKeypair(name);

  // 2) server (idempotent: reuse if it already exists)
  let server = await findServer(name);
  if (server) {
    step(`server exists: id ${server.id}, ${server.public_net.ipv4?.ip}`);
  } else {
    step("creating server via Hetzner API…");
    const created = await api("POST", "/servers", {
      name,
      server_type: SERVER_TYPE,
      image: IMAGE,
      location: LOCATION,
      user_data: cloudInit(pubText),
      labels: { managed_by: "t3code-provisioner" },
    });
    server = created.server;
    step(`created: id ${server.id}`);
  }

  // 3) wait for it to be running and have an IP
  for (let i = 0; i < 60 && (server.status !== "running" || !server.public_net.ipv4?.ip); i++) {
    await sleep(3000);
    server = await findServer(name);
  }
  const ip = server.public_net.ipv4?.ip;
  if (!ip) die("server has no IPv4 after waiting");
  step(`ip: ${ip}, status: ${server.status}`);

  // 4) ssh config + wait for ssh
  const alias = upsertSshConfig(name, ip, priv);
  // Hetzner recycles IPs, so an old box's host key may linger in known_hosts.
  // accept-new only auto-trusts *new* hosts, not *changed* ones — scrub it.
  spawnSync("ssh-keygen", ["-R", ip], { stdio: "ignore" });
  if (!(await waitForSsh(alias))) die("ssh never came up (cloud-init still booting?)");

  // 5) idempotent box setup over ssh
  say("Running setup (idempotent)");
  const r = spawnSync("ssh", ["-o", "BatchMode=yes", alias, "bash -s"], {
    input: setupScript(),
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (r.status !== 0) die("setup script failed on the box");

  // 6) summary
  const nodeV = ssh(alias, "node -v", { quiet: true }).stdout.trim();
  const tsStatus = ssh(alias, "tailscale ip -4 2>/dev/null | head -1", { quiet: true }).stdout.trim();
  say("Summary");
  step(`ip:         ${ip}`);
  step(`ssh:        ssh ${alias}`);
  step(`node:       ${nodeV || "?"}`);
  step(`tailscale:  ${tsStatus || "not joined (set TS_AUTHKEY or run `tailscale up --ssh`)"}`);
  step(`systemd:    t3code.service written (deploy bin.mjs then: systemctl enable --now t3code)`);
  console.log("\nNext: scripts/deploy-remote.sh " + `root@${ip}` + " to ship the bundle.");
  return { alias, ip, nodeV, server };
}

async function cmdDestroy(name, yes) {
  if (!name) die("destroy needs --name <n>");
  if (PROTECTED.has(name)) die(`refusing to destroy protected server ${name}`);

  const server = await findServer(name);
  if (!server) {
    step(`no server named ${name} (already gone)`);
  } else {
    if (server.labels?.managed_by !== "t3code-provisioner") {
      // Extra guard: never delete a box we did not create.
      die(`server ${name} is not managed by this provisioner — refusing to delete`);
    }
    if (!yes && !confirm(`Delete server ${name} (${server.public_net.ipv4?.ip})?`)) {
      say("Aborted.");
      return;
    }
    say(`Deleting ${name} (id ${server.id})`);
    await api("DELETE", `/servers/${server.id}`);
    step("deleted");
  }

  // clean ssh config block (idempotent)
  if (existsSync(SSH_CONFIG)) {
    const cfg = readFileSync(SSH_CONFIG, "utf8");
    const cleaned = removeConfigBlock(cfg, name).replace(/\n{3,}/g, "\n\n");
    if (cleaned !== cfg) {
      writeFileSync(SSH_CONFIG, cleaned, { mode: 0o600 });
      step(`removed Host t3code-${name} from ssh config`);
    }
  }
}

async function cmdStatus() {
  const j = await api("GET", "/servers");
  const servers = j.servers ?? [];
  say(`Servers (${servers.length})`);
  if (!servers.length) {
    step("none");
    return;
  }
  for (const s of servers) {
    const prices = s.server_type?.prices ?? [];
    const loc = s.datacenter?.location?.name ?? s.datacenter?.name;
    const price = prices.find((p) => p.location === loc) ?? prices[0];
    const hourly = price?.price_hourly?.gross;
    const cost = hourly ? `€${Number(hourly).toFixed(4)}/hr` : "?";
    const mine = s.labels?.managed_by === "t3code-provisioner" ? " [managed]" : "";
    const prot = PROTECTED.has(s.name) ? " [protected]" : "";
    step(
      `${s.name.padEnd(20)} ${(s.server_type?.name ?? "?").padEnd(6)} ${(s.public_net.ipv4?.ip ?? "-").padEnd(16)} ${s.status.padEnd(8)} ${cost}${mine}${prot}`,
    );
  }
}

/** End-to-end proof: create t3code-test, verify ssh + node 24, then destroy. */
async function cmdTest() {
  const name = "t3code-test";
  say("TEST: create -> verify -> destroy");
  const { alias, nodeV } = await cmdCreate(name);
  const ok = /^v24\./.test(nodeV);
  say(`Verify: node on box = ${nodeV || "?"} -> ${ok ? "PASS (24.x)" : "FAIL"}`);
  const sshOk = ssh(alias, "true", { quiet: true }).status === 0;
  step(`ssh reachable: ${sshOk ? "PASS" : "FAIL"}`);
  say("Tearing down test box");
  await cmdDestroy(name, true);
  if (!ok || !sshOk) die("test did not fully pass");
  say("TEST PASSED: both directions proven.");
}

// ---------------------------------------------------------------- main
const args = parseArgs(process.argv.slice(2));
const command = args._[0];

switch (command) {
  case "create":
    if (args.test) await cmdTest();
    else await cmdCreate(args.name);
    break;
  case "destroy":
    await cmdDestroy(args.name, args.yes);
    break;
  case "status":
    await cmdStatus();
    break;
  case "test":
    await cmdTest();
    break;
  default:
    console.log(`usage:
  node scripts/provision-remote.mjs create  --name <n>     # create + set up a box
  node scripts/provision-remote.mjs destroy --name <n> [--yes]
  node scripts/provision-remote.mjs status                # list servers
  node scripts/provision-remote.mjs test                  # create t3code-test, verify, destroy

env: TS_AUTHKEY (optional) joins the tailnet headless; else prints the manual step.`);
    process.exit(command ? 1 : 0);
}
