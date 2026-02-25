import {
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  IsEthereumAddress,
  Min,
  Max,
  ArrayMaxSize,
  IsUrl,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ContractEfficiencyDto {
  @ApiProperty({
    description: 'The contract address to analyze',
    example: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  })
  @IsString()
  @IsEthereumAddress()
  contractAddress: string;

  @ApiPropertyOptional({
    description: 'Starting block number for historical scan. Defaults to toBlock - 10000.',
    example: 19000000,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  fromBlock?: number;

  @ApiPropertyOptional({
    description: 'Ending block number for historical scan. Defaults to latest.',
    example: 19010000,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  toBlock?: number;

  @ApiPropertyOptional({
    description:
      'Explicit list of transaction hashes to analyze. When provided, block range is ignored.',
    example: ['0xabc123...', '0xdef456...'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(500)
  transactionHashes?: string[];

  @ApiPropertyOptional({
    description: 'Custom JSON-RPC URL. Falls back to configured default if omitted.',
    example: 'https://mainnet.infura.io/v3/YOUR_KEY',
  })
  @IsOptional()
  @IsUrl({ require_tld: false })
  rpcUrl?: string;

  @ApiPropertyOptional({
    description:
      'Contract ABI for resolving full function signatures. Without it, only 4-byte selectors in the benchmark table are resolved.',
    type: 'array',
    items: { type: 'object' },
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  abi?: object[];

  @ApiPropertyOptional({
    description: 'Maximum number of transactions to analyze. Defaults to 200.',
    example: 200,
    minimum: 1,
    maximum: 500,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @Max(500)
  limit?: number;
}
