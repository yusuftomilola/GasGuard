# Audit Module

Comprehensive audit logging system for GasGuard providing traceability and accountability for all critical actions.

## Quick Summary

- **Purpose**: Track all API requests, API key lifecycle events, and gas transactions
- **Storage**: PostgreSQL with immutable append-only logs
- **Access**: REST API endpoints with admin-only access
- **Export**: CSV and JSON export capabilities
- **Integrity**: SHA256 hashing for tamper-detection

## Key Files

### Entities
- `entities/audit-log.entity.ts` - Main audit log entity with event tracking
- `entities/api-key.entity.ts` - API key management and lifecycle tracking

### Services
- `services/audit-log.service.ts` - Main service for querying and emitting audit events
- `services/audit-log.repository.ts` - Database repository for audit logs
- `services/audit-event-emitter.ts` - EventEmitter for decoupled event handling

### API Layer
- `controllers/audit.controller.ts` - REST endpoints for querying and exporting logs
- `interceptors/audit.interceptor.ts` - Global request interceptor for automatic API logging
- `dto/audit-log.dto.ts` - Data transfer objects for API requests/responses

### Module
- `audit.module.ts` - NestJS module configuration
- `index.ts` - Public API exports

### Tests
- `services/__tests__/audit-log.service.spec.ts` - Service unit tests (70%+ coverage)
- `services/__tests__/audit-event-emitter.spec.ts` - Event emitter tests
- `interceptors/__tests__/audit.interceptor.spec.ts` - Interceptor tests
- `__tests__/audit.controller.e2e.spec.ts` - Integration/E2E tests

### Documentation
- Root docs: `AUDIT_LOGGING_SYSTEM.md` - Comprehensive system documentation
- Root docs: `AUDIT_INTEGRATION_GUIDE.md` - Integration and usage guide
- Examples: `examples/audit-integration.example.ts` - Code examples

## Event Types

```typescript
enum EventType {
  API_REQUEST = 'APIRequest',              // All API requests
  API_KEY_CREATED = 'KeyCreated',          // New API key creation
  API_KEY_ROTATED = 'KeyRotated',          // Key rotation
  API_KEY_REVOKED = 'KeyRevoked',          // Key revocation
  GAS_TRANSACTION = 'GasTransaction',      // Gas transactions
  GAS_SUBMISSION = 'GasSubmission',        // Gas submissions
}
```

## Database Schema

### audit_logs Table
Immutable, append-only log storage with:
- Composite index on (eventType, user, timestamp) for fast queries
- Individual indexes on eventType, user, timestamp, chainId
- JSONB field for flexible event-specific details
- SHA256 integrity field for tamper detection

### api_keys Table
API key lifecycle tracking with:
- Merchant association
- Status tracking (active, rotated, revoked, expired)
- Key hash storage (never stores raw keys)
- Rotation chain via rotatedFromId

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/audit/logs` | Query logs with filtering |
| GET | `/audit/logs/:id` | Get specific log |
| GET | `/audit/logs/type/:eventType` | Filter by event type |
| GET | `/audit/logs/user/:userId` | Filter by user |
| POST | `/audit/logs/export` | Export as CSV/JSON |
| GET | `/audit/stats` | Get statistics |

## Auto-Logging

The `AuditInterceptor` automatically logs all API requests including:
- API key extraction (Authorization header, X-API-Key, query param)
- Endpoint and HTTP method
- Response status and duration
- IP address
- Error messages on failures
- Excludes: /health, /metrics, /swagger, /api-docs

## Usage Examples

### Emit API Key Event
```typescript
auditLogService.emitApiKeyEvent(
  EventType.API_KEY_CREATED,
  'merchant_123',
  { keyId: 'key_1', name: 'Production Key', role: 'user' }
);
```

### Emit Gas Transaction
```typescript
auditLogService.emitGasTransaction(
  'merchant_123',
  1, // chainId
  '0x1234...', // txHash
  21000, // gasUsed
  '45 gwei', // gasPrice
  '0xabcd...', // senderAddress
  { method: 'transfer', value: '1.5' }
);
```

### Query Logs
```typescript
const logs = await auditLogService.queryLogs({
  eventType: EventType.API_REQUEST,
  user: 'merchant_123',
  from: '2024-02-01',
  to: '2024-02-28',
  limit: 50,
  offset: 0,
});
```

### Export Logs
```typescript
const csv = await auditLogService.exportLogs('csv', {
  eventType: EventType.API_REQUEST,
  user: 'merchant_123',
});
```

## Setup Instructions

1. **Database Migration**
   ```bash
   npm run migration:run
   ```

2. **Verify Integration**
   - Check `AppModule` imports `AuditModule` ✓
   - Check `main.ts` registers `AuditInterceptor` ✓
   - Check database has `audit_logs` and `api_keys` tables

3. **Test**
   ```bash
   npm test -- audit
   npm run test:cov -- src/audit
   ```

## Security Features

- ✅ API key hashing (never stores raw keys)
- ✅ Immutable append-only logs
- ✅ SHA256 integrity hashing
- ✅ Admin-only access (configurable)
- ✅ Automatic request capture via interceptor
- ✅ Audit trail for all key operations
- ✅ Multi-chain support

## Performance

- Composite indexes for fast querying
- Pagination support for large result sets
- Configurable retention policies
- Query execution optimized via indexes
- Async event emission (non-blocking)

## Compliance

Maps to requirements: SOX, GDPR, HIPAA, PCI-DSS
- User activity tracking ✅
- Access control logging ✅
- Change audit trail ✅
- Data retention policies ✅
- Export for external audit ✅

## Testing Coverage

- Unit tests for all services (70%+ coverage)
- Integration tests for API endpoints
- Event emitter tests
- Interceptor tests
- End-to-end tests

Run tests:
```bash
npm test -- audit
npm run test:cov -- src/audit
npm run test:e2e -- audit.controller.e2e.spec.ts
```

## Future Enhancements

- [ ] Elasticsearch integration for large-scale queries
- [ ] Real-time log streaming via WebSockets
- [ ] Advanced analytics dashboard
- [ ] Automated compliance report generation
- [ ] Log encryption at rest
- [ ] Prometheus metrics export
- [ ] Anomaly detection via ML

## Related Documentation

- [AUDIT_LOGGING_SYSTEM.md](../../docs/AUDIT_LOGGING_SYSTEM.md) - Full system documentation
- [AUDIT_INTEGRATION_GUIDE.md](../../docs/AUDIT_INTEGRATION_GUIDE.md) - Integration guide with examples
