export type SdBackgroundMode = 'daemon' | 'inline' | 'off';

export interface SdDaemonConfig {
  root?: string;
  auto_start?: boolean;
}

export interface SdBackgroundConfig {
  mode?: SdBackgroundMode;
  daemon?: SdDaemonConfig;
}

export interface SdIsolationConfig {
  home?: 'profile' | 'inherit';
  workspace?: 'profile' | 'inherit';
  logs?: 'profile' | 'inherit';
  auth?: 'inherit' | 'profile';
}
