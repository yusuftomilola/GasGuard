import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { ContractEfficiencyDto } from './dto/contract-efficiency.dto';
import {
  ParsedTransaction,
  FunctionGasGroup,
  FunctionEfficiencyResult,
  ContractEfficiencyResult,
  EfficiencyLevel,
} from './interfaces/analytics.interface';
import {
  FUNCTION_GAS_BENCHMARKS,
  GAS_TIER_SCORE_TABLE,
  EFFICIENCY_THRESHOLDS,
  OPTIMIZATION_RECOMMENDATIONS,
} from './constants/gas-benchmarks.constant';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly DEFAULT_BLOCK_SCAN_RANGE = 10_000;
  private readonly DEFAULT_TX_LIMIT = 200;

  constructor(private readonly configService: ConfigService) {}

  // ─── Public API ───────────────────────────────────────────────────────────

  async analyzeContractEfficiency(
    dto: ContractEfficiencyDto,
  ): Promise<ContractEfficiencyResult> {
    const provider = this.buildProvider(dto.rpcUrl);
    const limit = dto.limit ?? this.DEFAULT_TX_LIMIT;

    // Resolve block range
    const latestBlock = await provider.getBlockNumber();
    const toBlock = dto.toBlock ?? latestBlock;
    const fromBlock = dto.fromBlock ?? Math.max(0, toBlock - this.DEFAULT_BLOCK_SCAN_RANGE);

    if (fromBlock > toBlock) {
      throw new BadRequestException('fromBlock must be less than or equal to toBlock.');
    }

    // Build ABI interface for function name resolution (if provided)
    const abiInterface = dto.abi ? this.buildInterface(dto.abi) : null;

    // Collect raw transactions
    const txHashes = dto.transactionHashes?.length
      ? dto.transactionHashes
      : await this.collectTxHashesFromLogs(
          provider,
          dto.contractAddress,
          fromBlock,
          toBlock,
          limit,
        );

    if (!txHashes.length) {
      throw new BadRequestException(
        'No transactions found for the specified contract and block range.',
      );
    }

    // Fetch receipts and parse gas data
    const parsedTxs = await this.fetchAndParseTxs(
      provider,
      txHashes.slice(0, limit),
      dto.contractAddress,
      abiInterface,
    );

    if (!parsedTxs.length) {
      throw new BadRequestException(
        'Could not parse any transactions. Ensure the contract address is correct.',
      );
    }

    // Group by function selector
    const groups = this.groupByFunction(parsedTxs);

    // Score each function
    const functionResults = this.scoreFunctions(groups);

    // Derive overall score (weighted by call volume)
    const overallScore = this.calculateOverallScore(functionResults);

    return {
      contractAddress: ethers.getAddress(dto.contractAddress),
      analyzedTransactions: parsedTxs.length,
      fromBlock,
      toBlock,
      overallEfficiencyScore: overallScore,
      efficiencyLevel: this.resolveEfficiencyLevel(overallScore),
      functions: functionResults,
    };
  }

  // ─── Provider ─────────────────────────────────────────────────────────────

  private buildProvider(rpcUrl?: string): ethers.JsonRpcProvider {
    const url =
      rpcUrl ??
      this.configService.get<string>('RPC_URL') ??
      this.configService.get<string>('ETHEREUM_RPC_URL');

    if (!url) {
      throw new BadRequestException(
        'No RPC URL configured. Provide rpcUrl in the request body or set RPC_URL in environment.',
      );
    }

    return new ethers.JsonRpcProvider(url);
  }

  private buildInterface(abi: object[]): ethers.Interface | null {
    try {
      return new ethers.Interface(abi);
    } catch {
      this.logger.warn('Failed to parse provided ABI. Falling back to selector-only resolution.');
      return null;
    }
  }

  // ─── Transaction Collection ───────────────────────────────────────────────

  /**
   * Collects transaction hashes by scanning event logs emitted by the contract.
   * This is the most RPC-efficient approach without an indexer.
   */
  private async collectTxHashesFromLogs(
    provider: ethers.JsonRpcProvider,
    contractAddress: string,
    fromBlock: number,
    toBlock: number,
    limit: number,
  ): Promise<string[]> {
    const checksumAddress = ethers.getAddress(contractAddress);

    try {
      const logs = await provider.getLogs({
        address: checksumAddress,
        fromBlock,
        toBlock,
      });

      // Deduplicate by tx hash (multiple logs can share a tx)
      const uniqueHashes = [...new Set(logs.map((l) => l.transactionHash))];

      // Most recent first
      return uniqueHashes.reverse().slice(0, limit);
    } catch (err) {
      this.logger.warn(
        `getLogs failed (block range may be too wide): ${(err as Error).message}. ` +
          'Attempting chunked scan...',
      );

      return this.collectTxHashesChunked(provider, contractAddress, fromBlock, toBlock, limit);
    }
  }

  /**
   * Chunked fallback when a single getLogs call exceeds provider limits.
   */
  private async collectTxHashesChunked(
    provider: ethers.JsonRpcProvider,
    contractAddress: string,
    fromBlock: number,
    toBlock: number,
    limit: number,
  ): Promise<string[]> {
    const CHUNK_SIZE = 2_000;
    const hashes = new Set<string>();

    for (let start = toBlock; start >= fromBlock && hashes.size < limit; start -= CHUNK_SIZE) {
      const end = start;
      const chunkStart = Math.max(fromBlock, start - CHUNK_SIZE + 1);

      try {
        const logs = await provider.getLogs({
          address: ethers.getAddress(contractAddress),
          fromBlock: chunkStart,
          toBlock: end,
        });

        for (const log of logs) {
          hashes.add(log.transactionHash);
          if (hashes.size >= limit) break;
        }
      } catch {
        // Skip problematic chunk
      }
    }

    return [...hashes];
  }

  // ─── Transaction Parsing ──────────────────────────────────────────────────

  private async fetchAndParseTxs(
    provider: ethers.JsonRpcProvider,
    hashes: string[],
    contractAddress: string,
    abiInterface: ethers.Interface | null,
  ): Promise<ParsedTransaction[]> {
    const checksumAddress = ethers.getAddress(contractAddress);
    const results: ParsedTransaction[] = [];

    // Batch in groups of 20 to avoid overwhelming the provider
    const BATCH_SIZE = 20;
    for (let i = 0; i < hashes.length; i += BATCH_SIZE) {
      const batch = hashes.slice(i, i + BATCH_SIZE);

      const settled = await Promise.allSettled(
        batch.map((hash) => this.parseSingleTx(provider, hash, checksumAddress, abiInterface)),
      );

      for (const result of settled) {
        if (result.status === 'fulfilled' && result.value) {
          results.push(result.value);
        }
      }
    }

    return results;
  }

  private async parseSingleTx(
    provider: ethers.JsonRpcProvider,
    hash: string,
    contractAddress: string,
    abiInterface: ethers.Interface | null,
  ): Promise<ParsedTransaction | null> {
    try {
      const [tx, receipt] = await Promise.all([
        provider.getTransaction(hash),
        provider.getTransactionReceipt(hash),
      ]);

      if (!tx || !receipt) return null;

      // Only analyze calls directly to the target contract
      if (tx.to?.toLowerCase() !== contractAddress.toLowerCase()) return null;

      // Transactions with no input data are plain ETH transfers
      const inputData = tx.data ?? '0x';
      const functionSelector =
        inputData.length >= 10 ? inputData.slice(0, 10).toLowerCase() : '0x';

      const functionName = this.resolveFunctionName(functionSelector, inputData, abiInterface);

      return {
        hash,
        functionSelector,
        functionName,
        gasUsed: receipt.gasUsed,
        gasLimit: tx.gasLimit,
        effectiveGasPrice: receipt.gasPrice ?? tx.gasPrice ?? 0n,
        blockNumber: receipt.blockNumber,
      };
    } catch (err) {
      this.logger.debug(`Failed to parse tx ${hash}: ${(err as Error).message}`);
      return null;
    }
  }

  // ─── Function Name Resolution ─────────────────────────────────────────────

  private resolveFunctionName(
    selector: string,
    inputData: string,
    abiInterface: ethers.Interface | null,
  ): string {
    // 1. Try ABI interface (full signature)
    if (abiInterface && inputData.length >= 10) {
      try {
        const fragment = abiInterface.getFunction(selector);
        if (fragment) return fragment.format('full');
      } catch {
        // not in provided ABI
      }
    }

    // 2. Try known benchmark table
    if (FUNCTION_GAS_BENCHMARKS[selector]) {
      return FUNCTION_GAS_BENCHMARKS[selector].name;
    }

    // 3. ETH transfer (no data)
    if (selector === '0x') return 'ETH Transfer';

    // 4. Unknown — return raw selector
    return `unknown(${selector})`;
  }

  // ─── Grouping ─────────────────────────────────────────────────────────────

  private groupByFunction(transactions: ParsedTransaction[]): FunctionGasGroup[] {
    const map = new Map<string, ParsedTransaction[]>();

    for (const tx of transactions) {
      const existing = map.get(tx.functionSelector) ?? [];
      existing.push(tx);
      map.set(tx.functionSelector, existing);
    }

    return [...map.entries()].map(([selector, txs]) => {
      const gasValues = txs.map((t) => Number(t.gasUsed));
      const totalGas = gasValues.reduce((a, b) => a + b, 0);
      const avgGas = totalGas / txs.length;

      const gasLimitValues = txs.map((t) => Number(t.gasLimit));
      const avgUtilization =
        gasLimitValues.reduce((sum, limit, i) => {
          return limit > 0 ? sum + gasValues[i] / limit : sum;
        }, 0) / txs.length;

      return {
        functionName: txs[0].functionName,
        functionSelector: selector,
        transactions: txs,
        totalGasUsed: txs.reduce((a, t) => a + t.gasUsed, 0n),
        averageGasUsed: Math.round(avgGas),
        minGasUsed: Math.min(...gasValues),
        maxGasUsed: Math.max(...gasValues),
        callCount: txs.length,
        averageGasUtilization: avgUtilization,
      } satisfies FunctionGasGroup;
    });
  }

  // ─── Scoring ──────────────────────────────────────────────────────────────

  private scoreFunctions(groups: FunctionGasGroup[]): FunctionEfficiencyResult[] {
    return groups
      .sort((a, b) => b.callCount - a.callCount) // most-called first
      .map((group) => {
        const benchmark = FUNCTION_GAS_BENCHMARKS[group.functionSelector]?.benchmark ?? null;
        const score = this.calculateEfficiencyScore(group, benchmark);
        const level = this.resolveEfficiencyLevel(score);
        const recommendation = this.buildRecommendation(score, group, benchmark);

        return {
          functionName: group.functionName,
          functionSelector: group.functionSelector,
          callCount: group.callCount,
          averageGasUsed: group.averageGasUsed,
          minGasUsed: group.minGasUsed,
          maxGasUsed: group.maxGasUsed,
          benchmarkGas: benchmark,
          efficiencyScore: score,
          efficiencyLevel: level,
          ...(recommendation ? { recommendation } : {}),
        } satisfies FunctionEfficiencyResult;
      });
  }

  /**
   * Deterministic Gas Efficiency Score (0–100).
   *
   * Algorithm:
   *   1. Benchmark-based score: 100 * (benchmark / actual), capped at 100.
   *   2. Tier-based score (no benchmark): interpolated from GAS_TIER_SCORE_TABLE.
   *   3. Utilization bonus: +3 pts when avg gas/limit < 0.6 (headroom available).
   *   4. High-variance penalty: −5 pts when (max−min)/avg > 0.5.
   *
   * All inputs are deterministic given the same transaction set.
   */
  private calculateEfficiencyScore(group: FunctionGasGroup, benchmark: number | null): number {
    let baseScore: number;

    if (benchmark !== null && benchmark > 0) {
      // Benchmark-relative score
      baseScore = Math.min(100, (benchmark / group.averageGasUsed) * 100);
    } else {
      // Tier-based score
      const tier = GAS_TIER_SCORE_TABLE.find((t) => group.averageGasUsed <= t.maxGas);
      baseScore = tier?.baseScore ?? 5;
    }

    // Utilization bonus (low utilization = function has natural headroom or is rarely expensive)
    const utilizationBonus = group.averageGasUtilization < 0.6 ? 3 : 0;

    // Variance penalty (inconsistent gas usage may indicate conditional logic or re-entrancy guards)
    const gasRange = group.maxGasUsed - group.minGasUsed;
    const variancePenalty = gasRange / group.averageGasUsed > 0.5 ? 5 : 0;

    return Math.max(0, Math.min(100, Math.round(baseScore + utilizationBonus - variancePenalty)));
  }

  private calculateOverallScore(functions: FunctionEfficiencyResult[]): number {
    if (!functions.length) return 0;

    const totalCalls = functions.reduce((sum, f) => sum + f.callCount, 0);
    const weightedSum = functions.reduce(
      (sum, f) => sum + f.efficiencyScore * (f.callCount / totalCalls),
      0,
    );

    return Math.round(weightedSum);
  }

  // ─── Efficiency Level ──────────────────────────────────────────────────────

  private resolveEfficiencyLevel(score: number): EfficiencyLevel {
    if (score >= EFFICIENCY_THRESHOLDS.HIGHLY_EFFICIENT) return 'Highly Efficient';
    if (score >= EFFICIENCY_THRESHOLDS.OPTIMIZED) return 'Optimized';
    if (score >= EFFICIENCY_THRESHOLDS.MODERATE) return 'Moderate';
    if (score >= EFFICIENCY_THRESHOLDS.INEFFICIENT) return 'Inefficient';
    return 'Critical';
  }

  // ─── Recommendations ──────────────────────────────────────────────────────

  private buildRecommendation(
    score: number,
    group: FunctionGasGroup,
    benchmark: number | null,
  ): string | undefined {
    // No recommendation needed for efficient functions
    if (score >= EFFICIENCY_THRESHOLDS.OPTIMIZED) return undefined;

    const name = group.functionName.toLowerCase();
    const avg = group.averageGasUsed;

    // Context-aware recommendation selection
    if (name.includes('swap') || name.includes('exchange')) {
      return OPTIMIZATION_RECOMMENDATIONS.SWAP_HEAVY;
    }

    if (avg > 500_000) {
      return OPTIMIZATION_RECOMMENDATIONS.LOOP_OPTIMIZATION;
    }

    if (name.includes('batch') || name.includes('multi')) {
      return OPTIMIZATION_RECOMMENDATIONS.BATCH_OPERATIONS;
    }

    if (avg > 200_000 && benchmark !== null && avg > benchmark * 1.5) {
      return OPTIMIZATION_RECOMMENDATIONS.EXTERNAL_CALLS;
    }

    if (avg > 150_000) {
      return OPTIMIZATION_RECOMMENDATIONS.HIGH_GAS_STORAGE;
    }

    if (group.callCount > 50 && avg > 80_000) {
      return OPTIMIZATION_RECOMMENDATIONS.BATCH_OPERATIONS;
    }

    return OPTIMIZATION_RECOMMENDATIONS.GENERAL_REVIEW;
  }
}
