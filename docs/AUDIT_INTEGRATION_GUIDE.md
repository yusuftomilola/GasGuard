# Audit System Integration Guide

## Quick Start

### 1. Database Setup
```bash
# Run migrations to create audit tables
npm run migration:run
```

### 2. Service Usage

#### Emitting API Key Events
```typescript
import { AuditLogService } from './audit/services';
import { EventType } from './audit/entities';

export class ApiKeyService {
  constructor(private auditLogService: AuditLogService) {}

  async createApiKey(merchantId: string, details: any) {
    const newKey = await this.repo.save(details);
    
    // Emit creation event
    this.auditLogService.emitApiKeyEvent(
      EventType.API_KEY_CREATED,
      merchantId,
      {
        keyId: newKey.id,
        name: newKey.name,
        role: newKey.role,
      }
    );
    
    return newKey;
  }

  async rotateApiKey(merchantId: string, oldKeyId: string, newKey: any) {
    await this.repo.save(newKey);
    
    this.auditLogService.emitApiKeyEvent(
      EventType.API_KEY_ROTATED,
      merchantId,
      {
        oldKeyId,
        newKeyId: newKey.id,
        reason: 'scheduled rotation',
      }
    );
  }

  async revokeApiKey(merchantId: string, keyId: string) {
    await this.repo.update(keyId, { status: 'revoked' });
    
    this.auditLogService.emitApiKeyEvent(
      EventType.API_KEY_REVOKED,
      merchantId,
      {
        revokedKeyId: keyId,
        reason: 'user-initiated',
      }
    );
  }
}
```

#### Emitting Gas Transaction Events
```typescript
import { AuditLogService } from './audit/services';
import { EventType } from './audit/entities';

export class GasTransactionService {
  constructor(private auditLogService: AuditLogService) {}

  async submitGasTransaction(
    merchantId: string,
    chainId: number,
    data: any
  ) {
    // Process transaction...
    const result = await this.submitToChain(data);
    
    // Emit gas transaction event
    this.auditLogService.emitGasTransaction(
      merchantId,
      chainId,
      result.transactionHash,
      result.gasUsed,
      result.gasPrice,
      result.senderAddress,
      {
        method: result.method,
        value: result.value,
        status: 'confirmed',
      }
    );
    
    return result;
  }
}
```

### 3. Querying Audit Logs

#### From Services
```typescript
import { AuditLogService } from './audit/services';
import { EventType } from './audit/entities';

export class ReportService {
  constructor(private auditLogService: AuditLogService) {}

  async generateUserActivityReport(merchantId: string, month: string) {
    const [year, monthNum] = month.split('-');
    const from = new Date(`${year}-${monthNum}-01`);
    const to = new Date(from.getFullYear(), from.getMonth() + 1, 0);

    const logs = await this.auditLogService.queryLogs({
      user: merchantId,
      from: from.toISOString(),
      to: to.toISOString(),
      limit: 1000,
      offset: 0,
    });

    return logs;
  }

  async generateComplianceReport() {
    // Get all key lifecycle events
    const keyEvents = await this.auditLogService.getLogsByEventType(
      EventType.API_KEY_CREATED,
      10000
    );

    // Get all failed requests
    const failures = await this.auditLogService.queryLogs({
      eventType: EventType.API_REQUEST,
      outcome: 'failure',
      limit: 10000,
      offset: 0,
    });

    return {
      period: 'current_month',
      keyCreations: keyEvents.length,
      failedRequests: failures.total,
    };
  }

  async exportAuditTrail(format: 'csv' | 'json') {
    return this.auditLogService.exportLogs(format, {
      limit: 10000,
      offset: 0,
    });
  }
}
```

#### Via REST API
```bash
# Get all audit logs with pagination
curl -X GET 'http://localhost:3000/audit/logs?limit=50&offset=0'

# Filter by event type
curl -X GET 'http://localhost:3000/audit/logs?eventType=APIRequest'

# Filter by user and date range
curl -X GET 'http://localhost:3000/audit/logs?user=merchant_123&from=2024-02-01&to=2024-02-28'

# Get specific log
curl -X GET 'http://localhost:3000/audit/logs/550e8400-e29b-41d4-a716-446655440000'

# Get logs by type
curl -X GET 'http://localhost:3000/audit/logs/type/KeyCreated?limit=100'

# Export logs as CSV
curl -X POST 'http://localhost:3000/audit/logs/export' \
  -H 'Content-Type: application/json' \
  -d '{
    "format": "csv",
    "eventType": "APIRequest",
    "user": "merchant_123"
  }' > audit-logs.csv

# Get audit statistics
curl -X GET 'http://localhost:3000/audit/stats'
```

### 4. Automatic HTTP Request Logging

The `AuditInterceptor` automatically captures all API requests. Configure excluded patterns in `audit.interceptor.ts`:

```typescript
private shouldSkipAudit(url: string): boolean {
  const excludePatterns = [
    '/health',
    '/health/ready',
    '/health/live',
    '/metrics',
    '/swagger',
    '/api-docs',
  ];

  return excludePatterns.some((pattern) => url.includes(pattern));
}
```

API Key extraction (automatic):
1. Authorization header: `Authorization: Bearer <api-key>`
2. Custom header: `X-API-Key: <api-key>`
3. Query parameter: `?apiKey=<api-key>`

### 5. Environment Configuration

```bash
# Set retention policy (days)
AUDIT_LOG_RETENTION_DAYS=90

# Database settings (see main DB config)
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=gasguard
```

### 6. Scheduled Cleanup

Set up scheduled task with `@nestjs/schedule`:

```typescript
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuditLogService } from './audit/services/audit-log.service';

@Injectable()
export class AuditMaintenanceService {
  constructor(private auditLogService: AuditLogService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupOldLogs() {
    const retentionDays = parseInt(
      process.env.AUDIT_LOG_RETENTION_DAYS || '90'
    );
    
    const deleted = await this.auditLogService.retentionCleanup(
      retentionDays
    );
    
    console.log(
      `🧹 Audit cleanup completed: ${deleted} logs removed`
    );
  }
}
```

Add to module:
```typescript
@Module({
  providers: [AuditMaintenanceService],
})
export class ScheduleModule {}
```

## Security Considerations

1. **API Key Protection**
   - Keys stored as hashes only (SHA256)
   - Never log raw API keys
   - Rotate keys regularly

2. **Access Control**
   - Restrict audit endpoints to admin users
   - Log all access to audit logs
   - Use HTTPS in production

3. **Data Integrity**
   - Each log includes SHA256 hash
   - Prevent unauthorized log deletion/modification
   - Verify integrity on retrieval

4. **Performance**
   - Use pagination (limit results)
   - Implement query timeouts
   - Archive old logs periodically
   - Monitor database performance

## Compliance Mapping

| Requirement | Implementation |
|-------------|-----------------|
| User activity tracking | API request events |
| Key management audit | KeyCreated, KeyRotated, KeyRevoked events |
| Transaction traceability | GasTransaction events |
| Access control | Admin-only audit endpoints |
| Immutable storage | Append-only design, integrity hashing |
| Data retention | Configurable retention policies |
| Reporting | CSV/JSON export with filtering |
| Accountability | User ID in all events |

## Troubleshooting

### Issue: Events not being logged
**Solution:**
1. Check `AuditModule` is imported in `AppModule`
2. Verify interceptor registered in `main.ts`
3. Check database connection
4. Monitor application logs

### Issue: Query returning no results
**Solution:**
1. Verify date filters are correct
2. Check user/eventType filters match data
3. Try with larger limit (pagination issue)
4. Query without filters to verify data exists

### Issue: Export fails
**Solution:**
1. Verify csv parsing dependency installed
2. Check disk space available
3. Try smaller export (fewer records)
4. Check file permissions

## Testing

```bash
# Run all audit tests
npm test -- audit

# Run with coverage
npm run test:cov -- src/audit

# Run E2E tests
npm run test:e2e -- audit.controller.e2e.spec.ts

# Watch mode
npm test -- audit --watch
```

## Examples

See [AUDIT_LOGGING_SYSTEM.md](./AUDIT_LOGGING_SYSTEM.md) for comprehensive documentation and examples.
