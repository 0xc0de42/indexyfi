// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IIndexFiOracle} from "../interfaces/IIndexFiOracle.sol";

// Atlas Single-Feed AggregatorV3-compatible interface (official public API).
interface IAtlasSingleFeed {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

/// Immutable, deployment-reviewed feed bindings. No unsigned backend prices.
contract AtlasPushOracle is IIndexFiOracle {
    error InvalidFeed(address asset);
    error InvalidPrice(address asset);
    error StalePrice(address asset);

    struct Feed {
        address asset;
        address aggregator;
        uint32 maxAge;
    }

    struct Binding {
        address aggregator;
        uint32 maxAge;
        uint8 decimals;
    }
    address public immutable override settlementToken;
    mapping(address => Binding) public feeds;

    constructor(address settlement, Feed[] memory bindings) {
        require(settlement.code.length != 0, "Oracle: settlement");
        settlementToken = settlement;
        for (uint256 i; i < bindings.length; ++i) {
            Feed memory f = bindings[i];
            if (
                f.asset.code.length == 0 || f.asset == settlement || f.aggregator.code.length == 0 || f.maxAge == 0
                    || feeds[f.asset].aggregator != address(0)
            ) revert InvalidFeed(f.asset);
            uint8 d = IAtlasSingleFeed(f.aggregator).decimals();
            if (d > 18) revert InvalidFeed(f.asset);
            feeds[f.asset] = Binding(f.aggregator, f.maxAge, d);
        }
    }

    function supportsAsset(address asset) external view override returns (bool) {
        return asset == settlementToken || feeds[asset].aggregator != address(0);
    }

    function price18(address asset) external view override returns (uint256) {
        if (asset == settlementToken) return 1e18;
        Binding memory f = feeds[asset];
        if (f.aggregator == address(0)) revert InvalidFeed(asset);
        (uint80 round, int256 answer, uint256 source, uint256 updated, uint80 answered) =
            IAtlasSingleFeed(f.aggregator).latestRoundData();
        if (
            round == 0 || answered < round || answer <= 0 || source == 0 || updated == 0 || source > updated
                || updated > block.timestamp
        ) revert InvalidPrice(asset);
        if (block.timestamp - source > f.maxAge || block.timestamp - updated > f.maxAge) revert StalePrice(asset);
        return uint256(answer) * 10 ** uint256(18 - f.decimals);
    }

    /// Push feeds are updated by Atlas reporters on chain; injected payloads are ignored.
    function updatePrices(bytes calldata, bytes calldata) external pure override returns (uint256) {
        return 0;
    }
}
