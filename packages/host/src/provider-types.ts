export interface ProviderCapabilities {
  streaming: boolean;
  tools: boolean;
  imageInput: boolean;
  fileInput: boolean;
  reasoning: boolean;
  modelDiscovery: boolean | 'static';
  imageGeneration: boolean | 'responses-tool' | 'images-api';
}

export interface ProviderDescriptor {
  id: string;
  name: string;
  protocol: string;
  capabilities: ProviderCapabilities;
}

export interface ProviderModelLimits {
  contextWindow?: number;
  maxContextWindow?: number;
  effectiveContextWindowPercent?: number;
  maxOutputTokens?: number;
}
