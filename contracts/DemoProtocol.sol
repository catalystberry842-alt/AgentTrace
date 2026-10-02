// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

/// @title DemoProtocol
/// @notice Test contract for the AgentTrace demonstration on Monad testnet.
/// @dev This is not production DeFi. It does not custody MON and it has no administrator.
///      deposit, swap, and withdraw are separate functions so a firewall can allow one and reject the others.
///      Arguments include the agent id because a firewall call must say which agent the accounting belongs to.
contract DemoProtocol {
    error ZeroAmount();
    error InsufficientDeposit(uint256 agentId, uint256 amount);

    mapping(uint256 agentId => uint256 amount) public deposits;
    mapping(uint256 agentId => uint256 amount) public swapped;

    event Deposited(uint256 indexed agentId, uint256 amount);
    event Withdrawn(uint256 indexed agentId, uint256 amount);
    event Swapped(uint256 indexed agentId, uint256 amountIn, uint256 amountOut);

    function deposit(uint256 agentId, uint256 amount) external {
        if (agentId == 0 || amount == 0) revert ZeroAmount();
        deposits[agentId] += amount;
        emit Deposited(agentId, amount);
    }

    /// @notice Moves recorded deposit units into a recorded swap balance. Not a market.
    function swap(uint256 agentId, uint256 amountIn, uint256 amountOut) external {
        if (agentId == 0 || amountIn == 0 || amountOut == 0) revert ZeroAmount();
        uint256 current = deposits[agentId];
        if (amountIn > current) revert InsufficientDeposit(agentId, amountIn);
        deposits[agentId] = current - amountIn;
        swapped[agentId] += amountOut;
        emit Swapped(agentId, amountIn, amountOut);
    }

    function withdraw(uint256 agentId, uint256 amount) external {
        if (agentId == 0 || amount == 0) revert ZeroAmount();
        uint256 current = deposits[agentId];
        if (amount > current) revert InsufficientDeposit(agentId, amount);
        deposits[agentId] = current - amount;
        emit Withdrawn(agentId, amount);
    }
}
