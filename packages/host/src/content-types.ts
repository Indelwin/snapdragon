export type ImageDetail = 'auto' | 'low' | 'high';

export type ImageSource =
  | { type: 'url'; url: string }
  | { type: 'base64'; media_type: string; data: string }
  | { type: 'file'; file_id: string };

export type FileSource =
  | { type: 'url'; url: string }
  | { type: 'base64'; media_type: string; data: string }
  | { type: 'file'; file_id: string };

export interface TextContentBlock {
  type: 'text';
  text: string;
}

export interface ImageContentBlock {
  type: 'image';
  source: ImageSource;
  detail?: ImageDetail;
}

export interface FileContentBlock {
  type: 'file';
  source: FileSource;
  filename?: string;
}

export interface ToolResultContentBlock {
  type: 'tool_result';
  tool_call_id?: string;
  content: string | ContentBlock[];
  is_error?: boolean;
}

export type ContentBlock =
  | TextContentBlock
  | ImageContentBlock
  | FileContentBlock
  | ToolResultContentBlock;

export type MessageContent = string | ContentBlock[];
