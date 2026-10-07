// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

/// @title AgentFirewallV2
/// @notice V2 adds per-selector argument caps (setArgCap): a static uint256 argument of an
///         allowed function can be bounded, e.g. the amount of deposit(uint256,uint256).
///         Everything else, including the AgentAction event and executionId, is identical to V1.
/// @notice Onchain execution boundary for an Agent Registry identity.
/// @dev The registry is the source of truth for agent existence, owner, and active status.
///      There is no administrator and the contract is not upgradeable.
///      Calls to approved targets use a normal external call. The firewall does not run
///      target code against its own storage.
interface IAgentRegistry {
    struct Agent {
        uint256 agentId;
        address owner;
        string name;
        string description;
        string metadataURI;
        uint256 capabilities;
        uint64 registeredAt;
        bool active;
    }

    function getAgent(uint256 agentId) external view returns (Agent memory);
}

contract AgentFirewallV2 {
    struct Firewall {
        uint256 firewallId;
        uint256 agentId;
        address owner;
        address executor;
        bool active;
        bool paused;
        uint64 createdAt;
        uint256 executionNonce;
    }

    struct Policy {
        bool allowValueTransfer;
        uint256 maxValuePerTransaction;
        uint256 maxValuePerPeriod;
        uint256 spentInPeriod;
        uint64 periodStart;
        uint64 periodDuration;
    }

    struct TargetInfo {
        string name;
        bool active;
        bool exists;
    }

    IAgentRegistry public immutable agentRegistry;

    uint256 public nextFirewallId = 1;

    mapping(uint256 => Firewall) private _firewalls;
    mapping(uint256 => Policy) private _policies;
    mapping(uint256 => uint256[]) private _byAgent;
    mapping(uint256 => mapping(address => TargetInfo)) private _targets;
    mapping(uint256 => mapping(address => mapping(bytes4 => bool))) private _functions;

    struct ArgCap {
        bool enabled;
        uint8 argIndex;
        uint256 maxValue;
    }

    mapping(uint256 => mapping(address => mapping(bytes4 => ArgCap))) private _argCaps;

    error FirewallNotFound(uint256 firewallId);
    error FirewallInactive(uint256 firewallId);
    error FirewallIsPaused(uint256 firewallId);
    error FirewallNotPaused(uint256 firewallId);
    error AgentNotFound(uint256 agentId);
    error AgentInactive(uint256 agentId);
    error UnauthorizedExecutor(uint256 firewallId, address caller);
    error UnauthorizedOwner(uint256 id, address caller);
    error TargetNotAllowed(uint256 firewallId, address target);
    error TargetInactive(uint256 firewallId, address target);
    error FunctionNotAllowed(uint256 firewallId, address target, bytes4 selector);
    error InvalidCalldata();
    error InvalidExecutor();
    error InvalidTarget();
    error ValueTransferDisabled(uint256 firewallId);
    error TransactionValueTooHigh(uint256 firewallId, uint256 value);
    error SpendingLimitExceeded(uint256 firewallId, uint256 value);
    error InvalidPeriod();
    error InvalidPolicy();
    error ArgumentTooHigh(uint256 firewallId, bytes4 selector, uint8 argIndex, uint256 value, uint256 maxValue);
    error ArgumentMissing(uint256 firewallId, bytes4 selector, uint8 argIndex);
    error ArgCapNotSet(uint256 firewallId, address target, bytes4 selector);
    error AttachedValueMismatch(uint256 attached, uint256 declared);

    event FirewallCreated(
        uint256 indexed firewallId,
        uint256 indexed agentId,
        address indexed owner,
        address executor,
        bool allowValueTransfer,
        uint256 maxValuePerTransaction,
        uint256 maxValuePerPeriod,
        uint64 periodDuration,
        uint64 timestamp
    );

    event ExecutorUpdated(
        uint256 indexed firewallId,
        uint256 indexed agentId,
        address executor,
        uint64 timestamp
    );

    event TargetAllowed(
        uint256 indexed firewallId,
        uint256 indexed agentId,
        address target,
        string name,
        uint64 timestamp
    );

    event TargetDisabled(uint256 indexed firewallId, uint256 indexed agentId, address target, uint64 timestamp);

    event FunctionAllowed(
        uint256 indexed firewallId,
        uint256 indexed agentId,
        address target,
        bytes4 selector,
        uint64 timestamp
    );

    event FunctionDisabled(
        uint256 indexed firewallId,
        uint256 indexed agentId,
        address target,
        bytes4 selector,
        uint64 timestamp
    );

    event AgentAction(
        uint256 indexed agentId,
        uint256 indexed firewallId,
        address indexed executor,
        address target,
        bytes4 functionSelector,
        uint256 value,
        uint256 executionNonce,
        bytes32 executionId,
        bytes32 calldataHash,
        uint64 timestamp
    );

    event ArgCapSet(
        uint256 indexed firewallId,
        uint256 indexed agentId,
        address target,
        bytes4 selector,
        uint8 argIndex,
        uint256 maxValue,
        uint64 timestamp
    );

    event ArgCapCleared(uint256 indexed firewallId, uint256 indexed agentId, address target, bytes4 selector, uint64 timestamp);

    event FirewallPaused(uint256 indexed firewallId, uint256 indexed agentId, uint64 timestamp);
    event FirewallUnpaused(uint256 indexed firewallId, uint256 indexed agentId, uint64 timestamp);
    event FirewallDeactivated(uint256 indexed firewallId, uint256 indexed agentId, uint64 timestamp);

    event PolicyUpdated(
        uint256 indexed firewallId,
        uint256 indexed agentId,
        bool allowValueTransfer,
        uint256 maxValuePerTransaction,
        uint256 maxValuePerPeriod,
        uint64 periodDuration,
        uint64 timestamp
    );

    event FirewallOwnerSynced(
        uint256 indexed firewallId,
        uint256 indexed agentId,
        address owner,
        uint64 timestamp
    );

    constructor(IAgentRegistry registry_) {
        if (address(registry_) == address(0)) revert InvalidTarget();
        agentRegistry = registry_;
    }

    function createFirewall(
        uint256 agentId,
        address executor,
        bool allowValueTransfer,
        uint256 maxValuePerTransaction,
        uint256 maxValuePerPeriod,
        uint64 periodDuration
    ) external returns (uint256 firewallId) {
        if (executor == address(0)) revert InvalidExecutor();
        _validatePolicy(allowValueTransfer, maxValuePerTransaction, maxValuePerPeriod, periodDuration);

        IAgentRegistry.Agent memory agent = agentRegistry.getAgent(agentId);
        if (agent.owner == address(0)) revert AgentNotFound(agentId);
        if (!agent.active) revert AgentInactive(agentId);
        if (agent.owner != msg.sender) revert UnauthorizedOwner(agentId, msg.sender);

        firewallId = nextFirewallId;
        nextFirewallId = firewallId + 1;
        uint64 nowTs = uint64(block.timestamp);

        Firewall storage fw = _firewalls[firewallId];
        fw.firewallId = firewallId;
        fw.agentId = agentId;
        fw.owner = agent.owner;
        fw.executor = executor;
        fw.active = true;
        fw.paused = false;
        fw.createdAt = nowTs;
        fw.executionNonce = 0;

        Policy storage policy = _policies[firewallId];
        policy.allowValueTransfer = allowValueTransfer;
        policy.maxValuePerTransaction = maxValuePerTransaction;
        policy.maxValuePerPeriod = maxValuePerPeriod;
        policy.spentInPeriod = 0;
        policy.periodStart = nowTs;
        policy.periodDuration = periodDuration;

        _byAgent[agentId].push(firewallId);

        emit FirewallCreated(
            firewallId,
            agentId,
            agent.owner,
            executor,
            allowValueTransfer,
            maxValuePerTransaction,
            maxValuePerPeriod,
            periodDuration,
            nowTs
        );
    }

    function setExecutor(uint256 firewallId, address newExecutor) external {
        Firewall storage fw = _owned(firewallId);
        if (newExecutor == address(0)) revert InvalidExecutor();
        fw.executor = newExecutor;
        emit ExecutorUpdated(firewallId, fw.agentId, newExecutor, uint64(block.timestamp));
    }

    function updatePolicy(
        uint256 firewallId,
        bool allowValueTransfer,
        uint256 maxValuePerTransaction,
        uint256 maxValuePerPeriod,
        uint64 periodDuration
    ) external {
        Firewall storage fw = _owned(firewallId);
        _validatePolicy(allowValueTransfer, maxValuePerTransaction, maxValuePerPeriod, periodDuration);
        uint64 nowTs = uint64(block.timestamp);
        Policy storage policy = _policies[firewallId];
        policy.allowValueTransfer = allowValueTransfer;
        policy.maxValuePerTransaction = maxValuePerTransaction;
        policy.maxValuePerPeriod = maxValuePerPeriod;
        policy.periodDuration = periodDuration;
        policy.spentInPeriod = 0;
        policy.periodStart = nowTs;
        emit PolicyUpdated(
            firewallId,
            fw.agentId,
            allowValueTransfer,
            maxValuePerTransaction,
            maxValuePerPeriod,
            periodDuration,
            nowTs
        );
    }

    function allowTarget(uint256 firewallId, address target, string calldata name) external {
        Firewall storage fw = _owned(firewallId);
        if (target == address(0) || bytes(name).length > 64) revert InvalidTarget();
        TargetInfo storage info = _targets[firewallId][target];
        info.name = name;
        info.active = true;
        info.exists = true;
        emit TargetAllowed(firewallId, fw.agentId, target, name, uint64(block.timestamp));
    }

    function disableTarget(uint256 firewallId, address target) external {
        Firewall storage fw = _owned(firewallId);
        if (target == address(0)) revert InvalidTarget();
        TargetInfo storage info = _targets[firewallId][target];
        if (!info.exists) revert TargetNotAllowed(firewallId, target);
        if (!info.active) revert TargetInactive(firewallId, target);
        info.active = false;
        emit TargetDisabled(firewallId, fw.agentId, target, uint64(block.timestamp));
    }

    function allowFunction(uint256 firewallId, address target, bytes4 selector) external {
        Firewall storage fw = _owned(firewallId);
        if (target == address(0)) revert InvalidTarget();
        TargetInfo storage info = _targets[firewallId][target];
        if (!info.exists) revert TargetNotAllowed(firewallId, target);
        if (!info.active) revert TargetInactive(firewallId, target);
        if (_functions[firewallId][target][selector]) return;
        _functions[firewallId][target][selector] = true;
        emit FunctionAllowed(firewallId, fw.agentId, target, selector, uint64(block.timestamp));
    }

    function disableFunction(uint256 firewallId, address target, bytes4 selector) external {
        Firewall storage fw = _owned(firewallId);
        if (!_functions[firewallId][target][selector]) revert FunctionNotAllowed(firewallId, target, selector);
        _functions[firewallId][target][selector] = false;
        emit FunctionDisabled(firewallId, fw.agentId, target, selector, uint64(block.timestamp));
    }

    /// @notice Cap one static uint256 argument (0-based index after the selector) of an allowed function.
    ///         execute reverts with ArgumentTooHigh when the word at that index is above maxValue.
    ///         One cap per (target, selector); setting again replaces it.
    function setArgCap(uint256 firewallId, address target, bytes4 selector, uint8 argIndex, uint256 maxValue) external {
        Firewall storage fw = _owned(firewallId);
        if (!_functions[firewallId][target][selector]) revert FunctionNotAllowed(firewallId, target, selector);
        _argCaps[firewallId][target][selector] = ArgCap({enabled: true, argIndex: argIndex, maxValue: maxValue});
        emit ArgCapSet(firewallId, fw.agentId, target, selector, argIndex, maxValue, uint64(block.timestamp));
    }

    function clearArgCap(uint256 firewallId, address target, bytes4 selector) external {
        Firewall storage fw = _owned(firewallId);
        if (!_argCaps[firewallId][target][selector].enabled) revert ArgCapNotSet(firewallId, target, selector);
        delete _argCaps[firewallId][target][selector];
        emit ArgCapCleared(firewallId, fw.agentId, target, selector, uint64(block.timestamp));
    }

    function getArgCap(uint256 firewallId, address target, bytes4 selector) external view returns (ArgCap memory) {
        return _argCaps[firewallId][target][selector];
    }

    function pauseFirewall(uint256 firewallId) external {
        Firewall storage fw = _owned(firewallId);
        if (fw.paused) revert FirewallIsPaused(firewallId);
        fw.paused = true;
        emit FirewallPaused(firewallId, fw.agentId, uint64(block.timestamp));
    }

    function unpauseFirewall(uint256 firewallId) external {
        Firewall storage fw = _owned(firewallId);
        if (!fw.paused) revert FirewallNotPaused(firewallId);
        fw.paused = false;
        emit FirewallUnpaused(firewallId, fw.agentId, uint64(block.timestamp));
    }

    function deactivateFirewall(uint256 firewallId) external {
        Firewall storage fw = _owned(firewallId);
        fw.active = false;
        emit FirewallDeactivated(firewallId, fw.agentId, uint64(block.timestamp));
    }

    /// @notice Execute one approved call. Only the configured executor may call this.
    ///         A zero value is not a transfer. A positive value is rejected until the owner enables it.
    ///         A reverting target rolls the whole transaction back, including nonce and spend.
    function execute(uint256 firewallId, address target, uint256 value, bytes calldata data) external payable {
        Firewall storage fw = _firewalls[firewallId];
        if (fw.firewallId == 0) revert FirewallNotFound(firewallId);
        if (!fw.active) revert FirewallInactive(firewallId);
        if (fw.paused) revert FirewallIsPaused(firewallId);

        IAgentRegistry.Agent memory agent = agentRegistry.getAgent(fw.agentId);
        if (agent.owner == address(0)) revert AgentNotFound(fw.agentId);
        if (!agent.active) revert AgentInactive(fw.agentId);
        if (msg.sender != fw.executor) revert UnauthorizedExecutor(firewallId, msg.sender);

        TargetInfo storage info = _targets[firewallId][target];
        if (!info.exists) revert TargetNotAllowed(firewallId, target);
        if (!info.active) revert TargetInactive(firewallId, target);
        if (data.length < 4) revert InvalidCalldata();

        bytes4 selector = bytes4(data[:4]);
        if (!_functions[firewallId][target][selector]) revert FunctionNotAllowed(firewallId, target, selector);
        ArgCap storage cap = _argCaps[firewallId][target][selector];
        if (cap.enabled) {
            uint256 offset = 4 + uint256(cap.argIndex) * 32;
            if (data.length < offset + 32) revert ArgumentMissing(firewallId, selector, cap.argIndex);
            uint256 argValue = uint256(bytes32(data[offset:offset + 32]));
            if (argValue > cap.maxValue) revert ArgumentTooHigh(firewallId, selector, cap.argIndex, argValue, cap.maxValue);
        }
        if (msg.value != value) revert AttachedValueMismatch(msg.value, value);

        if (value > 0) {
            Policy storage policy = _policies[firewallId];
            if (!policy.allowValueTransfer) revert ValueTransferDisabled(firewallId);
            if (value > policy.maxValuePerTransaction) revert TransactionValueTooHigh(firewallId, value);
            uint256 start = uint256(policy.periodStart);
            uint256 duration = uint256(policy.periodDuration);
            if (block.timestamp >= start + duration) {
                policy.spentInPeriod = 0;
                policy.periodStart = uint64(block.timestamp);
            }
            uint256 nextSpent = policy.spentInPeriod + value;
            if (nextSpent > policy.maxValuePerPeriod) revert SpendingLimitExceeded(firewallId, value);
            policy.spentInPeriod = nextSpent;
        }

        uint256 nonce = fw.executionNonce;
        bytes32 executionId = keccak256(abi.encode(firewallId, fw.agentId, fw.executor, nonce, target, selector));
        fw.executionNonce = nonce + 1;

        (bool ok, bytes memory ret) = target.call{value: value}(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(ret, 0x20), mload(ret))
            }
        }

        emit AgentAction(
            fw.agentId,
            firewallId,
            fw.executor,
            target,
            selector,
            value,
            nonce,
            executionId,
            keccak256(data),
            uint64(block.timestamp)
        );
    }

    function getFirewall(uint256 firewallId) external view returns (Firewall memory fw) {
        fw = _load(firewallId);
        fw.owner = agentRegistry.getAgent(fw.agentId).owner;
    }

    function getPolicy(uint256 firewallId) external view returns (Policy memory) {
        _load(firewallId);
        return _policies[firewallId];
    }

    function getFirewallCount() external view returns (uint256) {
        return nextFirewallId - 1;
    }

    function getFirewallsByAgent(uint256 agentId) external view returns (uint256[] memory) {
        return _byAgent[agentId];
    }

    function isTargetActive(uint256 firewallId, address target) external view returns (bool) {
        TargetInfo storage info = _targets[firewallId][target];
        return info.exists && info.active;
    }

    function isFunctionAllowed(uint256 firewallId, address target, bytes4 selector) external view returns (bool) {
        return _functions[firewallId][target][selector];
    }

    function _load(uint256 firewallId) private view returns (Firewall memory fw) {
        fw = _firewalls[firewallId];
        if (fw.firewallId == 0) revert FirewallNotFound(firewallId);
    }

    function _owned(uint256 firewallId) private returns (Firewall storage fw) {
        fw = _firewalls[firewallId];
        if (fw.firewallId == 0) revert FirewallNotFound(firewallId);
        if (!fw.active) revert FirewallInactive(firewallId);
        IAgentRegistry.Agent memory agent = agentRegistry.getAgent(fw.agentId);
        if (agent.owner == address(0)) revert AgentNotFound(fw.agentId);
        if (agent.owner != msg.sender) revert UnauthorizedOwner(firewallId, msg.sender);
        if (fw.owner != agent.owner) {
            fw.owner = agent.owner;
            emit FirewallOwnerSynced(firewallId, fw.agentId, agent.owner, uint64(block.timestamp));
        }
    }

    function _validatePolicy(
        bool allowValueTransfer,
        uint256 maxValuePerTransaction,
        uint256 maxValuePerPeriod,
        uint64 periodDuration
    ) private pure {
        if (periodDuration == 0) revert InvalidPeriod();
        if (!allowValueTransfer) {
            if (maxValuePerTransaction != 0 || maxValuePerPeriod != 0) revert InvalidPolicy();
            return;
        }
        if (maxValuePerTransaction == 0 || maxValuePerPeriod < maxValuePerTransaction) revert InvalidPolicy();
    }
}
