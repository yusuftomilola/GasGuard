import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Param, 
  Query, 
  HttpException,
  HttpStatus,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { 
  TransactionAnalysisRequest,
  TransactionAnalysisResponse,
  FailedTransaction,
  FailedTransactionEvent
} from '../schemas/failed-transaction.schema';
import { TransactionAnalysisService } from '../services/transaction-analysis.service';
import { Public, Roles, Role, JwtAuthGuard, RolesGuard } from '../auth';

@ApiTags('failed-transactions')
@ApiBearerAuth()
@Controller({ path: 'failed-transactions', version: '1' })
export class FailedTransactionController {
  private readonly logger = new Logger(FailedTransactionController.name);

  constructor(private readonly transactionAnalysisService: TransactionAnalysisService) {}

  @Post('analyze')
  @ApiOperation({ 
    summary: 'Analyze failed transactions for a wallet',
    description: 'Provides comprehensive analysis of failed transactions including cost metrics, failure categories, and mitigation recommendations'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Analysis completed successfully'
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Invalid request parameters' 
  })
  async analyzeWalletFailures(
    @Body() request: TransactionAnalysisRequest
  ): Promise<TransactionAnalysisResponse> {
    try {
      this.logger.log(`Analyzing failed transactions for wallet: ${request.wallet}`);
      
      if (!request.wallet || !request.wallet.match(/^0x[a-fA-F0-9]{40}$/)) {
        throw new HttpException('Invalid wallet address', HttpStatus.BAD_REQUEST);
      }

      return await this.transactionAnalysisService.analyzeWalletFailures(request);
    } catch (error) {
      this.logger.error(`Error analyzing wallet failures: ${error.message}`);
      throw new HttpException(
        `Failed to analyze wallet failures: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get(':wallet/summary')
  @ApiOperation({ 
    summary: 'Get wallet failure summary',
    description: 'Returns a quick summary of failed transaction metrics for a wallet'
  })
  @ApiParam({ 
    name: 'wallet', 
    description: 'Wallet address to analyze' 
  })
  @ApiQuery({ 
    name: 'chainIds', 
    required: false, 
    description: 'Comma-separated list of chain IDs to filter by',
    example: '1,137,42161'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Summary retrieved successfully' 
  })
  async getWalletSummary(
    @Param('wallet') wallet: string,
    @Query('chainIds') chainIds?: string
  ): Promise<any> {
    try {
      if (!wallet.match(/^0x[a-fA-F0-9]{40}$/)) {
        throw new HttpException('Invalid wallet address', HttpStatus.BAD_REQUEST);
      }

      const chainIdArray = chainIds 
        ? chainIds.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id))
        : undefined;

      return await this.transactionAnalysisService.getWalletSummary(wallet, chainIdArray);
    } catch (error) {
      this.logger.error(`Error getting wallet summary: ${error.message}`);
      throw new HttpException(
        `Failed to get wallet summary: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get(':wallet/mitigation')
  @ApiOperation({ 
    summary: 'Get immediate mitigation for recent failure',
    description: 'Provides immediate action steps to resolve the most recent failed transaction'
  })
  @ApiParam({ 
    name: 'wallet', 
    description: 'Wallet address' 
  })
  @ApiQuery({ 
    name: 'txHash', 
    required: false, 
    description: 'Specific transaction hash to get mitigation for' 
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Mitigation recommendations retrieved successfully' 
  })
  async getImmediateMitigation(
    @Param('wallet') wallet: string,
    @Query('txHash') txHash?: string
  ): Promise<any> {
    try {
      if (!wallet.match(/^0x[a-fA-F0-9]{40}$/)) {
        throw new HttpException('Invalid wallet address', HttpStatus.BAD_REQUEST);
      }

      return await this.transactionAnalysisService.getImmediateMitigation(wallet, txHash);
    } catch (error) {
      this.logger.error(`Error getting immediate mitigation: ${error.message}`);
      throw new HttpException(
        `Failed to get mitigation: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('track')
  @ApiOperation({ 
    summary: 'Track a failed transaction',
    description: 'Records a failed transaction for analysis and future recommendations'
  })
  @ApiResponse({ 
    status: 201, 
    description: 'Failed transaction tracked successfully' 
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Invalid transaction data' 
  })
  async trackFailedTransaction(
    @Body() transactionData: Partial<FailedTransaction>
  ): Promise<FailedTransaction> {
    try {
      // Validate required fields
      if (!transactionData.hash || !transactionData.wallet || !transactionData.chainId) {
        throw new HttpException(
          'Missing required fields: hash, wallet, chainId',
          HttpStatus.BAD_REQUEST
        );
      }

      if (!transactionData.wallet.match(/^0x[a-fA-F0-9]{40}$/)) {
        throw new HttpException('Invalid wallet address', HttpStatus.BAD_REQUEST);
      }

      if (!transactionData.hash.match(/^0x[a-fA-F0-9]{64}$/)) {
        throw new HttpException('Invalid transaction hash', HttpStatus.BAD_REQUEST);
      }

      this.logger.log(`Tracking failed transaction: ${transactionData.hash} for wallet: ${transactionData.wallet}`);
      
      return await this.transactionAnalysisService.processFailedTransaction(transactionData);
    } catch (error) {
      this.logger.error(`Error tracking failed transaction: ${error.message}`);
      throw new HttpException(
        `Failed to track transaction: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('chains/:chainId/stats')
  @ApiOperation({ 
    summary: 'Get chain-specific failure statistics',
    description: 'Returns failure statistics for a specific blockchain network' 
  })
  @ApiParam({ 
    name: 'chainId', 
    description: 'Blockchain network ID' 
  })
  @ApiQuery({ 
    name: 'timeframe', 
    required: false, 
    description: 'Timeframe for analysis (7d, 30d, 90d)',
    example: '30d'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Chain statistics retrieved successfully' 
  })
  async getChainStats(
    @Param('chainId') chainId: string,
    @Query('timeframe') timeframe?: string
  ): Promise<any> {
    try {
      const chainIdNum = parseInt(chainId);
      if (isNaN(chainIdNum)) {
        throw new HttpException('Invalid chain ID', HttpStatus.BAD_REQUEST);
      }

      // This would typically query a database for chain-wide statistics
      // For now, return a mock response
      return {
        chainId: chainIdNum,
        timeframe: timeframe || '30d',
        totalFailures: Math.floor(Math.random() * 1000),
        totalGasWasted: (Math.random() * 10).toFixed(4) + ' ETH',
        topFailureCategory: 'underpriced_gas',
        averageGasWastePerFailure: (Math.random() * 0.1).toFixed(6) + ' ETH',
        processedAt: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error(`Error getting chain stats: ${error.message}`);
      throw new HttpException(
        `Failed to get chain stats: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Public()
  @Get('health')
  @ApiOperation({ 
    summary: 'Health check endpoint',
    description: 'Returns the health status of the failed transaction analyzer service' 
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Service is healthy' 
  })
  async getHealth(): Promise<any> {
    return {
      status: 'healthy',
      service: 'failed-transaction-analyzer',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    };
  }
}
