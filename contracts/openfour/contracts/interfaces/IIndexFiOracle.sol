// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IIndexFiOracle {
    function settlementToken() external view returns (address);
    function supportsAsset(address asset) external view returns (bool);
    /// USD per whole token, normalized to 18 decimals. USD/USDT parity is the MVP assumption.
    function price18(address asset) external view returns (uint256);
}
