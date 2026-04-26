import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import type { ImageContentBlock, MessageContent } from '@snapdragon-ai/host';

export interface PendingAttachment {
  label: string;
  block: ImageContentBlock;
}

export async function attachmentFromReference(
  reference: string,
  cwd = process.cwd(),
): Promise<PendingAttachment> {
  const trimmed = reference.trim();
  if (!trimmed) throw new Error('/attach needs a path or URL');
  if (isHttpUrl(trimmed)) {
    return {
      label: trimmed,
      block: { type: 'image', source: { type: 'url', url: trimmed }, detail: 'auto' },
    };
  }

  const path = resolve(cwd, trimmed);
  const mediaType = mediaTypeForPath(path);
  const data = await readFile(path);
  return {
    label: path,
    block: {
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: data.toString('base64') },
      detail: 'auto',
    },
  };
}

export function contentWithAttachments(
  text: string,
  attachments: PendingAttachment[],
): MessageContent {
  if (attachments.length === 0) return text;
  return [{ type: 'text', text }, ...attachments.map((attachment) => attachment.block)];
}

export function mediaTypeForPath(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  throw new Error(`Unsupported image type for ${path}; expected png, jpg, gif, or webp`);
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}
