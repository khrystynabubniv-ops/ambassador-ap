import type { AppConfig } from "./config.js";
import { requireEnv } from "./config.js";

const NOTION_VERSION = "2026-03-11";
const NOTION_API_BASE = "https://api.notion.com";

type JsonBody = Record<string, unknown> | unknown[];

export async function notionJson<T>(
  config: AppConfig,
  path: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: JsonBody
): Promise<T> {
  requireEnv("notionApiKey", config.notionApiKey);

  const response = await fetch(`${NOTION_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.notionApiKey}`,
      "Notion-Version": NOTION_VERSION,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Notion ${method} ${path} failed: ${response.status} ${JSON.stringify(payload)}`);
  }

  return payload as T;
}

export async function notionForm<T>(config: AppConfig, path: string, formData: FormData): Promise<T> {
  requireEnv("notionApiKey", config.notionApiKey);

  const response = await fetch(`${NOTION_API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.notionApiKey}`,
      "Notion-Version": NOTION_VERSION
    },
    body: formData
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Notion POST ${path} failed: ${response.status} ${JSON.stringify(payload)}`);
  }

  return payload as T;
}

export async function queryDataSource<T extends { results: unknown[]; has_more?: boolean; next_cursor?: string | null }>(
  config: AppConfig,
  dataSourceId: string,
  body: Record<string, unknown> = {}
): Promise<unknown[]> {
  const results: unknown[] = [];
  let startCursor: string | undefined;

  do {
    const response = await notionJson<T>(config, `/v1/data_sources/${dataSourceId}/query`, "POST", {
      page_size: 100,
      ...body,
      ...(startCursor ? { start_cursor: startCursor } : {})
    });
    results.push(...response.results);
    startCursor = response.has_more && response.next_cursor ? response.next_cursor : undefined;
  } while (startCursor);

  return results;
}

export function richText(content: string) {
  return {
    rich_text: content ? [{ type: "text", text: { content } }] : []
  };
}

export function titleText(content: string) {
  return {
    title: [{ type: "text", text: { content: content.slice(0, 2000) } }]
  };
}

export function propertyPlainText(property: any): string {
  if (!property) return "";
  if (property.type === "title") return property.title?.map((item: any) => item.plain_text).join("") ?? "";
  if (property.type === "rich_text") return property.rich_text?.map((item: any) => item.plain_text).join("") ?? "";
  if (property.type === "select") return property.select?.name ?? "";
  return "";
}

export function propertyNumber(property: any): number {
  return typeof property?.number === "number" ? property.number : 0;
}

export function propertyCheckbox(property: any): boolean {
  return Boolean(property?.checkbox);
}

export function propertyDate(property: any): string {
  return property?.date?.start ?? "";
}
