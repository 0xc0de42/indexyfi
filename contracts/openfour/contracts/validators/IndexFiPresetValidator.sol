// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {IOpenFourPresetValidator} from "../interfaces/IOpenFourPresetValidator.sol";
import {OpenFourTypes} from "../libraries/OpenFourTypes.sol";
import {IIndexFiFactory} from "../interfaces/IIndexFi.sol";
import {IIndexFiAdapter} from "../interfaces/IIndexFiAdapter.sol";
import {IIndexFiOracle} from "../interfaces/IIndexFiOracle.sol";
import {IndexFiFactory} from "../IndexFiFactory.sol";

/// Pin the preset to the deployed, trusted factory; registration follows factory deployment.
contract IndexFiPresetValidator is IOpenFourPresetValidator {
    address public immutable factory;

    constructor(address factory_) {
        require(factory_.code.length != 0, "IndexFi: factory");
        factory = factory_;
    }

    function validate(uint256 preset, OpenFourTypes.TokenInitParams calldata p) external view {
        IndexFiFactory f = IndexFiFactory(factory);
        IIndexFiFactory.LaunchConfig memory c = abi.decode(p.vaultParams, (IIndexFiFactory.LaunchConfig));
        require(
            preset == f.presetId() && p.quoteAsset == f.settlementToken() && p.maxSupply == f.maxSupply()
                && p.saleAmount == 1e18 && p.raiseAmount == c.liquidityUSDT,
            "IndexFi: preset"
        );
        require(
            c.factory == factory && c.creator != address(0) && c.adapter == address(f.adapter())
                && c.oracle == address(f.oracle()) && c.router == f.router(),
            "IndexFi: bindings"
        );
        require(c.collateralUSDT >= f.minimumSeed() && c.liquidityUSDT >= f.minimumLiquidity(), "IndexFi: funding");
        require(
            bytes(p.name).length != 0 && bytes(p.symbol).length != 0 && c.assets.length > 0 && c.assets.length <= 32,
            "IndexFi: basket"
        );
        require(
            p.tokenParams.length == 0 && p.curveParams.length == 0 && p.tradeParams.length == 0
                && p.migrateParams.length == 0 && p.customDataParams.length == 0,
            "IndexFi: params"
        );
        uint256 weight;
        for (uint256 i; i < c.assets.length; ++i) {
            address a = c.assets[i].token;
            require(
                c.assets[i].weightBps != 0 && IIndexFiAdapter(c.adapter).supportsAsset(a)
                    && IIndexFiOracle(c.oracle).supportsAsset(a),
                "IndexFi: asset"
            );
            for (uint256 j; j < i; ++j) {
                require(c.assets[j].token != a, "IndexFi: duplicate");
            }
            weight += c.assets[i].weightBps;
        }
        require(weight == 10000, "IndexFi: weights");
    }
}
