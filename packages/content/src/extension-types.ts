export interface ExtensionGatewayServiceManifest {
  name: string;
  description?: string;
  interval_ms?: number;
  startup_delay_ms?: number;
  enabled?: boolean;
  capabilities?: string[];
}

export interface ExtensionApplianceManifest {
  id: string;
  name: string;
  version?: string;
  description?: string;
  root?: string;
  capabilities?: string[];
  resources?: string[];
}

export interface ExtensionGatewayContributionManifest {
  services?: ExtensionGatewayServiceManifest[];
  capabilities?: string[];
  channels?: string[];
}

export interface ExtensionContributionManifest {
  skills?: string[];
  profiles?: string[];
  tools?: string[];
  providers?: string[];
  memory?: string[];
  ui?: string[];
  sandboxes?: string[];
  gateway?: ExtensionGatewayContributionManifest;
  appliances?: ExtensionApplianceManifest[];
}

export interface ExtensionManifest {
  id: string;
  name: string;
  version?: string;
  description?: string;
  main?: string;
  capabilities?: string[];
  contributes?: ExtensionContributionManifest;
  metadata?: Record<string, unknown>;
}

export interface ExtensionDescriptor extends ExtensionManifest {
  path?: string;
  dir?: string;
  enabled?: boolean;
}
