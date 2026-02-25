import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog, ApiKey } from './entities';
import { AuditLogService, AuditLogRepository, AuditEventEmitter } from './services';
import { AuditController } from './controllers/audit.controller';
import { AuditInterceptor } from './interceptors';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog, ApiKey])],
  controllers: [AuditController],
  providers: [
    AuditLogService,
    AuditLogRepository,
    AuditEventEmitter,
    AuditInterceptor,
  ],
  exports: [AuditLogService, AuditEventEmitter, AuditInterceptor],
})
export class AuditModule {}
