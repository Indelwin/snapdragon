export type SdBackgroundMode = 'daemon' | 'inline' | 'off';
export type SdGatewayRuntime = 'rust' | 'inline-ts';

export interface SdDaemonConfig {
  root?: string;
  auto_start?: boolean;
}

export interface SdGatewayServiceConfig {
  enabled?: boolean;
  interval_ms?: number;
  startup_delay_ms?: number;
  restart?: 'permanent' | 'transient' | 'temporary';
  restart_intensity?: {
    max_restarts?: number;
    within_ms?: number;
  };
  backoff_ms?: number;
  max_backoff_ms?: number;
  max_fuel?: number;
  timeout_ms?: number;
  isolation?: 'inherit' | 'profile' | 'channel';
}

export interface SdGatewayConfig {
  runtime?: SdGatewayRuntime;
  root?: string;
  services?: Record<string, SdGatewayServiceConfig>;
}

export interface SdBackgroundConfig {
  mode?: SdBackgroundMode;
  daemon?: SdDaemonConfig;
  channels?: SdGatewayChannelsConfig;
}

export interface SdIsolationConfig {
  home?: 'profile' | 'inherit';
  workspace?: 'profile' | 'inherit';
  logs?: 'profile' | 'inherit';
  auth?: 'inherit' | 'profile';
}

export interface SdGatewayChannelsConfig {
  enabled?: boolean;
  root?: string;
  default_platform?: string;
  default_channel?: string;
  events?: SdGatewayChannelEventsConfig;
}

export interface SdGatewayChannelEventsConfig {
  enabled?: boolean;
  root?: string;
  interval_ms?: number;
  startup_delay_ms?: number;
  max_events_per_pass?: number;
  max_prompt_chars?: number;
  max_response_chars?: number;
  max_tokens?: number;
}
