export interface ParsedTransaction {
  hash: string;
  functionSelector: string;
  functionName: string;
  gasUsed: bigint;
  gasLimit: bigint;
  effectiveGasPrice: bigint;
  blockNumber: number;
}

export interface FunctionGasGroup {
  functionName: string;
  functionSelector: string;
  transactions: ParsedTransaction[];
  totalGasUsed: bigint;
  averageGasUsed: number;
  minGasUsed: number;
  maxGasUsed: number;
  callCount: number;
  averageGasUtilization: number;
}

export interface FunctionEfficiencyResult {
  functionName: string;
  functionSelector: string;
  callCount: number;
  averageGasUsed: number;
  minGasUsed: number;
  maxGasUsed: number;
  benchmarkGas: number | null;
  efficiencyScore: number;
  efficiencyLevel: EfficiencyLevel;
  recommendation?: string;
}

export interface ContractEfficiencyResult {
  contractAddress: string;
  analyzedTransactions: number;
  fromBlock: number;
  toBlock: number;
  overallEfficiencyScore: number;
  efficiencyLevel: EfficiencyLevel;
  functions: FunctionEfficiencyResult[];
}

export type EfficiencyLevel =
  | 'Highly Efficient'
  | 'Optimized'
  | 'Moderate'
  | 'Inefficient'
  | 'Critical';
