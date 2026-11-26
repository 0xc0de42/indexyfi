// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IIndexFiFactory} from "./interfaces/IIndexFi.sol";
import {IIndexFiAdapter} from "./interfaces/IIndexFiAdapter.sol";
import {IOpenFourCore} from "./interfaces/IOpenFourCore.sol";
import {IOpenFourToken} from "./interfaces/IOpenFourToken.sol";
import {OpenFourTypes} from "./libraries/OpenFourTypes.sol";
import {IndexFiVault} from "./modules/vault/IndexFiVault.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

contract IndexFiFactory is IIndexFiFactory, ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public immutable settlementToken;
    uint256 public immutable minimumSeed;
    uint256 public immutable presetId;
    IOpenFourCore public immutable core;
    IIndexFiAdapter public immutable adapter;
    address[] private vaults;

    constructor(IOpenFourCore core_, uint256 preset_, IIndexFiAdapter adapter_) {
        core = core_;
        presetId = preset_;
        adapter = adapter_;
        settlementToken = adapter_.settlementToken();
        uint8 decimals = IERC20Metadata(settlementToken).decimals();
        require(decimals <= 18, "IndexFi: settlement decimals");
        minimumSeed = 100 * 10 ** uint256(decimals);
    }

    function vaultCount() external view returns (uint256) { return vaults.length; }
    function vaultAt(uint256 index) external view returns (address) { return vaults[index]; }

    function previewCreate(Basket calldata basket, uint256 seedUSDT) public view returns (uint256[] memory out) {
        uint256 count = basket.constituents.length;
        require(seedUSDT >= minimumSeed && count != 0 && count <= 32, "IndexFi: seed or count");
        require(bytes(basket.name).length != 0 && bytes(basket.symbol).length != 0, "IndexFi: empty identity");
        out = new uint256[](count);
        uint256 weights;
        uint256 left = seedUSDT;
        for (uint256 i; i < count; ++i) {
            Constituent calldata asset = basket.constituents[i];
            require(asset.weightBps != 0 && asset.token != address(0), "IndexFi: invalid constituent");
            for (uint256 j; j < i; ++j) require(basket.constituents[j].token != asset.token, "IndexFi: duplicate");
            weights += asset.weightBps;
            require(weights <= 10000, "IndexFi: weights");
            uint256 input = i + 1 == count ? left : Math.mulDiv(seedUSDT, asset.weightBps, 10000);
            left -= input;
            out[i] = adapter.quoteBuy(asset.token, input);
            require(out[i] != 0, "IndexFi: zero leg");
        }
        require(weights == 10000, "IndexFi: weights");
    }

    function createVault(Basket calldata basket, uint256 seedUSDT, uint256[] calldata minTokenOut,
        uint256 deadline, bytes calldata launchAuthorization)
        external payable nonReentrant returns (address vault, uint256 seedShares) {
        require(block.timestamp <= deadline, "IndexFi: expired");
        previewCreate(basket, seedUSDT);
        OpenFourTypes.CreateTokenArgs memory args;
        args.requestId = vaults.length + 1;
        args.presetId = presetId;
        args.validTimestamp = deadline;
        args.createFee = msg.value;
        args.initParams.name = basket.name;
        args.initParams.symbol = basket.symbol;
        args.initParams.tokenUri = basket.metadataURI;
        args.initParams.tokenSalt = keccak256(abi.encode(address(this), msg.sender, args.requestId));
        args.initParams.quoteAsset = settlementToken;
        args.initParams.maxSupply = 0;
        args.initParams.saleAmount = 0;
        args.initParams.raiseAmount = 0;
        args.initParams.vaultParams = abi.encode(msg.sender, basket.constituents, address(adapter), address(this));
        address share = core.createToken{value: msg.value}(abi.encode(args), launchAuthorization);
        vault = IOpenFourToken(share).vault();
        require(IndexFiVault(vault).creator() == msg.sender && IndexFiVault(vault).token() == share, "IndexFi: binding");
        IERC20 cash = IERC20(settlementToken);
        uint256 before = cash.balanceOf(address(this));
        cash.safeTransferFrom(msg.sender, address(this), seedUSDT);
        require(cash.balanceOf(address(this)) - before == seedUSDT, "IndexFi: seed transfer");
        cash.forceApprove(vault, seedUSDT);
        seedShares = IndexFiVault(vault).seed(seedUSDT, minTokenOut, deadline);
        vaults.push(vault);
        emit VaultCreated(msg.sender, vault, seedUSDT);
    }
}
