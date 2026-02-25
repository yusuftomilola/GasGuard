import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { ApiKeyService, ApiKeyExpiredException } from '../api-key.service';
import { ApiKeyRepository } from '../api-key.repository';
import { AuditLogService } from '../audit-log.service';
import { ApiKey, ApiKeyStatus } from '../../entities/api-key.entity';
import { EventType } from '../../entities/audit-log.entity';

describe('ApiKeyService', () => {
  let service: ApiKeyService;
  let apiKeyRepository: jest.Mocked<ApiKeyRepository>;
  let auditLogService: jest.Mocked<AuditLogService>;

  const mockApiKey: ApiKey = {
    id: 'test-key-id',
    merchantId: 'test-merchant',
    name: 'Test Key',
    keyHash: 'test-hash',
    status: ApiKeyStatus.ACTIVE,
    expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days from now
    createdAt: new Date(),
    lastUsedAt: null,
    requestCount: 0,
    description: 'Test description',
    role: 'user',
    rotatedFromId: null,
    metadata: null,
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockApiKeyRepo = {
      createApiKey: jest.fn(),
      findById: jest.fn(),
      findByKeyHash: jest.fn(),
      findActiveByKeyHash: jest.fn(),
      findByMerchantId: jest.fn(),
      updateStatus: jest.fn(),
      updateApiKey: jest.fn(),
      recordUsage: jest.fn(),
      findExpiredKeys: jest.fn(),
      findKeysExpiringWithinDays: jest.fn(),
      findKeysPastGracePeriod: jest.fn(),
      revoke: jest.fn(),
      isOwnedBy: jest.fn(),
    };

    const mockAuditLogService = {
      emitApiKeyEvent: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue: any) => {
        const config: Record<string, any> = {
          'API_KEY_DEFAULT_EXPIRY_DAYS': 90,
          'API_KEY_ROTATION_GRACE_PERIOD_HOURS': 24,
          'API_KEY_PREFIX': 'gg',
        };
        return config[key] || defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyService,
        {
          provide: ApiKeyRepository,
          useValue: mockApiKeyRepo,
        },
        {
          provide: AuditLogService,
          useValue: mockAuditLogService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<ApiKeyService>(ApiKeyService);
    apiKeyRepository = module.get(ApiKeyRepository);
    auditLogService = module.get(AuditLogService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createApiKey', () => {
    it('should create a new API key with default expiry', async () => {
      const createDto = {
        name: 'Test Key',
        description: 'Test description',
      };

      apiKeyRepository.createApiKey.mockResolvedValue(mockApiKey);

      const result = await service.createApiKey('test-merchant', createDto);

      expect(result).toBeDefined();
      expect(result.name).toBe(createDto.name);
      expect(result.apiKey).toBeDefined();
      expect(result.keyHash).toBeDefined();
      expect(result.status).toBe(ApiKeyStatus.ACTIVE);
      expect(apiKeyRepository.createApiKey).toHaveBeenCalled();
      expect(auditLogService.emitApiKeyEvent).toHaveBeenCalledWith(
        EventType.API_KEY_CREATED,
        'test-merchant',
        expect.any(Object),
      );
    });

    it('should create API key with custom expiry days', async () => {
      const createDto = {
        name: 'Test Key',
        expiresInDays: 30,
      };

      apiKeyRepository.createApiKey.mockResolvedValue({
        ...mockApiKey,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      const result = await service.createApiKey('test-merchant', createDto);

      expect(result).toBeDefined();
      expect(result.expiresAt).toBeDefined();
    });
  });

  describe('validateApiKey', () => {
    it('should validate a valid API key', async () => {
      apiKeyRepository.findActiveByKeyHash.mockResolvedValue(mockApiKey);

      // Generate a valid key format
      const rawKey = 'gg_testkey123';
      const result = await service.validateApiKey(rawKey);

      expect(result).toBeDefined();
      expect(result.id).toBe(mockApiKey.id);
      expect(apiKeyRepository.recordUsage).toHaveBeenCalledWith(mockApiKey.id);
    });

    it('should throw error for invalid API key', async () => {
      apiKeyRepository.findActiveByKeyHash.mockResolvedValue(null);

      await expect(service.validateApiKey('invalid-key')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw ApiKeyExpiredException for expired key', async () => {
      const expiredKey = {
        ...mockApiKey,
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
      };
      apiKeyRepository.findActiveByKeyHash.mockResolvedValue(expiredKey);

      await expect(service.validateApiKey('expired-key')).rejects.toThrow(
        ApiKeyExpiredException,
      );
      expect(apiKeyRepository.updateStatus).toHaveBeenCalledWith(
        expiredKey.id,
        ApiKeyStatus.EXPIRED,
      );
    });
  });

  describe('getApiKeyStatus', () => {
    it('should return API key status', async () => {
      apiKeyRepository.findById.mockResolvedValue(mockApiKey);

      const result = await service.getApiKeyStatus('test-key-id', 'test-merchant');

      expect(result).toBeDefined();
      expect(result.id).toBe(mockApiKey.id);
      expect(result.isExpired).toBe(false);
      expect(result.daysUntilExpiry).toBeGreaterThan(0);
    });

    it('should throw NotFoundException for non-existent key', async () => {
      apiKeyRepository.findById.mockResolvedValue(null);

      await expect(
        service.getApiKeyStatus('non-existent', 'test-merchant'),
      ).rejects.toThrow('API key not found');
    });

    it('should throw ForbiddenException for unauthorized access', async () => {
      apiKeyRepository.findById.mockResolvedValue(mockApiKey);

      await expect(
        service.getApiKeyStatus('test-key-id', 'different-merchant'),
      ).rejects.toThrow('You do not have access to this API key');
    });
  });

  describe('listApiKeys', () => {
    it('should list API keys for merchant', async () => {
      apiKeyRepository.findByMerchantId.mockResolvedValue({
        data: [mockApiKey],
        total: 1,
      });

      const result = await service.listApiKeys('test-merchant');

      expect(result).toBeDefined();
      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe('rotateApiKey', () => {
    it('should rotate an API key', async () => {
      apiKeyRepository.findById.mockResolvedValue(mockApiKey);
      apiKeyRepository.createApiKey.mockResolvedValue({
        ...mockApiKey,
        id: 'new-key-id',
        rotatedFromId: mockApiKey.id,
      });

      const result = await service.rotateApiKey('test-key-id', 'test-merchant');

      expect(result).toBeDefined();
      expect(result.oldKeyId).toBe(mockApiKey.id);
      expect(result.apiKey).toBeDefined();
      expect(apiKeyRepository.updateStatus).toHaveBeenCalledWith(
        mockApiKey.id,
        ApiKeyStatus.ROTATED,
      );
      expect(auditLogService.emitApiKeyEvent).toHaveBeenCalledWith(
        EventType.API_KEY_ROTATED,
        'test-merchant',
        expect.any(Object),
      );
    });

    it('should throw error for revoked key rotation', async () => {
      apiKeyRepository.findById.mockResolvedValue({
        ...mockApiKey,
        status: ApiKeyStatus.REVOKED,
      });

      await expect(
        service.rotateApiKey('test-key-id', 'test-merchant'),
      ).rejects.toThrow('Cannot rotate a revoked API key');
    });
  });

  describe('revokeApiKey', () => {
    it('should revoke an API key', async () => {
      apiKeyRepository.findById.mockResolvedValue(mockApiKey);

      await service.revokeApiKey('test-key-id', 'test-merchant', 'test-reason');

      expect(apiKeyRepository.updateStatus).toHaveBeenCalledWith(
        'test-key-id',
        ApiKeyStatus.REVOKED,
      );
      expect(auditLogService.emitApiKeyEvent).toHaveBeenCalledWith(
        EventType.API_KEY_REVOKED,
        'test-merchant',
        expect.objectContaining({ reason: 'test-reason' }),
      );
    });

    it('should throw error for already revoked key', async () => {
      apiKeyRepository.findById.mockResolvedValue({
        ...mockApiKey,
        status: ApiKeyStatus.REVOKED,
      });

      await expect(
        service.revokeApiKey('test-key-id', 'test-merchant'),
      ).rejects.toThrow('API key is already revoked');
    });
  });

  describe('processExpiredKeys', () => {
    it('should process and mark expired keys', async () => {
      const expiredKey = {
        ...mockApiKey,
        id: 'expired-key-id',
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      };
      apiKeyRepository.findExpiredKeys.mockResolvedValue([expiredKey]);

      const count = await service.processExpiredKeys();

      expect(count).toBe(1);
      expect(apiKeyRepository.updateStatus).toHaveBeenCalledWith(
        expiredKey.id,
        ApiKeyStatus.EXPIRED,
      );
      expect(auditLogService.emitApiKeyEvent).toHaveBeenCalled();
    });
  });

  describe('hashApiKey', () => {
    it('should consistently hash API keys', () => {
      const key = 'test-api-key';
      const hash1 = service.hashApiKey(key);
      const hash2 = service.hashApiKey(key);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA256 hex length
    });

    it('should produce different hashes for different keys', () => {
      const hash1 = service.hashApiKey('key1');
      const hash2 = service.hashApiKey('key2');

      expect(hash1).not.toBe(hash2);
    });
  });
});
