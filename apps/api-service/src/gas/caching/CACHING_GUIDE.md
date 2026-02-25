# Gas Query Caching Layer - Documentation

## Overview

The caching layer reduces RPC calls and API latency by caching gas query results in Redis. It transparently handles cache hits, misses, and invalidation while maintaining data accuracy.

## Architecture

```
Client Request
    ↓
API Endpoint
    ↓
Cache Service
    ├─ Check Redis Cache ───→ Hit? ─→ Return Cached Data
    │
    └─ Miss ─→ Call RPC Endpoint ─→ Store in Redis ─→ Return Data
```

## Features

- **Configurable TTL**: Different TTLs for different query types (base fee, priority fee, gas estimate, etc.)
- **Automatic Fallback**: Uses in-memory cache if Redis is unavailable
- **Cache Metrics**: Track hit/miss rates per endpoint and chain
- **Cache Invalidation**: Support for key-level, chain-level, or pattern-based invalidation
- **Health Checks**: Monitor cache connectivity and status
- **Zero Configuration**: Works out of the box with sensible defaults

## Configuration

### Environment Variables

```env
# Redis Connection
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=<optional>
REDIS_DB=0

# Cache TTL (seconds)
CACHE_TTL_BASE_FEE=120          # 2 minutes
CACHE_TTL_PRIORITY_FEE=60       # 1 minute
CACHE_TTL_GAS_ESTIMATE=180      # 3 minutes
CACHE_TTL_CHAIN_METRICS=300     # 5 minutes
CACHE_TTL_VOLATILITY=600        # 10 minutes
CACHE_TTL_DEFAULT=180           # 3 minutes

# Cache Behavior
CACHE_ENABLED=true
CACHE_STALE_TTL=30              # Serve stale while revalidating
```

### Programmatic Configuration

```typescript
import { CacheService, defaultCacheConfig, CacheConfig } from '@gasguard/gas/caching';

const customConfig: Partial<CacheConfig> = {
  ttl: {
    ...defaultCacheConfig.ttl,
    baseFee: 300, // 5 minutes for slower chains
  },
  behavior: {
    ...defaultCacheConfig.behavior,
    staleWhileRevalidate: 60, // Allow stale data for 60 seconds
  },
};

// Initialize with custom config
const cacheService = CacheService.initialize(customConfig);
```

## Usage

### Basic Caching

```typescript
import { CacheService, cacheKeys } from '@gasguard/gas/caching';

class GasService {
  constructor(private cache: CacheService) {}

  async getBaseFee(chainId: number): Promise<string> {
    const key = cacheKeys.baseFee(chainId);

    // Get or fetch - automatically handles cache
    return this.cache.getOrFetch(
      key,
      'baseFee',
      () => this.fetchBaseFeeFromRPC(chainId),
      chainId,
    );
  }

  private async fetchBaseFeeFromRPC(chainId: number): Promise<string> {
    // RPC call
    const response = await rpcClient.call(chainId, 'eth_baseFeePerGas', []);
    return response;
  }
}
```

### Using Decorators

```typescript
import { Cacheable, InvalidateCache, cacheKeyBuilders } from '@gasguard/gas/caching';

class GasService {
  @Cacheable('baseFee', cacheKeyBuilders.baseFee)
  async getBaseFee(chainId: number): Promise<{ baseFee: string }> {
    // Automatically cached based on chainId
    return this.rpcClient.getBaseFee(chainId);
  }

  @Cacheable('gasEstimate', (args) => `gas_estimate:${args[0]}:${args[1]}`)
  async getGasEstimate(chainId: number, endpoint: string): Promise<number> {
    return this.rpcClient.getGasEstimate(chainId, endpoint);
  }

  @InvalidateCache((args) => [`gasguard:*:${args[0]}*`])
  async updateChainMetrics(chainId: number): Promise<void> {
    // After this completes, all cache for chainId is invalidated
    await this.recalculateMetrics(chainId);
  }
}
```

### Manual Cache Operations

```typescript
import { CacheService, buildCacheKey } from '@gasguard/gas/caching';

class AdminService {
  constructor(private cache: CacheService) {}

  async invalidateCache(chainId: number): Promise<void> {
    // Invalidate all cache for a chain
    await this.cache.invalidateChain(chainId);
  }

  async getCacheHealth(): Promise<object> {
    return this.cache.getHealthStatus();
  }

  async getCacheMetrics(): Promise<object> {
    // Returns hit/miss rate, avg response time
    return this.metricsService.getGlobalMetrics();
  }

  async clearAll(): Promise<void> {
    // Emergency cache clear
    await this.cache.clearAll();
  }
}
```

## Integration with Gas Endpoints

### Example: Updated Gas Controller

```typescript
import { Controller, Get, Param, Query } from '@nestjs/common';
import { CacheService, cacheKeys } from '@gasguard/gas/caching';

@Controller('gas')
export class GasController {
  constructor(
    private gasService: GasService,
    private cache: CacheService,
  ) {}

  @Get('base-fee/:chainId')
  async getBaseFee(@Param('chainId') chainId: number) {
    const key = cacheKeys.baseFee(chainId);
    const data = await this.cache.getOrFetch(
      key,
      'baseFee',
      () => this.gasService.getBaseFeeFromRPC(chainId),
      chainId,
    );

    return { baseFee: data };
  }

  @Get('priority-fee/:chainId')
  async getPriorityFee(@Param('chainId') chainId: number) {
    const key = cacheKeys.priorityFee(chainId);
    return this.cache.getOrFetch(
      key,
      'priorityFee',
      () => this.gasService.getPriorityFeeFromRPC(chainId),
      chainId,
    );
  }

  @Get('gas-estimate/:chainId')
  async getGasEstimate(
    @Param('chainId') chainId: number,
    @Query('endpoint') endpoint: string,
  ) {
    const key = cacheKeys.gasEstimate(chainId, endpoint);
    return this.cache.getOrFetch(
      key,
      'gasEstimate',
      () => this.gasService.estimateGasFromRPC(chainId, endpoint),
      chainId,
    );
  }

  @Get('cache/metrics')
  getCacheMetrics() {
    const metrics = this.metricsService.getGlobalMetrics();
    const endpointMetrics = this.metricsService.getEndpointMetrics();
    return { global: metrics, byEndpoint: endpointMetrics };
  }

  @Get('cache/health')
  async getCacheHealth() {
    return this.cache.getHealthStatus();
  }
}
```

## Cache Metrics

### Global Metrics

```typescript
const metrics = metricsService.getGlobalMetrics();

// Returns:
{
  hits: 1500,           // Total cache hits
  misses: 250,          // Total cache misses
  hitRate: 85.71,       // Percentage (85.71%)
  totalRequests: 1750,  // Total queries
  avgResponseTime: 15.3 // Average response time in ms
}
```

### Per-Endpoint Metrics

```typescript
const endpointMetrics = metricsService.getEndpointMetrics();

// Returns:
{
  'base_fee:1': {
    hits: 800,
    misses: 50,
    totalRequests: 850,
    avgResponseTime: 12.5
  },
  'priority_fee:1': {
    hits: 700,
    misses: 100,
    totalRequests: 800,
    avgResponseTime: 18.2
  },
  // ... more endpoints
}
```

### Per-Chain Metrics

```typescript
const chain1Metrics = metricsService.getChainMetrics(1);
const allChainMetrics = metricsService.getChainMetrics(); // Returns Map<chainId, metrics>
```

## Monitoring & Logging

### Cache Hit/Miss Logging

```
[CacheService] Cache HIT for gasguard:base_fee:1 (5ms)
[CacheService] Cache MISS for gasguard:priority_fee:1 - fetching from RPC
[CacheService] Cached gasguard:base_fee:1 with TTL 120s
```

### Redis Connection Logging

```
[RedisClient] Redis connected successfully
[RedisClient] Redis error: Connection refused
[RedisClient] Max Redis retries exceeded, falling back to in-memory cache
```

### Health Check

```typescript
const health = await cacheService.getHealthStatus();

{
  connected: true,      // Redis connected
  enabled: true,        // Caching enabled
  cacheSize: 1024       // Number of keys (optional)
}
```

## Performance Characteristics

### Typical Response Times

| Scenario | Time |
| --- | --- |
| Cache Hit | 5-10ms |
| Cache Miss + RPC | 200-1000ms |
| Average (80% hit rate) | ~165ms |

### Space Usage

- **In-Memory Cache**: ~1KB per cached entry
- **Redis Cache**: ~500 bytes per entry
- **Typical Load**: 1000-5000 entries = 500KB-5MB

## Troubleshooting

### Redis Connection Issues

```typescript
// Check connection status
const health = await cacheService.getHealthStatus();
if (!health.connected) {
  console.log('Using in-memory fallback cache');
}

// Monitor Redis logs
// Docker: docker logs <redis-container>
// Systemd: journalctl -u redis
```

### Cache Not Working

1. Check `CACHE_ENABLED=true`
2. Verify Redis is running: `redis-cli ping`
3. Check TTL configuration values
4. Monitor cache metrics for hit rate

### High Cache Misses

- Reduce TTL to force fresh data
- Check if cache keys are consistent
- Monitor RPC endpoint latency
- Consider if data is too volatile

## Best Practices

1. **Cache Non-Sensitive Data Only**: Gas queries are perfect candidates
2. **Monitor Hit Rates**: Aim for 70%+ hit rate in production
3. **Set Appropriate TTLs**: Balance freshness with cache efficiency
4. **Use Pattern Invalidation Carefully**: Can impact performance
5. **Test Cache Failover**: Ensure in-memory fallback works
6. **Regular Monitoring**: Check metrics and health status

## Testing

See `__tests__/` directory for comprehensive test suite:

- `cache.service.spec.ts` - Cache hit/miss behavior
- `cache-metrics.service.spec.ts` - Metrics tracking
- `cache-config.spec.ts` - Configuration validation

**Coverage**: >70% of caching layer

## Future Enhancements

- [ ] Prometheus integration for metrics
- [ ] Redis cluster support
- [ ] Distributed cache invalidation
- [ ] Cache warming strategies
- [ ] GraphQL subscription invalidation
