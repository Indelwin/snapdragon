export type ChatEntry = {
  id: string;
  role: string;
  content: string;
} & Partial<{
  streaming: boolean;
  thinking: string;
  toolCalls: number;
  isError: boolean;
  toolName: string;
  toolStatus: string;
}>;

export type ToolEntry = {
  id: string;
  name: string;
  status: string;
} & Partial<{ content: string }>;
