import type { ThinkingBlock } from '../types.js';

export type SignedThinkingBlock = ThinkingBlock & { signature: string };

export function signedThinkingBlocks(
  blocks: readonly ThinkingBlock[] | undefined,
): SignedThinkingBlock[] {
  return (blocks ?? []).filter(hasSignature);
}

function hasSignature(block: ThinkingBlock): block is SignedThinkingBlock {
  return typeof block.signature === 'string' && block.signature.length > 0;
}
