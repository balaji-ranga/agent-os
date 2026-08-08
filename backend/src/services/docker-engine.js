import http from "http";

const DEFAULT_SOCKET = "/var/run/docker.sock";

export function dockerSocketPath() {
  return String(process.env.DOCKER_TOOLS_SOCKET || DEFAULT_SOCKET).trim() || DEFAULT_SOCKET;
}

export function dockerToolsEnabled() {
  const v = String(process.env.DOCKER_TOOLS_ENABLED || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

export function request(method, path, { body, headers = {}, timeoutMs = 120000 } = {}) {
  const socketPath = dockerSocketPath();
  const payload = body == null ? null : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath,
        path,
        method,
        headers: {
          Accept: "application/json",
          ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}),
          ...headers,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let data = null;
          if (raw) {
            try {
              data = JSON.parse(raw);
            } catch {
              data = raw;
            }
          }
          if (res.statusCode >= 400) {
            const msg =
              (data && typeof data === "object" && (data.message || data.error)) ||
              (typeof data === "string" ? data : `Docker API ${res.statusCode}`);
            const err = new Error(String(msg));
            err.status = res.statusCode;
            err.docker = data;
            reject(err);
            return;
          }
          resolve({ status: res.statusCode, headers: res.headers, data });
        });
      }
    );
    req.on("error", (e) => {
      const err = new Error(`Docker socket error: ${e.message} (path=${socketPath})`);
      err.status = 503;
      reject(err);
    });
    req.on("timeout", () => {
      req.destroy();
      const err = new Error("Docker API request timed out");
      err.status = 504;
      reject(err);
    });
    if (payload) req.write(payload);
    req.end();
  });
}

export function splitImageRef(imageRef) {
  const raw = String(imageRef || "").trim();
  let tag = "latest";
  let path = raw;
  const lastColon = raw.lastIndexOf(":");
  const lastSlash = raw.lastIndexOf("/");
  if (lastColon > lastSlash) {
    tag = raw.slice(lastColon + 1) || "latest";
    path = raw.slice(0, lastColon);
  }
  let registryPath = path;
  if (!path.includes("/")) {
    registryPath = `docker.io/library/${path}`;
  } else if (!path.includes(".") && !path.includes(":") && path.split("/").length === 2) {
    registryPath = `docker.io/${path}`;
  } else if (!path.startsWith("docker.io/") && !path.includes(".") && !path.startsWith("localhost")) {
    const host = path.split("/")[0];
    if (!host.includes(".") && !host.includes(":")) registryPath = `docker.io/${path}`;
  }
  return { registryPath, tag, canonical: `${registryPath}:${tag}` };
}

export async function pullImage(imageRef) {
  const ref = String(imageRef || "").trim();
  if (!ref) throw Object.assign(new Error("image required"), { status: 400 });
  const { registryPath, tag } = splitImageRef(ref);
  const qs = new URLSearchParams({ fromImage: registryPath, tag });
  const socketPath = dockerSocketPath();
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath,
        path: `/images/create?${qs.toString()}`,
        method: "POST",
        headers: { Accept: "application/json" },
        timeout: 600000,
      },
      (res) => {
        let buf = "";
        let errorMsg = null;
        res.on("data", (chunk) => {
          buf += chunk.toString("utf8");
          const lines = buf.split("\n");
          buf = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const j = JSON.parse(line);
              if (j.error || j.errorDetail?.message) errorMsg = j.error || j.errorDetail.message;
            } catch {
              /* progress */
            }
          }
        });
        res.on("end", () => {
          if (res.statusCode >= 400 || errorMsg) {
            const err = new Error(errorMsg || `Image pull failed (${res.statusCode})`);
            err.status = res.statusCode || 502;
            reject(err);
            return;
          }
          resolve({ ok: true, image: ref });
        });
      }
    );
    req.on("error", (e) => reject(Object.assign(new Error(`Docker pull error: ${e.message}`), { status: 503 })));
    req.on("timeout", () => {
      req.destroy();
      reject(Object.assign(new Error("Docker pull timed out"), { status: 504 }));
    });
    req.end();
  });
}

export async function createContainer(spec) {
  return request("POST", "/containers/create?name=" + encodeURIComponent(spec.name), { body: spec.body });
}
export async function startContainer(id) {
  return request("POST", `/containers/${encodeURIComponent(id)}/start`);
}
export async function stopContainer(id, { t = 10 } = {}) {
  return request("POST", `/containers/${encodeURIComponent(id)}/stop?t=${t}`);
}
export async function restartContainer(id, { t = 10 } = {}) {
  return request("POST", `/containers/${encodeURIComponent(id)}/restart?t=${t}`);
}
export async function removeContainer(id, { force = true, volumes = true } = {}) {
  const qs = new URLSearchParams({ force: force ? "1" : "0", v: volumes ? "1" : "0" });
  return request("DELETE", `/containers/${encodeURIComponent(id)}?${qs}`);
}
export async function inspectContainer(id) {
  const { data } = await request("GET", `/containers/${encodeURIComponent(id)}/json`);
  return data;
}
export async function listContainers({ all = true, filters } = {}) {
  const qs = new URLSearchParams({ all: all ? "1" : "0" });
  if (filters) qs.set("filters", JSON.stringify(filters));
  const { data } = await request("GET", `/containers/json?${qs}`);
  return Array.isArray(data) ? data : [];
}
export async function inspectSelfNetworks() {
  const hostname = String(process.env.HOSTNAME || "").trim();
  if (!hostname) return [];
  try {
    const info = await inspectContainer(hostname);
    return Object.keys(info?.NetworkSettings?.Networks || {});
  } catch {
    return [];
  }
}
export async function pingDocker() {
  const { status } = await request("GET", "/_ping", { timeoutMs: 5000 });
  return status === 200;
}