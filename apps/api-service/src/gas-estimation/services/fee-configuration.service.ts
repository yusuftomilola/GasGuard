import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import {
  FeeConfiguration,
  FeeUpdateRequest,
  FeeChangeEvent,
  FeeValidationResult,
  FeeConfigurationHistory,
  FeeAnalytics,
  AdminFeeSettings,
  ApprovalRequest,
} from "../interfaces/fee-config.interface";

/**
 * FeeConfigurationService
 * Manages configurable protocol fees with admin controls and audit trails
 */
@Injectable()
export class FeeConfigurationService {
  private readonly logger = new Logger(FeeConfigurationService.name);

  // In-memory storage (in production, this would be a database)
  private configurations: Map<string, FeeConfiguration> = new Map();
  private configurationHistory: FeeConfigurationHistory[] = [];
  private feeEvents: FeeChangeEvent[] = [];
  private pendingApprovals: Map<string, ApprovalRequest> = new Map();
  private adminSettings: AdminFeeSettings;

  constructor() {
    this.initializeDefaultConfiguration();
    this.initializeAdminSettings();
  }

  /**
   * Get current fee configuration
   */
  async getCurrentConfiguration(): Promise<FeeConfiguration> {
    const config = this.configurations.get("default");
    if (!config) {
      throw new NotFoundException("No fee configuration found");
    }
    return { ...config }; // Return copy to prevent mutation
  }

  /**
   * Get all fee configurations
   */
  async getAllConfigurations(): Promise<FeeConfiguration[]> {
    return Array.from(this.configurations.values()).map((config) => ({
      ...config,
    }));
  }

  /**
   * Update fee configuration (admin only)
   */
  async updateConfiguration(
    configId: string,
    updateRequest: FeeUpdateRequest,
    adminUserId: string,
  ): Promise<FeeConfiguration> {
    // Validate admin permissions
    if (!this.adminSettings.allowFeeUpdates) {
      throw new BadRequestException("Fee updates are currently disabled");
    }

    // Get current configuration
    const currentConfig = this.configurations.get(configId);
    if (!currentConfig) {
      throw new NotFoundException(`Fee configuration ${configId} not found`);
    }

    // Validate the update request
    const validation = this.validateFeeUpdate(currentConfig, updateRequest);
    if (!validation.isValid) {
      throw new BadRequestException(
        `Invalid fee update: ${validation.errors.join(", ")}`,
      );
    }

    // Check if approval is required for large changes
    if (this.adminSettings.requireApprovalForLargeChanges) {
      const requiresApproval = this.checkIfApprovalRequired(
        currentConfig,
        updateRequest,
      );
      if (requiresApproval) {
        this.logger.warn(
          `Large fee change requires approval: ${updateRequest.reason}`,
        );
        // In production, this would trigger approval workflow
        // For now, we'll allow it but log the warning
      }
    }

    // Create new configuration
    const newConfiguration: FeeConfiguration = {
      ...currentConfig,
      ...this.applyUpdateRequest(currentConfig, updateRequest),
      updatedAt: new Date(),
      version: currentConfig.version + 1,
    };

    // Detect changes
    const changes = this.detectChanges(currentConfig, newConfiguration);

    // Create change event
    const changeEvent: FeeChangeEvent = {
      id: this.generateId(),
      configurationId: configId,
      type: "FEE_UPDATED",
      timestamp: new Date(),
      oldConfiguration: { ...currentConfig },
      newConfiguration: { ...newConfiguration },
      changes,
      metadata: {
        updatedBy: adminUserId,
        reason: updateRequest.reason,
        effectiveDate: updateRequest.effectiveDate || new Date(),
        notifyUsers: updateRequest.notifyUsers ?? true,
        version: newConfiguration.version,
      },
    };

    // Store new configuration
    this.configurations.set(configId, newConfiguration);

    // Add to history
    this.configurationHistory.push({
      id: this.generateId(),
      configurationId: configId,
      version: newConfiguration.version,
      configuration: { ...newConfiguration },
      changeEvent,
      createdAt: new Date(),
      createdBy: adminUserId,
    });

    // Store event
    this.feeEvents.push(changeEvent);

    // Log the change (removed emit for now)
    this.logger.log(
      `Fee configuration updated by ${adminUserId}: ${updateRequest.reason}`,
    );

    // Send user notifications if requested
    if (updateRequest.notifyUsers) {
      await this.notifyUsersOfFeeChange(changeEvent);
    }

    return { ...newConfiguration };
  }

  /**
   * Create new fee configuration
   */
  async createConfiguration(
    configuration: Omit<
      FeeConfiguration,
      "id" | "createdAt" | "updatedAt" | "version"
    >,
    adminUserId: string,
  ): Promise<FeeConfiguration> {
    // Validate the configuration
    const validation = this.validateNewConfiguration(configuration);
    if (!validation.isValid) {
      throw new BadRequestException(
        `Invalid fee configuration: ${validation.errors.join(", ")}`,
      );
    }

    const newConfig: FeeConfiguration = {
      ...configuration,
      id: this.generateId(),
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
      createdBy: adminUserId,
    };

    // Store configuration
    this.configurations.set(newConfig.id, newConfig);

    // Create creation event
    const changeEvent: FeeChangeEvent = {
      id: this.generateId(),
      configurationId: newConfig.id,
      type: "FEE_CREATED",
      timestamp: new Date(),
      newConfiguration: { ...newConfig },
      changes: [],
      metadata: {
        updatedBy: adminUserId,
        reason: "Initial configuration creation",
        effectiveDate: new Date(),
        notifyUsers: false,
        version: 1,
      },
    };

    // Add to history
    this.configurationHistory.push({
      id: this.generateId(),
      configurationId: newConfig.id,
      version: 1,
      configuration: { ...newConfig },
      changeEvent,
      createdAt: new Date(),
      createdBy: adminUserId,
    });

    // Store event
    this.feeEvents.push(changeEvent);

    // Log the change (removed emit for now)
    this.logger.log(
      `Fee configuration created by ${adminUserId}: ${newConfig.name}`,
    );

    return { ...newConfig };
  }

  /**
   * Get fee configuration history
   */
  async getConfigurationHistory(
    configId?: string,
  ): Promise<FeeConfigurationHistory[]> {
    let history = this.configurationHistory;

    if (configId) {
      history = history.filter((h) => h.configurationId === configId);
    }

    return history.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  /**
   * Get fee change events
   */
  async getFeeEvents(
    configId?: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<FeeChangeEvent[]> {
    let events = this.feeEvents;

    if (configId) {
      events = events.filter((e) => e.configurationId === configId);
    }

    if (startDate) {
      events = events.filter((e) => e.timestamp >= startDate);
    }

    if (endDate) {
      events = events.filter((e) => e.timestamp <= endDate);
    }

    return events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Get fee analytics
   */
  async getFeeAnalytics(startDate: Date, endDate: Date): Promise<FeeAnalytics> {
    // This is a simplified implementation
    // In production, this would query actual usage data
    const totalRevenue = {
      daily: 1000 * 0.00001, // Example calculation
      weekly: 7000 * 0.00001,
      monthly: 30000 * 0.00001,
      yearly: 365000 * 0.00001,
    };

    const usageByTier = {
      starter: 1000,
      developer: 5000,
      professional: 15000,
      enterprise: 9000,
    };

    const currentConfig = await this.getCurrentConfiguration();
    const revenueByTier = {
      starter:
        usageByTier.starter *
        currentConfig.basePricePerRequest *
        currentConfig.tierMultipliers.starter,
      developer:
        usageByTier.developer *
        currentConfig.basePricePerRequest *
        currentConfig.tierMultipliers.developer,
      professional:
        usageByTier.professional *
        currentConfig.basePricePerRequest *
        currentConfig.tierMultipliers.professional,
      enterprise:
        usageByTier.enterprise *
        currentConfig.basePricePerRequest *
        currentConfig.tierMultipliers.enterprise,
    };

    return {
      totalRevenue,
      usageByTier,
      revenueByTier,
      trends: {
        revenueGrowth: 15.5, // Example percentage
        usageGrowth: 8.2,
        averageRevenuePerUser:
          Object.values(revenueByTier).reduce((a, b) => a + b, 0) /
          Object.values(usageByTier).reduce((a, b) => a + b, 0),
      },
      period: {
        startDate,
        endDate,
      },
    };
  }

  /**
   * Get admin settings
   */
  async getAdminSettings(): Promise<AdminFeeSettings> {
    return { ...this.adminSettings };
  }

  /**
   * Update admin settings
   */
  async updateAdminSettings(
    settings: Partial<AdminFeeSettings>,
    adminUserId: string,
  ): Promise<AdminFeeSettings> {
    this.adminSettings = {
      ...this.adminSettings,
      ...settings,
    };

    this.logger.log(`Admin settings updated by ${adminUserId}`);
    return { ...this.adminSettings };
  }

  /**
   * Validate fee update request
   */
  private validateFeeUpdate(
    currentConfig: FeeConfiguration,
    updateRequest: FeeUpdateRequest,
  ): FeeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate base price
    if (updateRequest.basePricePerRequest !== undefined) {
      if (updateRequest.basePricePerRequest < 0) {
        errors.push("Base price per request cannot be negative");
      }
      if (updateRequest.basePricePerRequest > 1) {
        warnings.push("Base price per request is very high (> 1 XLM)");
      }
    }

    // Validate tier multipliers
    if (updateRequest.tierMultipliers) {
      Object.entries(updateRequest.tierMultipliers).forEach(
        ([tier, multiplier]) => {
          if (multiplier < 0) {
            errors.push(`Tier multiplier for ${tier} cannot be negative`);
          }
          if (multiplier > 10) {
            warnings.push(`Tier multiplier for ${tier} is very high (> 10x)`);
          }
        },
      );
    }

    // Validate discount percentages
    if (updateRequest.discountPercentages) {
      Object.entries(updateRequest.discountPercentages).forEach(
        ([tier, discount]) => {
          if (discount < 0 || discount > 100) {
            errors.push(
              `Discount percentage for ${tier} must be between 0 and 100`,
            );
          }
        },
      );
    }

    // Calculate impact
    const newConfig = {
      ...currentConfig,
      ...this.applyUpdateRequest(currentConfig, updateRequest),
    };
    const impact = this.calculateImpact(currentConfig, newConfig);

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      impact,
    };
  }

  /**
   * Validate new configuration
   */
  private validateNewConfiguration(
    configuration: Omit<
      FeeConfiguration,
      "id" | "createdAt" | "updatedAt" | "version"
    >,
  ): FeeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!configuration.name || configuration.name.trim() === "") {
      errors.push("Configuration name is required");
    }

    if (configuration.basePricePerRequest < 0) {
      errors.push("Base price per request cannot be negative");
    }

    if (configuration.minimumFee < 0) {
      errors.push("Minimum fee cannot be negative");
    }

    if (configuration.maximumFee < 0) {
      errors.push("Maximum fee cannot be negative");
    }

    if (
      configuration.maximumFee > 0 &&
      configuration.minimumFee > configuration.maximumFee
    ) {
      errors.push("Minimum fee cannot be greater than maximum fee");
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      impact: {
        affectedUsers: 0,
        priceIncreasePercentage: 0,
        priceDecreasePercentage: 0,
      },
    };
  }

  /**
   * Apply update request to configuration
   */
  private applyUpdateRequest(
    currentConfig: FeeConfiguration,
    updateRequest: FeeUpdateRequest,
  ): Partial<FeeConfiguration> {
    const result: Partial<FeeConfiguration> = {};

    if (updateRequest.basePricePerRequest !== undefined) {
      result.basePricePerRequest = updateRequest.basePricePerRequest;
    }

    if (updateRequest.tierMultipliers) {
      result.tierMultipliers = {
        ...currentConfig.tierMultipliers,
        ...updateRequest.tierMultipliers,
      };
    }

    if (updateRequest.discountPercentages) {
      result.discountPercentages = {
        ...currentConfig.discountPercentages,
        ...updateRequest.discountPercentages,
      };
    }

    if (updateRequest.minimumFee !== undefined) {
      result.minimumFee = updateRequest.minimumFee;
    }

    if (updateRequest.maximumFee !== undefined) {
      result.maximumFee = updateRequest.maximumFee;
    }

    if (updateRequest.rateLimits) {
      result.rateLimits = {
        ...currentConfig.rateLimits,
        ...updateRequest.rateLimits,
      };
    }

    if (updateRequest.requestLimits) {
      result.requestLimits = {
        ...currentConfig.requestLimits,
        ...updateRequest.requestLimits,
      };
    }

    return result;
  }

  /**
   * Detect changes between configurations
   */
  private detectChanges(
    oldConfig: FeeConfiguration,
    newConfig: FeeConfiguration,
  ): any[] {
    const changes = [];

    // Check top-level fields
    if (oldConfig.basePricePerRequest !== newConfig.basePricePerRequest) {
      changes.push({
        field: "basePricePerRequest",
        oldValue: oldConfig.basePricePerRequest,
        newValue: newConfig.basePricePerRequest,
      });
    }

    // Check tier multipliers
    Object.keys(oldConfig.tierMultipliers).forEach((tier) => {
      const oldValue =
        oldConfig.tierMultipliers[
          tier as keyof typeof oldConfig.tierMultipliers
        ];
      const newValue =
        newConfig.tierMultipliers[
          tier as keyof typeof newConfig.tierMultipliers
        ];
      if (oldValue !== newValue) {
        changes.push({
          field: "tierMultiplier",
          tier,
          oldValue,
          newValue,
        });
      }
    });

    // Check discount percentages
    Object.keys(oldConfig.discountPercentages).forEach((tier) => {
      const oldValue =
        oldConfig.discountPercentages[
          tier as keyof typeof oldConfig.discountPercentages
        ];
      const newValue =
        newConfig.discountPercentages[
          tier as keyof typeof newConfig.discountPercentages
        ];
      if (oldValue !== newValue) {
        changes.push({
          field: "discountPercentage",
          tier,
          oldValue,
          newValue,
        });
      }
    });

    return changes;
  }

  /**
   * Calculate impact of fee changes
   */
  private calculateImpact(
    oldConfig: FeeConfiguration,
    newConfig: FeeConfiguration,
  ): FeeValidationResult["impact"] {
    // This is a simplified calculation
    // In production, this would use actual user data
    const oldAveragePrice = oldConfig.basePricePerRequest;
    const newAveragePrice = newConfig.basePricePerRequest;

    const priceIncreasePercentage =
      newAveragePrice > oldAveragePrice
        ? ((newAveragePrice - oldAveragePrice) / oldAveragePrice) * 100
        : 0;

    const priceDecreasePercentage =
      newAveragePrice < oldAveragePrice
        ? ((oldAveragePrice - newAveragePrice) / oldAveragePrice) * 100
        : 0;

    return {
      affectedUsers: 30000, // Example number
      priceIncreasePercentage,
      priceDecreasePercentage,
    };
  }

  /**
   * Check if approval is required for fee changes
   */
  private checkIfApprovalRequired(
    currentConfig: FeeConfiguration,
    updateRequest: FeeUpdateRequest,
  ): boolean {
    if (!this.adminSettings.requireApprovalForLargeChanges) {
      return false;
    }

    const threshold = this.adminSettings.largeChangeThreshold / 100;

    // Check base price change
    if (updateRequest.basePricePerRequest !== undefined) {
      const changePercentage = Math.abs(
        (updateRequest.basePricePerRequest -
          currentConfig.basePricePerRequest) /
          currentConfig.basePricePerRequest,
      );
      return changePercentage > threshold;
    }

    return false;
  }

  /**
   * Notify users of fee changes
   */
  private async notifyUsersOfFeeChange(
    changeEvent: FeeChangeEvent,
  ): Promise<void> {
    // In production, this would send actual notifications
    this.logger.log(
      `User notifications sent for fee change: ${changeEvent.id}`,
    );

    // Log notification (removed emit for now)
    this.logger.log(
      `User notifications sent for fee change: ${changeEvent.id}`,
    );
  }

  /**
   * Initialize default configuration
   */
  private initializeDefaultConfiguration(): void {
    const defaultConfig: FeeConfiguration = {
      id: "default",
      name: "Default GasGuard Pricing",
      description: "Default fee configuration for GasGuard services",
      basePricePerRequest: 0.00001,
      currency: "XLM",
      tierMultipliers: {
        starter: 1.0,
        developer: 0.8, // 20% discount
        professional: 0.6, // 40% discount
        enterprise: 0.4, // 60% discount
      },
      discountPercentages: {
        starter: 0,
        developer: 20,
        professional: 40,
        enterprise: 60,
      },
      minimumFee: 0.000001,
      maximumFee: 0, // Unlimited
      rateLimits: {
        starter: 10,
        developer: 30,
        professional: 100,
        enterprise: 1000,
      },
      requestLimits: {
        starter: 1000,
        developer: 10000,
        professional: 100000,
        enterprise: -1, // Unlimited
      },
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: "system",
      version: 1,
    };

    this.configurations.set("default", defaultConfig);
  }

  /**
   * Initialize admin settings
   */
  private initializeAdminSettings(): void {
    this.adminSettings = {
      allowFeeUpdates: true,
      requireApprovalForLargeChanges: true,
      largeChangeThreshold: 25, // 25% change requires approval
      approvalRequiredUsers: [],
      defaultGracePeriod: 7, // 7 days
      enableUserNotifications: true,
      notificationChannels: ["email", "in-app"],
      enableAuditLog: true,
      auditRetentionDays: 365,
      maxFeeChangesPerDay: 10,
      maxFeeChangesPerHour: 2,
    };
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
  }
}
