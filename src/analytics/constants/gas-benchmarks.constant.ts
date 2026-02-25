/**
 * Known function selector benchmarks (4-byte hex -> expected gas).
 * Values represent well-optimized implementations for each function.
 */
export const FUNCTION_GAS_BENCHMARKS: Record<string, { name: string; benchmark: number }> = {
  // ERC-20
  '0xa9059cbb': { name: 'transfer(address,uint256)', benchmark: 52000 },
  '0x23b872dd': { name: 'transferFrom(address,address,uint256)', benchmark: 65000 },
  '0x095ea7b3': { name: 'approve(address,uint256)', benchmark: 46000 },
  '0x70a08231': { name: 'balanceOf(address)', benchmark: 25000 },
  '0xdd62ed3e': { name: 'allowance(address,address)', benchmark: 26000 },
  '0x18160ddd': { name: 'totalSupply()', benchmark: 22000 },

  // ERC-721
  '0x42842e0e': { name: 'safeTransferFrom(address,address,uint256)', benchmark: 85000 },
  '0xb88d4fde': { name: 'safeTransferFrom(address,address,uint256,bytes)', benchmark: 95000 },
  '0x6352211e': { name: 'ownerOf(uint256)', benchmark: 25000 },
  '0x081812fc': { name: 'getApproved(uint256)', benchmark: 25000 },
  '0xa22cb465': { name: 'setApprovalForAll(address,bool)', benchmark: 46000 },
  '0xe985e9c5': { name: 'isApprovedForAll(address,address)', benchmark: 26000 },

  // ERC-1155
  '0xf242432a': { name: 'safeTransferFrom(address,address,uint256,uint256,bytes)', benchmark: 90000 },
  '0x2eb2c2d6': { name: 'safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)', benchmark: 150000 },
  '0x00fdd58e': { name: 'balanceOf(address,uint256)', benchmark: 26000 },

  // Uniswap V2
  '0x38ed1739': { name: 'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)', benchmark: 150000 },
  '0x7ff36ab5': { name: 'swapExactETHForTokens(uint256,address[],address,uint256)', benchmark: 140000 },
  '0x18cbafe5': { name: 'swapExactTokensForETH(uint256,uint256,address[],address,uint256)', benchmark: 145000 },
  '0xe8e33700': { name: 'addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256)', benchmark: 200000 },
  '0xbaa2abde': { name: 'removeLiquidity(address,address,uint256,uint256,uint256,address,uint256)', benchmark: 185000 },

  // Uniswap V3
  '0x414bf389': { name: 'exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))', benchmark: 160000 },
  '0xc04b8d59': { name: 'exactInput((bytes,address,uint256,uint256,uint256))', benchmark: 200000 },

  // Common patterns
  '0x40c10f19': { name: 'mint(address,uint256)', benchmark: 70000 },
  '0x42966c68': { name: 'burn(uint256)', benchmark: 55000 },
  '0x4e71d92d': { name: 'claim()', benchmark: 80000 },
  '0x3d18b912': { name: 'getReward()', benchmark: 90000 },
  '0xe9fad8ee': { name: 'exit()', benchmark: 120000 },
  '0xa694fc3a': { name: 'stake(uint256)', benchmark: 85000 },
  '0x2e1a7d4d': { name: 'withdraw(uint256)', benchmark: 80000 },
  '0xd0e30db0': { name: 'deposit()', benchmark: 55000 },
  '0xb6b55f25': { name: 'deposit(uint256)', benchmark: 75000 },
};

/**
 * Logarithmic gas tiers used when no benchmark exists for a function.
 * Maps average gas used to a base score.
 */
export const GAS_TIER_SCORE_TABLE: Array<{ maxGas: number; baseScore: number; tier: string }> = [
  { maxGas: 25000, baseScore: 100, tier: 'View/Static' },
  { maxGas: 50000, baseScore: 95, tier: 'Minimal' },
  { maxGas: 75000, baseScore: 88, tier: 'Simple' },
  { maxGas: 100000, baseScore: 80, tier: 'Low' },
  { maxGas: 150000, baseScore: 70, tier: 'Moderate-Low' },
  { maxGas: 200000, baseScore: 58, tier: 'Moderate' },
  { maxGas: 300000, baseScore: 45, tier: 'Moderate-High' },
  { maxGas: 500000, baseScore: 32, tier: 'High' },
  { maxGas: 1000000, baseScore: 18, tier: 'Very High' },
  { maxGas: Infinity, baseScore: 5, tier: 'Extreme' },
];

/**
 * Efficiency level thresholds.
 */
export const EFFICIENCY_THRESHOLDS = {
  HIGHLY_EFFICIENT: 90,
  OPTIMIZED: 70,
  MODERATE: 50,
  INEFFICIENT: 30,
} as const;

/**
 * Optimization recommendations keyed by trigger condition.
 */
export const OPTIMIZATION_RECOMMENDATIONS: Record<string, string> = {
  HIGH_GAS_STORAGE:
    'Reduce storage writes by caching state variables in memory and batching updates.',
  EXTERNAL_CALLS:
    'Minimize external contract calls. Consider aggregating calls or using a multicall pattern.',
  SWAP_HEAVY:
    'Review storage writes and external calls. Consider using transient storage (EIP-1153) for intermediate values.',
  LOOP_OPTIMIZATION:
    'Optimize loops by caching array length, using unchecked arithmetic, and reducing per-iteration storage ops.',
  REDUNDANT_EVENTS:
    'Remove redundant or overly verbose event emissions. Index only necessary parameters.',
  ASSEMBLY_OPPORTUNITY:
    'Hot-path operations are candidates for inline assembly to skip Solidity safety overhead.',
  BATCH_OPERATIONS:
    'High call frequency detected. Consider a batching interface to amortize fixed costs.',
  CALLDATA_OPTIMIZATION:
    'Use calldata instead of memory for read-only function parameters to reduce gas cost.',
  GENERAL_REVIEW:
    'Review function logic for redundant computations, unnecessary storage reads, and avoidable external calls.',
};
