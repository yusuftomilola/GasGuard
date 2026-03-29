import { GasGuardEngine } from '../packages/rules/gasGuard/gasguard.engine';
import * as fs from 'fs';
import * as path from 'path';

describe('Solidity Reentrancy Guard Analysis', () => {
  let engine: GasGuardEngine;

  beforeAll(() => {
    engine = new GasGuardEngine();
  });

  describe('Reentrancy Guard Detection', () => {
    it('should detect missing reentrancy guard in vulnerable contract', async () => {
      const source = fs.readFileSync(
        path.join(__dirname, '../../examples/vulnerable_bank.sol'),
        'utf8'
      );

      const result = await engine.scan({
        language: 'solidity',
        source,
      });

      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'sol-006',
            severity: 'critical',
            message: 'Function transfers ETH/tokens but lacks reentrancy guard'
          })
        ])
      );
    });

    it('should not flag secure contract with reentrancy guard', async () => {
      const source = fs.readFileSync(
        path.join(__dirname, '../../examples/secure_bank.sol'),
        'utf8'
      );

      const result = await engine.scan({
        language: 'solidity',
        source,
      });

      // Should not have sol-006 issues
      const reentrancyIssues = result.issues.filter(issue => issue.ruleId === 'sol-006');
      expect(reentrancyIssues).toHaveLength(0);
    });

    it('should detect multiple vulnerable functions in complex contract', async () => {
      const source = fs.readFileSync(
        path.join(__dirname, '../../examples/reentrancy_examples.sol'),
        'utf8'
      );

      const result = await engine.scan({
        language: 'solidity',
        source,
      });

      const reentrancyIssues = result.issues.filter(issue => issue.ruleId === 'sol-006');
      // Should detect 3 vulnerable functions: vulnerableWithdraw, vulnerableSend, vulnerableCall
      expect(reentrancyIssues).toHaveLength(3);
    });
  });

  describe('Reentrancy Attack Simulation', () => {
    it('should identify functions vulnerable to reentrancy attacks', async () => {
      const vulnerableContract = `
        contract Vulnerable {
            mapping(address => uint256) balances;

            function withdraw() external {
                uint256 amount = balances[msg.sender];
                require(amount > 0);

                // VULNERABLE: External call before state update
                (bool success,) = msg.sender.call{value: amount}("");
                require(success, "Transfer failed");

                balances[msg.sender] = 0; // State update after external call
            }

            function deposit() external payable {
                balances[msg.sender] += msg.value;
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: vulnerableContract,
      });

      expect(result.issues).toContainEqual(
        expect.objectContaining({
          ruleId: 'sol-006',
          severity: 'critical',
          message: 'Function transfers ETH/tokens but lacks reentrancy guard'
        })
      );
    });

    it('should not flag functions that do not transfer ETH/tokens', async () => {
      const safeContract = `
        contract Safe {
            mapping(address => uint256) balances;

            function updateBalance(uint256 newBalance) external {
                balances[msg.sender] = newBalance;
            }

            function getBalance() external view returns (uint256) {
                return balances[msg.sender];
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: safeContract,
      });

      const reentrancyIssues = result.issues.filter(issue => issue.ruleId === 'sol-006');
      expect(reentrancyIssues).toHaveLength(0);
    });
  });

  describe('Fallback Function Security', () => {
    it('should detect insecure fallback with sensitive external transfer logic', async () => {
      const insecureFallbackContract = `
        contract InsecureFallback {
            address payable public treasury;

            constructor(address payable _treasury) {
                treasury = _treasury;
            }

            fallback() external payable {
                (bool ok,) = treasury.call{value: msg.value}("");
                require(ok, "Forward failed");
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: insecureFallbackContract,
      });

      expect(result.issues).toContainEqual(
        expect.objectContaining({
          ruleId: 'sol-007',
          severity: 'high',
          message: 'Fallback/receive handler is permissive or executes sensitive logic without strict validation',
        })
      );
    });

    it('should detect permissive fallback that accepts unknown calls without explicit rejection', async () => {
      const permissiveFallbackContract = `
        contract PermissiveFallback {
            event UnknownCall(address caller, uint256 value, bytes data);

            fallback() external payable {
                uint256 x = msg.value;
                if (x > 0) {
                    emit UnknownCall(msg.sender, x, msg.data);
                }
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: permissiveFallbackContract,
      });

      const fallbackIssues = result.issues.filter(issue => issue.ruleId === 'sol-007');
      expect(fallbackIssues.length).toBeGreaterThan(0);
    });

    it('should not flag strict fallback that always rejects unknown calls', async () => {
      const strictFallbackContract = `
        contract StrictFallback {
            fallback() external payable {
                revert("Unknown function call");
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: strictFallbackContract,
      });

      const fallbackIssues = result.issues.filter(issue => issue.ruleId === 'sol-007');
      expect(fallbackIssues).toHaveLength(0);
    });

    it('should not flag minimal receive handler that only emits telemetry event', async () => {
      const safeReceiveContract = `
        contract SafeReceive {
            event Received(address indexed sender, uint256 amount);

            receive() external payable {
                emit Received(msg.sender, msg.value);
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: safeReceiveContract,
      });

      const fallbackIssues = result.issues.filter(issue => issue.ruleId === 'sol-007');
      expect(fallbackIssues).toHaveLength(0);
    });
  });

  describe('Timelock Security For Sensitive Operations', () => {
    it('should detect immediate sensitive actions without timelock scheduling', async () => {
      const vulnerableContract = `
        contract VulnerableTreasury {
            address public owner;
            uint256 public treasury;

            constructor() {
                owner = msg.sender;
            }

            function withdrawFunds(address payable recipient, uint256 amount) external {
                require(msg.sender == owner, "Not owner");
                treasury -= amount;
                recipient.transfer(amount);
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: vulnerableContract,
      });

      expect(result.issues).toContainEqual(
        expect.objectContaining({
          ruleId: 'sol-009',
          severity: 'high',
          message: expect.stringContaining('lacks enforced timelock'),
        })
      );
    });

    it('should detect execute paths without delay enforcement', async () => {
      const vulnerableContract = `
        contract MissingDelay {
            address public owner;
            mapping(bytes32 => bool) public queued;

            function scheduleOperation(bytes32 opId) external {
                require(msg.sender == owner, "Not owner");
                queued[opId] = true;
            }

            function executeOperation(bytes32 opId) external {
                require(msg.sender == owner, "Not owner");
                require(queued[opId], "Not queued");
                // Missing block.timestamp delay check
                queued[opId] = false;
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: vulnerableContract,
      });

      expect(result.issues).toContainEqual(
        expect.objectContaining({
          ruleId: 'sol-009',
          message: expect.stringContaining('does not enforce timelock delay'),
        })
      );
    });

    it('should detect missing authorization on timelock operations', async () => {
      const vulnerableContract = `
        contract MissingAuth {
            mapping(bytes32 => uint256) public queuedAt;

            function schedule(bytes32 opId) external {
                queuedAt[opId] = block.timestamp + 1 days;
            }

            function execute(bytes32 opId) external {
                require(block.timestamp >= queuedAt[opId], "Timelock not expired");
                delete queuedAt[opId];
            }

            function cancel(bytes32 opId) external {
                delete queuedAt[opId];
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: vulnerableContract,
      });

      const authIssues = result.issues.filter(
        issue => issue.ruleId === 'sol-009' && issue.message.includes('lacks authorization')
      );
      expect(authIssues.length).toBeGreaterThan(0);
    });

    it('should detect timelock flows missing cancellation capability', async () => {
      const vulnerableContract = `
        contract MissingCancel {
            address public owner;
            mapping(bytes32 => uint256) public queuedAt;

            function schedule(bytes32 opId) external {
                require(msg.sender == owner, "Not owner");
                queuedAt[opId] = block.timestamp + 1 days;
            }

            function execute(bytes32 opId) external {
                require(msg.sender == owner, "Not owner");
                require(block.timestamp >= queuedAt[opId], "Timelock not expired");
                delete queuedAt[opId];
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: vulnerableContract,
      });

      expect(result.issues).toContainEqual(
        expect.objectContaining({
          ruleId: 'sol-009',
          message: expect.stringContaining('missing cancellation capability'),
        })
      );
    });

    it('should not flag properly timelocked and authorized sensitive operations', async () => {
      const secureContract = `
        contract SecureTimelock {
            address public owner;
            uint256 public constant TIMELOCK_DELAY = 1 days;

            struct QueuedOperation {
                uint256 executeAfter;
                bool exists;
            }

            mapping(bytes32 => QueuedOperation) public queuedOperations;

            event OperationScheduled(bytes32 indexed opId, uint256 executeAfter);
            event OperationExecuted(bytes32 indexed opId);
            event OperationCancelled(bytes32 indexed opId);

            constructor() {
                owner = msg.sender;
            }

            function scheduleWithdraw(bytes32 opId) external {
                require(msg.sender == owner, "Not owner");
                queuedOperations[opId] = QueuedOperation({
                    executeAfter: block.timestamp + TIMELOCK_DELAY,
                    exists: true
                });
                emit OperationScheduled(opId, queuedOperations[opId].executeAfter);
            }

            function executeWithdraw(bytes32 opId) external {
                require(msg.sender == owner, "Not owner");
                require(queuedOperations[opId].exists, "Not queued");
                require(block.timestamp >= queuedOperations[opId].executeAfter, "Timelock not expired");
                delete queuedOperations[opId];
                emit OperationExecuted(opId);
            }

            function cancelOperation(bytes32 opId) external {
                require(msg.sender == owner, "Not owner");
                require(queuedOperations[opId].exists, "Not queued");
                delete queuedOperations[opId];
                emit OperationCancelled(opId);
            }
        }
      `;

      const result = await engine.scan({
        language: 'solidity',
        source: secureContract,
      });

      const timelockIssues = result.issues.filter(issue => issue.ruleId === 'sol-009');
      expect(timelockIssues).toHaveLength(0);
    });
  });
});