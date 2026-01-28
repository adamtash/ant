import fs from "node:fs/promises";
import path from "node:path";

import type { AntConfig } from "../config.js";
import {
  buildRoleSnapshotFromAriaSnapshot,
  getRoleSnapshotStats,
  parseRoleRef,
  type RoleRefMap,
} from "./browser-snapshot.js";

type PlaywrightModule = typeof import("playwright");
type BrowserContext = import("playwright").BrowserContext;
type Page = import("playwright").Page;
type ConsoleMessage = import("playwright").ConsoleMessage;

type PageRecord = {
  targetId: string;
  page: Page;
  profile: string;
  createdAt: number;
  lastSnapshotRefs?: RoleRefMap;
  console: string[];
};

type SnapshotNode = {
  ref: string;
  role: string;
  name: string;
  depth: number;
};

export type BrowserSnapshotResult =
  | {
      ok: true;
      format: "aria";
      targetId: string;
      url: string;
      nodes: SnapshotNode[];
    }
  | {
      ok: true;
      format: "ai";
      targetId: string;
      url: string;
      snapshot: string;
      truncated?: boolean;
      refs?: RoleRefMap;
      stats?: {
        lines: number;
        chars: number;
        refs: number;
        interactive: number;
      };
    };

export type BrowserTabInfo = {
  targetId: string;
  title: string;
  url: string;
  type?: string;
};

type BrowserStatus = {
  enabled: boolean;
  running: boolean;
  chosenBrowser: string | null;
  headless: boolean;
  tabCount: number;
  profiles: string[];
};

type BrowserActRequest = {
  kind: string;
  targetId?: string;
  ref?: string;
  doubleClick?: boolean;
  button?: string;
  modifiers?: string[];
  submit?: boolean;
  slowly?: boolean;
  key?: string;
  startRef?: string;
  endRef?: string;
  values?: string[];
  fields?: Array<Record<string, unknown>>;
  width?: number;
  height?: number;
  timeMs?: number;
  text?: string;
  textGone?: string;
  selector?: string;
  url?: string;
  loadState?: "load" | "domcontentloaded" | "networkidle";
  fn?: string;
  timeoutMs?: number;
};

type BrowserActResponse = {
  ok: true;
  targetId: string;
  url?: string;
  result?: unknown;
};

export class BrowserManager {
  private readonly cfg: AntConfig;
  private playwright: PlaywrightModule | null = null;
  private contexts = new Map<
    string,
    { context: BrowserContext; browser?: import("playwright").Browser; mode: "persistent" | "cdp" }
  >();
  private pages = new Map<string, PageRecord>();
  private pageIds = new WeakMap<Page, string>();
  private nextId = 0;
  private activeTargetByProfile = new Map<string, string>();

  constructor(cfg: AntConfig) {
    this.cfg = cfg;
  }

  async status(): Promise<BrowserStatus> {
    const profiles = [...this.contexts.keys()];
    return {
      enabled: this.cfg.browser.enabled,
      running: this.contexts.size > 0,
      chosenBrowser: "chromium",
      headless: this.cfg.browser.headless,
      tabCount: this.pages.size,
      profiles,
    };
  }

  async start(profile?: string): Promise<BrowserStatus> {
    this.ensureEnabled();
    await this.ensureContext(this.profileName(profile));
    return this.status();
  }

  async stop(profile?: string): Promise<BrowserStatus> {
    if (profile) {
      const name = this.profileName(profile);
      const entry = this.contexts.get(name);
      if (entry) {
        if (entry.mode === "cdp") {
          await entry.browser?.close().catch(() => {});
        } else {
          await entry.context.close().catch(() => {});
        }
      }
      this.contexts.delete(name);
      for (const [targetId, record] of this.pages) {
        if (record.profile === name) this.pages.delete(targetId);
      }
      this.activeTargetByProfile.delete(name);
    } else {
      for (const entry of this.contexts.values()) {
        if (entry.mode === "cdp") {
          await entry.browser?.close().catch(() => {});
        } else {
          await entry.context.close().catch(() => {});
        }
      }
      this.contexts.clear();
      this.pages.clear();
      this.activeTargetByProfile.clear();
    }
    return this.status();
  }

  async profiles(): Promise<string[]> {
    return [...this.contexts.keys()];
  }

  async tabs(profile?: string): Promise<BrowserTabInfo[]> {
    const name = profile ? this.profileName(profile) : undefined;
    const list: BrowserTabInfo[] = [];
    for (const record of this.pages.values()) {
      if (name && record.profile !== name) continue;
      list.push({
        targetId: record.targetId,
        title: await record.page.title().catch(() => ""),
        url: record.page.url(),
        type: "page",
      } as BrowserTabInfo);
    }
    return list;
  }

  async open(profile: string | undefined, targetUrl: string): Promise<BrowserTabInfo> {
    this.ensureEnabled();
    const name = this.profileName(profile);
    const ctx = await this.ensureContext(name);
    const page = await ctx.newPage();
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const record = this.registerPage(name, page);
    this.activeTargetByProfile.set(name, record.targetId);
    return {
      targetId: record.targetId,
      title: await page.title(),
      url: page.url(),
      type: "page",
    };
  }

  async focus(profile: string | undefined, targetId: string): Promise<{ ok: true }> {
    const record = this.getPageRecord(profile, targetId);
    this.activeTargetByProfile.set(record.profile, record.targetId);
    return { ok: true };
  }

  async close(profile: string | undefined, targetId?: string): Promise<{ ok: true }> {
    const record = this.getPageRecord(profile, targetId);
    await record.page.close().catch(() => {});
    return { ok: true };
  }

  async navigate(
    profile: string | undefined,
    targetUrl: string,
    targetId?: string,
  ): Promise<{ ok: true; targetId: string; url: string }> {
    const record = this.getPageRecord(profile, targetId);
    await record.page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    return { ok: true, targetId: record.targetId, url: record.page.url() };
  }

  async consoleMessages(
    profile: string | undefined,
    targetId?: string,
    level?: string,
  ): Promise<{ ok: true; targetId: string; messages: string[] }> {
    const record = this.getPageRecord(profile, targetId);
    const messages = level
      ? record.console.filter((line) => line.toLowerCase().startsWith(`${level}:`))
      : record.console.slice();
    return { ok: true, targetId: record.targetId, messages };
  }

  async screenshot(params: {
    profile?: string;
    targetId?: string;
    fullPage?: boolean;
    ref?: string;
    element?: string;
    type?: "png" | "jpeg";
  }): Promise<{ ok: true; targetId: string; path: string; url: string }> {
    const record = this.getPageRecord(params.profile, params.targetId);
    const outputDir = path.join(this.cfg.resolved.stateDir, "captures");
    await fs.mkdir(outputDir, { recursive: true });
    const filePath = path.join(outputDir, `browser-${Date.now()}.${params.type ?? "png"}`);
    if (params.ref || params.element) {
      const locator = params.ref
        ? this.resolveRefLocator(record, params.ref)
        : record.page.locator(params.element ?? "");
      await locator.screenshot({ path: filePath });
    } else {
      await record.page.screenshot({ path: filePath, fullPage: params.fullPage ?? true });
    }
    return { ok: true, targetId: record.targetId, path: filePath, url: record.page.url() };
  }

  async pdf(profile?: string, targetId?: string): Promise<{ ok: true; targetId: string; path: string }> {
    const record = this.getPageRecord(profile, targetId);
    const outputDir = path.join(this.cfg.resolved.stateDir, "captures");
    await fs.mkdir(outputDir, { recursive: true });
    const filePath = path.join(outputDir, `browser-${Date.now()}.pdf`);
    await record.page.pdf({ path: filePath });
    return { ok: true, targetId: record.targetId, path: filePath };
  }

  async upload(params: {
    profile?: string;
    targetId?: string;
    paths: string[];
    ref?: string;
    inputRef?: string;
    element?: string;
    timeoutMs?: number;
  }): Promise<{ ok: true; targetId: string }> {
    const record = this.getPageRecord(params.profile, params.targetId);
    const locator = params.ref
      ? this.resolveRefLocator(record, params.ref)
      : record.page.locator(params.inputRef || params.element || "input[type=file]");
    await locator.setInputFiles(params.paths);
    return { ok: true, targetId: record.targetId };
  }

  async dialog(params: {
    profile?: string;
    targetId?: string;
    accept: boolean;
    promptText?: string;
    timeoutMs?: number;
  }): Promise<{ ok: true }> {
    const record = this.getPageRecord(params.profile, params.targetId);
    const timeoutMs = params.timeoutMs ?? 10_000;
    const dialogPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("dialog timeout")), timeoutMs);
      record.page.once("dialog", async (dialog) => {
        clearTimeout(timer);
        try {
          if (params.accept) {
            await dialog.accept(params.promptText);
          } else {
            await dialog.dismiss();
          }
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
    await dialogPromise;
    return { ok: true };
  }

  async snapshot(params: {
    profile?: string;
    targetId?: string;
    snapshotFormat?: "aria" | "ai";
    maxChars?: number;
    interactive?: boolean;
    compact?: boolean;
    depth?: number;
  }): Promise<BrowserSnapshotResult> {
    this.ensureEnabled();
    const record = this.getPageRecord(params.profile, params.targetId);
    const ariaText = await this.buildAriaSnapshotText(record.page);
    const options = {
      interactive: params.interactive,
      compact: params.compact,
      maxDepth: params.depth,
    };
    const { snapshot, refs } = buildRoleSnapshotFromAriaSnapshot(ariaText, options);
    record.lastSnapshotRefs = refs;
    if (params.snapshotFormat === "aria") {
      const nodes = parseSnapshotNodes(snapshot);
      return {
        ok: true,
        format: "aria",
        targetId: record.targetId,
        url: record.page.url(),
        nodes,
      };
    }
    const maxChars = typeof params.maxChars === "number" && params.maxChars > 0 ? params.maxChars : 20000;
    const truncated = snapshot.length > maxChars;
    const finalSnapshot = truncated ? snapshot.slice(0, maxChars) : snapshot;
    return {
      ok: true,
      format: "ai",
      targetId: record.targetId,
      url: record.page.url(),
      snapshot: finalSnapshot,
      truncated,
      refs,
      stats: getRoleSnapshotStats(finalSnapshot, refs),
    };
  }

  async act(profile: string | undefined, request: BrowserActRequest): Promise<BrowserActResponse> {
    this.ensureEnabled();
    const record = this.getPageRecord(profile, request.targetId);
    const page = record.page;
    switch (request.kind) {
      case "click": {
        const locator = this.resolveRefLocator(record, request.ref);
        const options: Parameters<typeof locator.click>[0] = {};
        if (request.button === "left" || request.button === "right" || request.button === "middle") {
          options.button = request.button;
        }
        if (request.modifiers && request.modifiers.length > 0) {
          options.modifiers = request.modifiers as any;
        }
        if (request.doubleClick) {
          await locator.dblclick(options);
        } else {
          await locator.click(options);
        }
        return { ok: true, targetId: record.targetId, url: page.url() };
      }
      case "type": {
        const locator = this.resolveRefLocator(record, request.ref);
        await locator.fill("");
        await locator.type(request.text ?? "", { delay: request.slowly ? 50 : undefined });
        if (request.submit) {
          await locator.press("Enter");
        }
        return { ok: true, targetId: record.targetId };
      }
      case "press": {
        if (!request.key) throw new Error("key is required");
        await page.keyboard.press(request.key, { delay: request.timeoutMs });
        return { ok: true, targetId: record.targetId };
      }
      case "hover": {
        const locator = this.resolveRefLocator(record, request.ref);
        await locator.hover();
        return { ok: true, targetId: record.targetId };
      }
      case "scrollIntoView": {
        const locator = this.resolveRefLocator(record, request.ref);
        await locator.scrollIntoViewIfNeeded();
        return { ok: true, targetId: record.targetId };
      }
      case "drag": {
        const start = this.resolveRefLocator(record, request.startRef);
        const end = this.resolveRefLocator(record, request.endRef);
        await start.dragTo(end);
        return { ok: true, targetId: record.targetId };
      }
      case "select": {
        const locator = this.resolveRefLocator(record, request.ref);
        await locator.selectOption(request.values ?? []);
        return { ok: true, targetId: record.targetId };
      }
      case "fill": {
        const fields = Array.isArray(request.fields) ? request.fields : [];
        for (const field of fields) {
          const ref = typeof field.ref === "string" ? field.ref : "";
          const value = (field as { value?: string | number | boolean }).value;
          const locator = this.resolveRefLocator(record, ref);
          await locator.fill(value === undefined ? "" : String(value));
        }
        return { ok: true, targetId: record.targetId };
      }
      case "resize": {
        if (!request.width || !request.height) throw new Error("width and height are required");
        await page.setViewportSize({ width: request.width, height: request.height });
        return { ok: true, targetId: record.targetId, url: page.url() };
      }
      case "wait": {
        if (request.timeMs) {
          await page.waitForTimeout(request.timeMs);
        }
        if (request.text) {
          await page.getByText(request.text, { exact: false }).waitFor();
        }
        if (request.textGone) {
          await page.getByText(request.textGone, { exact: false }).waitFor({ state: "detached" });
        }
        if (request.selector) {
          await page.locator(request.selector).waitFor();
        }
        if (request.url) {
          await page.waitForURL(request.url);
        }
        if (request.loadState) {
          await page.waitForLoadState(request.loadState);
        }
        if (request.fn) {
          await page.evaluate(request.fn);
        }
        return { ok: true, targetId: record.targetId };
      }
      case "evaluate": {
        if (!request.fn) throw new Error("fn is required");
        const result = await page.evaluate(request.fn);
        return { ok: true, targetId: record.targetId, url: page.url(), result };
      }
      case "close": {
        await page.close().catch(() => {});
        return { ok: true, targetId: record.targetId };
      }
      default:
        throw new Error(`unsupported action: ${request.kind}`);
    }
  }

  private profileName(profile?: string): string {
    const name = profile?.trim();
    if (name) return name;
    const fallback = this.cfg.browser.defaultProfile?.trim();
    return fallback || "default";
  }

  private async ensureContext(profile: string): Promise<BrowserContext> {
    const existing = this.contexts.get(profile);
    if (existing) return existing.context;
    const pw = await this.loadPlaywright();
    const profileCfg = this.cfg.browser.profiles?.[profile];
    if (profile === "chrome" && !profileCfg?.cdpUrl) {
      throw new Error(
        'profile "chrome" requires browser.profiles.chrome.cdpUrl (e.g. http://127.0.0.1:9222).',
      );
    }
    if (profileCfg?.cdpUrl) {
      const browser = await pw.chromium.connectOverCDP(profileCfg.cdpUrl);
      const context = browser.contexts()[0] ?? (await browser.newContext());
      this.contexts.set(profile, { context, browser, mode: "cdp" });
      context.on("page", (page) => this.registerPage(profile, page));
      for (const page of context.pages()) {
        this.registerPage(profile, page);
      }
      return context;
    }
    const userDataDir = path.join(this.cfg.resolved.stateDir, "browser-profiles", profile);
    await fs.mkdir(userDataDir, { recursive: true });
    const context = await pw.chromium.launchPersistentContext(userDataDir, {
      headless: this.cfg.browser.headless ?? true,
    });
    this.contexts.set(profile, { context, mode: "persistent" });
    context.on("page", (page) => this.registerPage(profile, page));
    for (const page of context.pages()) {
      this.registerPage(profile, page);
    }
    return context;
  }

  private registerPage(profile: string, page: Page): PageRecord {
    const existingId = this.pageIds.get(page);
    if (existingId) {
      const existing = this.pages.get(existingId);
      if (existing) return existing;
    }
    this.nextId += 1;
    const targetId = `t${this.nextId}`;
    this.pageIds.set(page, targetId);
    const record: PageRecord = {
      targetId,
      page,
      profile,
      createdAt: Date.now(),
      console: [],
    };
    this.pages.set(targetId, record);
    page.on("close", () => {
      this.pages.delete(targetId);
      if (this.activeTargetByProfile.get(profile) === targetId) {
        this.activeTargetByProfile.delete(profile);
      }
    });
    page.on("console", (msg: ConsoleMessage) => {
      record.console.push(`${msg.type()}: ${msg.text()}`);
      if (record.console.length > 200) record.console.shift();
    });
    return record;
  }

  private getPageRecord(profile?: string, targetId?: string): PageRecord {
    if (targetId) {
      const record = this.pages.get(targetId);
      if (!record) throw new Error(`tab not found: ${targetId}`);
      return record;
    }
    const name = this.profileName(profile);
    const active = this.activeTargetByProfile.get(name);
    if (active) {
      const record = this.pages.get(active);
      if (record) return record;
    }
    for (const record of this.pages.values()) {
      if (record.profile === name) return record;
    }
    throw new Error("no tabs available");
  }

  private resolveRefLocator(record: PageRecord, ref?: string) {
    if (!ref) throw new Error("ref is required");
    const parsed = parseRoleRef(ref);
    if (!parsed) throw new Error(`invalid ref: ${ref}`);
    const refs = record.lastSnapshotRefs;
    if (!refs || !refs[parsed]) {
      throw new Error("ref not found. Run browser snapshot first.");
    }
    const entry = refs[parsed];
    const locator = entry.name
      ? record.page.getByRole(entry.role as never, { name: entry.name, exact: true })
      : record.page.getByRole(entry.role as never);
    if (typeof entry.nth === "number" && entry.nth > 0) {
      return locator.nth(entry.nth);
    }
    return locator;
  }

  private async loadPlaywright(): Promise<PlaywrightModule> {
    if (this.playwright) return this.playwright;
    try {
      const mod = await import("playwright");
      this.playwright = mod;
      return mod;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Playwright not available: ${message}. Install with: npm install playwright && npx playwright install chromium`,
      );
    }
  }

  private ensureEnabled() {
    if (!this.cfg.browser.enabled) {
      throw new Error("Browser control is disabled. Set browser.enabled=true in ant.config.json.");
    }
  }

  private async buildAriaSnapshotText(page: Page): Promise<string> {
    const accessibility = (page as unknown as { accessibility?: { snapshot?: Function } })
      .accessibility;
    if (!accessibility?.snapshot) return "(empty)";
    const tree = await accessibility.snapshot({ interestingOnly: false });
    if (!tree) return "(empty)";
    const lines: string[] = [];
    const walk = (node: any, depth: number) => {
      const indent = "  ".repeat(depth);
      const role = node.role || "generic";
      const name = node.name ? ` \"${node.name}\"` : "";
      lines.push(`${indent}- ${role}${name}`);
      const children = Array.isArray(node.children) ? node.children : [];
      for (const child of children) walk(child, depth + 1);
    };
    walk(tree, 0);
    return lines.join("\n");
  }
}

function parseSnapshotNodes(snapshot: string): SnapshotNode[] {
  const nodes: SnapshotNode[] = [];
  const lines = snapshot.split("\n");
  for (const line of lines) {
    const match = line.match(/^(\s*)-\s*(\w+)(?:\s+"([^"]*)")?.*\[ref=(e\d+)\]/);
    if (!match) continue;
    const indent = match[1] ?? "";
    const role = match[2] ?? "";
    const name = match[3] ?? "";
    const ref = match[4] ?? "";
    const depth = Math.floor(indent.length / 2);
    nodes.push({ ref, role, name, depth });
  }
  return nodes;
}
