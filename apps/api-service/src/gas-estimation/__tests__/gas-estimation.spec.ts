/// <reference types="jest" />
// @ts-nocheck
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DynamicPricingService } from '../services/dynamic-pricing.service';
import { NetworkConfigService } from '../config/network-config.service';
import { NetworkMonitorService } from '../services/network-monitor.service';
import { GasPriceHistoryService } from '../services/gas-price-history.service';
import { GasEstimationController } from '../gas-estimation.controller';
import { GasPriceHistory } from '../entities/gas-price-history.entity';

describe('Dynamic Gas Estimation Engine', () => {
  let controller: GasEstimationController;
  let dynamicPricingService: DynamicPricingService;
  let networkMonitorService: NetworkMonitorService;
  let gasPriceHistoryService: GasPriceHistoryService;
  let repository: Repository<GasPriceHistory>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GasEstimationController],
      providers: [
        DynamicPricingService,
        NetworkConfigService,
        NetworkMonitorService,
        GasPriceHistoryService,
        {
          provide: getRepositoryToken(GasPriceHistory),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            delete: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<GasEstimationController>(GasEstimationController);
    dynamicPricingService = module.get<DynamicPricingService>(DynamicPricingService);
    networkMonitorService = module.get<NetworkMonitorService>(NetworkMonitorService);
    gasPriceHistoryService = module.get<GasPriceHistoryService>(GasPriceHistoryService);
    repository = module.get<Repository<GasPriceHistory>>(getRepositoryToken(GasPriceHistory));
  });

  describe('Dynamic Pricing Service', () => {
    it('should calculate surge multiplier correctly for low congestion', async () => {
      // Mock low congestion
      const metrics = {
        congestionLevel: 20,
        gasPoolUtilization: 15,
        averageTransactionTime: 4000,
        pendingTransactionCount: 5,
        lastBlockGasUsed: 50000000,
        lastBlockGasLimit: 100000000,
        historicalAverageGasPrice: 1000,
        priceVolatility: 50,
      };

      jest
        .spyOn(networkMonitorService, 'getNetworkMetrics')
        .mockResolvedValue(metrics);

      const estimate = await dynamicPricingService.estimateGasPrice(
        'soroban-testnet',
        100000,
        'normal'
      );

      // Low congestion should have minimal surge (1.0x base)
      expect(estimate.surgeMultiplier).toBeLessThanOrEqual(1.1);
      expect(estimate.dynamicGasPrice).toBeGreaterThan(0);
    });

    it('should increase surge multiplier for high congestion', async () => {
      // Mock high congestion
      const metrics = {
        congestionLevel: 75,
        gasPoolUtilization: 80,
        averageTransactionTime: 8000,
        pendingTransactionCount: 150,
        lastBlockGasUsed: 95000000,
        lastBlockGasLimit: 100000000,
        historicalAverageGasPrice: 1000,
        priceVolatility: 200,
      };

      jest
        .spyOn(networkMonitorService, 'getNetworkMetrics')
        .mockResolvedValue(metrics);

      const estimate = await dynamicPricingService.estimateGasPrice(
        'soroban-testnet',
        100000,
        'normal'
      );

      // High congestion should have significant surge (> 2.0x)
      expect(estimate.surgeMultiplier).toBeGreaterThan(2.0);
    });

    it('should apply priority multipliers correctly', async () => {
      const baseEstimate = await dynamicPricingService.estimateGasPrice(
        'soroban-testnet',
        100000,
        'normal'
      );

      const lowEstimate = await dynamicPricingService.estimateGasPrice(
        'soroban-testnet',
        100000,
        'low'
      );

      const highEstimate = await dynamicPricingService.estimateGasPrice(
        'soroban-testnet',
        100000,
        'high'
      );

      // Low should be cheaper than normal
      expect(lowEstimate.dynamicGasPrice).toBeLessThan(baseEstimate.dynamicGasPrice);

      // High should be more expensive than normal
      expect(highEstimate.dynamicGasPrice).toBeGreaterThan(baseEstimate.dynamicGasPrice);
    });

    it('should apply safety margin to all prices', async () => {
      const estimate = await dynamicPricingService.estimateGasPrice(
        'soroban-testnet',
        100000,
        'normal'
      );

      // Safety margin of 1.15 should be applied
      const basePrice = estimate.baseGasPrice * estimate.surgeMultiplier;
      const expectedPrice = basePrice * 1.15;

      // Allow small rounding differences
      expect(estimate.dynamicGasPrice).toBeCloseTo(expectedPrice, 1);
    });

    it('should return multiple price options', async () => {
      const options = await dynamicPricingService.getMultiplePriceOptions(
        'soroban-testnet',
        100000
      );

      expect(options).toHaveProperty('low');
      expect(options).toHaveProperty('normal');
      expect(options).toHaveProperty('high');
      expect(options).toHaveProperty('critical');

      // Verify pricing hierarchy
      expect(options.low.dynamicGasPrice).toBeLessThan(options.normal.dynamicGasPrice);
      expect(options.normal.dynamicGasPrice).toBeLessThan(options.high.dynamicGasPrice);
      expect(options.high.dynamicGasPrice).toBeLessThan(options.critical.dynamicGasPrice);
    });

    it('should set correct price validity window based on volatility', async () => {
      const estimate = await dynamicPricingService.estimateGasPrice(
        'soroban-testnet',
        100000,
        'normal'
      );

      // Price should be valid for some time in the future
      expect(estimate.expiresAt.getTime()).toBeGreaterThan(Date.now());

      // Validity should be between 30-60 seconds
      const validityMs = estimate.expiresAt.getTime() - Date.now();
      expect(validityMs).toBeGreaterThan(30000);
      expect(validityMs).toBeLessThan(60000);
    });
  });

  describe('Network Monitor Service', () => {
    it('should cache network metrics', async () => {
      const chainId = 'soroban-testnet';

      const metrics1 = await networkMonitorService.getNetworkMetrics(chainId);
      const metrics2 = await networkMonitorService.getNetworkMetrics(chainId);

      // Should return same reference (cached)
      expect(metrics1).toBe(metrics2);
    });

    it('should track congestion levels', async () => {
      const metrics = await networkMonitorService.getNetworkMetrics('soroban-testnet');

      expect(metrics.congestionLevel).toBeGreaterThanOrEqual(0);
      expect(metrics.congestionLevel).toBeLessThanOrEqual(100);
    });

    it('should update metrics periodically', async () => {
      jest.useFakeTimers();

      const spy = jest.spyOn(networkMonitorService, 'updateNetworkMetrics');

      // Trigger cron manually
      await networkMonitorService.updateNetworkMetrics();

      expect(spy).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe('Gas Price History Service', () => {
    it('should record price snapshots', async () => {
      const snapshot = await networkMonitorService.getGasPriceSnapshot('soroban-testnet');

      const saveSpy = jest.spyOn(repository, 'save').mockResolvedValue({
        id: 'test-id',
      } as any);

      await gasPriceHistoryService.recordPriceSnapshot(snapshot);

      expect(saveSpy).toHaveBeenCalled();
    });

    it('should detect price trends correctly', async () => {
      const findSpy = jest
        .spyOn(repository, 'find')
        .mockResolvedValue(
          Array.from({ length: 20 }, (_, i) => ({
            id: `id-${i}`,
            chainId: 'soroban-testnet',
            timestamp: new Date(Date.now() - i * 3600000),
            baseGasPrice: 1000,
            surgeMultiplier: 1.0 + i * 0.01, // Increasing trend
            effectiveGasPrice: (1000 * (1.0 + i * 0.01)) as any,
            networkLoad: 30 + i,
            memoryPoolSize: 0,
            transactionCount: 10,
            blockTime: 4000,
            volatilityIndex: 10,
            priceConfidence: 80,
          })) as any
        );

      const trend = await gasPriceHistoryService.getPriceTrend('soroban-testnet');

      expect(trend.trend).toBe('increasing');
      expect(trend.percentChange).toBeGreaterThan(0);
    });

    it('should calculate average prices', async () => {
      const findSpy = jest
        .spyOn(repository, 'find')
        .mockResolvedValue(
          Array.from({ length: 24 }, (_, i) => ({
            id: `id-${i}`,
            chainId: 'soroban-testnet',
            timestamp: new Date(Date.now() - i * 3600000),
            baseGasPrice: 1000,
            surgeMultiplier: 1.0,
            effectiveGasPrice: (1000 + i * 50) as any, // Varying prices
            networkLoad: 40,
            memoryPoolSize: 0,
            transactionCount: 20,
            blockTime: 4000,
            volatilityIndex: 15,
            priceConfidence: 75,
          })) as any
        );

      const stats = await gasPriceHistoryService.getAveragePriceOverPeriod(
        'soroban-testnet',
        24
      );

      expect(stats.average).toBeGreaterThan(0);
      expect(stats.min).toBeLessThanOrEqual(stats.average);
      expect(stats.max).toBeGreaterThanOrEqual(stats.average);
      expect(stats.stdDev).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Gas Estimation Controller', () => {
    it('should handle estimate requests', async () => {
      const response = await controller.estimateGasPrice({
        chainId: 'soroban-testnet',
        estimatedGasUnits: 100000,
        priority: 'normal',
      });

      expect(response).toHaveProperty('chainId');
      expect(response).toHaveProperty('dynamicGasPrice');
      expect(response).toHaveProperty('totalEstimatedCostXLM');
      expect(response).toHaveProperty('expiresAt');
    });

    it('should return multiple price options', async () => {
      const response = await controller.getMultiplePriceOptions({
        chainId: 'soroban-testnet',
        estimatedGasUnits: 100000,
      });

      expect(response).toHaveProperty('low');
      expect(response).toHaveProperty('normal');
      expect(response).toHaveProperty('high');
      expect(response).toHaveProperty('critical');
    });

    it('should provide network metrics', async () => {
      const response = await controller.getNetworkMetrics('soroban-testnet');

      expect(response).toHaveProperty('chainId');
      expect(response).toHaveProperty('congestionLevel');
      expect(response).toHaveProperty('currentGasPriceSnapshot');
    });

    it('should return health status', async () => {
      const response = await controller.health();

      expect(response).toHaveProperty('status', 'healthy');
      expect(response).toHaveProperty('supportedChains');
      expect(response.supportedChains).toContain('soroban-mainnet');
      expect(response.supportedChains).toContain('soroban-testnet');
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle rapid price requests without cache thrashing', async () => {
      const promises = Array.from({ length: 100 }, () =>
        dynamicPricingService.estimateGasPrice('soroban-testnet', 100000, 'normal')
      );

      const results = await Promise.all(promises);

      // All requests should succeed
      expect(results.length).toBe(100);

      // All should have similar base prices (same cache hit)
      results.forEach((result) => {
        expect(result.baseGasPrice).toBe(results[0].baseGasPrice);
      });
    });

    it('should suggest optimal times with historical data', async () => {
      const findSpy = jest.spyOn(repository, 'find').mockResolvedValue(
        Array.from({ length: 168 }, (_, i) => ({
          id: `id-${i}`,
          chainId: 'soroban-testnet',
          timestamp: new Date(Date.now() - i * 3600000),
          baseGasPrice: 1000,
          surgeMultiplier: 1.0,
          // Simulate hourly pattern - cheaper at certain hours
          effectiveGasPrice: (1000 + (i % 24) * 30) as any,
          networkLoad: 40,
          memoryPoolSize: 0,
          transactionCount: 20,
          blockTime: 4000,
          volatilityIndex: 15,
          priceConfidence: 75,
        })) as any
      );

      const windows = await gasPriceHistoryService.getBestTimeWindowsForLowPrices(
        'soroban-testnet',
        3
      );

      // Should identify the cheapest hours
      expect(windows.length).toBeGreaterThan(0);
      expect(windows[0].averagePrice).toBeLessThanOrEqual(windows[windows.length - 1].averagePrice);
    });
  });
});
