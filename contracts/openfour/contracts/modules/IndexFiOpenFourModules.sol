// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IOpenFourToken} from "../interfaces/IOpenFourToken.sol";
import {IndexFiVault} from "./vault/IndexFiVault.sol";
import {
    PancakeV2MigrateLib,
    IPancakeV2RouterMeta,
    IPancakeV2FactoryLike,
    IPancakeV2PairLike
} from "../libraries/PancakeV2MigrateLib.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IOpenFourCurveModule} from "../interfaces/IOpenFourCurveModule.sol";
import {IOpenFourTradeModule} from "../interfaces/IOpenFourTradeModule.sol";
import {IOpenFourMigrateModule} from "../interfaces/IOpenFourMigrateModule.sol";
import {OpenFourTypes} from "../libraries/OpenFourTypes.sol";

abstract contract IndexFiSlot is Initializable {
    address internal boundToken;
    address internal boundCore;
    bytes internal parameters;
    string internal version;

    constructor() {
        _disableInitializers();
    }
}

contract IndexFiCurveModule is IndexFiSlot, IOpenFourCurveModule {
    function getInitParams() external view returns (bytes memory) {
        return parameters;
    }

    function init(
        address token,
        address core,
        OpenFourTypes.TokenCreateParams calldata p,
        bytes calldata params,
        string calldata version_
    ) external initializer {
        boundToken = token;
        boundCore = core;
        parameters = params;
        version = version_;
        initialPrice = 10 ** uint256(IERC20Metadata(p.quoteAsset).decimals());
    }

    function descriptor() external view returns (bytes8 id, string memory tag, string memory version_) {
        tag = "module.curve.indexfi.v5";
        return (bytes8(keccak256(bytes(tag))), tag, version);
    }

    function evaluate(OpenFourTypes.CurveContext calldata)
        external
        pure
        returns (OpenFourTypes.CurveResult memory result)
    {
        result.reason = "Use IndexFiVault.deposit or redeem";
    }

    function evaluateReverse(address, bool, uint256, uint256, uint256, uint256)
        external
        pure
        returns (uint256, uint256)
    {
        return (0, 0);
    }
    uint256 private initialPrice;

    function getInitialPrice() external view returns (uint256) {
        return initialPrice;
    }

    function getLastPrice(address, uint256, uint256) external view returns (uint256) {
        return initialPrice;
    }

    function getLiquiditySnapshot(address, uint256, uint256)
        external
        pure
        returns (OpenFourTypes.CurveLiquiditySnapshot memory snapshot)
    {
        return snapshot;
    }
}

contract IndexFiTradeModule is IndexFiSlot, IOpenFourTradeModule {
    function getInitParams() external view returns (bytes memory) {
        return parameters;
    }

    function init(address token, address core, bytes calldata params, string calldata version_) external initializer {
        boundToken = token;
        boundCore = core;
        parameters = params;
        version = version_;
    }

    function descriptor() external view returns (bytes8 id, string memory tag, string memory version_) {
        tag = "module.trade.indexfi.v5";
        return (bytes8(keccak256(bytes(tag))), tag, version);
    }

    function evaluate(OpenFourTypes.TradeContext calldata)
        external
        pure
        returns (OpenFourTypes.TradeResult memory result)
    {
        result.revertData = abi.encodeWithSignature("Error(string)", "Use IndexFiVault.deposit or redeem");
    }
}

contract IndexFiMigrateModule is IndexFiSlot, IOpenFourMigrateModule {
    error InvalidMigration();
    modifier onlyCore() {
        if (msg.sender != boundCore) revert InvalidMigration();
        _;
    }

    function getInitParams() external view returns (bytes memory) {
        return parameters;
    }

    function init(address token, address core, address, bytes calldata params, string calldata version_)
        external
        initializer
    {
        boundToken = token;
        boundCore = core;
        parameters = params;
        version = version_;
    }

    function descriptor() external view returns (bytes8 id, string memory tag, string memory version_) {
        tag = "module.migrate.indexfi.v5";
        return (bytes8(keccak256(bytes(tag))), tag, version);
    }

    function evaluate(OpenFourTypes.MigrateContext calldata ctx)
        external
        view
        onlyCore
        returns (OpenFourTypes.MigrateResult memory result)
    {
        if (ctx.token != boundToken) revert InvalidMigration();
        IndexFiVault v = IndexFiVault(IOpenFourToken(ctx.token).vault());
        result.canMigrate = v.funded() && v.pair() == address(0) && v.reservedShares() > 0 && v.reservedUSDT() > 0;
        result.reason = result.canMigrate ? "" : "IndexFi: not funded or already migrated";
    }

    function executeMigration(OpenFourTypes.MigrateHookContext calldata ctx, bytes calldata)
        external
        onlyCore
        returns (uint8, bytes memory)
    {
        if (ctx.token != boundToken || ctx.vault != IOpenFourToken(ctx.token).vault()) {
            revert InvalidMigration();
        }
        IndexFiVault v = IndexFiVault(ctx.vault);
        if (!v.funded() || v.pair() != address(0) || ctx.quoteAsset != v.settlementToken()) revert InvalidMigration();
        address factory = IPancakeV2RouterMeta(v.router()).factory();
        address pair = IPancakeV2FactoryLike(factory).getPair(ctx.token, ctx.quoteAsset);
        if (pair == address(0)) pair = IPancakeV2FactoryLike(factory).createPair(ctx.token, ctx.quoteAsset);
        if (pair == address(0) || IPancakeV2PairLike(pair).totalSupply() != 0) revert InvalidMigration();
        // A V2 address is predictable. Remove unsolicited pre-launch dust atomically
        // so it cannot poison the initial ratio or deny an otherwise valid launch.
        IPancakeV2PairLike(pair).skim(v.creator());
        (uint112 reserve0, uint112 reserve1,) = IPancakeV2PairLike(pair).getReserves();
        uint256 tokenReserve = IPancakeV2PairLike(pair).token0() == ctx.token ? reserve0 : reserve1;
        // Synchronized quote dust is harmless to mint accounting and becomes a
        // donation to the creator-owned pool. Token-side reserves must be zero.
        if (tokenReserve != 0 || IERC20(ctx.token).balanceOf(pair) != 0) {
            revert InvalidMigration();
        }
        IOpenFourToken(ctx.token).setMigratedPool(pair, true);
        v.prepareMigration(pair);
        PancakeV2MigrateLib.LiqParams memory lp =
            PancakeV2MigrateLib.LiqParams(v.router(), v.creator(), v.reservedShares(), v.reservedUSDT());
        if (PancakeV2MigrateLib.executePancakeLiquidity(lp, ctx) != pair) revert InvalidMigration();
        v.finishMigration(pair);
        return (1, abi.encode(pair));
    }
}
