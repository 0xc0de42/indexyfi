// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// Immutable allowlisted routes. Prices are USDT base units per whole constituent.
interface IIndexFiAdapter {
    function settlementToken() external view returns (address);
    function price(address token) external view returns (uint256);
    function unit(address token) external view returns (uint256);
    function quoteBuy(address token, uint256 usdt) external view returns (uint256);
    function quoteSell(address token, uint256 amount) external view returns (uint256);
    function buy(address token, uint256 usdt, uint256 minimum, uint256 deadline) external;
    function sell(address token, uint256 amount, uint256 minimum, uint256 deadline) external;
}
