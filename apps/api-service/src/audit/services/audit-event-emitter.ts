import { Injectable } from '@nestjs/common';
import { AuditLog, EventType, OutcomeStatus } from '../entities';

interface AuditEventListener {
  (payload: AuditEventPayload): void;
}

export interface AuditEventPayload {
  eventType: EventType;
  user?: string;
  apiKey?: string;
  chainId?: number;
  details: Record<string, any>;
  outcome: OutcomeStatus;
  endpoint?: string;
  httpMethod?: string;
  responseStatus?: number;
  ipAddress?: string;
  errorMessage?: string;
  responseDuration?: number;
}

@Injectable()
export class AuditEventEmitter {
  private listeners: AuditEventListener[] = [];

  emitAuditEvent(payload: AuditEventPayload): void {
    this.listeners.forEach(listener => listener(payload));
  }

  onAuditEvent(callback: AuditEventListener): void {
    this.listeners.push(callback);
  }

  emitApiKeyEvent(
    eventType: EventType.API_KEY_CREATED | EventType.API_KEY_ROTATED | EventType.API_KEY_REVOKED,
    merchantId: string,
    details: Record<string, any>,
  ): void {
    this.emitAuditEvent({
      eventType,
      user: merchantId,
      details,
      outcome: OutcomeStatus.SUCCESS,
    });
  }

  emitGasTransactionEvent(
    merchantId: string,
    chainId: number,
    transactionHash: string,
    gasUsed: number,
    gasPrice: string,
    senderAddress: string,
    details?: Record<string, any>,
  ): void {
    this.emitAuditEvent({
      eventType: EventType.GAS_TRANSACTION,
      user: merchantId,
      chainId,
      details: {
        transactionHash,
        gasUsed,
        gasPrice,
        senderAddress,
        ...details,
      },
      outcome: OutcomeStatus.SUCCESS,
    });
  }

  emitApiRequestEvent(
    apiKey: string,
    endpoint: string,
    httpMethod: string,
    responseStatus: number,
    ipAddress?: string,
    responseDuration?: number,
    errorMessage?: string,
  ): void {
    this.emitAuditEvent({
      eventType: EventType.API_REQUEST,
      apiKey,
      endpoint,
      httpMethod,
      responseStatus,
      ipAddress,
      responseDuration,
      errorMessage,
      outcome: responseStatus >= 400 ? OutcomeStatus.FAILURE : OutcomeStatus.SUCCESS,
      details: {},
    });
  }
}
