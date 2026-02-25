import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { ContractEfficiencyDto } from './dto/contract-efficiency.dto';
import { ContractEfficiencyResult } from './interfaces/analytics.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';

@ApiTags('Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Post('contract-efficiency')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.USER, Role.ADMIN)
  @ApiOperation({
    summary: 'Analyze gas efficiency for a smart contract',
    description:
      'Fetches historical transaction receipts for the given contract, groups them by ' +
      'function signature, computes a deterministic Gas Efficiency Score for each function, ' +
      'and returns actionable optimization recommendations.',
  })
  @ApiResponse({
    status: 200,
    description: 'Gas efficiency analysis result.',
    schema: {
      example: {
        contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        analyzedTransactions: 187,
        fromBlock: 19000000,
        toBlock: 19010000,
        overallEfficiencyScore: 72,
        efficiencyLevel: 'Optimized',
        functions: [
          {
            functionName: 'transfer(address,uint256)',
            functionSelector: '0xa9059cbb',
            callCount: 152,
            averageGasUsed: 52000,
            minGasUsed: 49800,
            maxGasUsed: 55100,
            benchmarkGas: 52000,
            efficiencyScore: 88,
            efficiencyLevel: 'Highly Efficient',
          },
          {
            functionName: 'swap(uint256,uint256)',
            functionSelector: '0x022c0d9f',
            callCount: 35,
            averageGasUsed: 310000,
            minGasUsed: 180000,
            maxGasUsed: 420000,
            benchmarkGas: null,
            efficiencyScore: 45,
            efficiencyLevel: 'Inefficient',
            recommendation: 'Review storage writes and external calls. Consider using transient storage (EIP-1153) for intermediate values.',
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid input or no transactions found.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async analyzeContractEfficiency(
    @Body() dto: ContractEfficiencyDto,
  ): Promise<ContractEfficiencyResult> {
    return this.analyticsService.analyzeContractEfficiency(dto);
  }
}
