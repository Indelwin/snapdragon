export interface WebtoolsExports {
  memory: WebAssembly.Memory;
  wt_alloc: (size: number) => number;
  wt_dealloc: (ptr: number, size: number) => void;
  wt_url_util: (ptr: number, len: number) => bigint;
  wt_robots: (ptr: number, len: number) => bigint;
  wt_content_filter: (ptr: number, len: number) => bigint;
  wt_extractor: (ptr: number, len: number) => bigint;
}

export type WebtoolsOp = 'url_util' | 'robots' | 'content_filter' | 'extractor';

export interface WebtoolsCore {
  call<T>(op: WebtoolsOp, request: unknown): T;
}
