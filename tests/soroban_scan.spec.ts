import { GasGuardEngine } from '../packages/rules/gasGuard/gasguard.engine'
import * as path from 'path';
import * as fs from 'fs';

describe('Soroban Full Scan Lifecycle', () => {
  const fixturesDir = path.join(
    __dirname,
    '../../../fixtures/soroban',
  );

  const expectedDir = path.join(fixturesDir, 'expected');

  let engine: GasGuardEngine;

  beforeAll(() => {
    engine = new GasGuardEngine();
  });

  it.each([
    'inefficient_storage.rs',
    'inefficient_loop.rs',
    'redundant_clone.rs',
  ])('scans %s and returns expected findings', async (file) => {
    const source = fs.readFileSync(
      path.join(fixturesDir, file),
      'utf8',
    );

    const expected = JSON.parse(
      fs.readFileSync(
        path.join(expectedDir, file.replace('.rs', '.json')),
        'utf8',
      ),
    );

    const result = await engine.scan({
      language: 'soroban',
      source,
    });

    expect(result.issues).toEqual(expected.issues);
  });

  describe('Soroban Health Check Functionality', () => {
    it('should recognize health check functions as safe monitoring utilities', async () => {
      const healthCheckContract = `
        use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

        #[contracttype]
        pub struct HealthStatus {
            pub contract_balance: u64,
            pub transaction_count: u32,
            pub has_anomalies: bool,
            pub contract_version: u32,
        }

        #[contracttype]
        pub struct OptimizedContract {
            pub owner: Address,
            pub balance: u64,
            pub transaction_count: u32,
            pub version: u32,
        }

        #[contractimpl]
        impl OptimizedContract {
            pub fn get_health_status(&self, env: Env) -> HealthStatus {
                let has_anomalies = self.balance == 0 || self.version == 0;

                HealthStatus {
                    contract_balance: self.balance,
                    transaction_count: self.transaction_count,
                    has_anomalies,
                    contract_version: self.version,
                }
            }

            pub fn check_invariants(&self) -> bool {
                self.balance >= 0 && self.version > 0
            }
        }
      `;

      const result = await engine.scan({
        language: 'soroban',
        source: healthCheckContract,
      });

      // Health check functions should not trigger security warnings
      const criticalIssues = result.issues.filter(issue => issue.severity === 'critical');
      const highIssues = result.issues.filter(issue => issue.severity === 'high');

      // Should have minimal security issues for health check functions
      expect(criticalIssues).toHaveLength(0);
      expect(highIssues).toHaveLength(0);
    });

    it('should validate health check function structure and safety', async () => {
      const safeHealthCheck = `
        use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

        #[contracttype]
        pub struct ContractMetrics {
            pub balance: u64,
            pub operations: u32,
            pub is_healthy: bool,
            pub timestamp: u64,
        }

        #[contractimpl]
        impl HealthCheckable {
            pub fn perform_health_check(&self, env: Env) -> ContractMetrics {
                let is_healthy = self.validate_state();
                let timestamp = env.ledger().timestamp();

                ContractMetrics {
                    balance: self.balance,
                    operations: self.operation_count,
                    is_healthy,
                    timestamp,
                }
            }

            pub fn validate_state(&self) -> bool {
                // Safe validation logic
                self.balance >= 0 && self.operation_count >= 0
            }
        }
      `;

      const result = await engine.scan({
        language: 'soroban',
        source: safeHealthCheck,
      });

      // Should not have security issues for proper health check implementation
      const securityIssues = result.issues.filter(
        issue => ['critical', 'high'].includes(issue.severity)
      );
      expect(securityIssues).toHaveLength(0);
    });
  });
});
