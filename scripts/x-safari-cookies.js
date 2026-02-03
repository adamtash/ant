#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const format = getArg("--format", "json");
const key = getArg("--key", null);
const domainArg = getArg("--domain", "x.com,twitter.com");
const writeEnvPath = getArg("--write-env", null);
const explicitPath = getArg("--cookies-path", null) ?? process.env.SAFARI_COOKIES_PATH;

const domains = domainArg
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

const envAuth = process.env.BIRD_AUTH_TOKEN || process.env.X_AUTH_TOKEN;
const envCt0 = process.env.BIRD_CT0 || process.env.X_CT0;

const { authToken, ct0 } = envAuth && envCt0
  ? { authToken: envAuth, ct0: envCt0 }
  : readSafariTokens(explicitPath, domains);

if (writeEnvPath) {
  writeEnvFile(writeEnvPath, authToken, ct0);
  process.exit(0);
}

outputTokens(authToken, ct0);

function getArg(name, fallback) {
  const idx = args.indexOf(name);
  if (idx === -1) return fallback;
  return args[idx + 1] ?? fallback;
}

function fail(msg) {
  process.stderr.write(`${msg}\n`);
  process.exit(2);
}

function readSafariTokens(explicit, domainList) {
  const candidates = [
    explicit,
    path.join(os.homedir(), "Library", "Cookies", "Cookies.binarycookies"),
    path.join(
      os.homedir(),
      "Library",
      "Containers",
      "com.apple.Safari",
      "Data",
      "Library",
      "Cookies",
      "Cookies.binarycookies"
    ),
    path.join(os.homedir(), "Library", "WebKit", "WebsiteData", "Cookies.binarycookies"),
    path.join(os.homedir(), "Library", "Safari", "Cookies.binarycookies"),
  ].filter(Boolean);

  const cookiePath = candidates.find((p) => p && fs.existsSync(p));
  if (!cookiePath) {
    fail("Safari cookie file not found. Set SAFARI_COOKIES_PATH.");
  }

  let cookies;
  try {
    const buf = fs.readFileSync(cookiePath);
    cookies = parseBinaryCookies(buf);
  } catch (err) {
    fail(`Failed to parse Safari cookies: ${err?.message || String(err)}`);
  }

  const matched = cookies.filter(
    (c) => c.domain && domainList.some((d) => domainMatch(c.domain, d))
  );

  const authToken = findCookie(matched, "auth_token");
  const ct0 = findCookie(matched, "ct0");

  if (!authToken || !ct0) {
    fail("Missing auth_token/ct0 in Safari cookies. Log into x.com in Safari.");
  }

  return { authToken, ct0 };
}

function writeEnvFile(filePath, authToken, ct0) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const contents = `BIRD_AUTH_TOKEN=${authToken}\nBIRD_CT0=${ct0}\n`;
  fs.writeFileSync(filePath, contents, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

function outputTokens(authToken, ct0) {
  switch (format) {
    case "json":
      process.stdout.write(JSON.stringify({ auth_token: authToken, ct0 }, null, 2));
      break;
    case "env":
      process.stdout.write(`BIRD_AUTH_TOKEN=${authToken}\nBIRD_CT0=${ct0}\n`);
      break;
    case "args":
      process.stdout.write(`--auth-token ${shQuote(authToken)} --ct0 ${shQuote(ct0)}`);
      break;
    case "value":
      if (!key) fail("Missing --key for --format value");
      if (key === "auth_token") process.stdout.write(authToken);
      else if (key === "ct0") process.stdout.write(ct0);
      else fail(`Unknown key: ${key}`);
      break;
    default:
      fail(`Unknown format: ${format}`);
  }
}

function shQuote(value) {
  if (value === "") return "''";
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function domainMatch(cookieDomain, target) {
  const cd = cookieDomain.toLowerCase();
  if (cd === target) return true;
  if (cd === `.${target}`) return true;
  return cd.endsWith(`.${target}`);
}

function findCookie(list, name) {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const item = list[i];
    if (item.name === name && item.value) return item.value;
  }
  return null;
}

function parseBinaryCookies(buf) {
  if (buf.toString("ascii", 0, 4) !== "cook") {
    throw new Error("Invalid cookies file header");
  }
  const pageCount = buf.readUInt32BE(4);
  if (pageCount <= 0 || pageCount > 4096) {
    throw new Error("Invalid cookies page count");
  }
  let offset = 8;
  const pageSizes = [];
  if (offset + pageCount * 4 > buf.length) {
    throw new Error("Invalid cookies page table");
  }
  for (let i = 0; i < pageCount; i += 1) {
    pageSizes.push(buf.readUInt32BE(offset));
    offset += 4;
  }
  const cookies = [];
  for (const size of pageSizes) {
    if (!size || size > buf.length || offset + size > buf.length) {
      throw new Error("Invalid cookies page size");
    }
    const page = buf.slice(offset, offset + size);
    offset += size;
    cookies.push(...parsePage(page));
  }
  return cookies;
}

function parsePage(page) {
  if (page.toString("ascii", 0, 4) !== "cook") return [];
  const cookieCount = page.readUInt32LE(4);
  let offset = 8;
  const offsets = [];
  for (let i = 0; i < cookieCount; i += 1) {
    offsets.push(page.readUInt32LE(offset));
    offset += 4;
  }
  const cookies = [];
  for (const off of offsets) {
    const cookie = parseCookie(page, off);
    if (cookie) cookies.push(cookie);
  }
  return cookies;
}

function parseCookie(page, off) {
  if (off + 4 > page.length) return null;
  const size = page.readUInt32LE(off);
  if (!size || off + size > page.length) return null;

  const urlOffset = page.readUInt32LE(off + 16);
  const nameOffset = page.readUInt32LE(off + 20);
  const pathOffset = page.readUInt32LE(off + 24);
  const valueOffset = page.readUInt32LE(off + 28);

  const domain = readCString(page, off + urlOffset);
  const name = readCString(page, off + nameOffset);
  const cookiePath = readCString(page, off + pathOffset);
  const value = readCString(page, off + valueOffset);

  return { domain, name, path: cookiePath, value };
}

function readCString(buf, start) {
  let end = start;
  while (end < buf.length && buf[end] !== 0x00) end += 1;
  return buf.toString("utf8", start, end);
}
