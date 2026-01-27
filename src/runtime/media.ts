export type MediaSplitResult = {
  text: string;
  mediaUrls?: string[];
  mediaUrl?: string;
};

const MEDIA_TOKEN_RE = /\bMEDIA:\s*`?([^\n]+)`?/gi;

export function normalizeMediaSource(src: string): string {
  if (!src) return src;
  return src.startsWith("file://") ? src.replace("file://", "") : src;
}

function cleanCandidate(raw: string): string {
  return raw.replace(/^[`"'[{(]+/, "").replace(/[`"'\\})\],]+$/, "");
}

function unwrapQuoted(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length < 2) return undefined;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if (first !== last) return undefined;
  if (first !== `"` && first !== "'" && first !== "`") return undefined;
  return trimmed.slice(1, -1).trim();
}

function isValidMedia(candidate: string, opts?: { allowSpaces?: boolean }): boolean {
  if (!candidate) return false;
  if (candidate.length > 4096) return false;
  if (!opts?.allowSpaces && /\s/.test(candidate)) return false;
  if (/^https?:\/\//i.test(candidate)) return true;
  if (candidate.startsWith("/")) return true;
  if (candidate.startsWith("./")) return true;
  if (candidate.startsWith("../")) return true;
  if (candidate.startsWith("~")) return true;
  return false;
}

export function splitMediaFromOutput(raw: string): MediaSplitResult {
  const trimmedRaw = raw.trimEnd();
  if (!trimmedRaw.trim()) return { text: "" };

  const media: string[] = [];
  let foundMediaToken = false;
  const lines = trimmedRaw.split("\n");
  const keptLines: string[] = [];

  for (const line of lines) {
    const trimmedStart = line.trimStart();
    if (!trimmedStart.startsWith("MEDIA:")) {
      keptLines.push(line);
      continue;
    }

    const matches = Array.from(line.matchAll(MEDIA_TOKEN_RE));
    if (matches.length === 0) {
      keptLines.push(line);
      continue;
    }

    foundMediaToken = true;
    const pieces: string[] = [];
    let cursor = 0;
    let hasValidMedia = false;

    for (const match of matches) {
      const start = match.index ?? 0;
      pieces.push(line.slice(cursor, start));
      const payload = match[1];
      const unwrapped = unwrapQuoted(payload);
      const payloadValue = unwrapped ?? payload;
      const parts = unwrapped ? [unwrapped] : payload.split(/\s+/).filter(Boolean);
      const mediaStartIndex = media.length;
      let validCount = 0;
      const invalidParts: string[] = [];

      for (const part of parts) {
        const candidate = normalizeMediaSource(cleanCandidate(part));
        if (isValidMedia(candidate, unwrapped ? { allowSpaces: true } : undefined)) {
          media.push(candidate);
          hasValidMedia = true;
          validCount += 1;
        } else {
          invalidParts.push(part);
        }
      }

      const trimmedPayload = payloadValue.trim();
      const looksLikeLocalPath =
        trimmedPayload.startsWith("/") ||
        trimmedPayload.startsWith("./") ||
        trimmedPayload.startsWith("../") ||
        trimmedPayload.startsWith("~") ||
        trimmedPayload.startsWith("file://");
      if (
        !unwrapped &&
        validCount === 1 &&
        invalidParts.length > 0 &&
        /\s/.test(payloadValue) &&
        looksLikeLocalPath
      ) {
        const fallback = normalizeMediaSource(cleanCandidate(payloadValue));
        if (isValidMedia(fallback, { allowSpaces: true })) {
          media.splice(mediaStartIndex, media.length - mediaStartIndex, fallback);
          hasValidMedia = true;
          validCount = 1;
          invalidParts.length = 0;
        }
      }

      if (!hasValidMedia) {
        const fallback = normalizeMediaSource(cleanCandidate(payloadValue));
        if (isValidMedia(fallback, { allowSpaces: true })) {
          media.push(fallback);
          hasValidMedia = true;
          invalidParts.length = 0;
        }
      }

      if (hasValidMedia && invalidParts.length > 0) {
        pieces.push(invalidParts.join(" "));
      }

      cursor = start + match[0].length;
    }

    pieces.push(line.slice(cursor));
    const cleanedLine = pieces
      .join("")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
    if (cleanedLine) {
      keptLines.push(cleanedLine);
    }
  }

  const cleanedText = keptLines
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();

  if (media.length === 0) {
    return { text: foundMediaToken ? cleanedText : trimmedRaw };
  }

  return {
    text: cleanedText,
    mediaUrls: media,
    mediaUrl: media[0],
  };
}
