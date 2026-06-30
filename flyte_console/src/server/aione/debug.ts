/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextRequest } from "next/server";

const REDACTED_VALUE = "[REDACTED]";
const TRUE_VALUE = "True";

const SENSITIVE_FIELD_NAMES = new Set([
  "authorization",
  "authorizedkey",
  "authorizedkeys",
  "accesskey",
  "apikey",
  "imagekey",
  "imagesecret",
  "password",
  "secret",
  "secretkey",
  "token",
]);

type AioneExternalApiDebugInput = {
  request: NextRequest;
  type: string;
  payload: unknown;
};

export function logAioneExternalApiRequest({
  request,
  type,
  payload,
}: AioneExternalApiDebugInput) {
  if (!isAioneApiDebugEnabled()) {
    return;
  }

  const url = new URL(request.url);
  console.info(
    "[aione-api-debug] external request",
    JSON.stringify({
      method: request.method,
      pathname: url.pathname,
      search: url.search || undefined,
      type,
      payload: redactAioneApiPayload(payload),
    }),
  );
}

export function isAioneApiDebugEnabled() {
  return readApiDebugFromEnvFile();
}

export function redactAioneApiPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactAioneApiPayload(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      isSensitiveFieldName(key)
        ? REDACTED_VALUE
        : redactAioneApiPayload(nested),
    ]),
  );
}

function readApiDebugFromEnvFile() {
  const envPath =
    process.env.API_DEBUG_ENV_FILE?.trim() || join(process.cwd(), ".env");
  try {
    return isEnabledValue(parseApiDebugEnvValue(readFileSync(envPath, "utf8")));
  } catch {
    return false;
  }
}

function parseApiDebugEnvValue(content: string) {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = trimmed.match(/^API_DEBUG\s*=\s*(.*)$/);
    if (!match) {
      continue;
    }
    return stripQuotes(match[1].trim());
  }
  return "";
}

function stripQuotes(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function isEnabledValue(value: string | undefined) {
  return value?.trim() === TRUE_VALUE;
}

function isSensitiveFieldName(name: string) {
  const normalized = name.replace(/[_-]/g, "").toLowerCase();
  return SENSITIVE_FIELD_NAMES.has(normalized);
}
