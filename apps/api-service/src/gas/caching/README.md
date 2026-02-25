# Gas Query Caching - Quick Start

## What is it?

A Redis-backed caching layer that:
- ✅ Reduces RPC calls by caching gas query results
- ✅ Automatically returns cached data if valid
- ✅ Falls back to in-memory cache if Redis unavailable
- ✅ Tracks cache hit/miss metrics
- ✅ Supports configurable TTL per query type

## Setup

### 1. Install & Start Redis

```bash
# Using Docker
docker run -d -p 6379:6379 redis:latest

# Or locally
brew install redis
redis-server
```

### 2. Environment Variables

```env
REDIS_HOST=localhost
REDIS_PORT=6379
CACHE_ENABLED=true
CACHE_TTL_BASE_FEE=120
CACHE_TTL_PRIORITY_FEE=60
CACHE_TTL_GAS_ESTIMATE=180
```

### 3. Import CacheModule

```typescript
import { Module } from '@nestjs/common';
import { CacheModule } from '@gasguard/gas/caching';

@Module({
  imports: [CacheModule],
})
export class AppModule {}
```

### 4. Use in Service

```typescript
import { Injectable } from '@nestjs/common';
import { CacheService, cacheKeys } from '@gasguard/gas/caching';

@Injectable()
export class GasService {
  constructor(private cache: CacheService) {}

  async getBaseFee(chainId: number): Promise<string> {
    const key = cacheKeys.baseFee(chainId);
    return this.cache.getOrFetch(
      key,
      'baseFee',
      () => this.rpcClient.getBaseFee(chainId),
      chainId,
    );
  }
}
```

## APIs

### Cache Service

```typescript
// Get or fetch with automatic caching
await cache.getOrFetch(key, queryType, fetcher, chainId);

// Manual operations
await cache.set(key, value, ttl);
const value = await cache.get(key);
await cache.invalidate(key);
await cache.invalidateChain(1);
await cache.clearAll();
```

### Metrics

```typescript
// Get cache statistics
const metrics = metricsService.getGlobalMetrics();
// { hits: 1500, misses: 250, hitRate: 85.71%, totalRequests: 1750 }

const endpointMetrics = metricsService.getEndpointMetrics();

const chainMetrics = metricsService.getChainMetrics(1);
```

## Cache Keys

```typescript
import { cacheKeys, buildCacheKey } from '@gasguard/gas/caching';

cacheKeys.baseFee(1)                    // 'gasguard:base_fee:1'
cacheKeys.priorityFee(137)              // 'gasguard:priority_fee:137'
cacheKeys.gasEstimate(1, '/rpc/eth')    // 'gasguard:gas_estimate:1:/rpc/eth'
cacheKeys.chainMetrics(42161)           // 'gasguard:chain_metrics:42161'

// Or build custom
buildCacheKey('custom', 'key', 1)       // 'gasguard:custom:key:1'
```

## Testing

```bash
npm test -- caching
```

Tests cover:
- Cache hits/misses
- TTL expiration
- RPC fallback
- Metrics tracking
- Multi-chain queries
- Configuration

## Monitoring

```typescript
// Health check
const health = await cache.getHealthStatus();
// { connected: true, enabled: true }

// Cache metrics
const stats = metricsService.getGlobalMetrics();
console.log(`Hit Rate: ${stats.hitRate}%`);
```

## Common Issues

| Problem | Solution |
| --- | --- |
| cache.get returns null | Data may have expired. Check TTL config |
| Redis connection failed | Ensure Redis is running. Falls back to in-memory |
| High cache misses | Increase TTL or check if data is being invalidated |

## Performance

- **Cache Hit**: 5-10ms
- **Cache Miss + RPC**: 200-1000ms
- **Typical (80% hit rate)**: ~165ms

## See Also

- [Full Caching Guide](./CACHING_GUIDE.md)
- [Integration Example](./integration.example.ts)
- [Test Suite](./__tests__/)
