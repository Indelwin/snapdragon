export interface ProviderCapabilities {
  streaming: boolean;
  tools: boolean;
  imageInput: boolean;
  fileInput: boolean;
  reasoning: boolean;
  modelDiscovery: boolean | 'static';
}

export interface ProviderDescriptor {
  id: string;
  name: string;
  protocol: string;
  capabilities: ProviderCapabilities;
}
