type ProxyRequest = {
  method: "GET" | "POST" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
};

function withBaseUrl(baseUrl: string, path: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  return `${trimmed}${path}`;
}

async function requestJson(
  baseUrl: string,
  req: ProxyRequest,
  opts?: { profile?: string },
): Promise<any> {
  const url = new URL(withBaseUrl(baseUrl, req.path));
  if (req.query) {
    for (const [key, value] of Object.entries(req.query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
  }
  if (opts?.profile) {
    url.searchParams.set("profile", opts.profile);
  }
  const res = await fetch(url.toString(), {
    method: req.method,
    headers: req.body ? { "Content-Type": "application/json" } : undefined,
    body: req.body ? JSON.stringify(req.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`browser proxy error ${res.status}: ${text || res.statusText}`);
  }
  return await res.json();
}

export async function callBrowserProxy(
  baseUrl: string,
  action: string,
  params: Record<string, unknown>,
): Promise<any> {
  const profile = typeof params.profile === "string" ? params.profile : undefined;
  switch (action) {
    case "status":
      return await requestJson(baseUrl, { method: "GET", path: "/" }, { profile });
    case "start":
      await requestJson(baseUrl, { method: "POST", path: "/start" }, { profile });
      return await requestJson(baseUrl, { method: "GET", path: "/" }, { profile });
    case "stop":
      await requestJson(baseUrl, { method: "POST", path: "/stop" }, { profile });
      return await requestJson(baseUrl, { method: "GET", path: "/" }, { profile });
    case "profiles":
      return await requestJson(baseUrl, { method: "GET", path: "/profiles" }, { profile });
    case "tabs":
      return await requestJson(baseUrl, { method: "GET", path: "/tabs" }, { profile });
    case "open": {
      const targetUrl = String(params.targetUrl ?? "");
      if (!targetUrl) throw new Error("targetUrl is required");
      return await requestJson(baseUrl, {
        method: "POST",
        path: "/tabs/open",
        body: { url: targetUrl },
      }, { profile });
    }
    case "focus": {
      const targetId = String(params.targetId ?? "");
      if (!targetId) throw new Error("targetId is required");
      return await requestJson(baseUrl, {
        method: "POST",
        path: "/tabs/focus",
        body: { targetId },
      }, { profile });
    }
    case "close": {
      const targetId = params.targetId ? String(params.targetId) : "";
      if (targetId) {
        return await requestJson(baseUrl, {
          method: "DELETE",
          path: `/tabs/${encodeURIComponent(targetId)}`,
        }, { profile });
      }
      return await requestJson(baseUrl, {
        method: "POST",
        path: "/act",
        body: { kind: "close" },
      }, { profile });
    }
    case "snapshot": {
      const format = params.snapshotFormat === "aria" ? "aria" : "ai";
      return await requestJson(baseUrl, {
        method: "GET",
        path: "/snapshot",
        query: {
          format,
          targetId: params.targetId as any,
          maxChars: params.maxChars as any,
          refs: params.refs as any,
          interactive: params.interactive as any,
          compact: params.compact as any,
          depth: params.depth as any,
          selector: params.selector as any,
          frame: params.frame as any,
          labels: params.labels as any,
          mode: params.mode as any,
        },
      }, { profile });
    }
    case "screenshot":
      return await requestJson(baseUrl, {
        method: "POST",
        path: "/screenshot",
        body: {
          targetId: params.targetId,
          fullPage: params.fullPage,
          ref: params.ref,
          element: params.element,
          type: params.type,
        },
      }, { profile });
    case "navigate": {
      const targetUrl = String(params.targetUrl ?? "");
      if (!targetUrl) throw new Error("targetUrl is required");
      return await requestJson(baseUrl, {
        method: "POST",
        path: "/navigate",
        body: { url: targetUrl, targetId: params.targetId },
      }, { profile });
    }
    case "console":
      return await requestJson(baseUrl, {
        method: "GET",
        path: "/console",
        query: {
          targetId: params.targetId as any,
          level: params.level as any,
        },
      }, { profile });
    case "pdf":
      return await requestJson(baseUrl, {
        method: "POST",
        path: "/pdf",
        body: { targetId: params.targetId },
      }, { profile });
    case "upload": {
      const paths = Array.isArray(params.paths) ? params.paths : [];
      if (!paths.length) throw new Error("paths are required");
      return await requestJson(baseUrl, {
        method: "POST",
        path: "/hooks/file-chooser",
        body: {
          paths,
          ref: params.ref,
          inputRef: params.inputRef,
          element: params.element,
          targetId: params.targetId,
          timeoutMs: params.timeoutMs,
        },
      }, { profile });
    }
    case "dialog":
      return await requestJson(baseUrl, {
        method: "POST",
        path: "/hooks/dialog",
        body: {
          accept: params.accept,
          promptText: params.promptText,
          targetId: params.targetId,
          timeoutMs: params.timeoutMs,
        },
      }, { profile });
    case "act":
      return await requestJson(baseUrl, {
        method: "POST",
        path: "/act",
        body: params.request ?? {},
      }, { profile });
    default:
      throw new Error(`unknown action: ${action}`);
  }
}
