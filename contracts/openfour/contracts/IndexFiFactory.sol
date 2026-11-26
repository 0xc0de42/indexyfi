// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {IIndexFiFactory} from "./interfaces/IIndexFi.sol";
import {IIndexFiAdapter} from "./interfaces/IIndexFiAdapter.sol";
import {IIndexFiOracle} from "./interfaces/IIndexFiOracle.sol";
import {IOpenFourCore} from "./interfaces/IOpenFourCore.sol";
import {IOpenFourToken} from "./interfaces/IOpenFourToken.sol";
import {OpenFourTypes} from "./libraries/OpenFourTypes.sol";
import {IndexFiVault} from "./modules/vault/IndexFiVault.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface ICoreMigration {
    function migrate(address token) external;
}

contract IndexFiFactory is IIndexFiFactory, ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public immutable override settlementToken;
    uint256 public immutable override minimumSeed;
    uint256 public immutable minimumLiquidity;
    uint256 public immutable maxSupply;
    uint256 public immutable presetId;
    IOpenFourCore public immutable core;
    IIndexFiAdapter public immutable adapter;
    IIndexFiOracle public immutable oracle;
    address public immutable router;
    address[] private vaults;
    mapping(address => bool) public override isVault;
    mapping(uint256 => bool) public override usedRequestIds;

    constructor(
        IOpenFourCore core_,
        uint256 preset_,
        IIndexFiAdapter adapter_,
        IIndexFiOracle oracle_,
        address router_,
        uint256 cap
    ) {
        require(
            address(core_).code.length != 0 && address(adapter_).code.length != 0 && address(oracle_).code.length != 0
                && router_.code.length != 0 && cap >= 100e18,
            "IndexFi: deployment"
        );
        core = core_;
        presetId = preset_;
        adapter = adapter_;
        oracle = oracle_;
        router = router_;
        maxSupply = cap;
        settlementToken = adapter_.settlementToken();
        require(oracle_.settlementToken() == settlementToken, "IndexFi: oracle settlement");
        uint8 d = IERC20Metadata(settlementToken).decimals();
        require(d <= 18, "IndexFi: decimals");
        minimumLiquidity = 10 ** uint256(d);
        minimumSeed = 100 * minimumLiquidity;
    }

    function vaultCount() external view returns (uint256) {
        return vaults.length;
    }

    function vaultAt(uint256 index) external view returns (address) {
        return vaults[index];
    }

    function previewCreate(Basket calldata basket, uint256 seedUSDT) public view returns (uint256[] memory out) {
        uint256 n = basket.constituents.length;
        require(seedUSDT >= minimumSeed && n != 0 && n <= 32, "IndexFi: seed or count");
        require(bytes(basket.name).length != 0 && bytes(basket.symbol).length != 0, "IndexFi: identity");
        out = new uint256[](n);
        uint256 weights;
        uint256 left = seedUSDT;
        for (uint256 i; i < n; ++i) {
            Constituent calldata a = basket.constituents[i];
            require(
                a.weightBps != 0 && adapter.supportsAsset(a.token) && oracle.supportsAsset(a.token), "IndexFi: asset"
            );
            for (uint256 j; j < i; ++j) {
                require(basket.constituents[j].token != a.token, "IndexFi: duplicate");
            }
            weights += a.weightBps;
            require(weights <= 10000, "IndexFi: weights");
            uint256 input = i + 1 == n ? left : Math.mulDiv(seedUSDT, a.weightBps, 10000);
            left -= input;
            out[i] = a.token == settlementToken ? input : adapter.quoteBuy(a.token, input);
            require(out[i] != 0, "IndexFi: zero leg");
        }
        require(weights == 10000, "IndexFi: weights");
    }

    /// Exact signed Core payload, bound to a caller-selected unique request ID.
    function buildCreateArgs(
        uint256 requestId,
        address creator,
        Basket calldata basket,
        uint256 seedUSDT,
        uint256 liquidityUSDT,
        uint256 minCreatorShares,
        uint256[] calldata minimums,
        uint256 deadline,
        uint256 createFee
    ) public view returns (bytes memory) {
        require(requestId != 0 && !usedRequestIds[requestId], "IndexFi: request id");
        require(
            creator != address(0) && liquidityUSDT >= minimumLiquidity && minimums.length == basket.constituents.length,
            "IndexFi: funding"
        );
        previewCreate(basket, seedUSDT);
        OpenFourTypes.CreateTokenArgs memory a;
        a.requestId = requestId;
        a.presetId = presetId;
        a.validTimestamp = deadline;
        a.createFee = createFee;
        a.initParams.name = basket.name;
        a.initParams.symbol = basket.symbol;
        a.initParams.tokenUri = basket.metadataURI;
        a.initParams.tokenSalt = keccak256(abi.encode(address(this), creator, a.requestId));
        a.initParams.quoteAsset = settlementToken;
        a.initParams.maxSupply = maxSupply;
        // Nonzero launch metadata, not a public sale. Core buy/sell are disabled; migration is explicitly called after funding.
        a.initParams.saleAmount = 1e18;
        a.initParams.raiseAmount = liquidityUSDT;
        a.initParams.vaultParams = abi.encode(
            LaunchConfig(
                creator,
                basket.constituents,
                address(adapter),
                address(oracle),
                router,
                address(this),
                seedUSDT,
                liquidityUSDT,
                minCreatorShares,
                keccak256(abi.encode(minimums))
            )
        );
        return abi.encode(a);
    }

    /// Same as createVault, after posting signed oracle prices in the same transaction, so the launch is priced
    /// from the latest Atlas state. The oracle verifies signatures; empty arrays post nothing.
    function createVaultWithPrices(
        bytes[] calldata payloads,
        bytes[] calldata signatures,
        uint256 requestId,
        Basket calldata basket,
        uint256 seedUSDT,
        uint256 liquidityUSDT,
        uint256 minCreatorShares,
        uint256[] calldata minimums,
        uint256 deadline,
        bytes calldata authorization
    ) external payable returns (address, uint256) {
        _postPrices(payloads, signatures);
        return createVault(requestId, basket, seedUSDT, liquidityUSDT, minCreatorShares, minimums, deadline, authorization);
    }

    /// Quote for eth_call only: posts signed prices, then returns previewCreate, so a launch can be quoted before any
    /// fresh price is stored on chain. Sending it as a transaction only updates the oracle.
    function quoteCreateWithPrices(bytes[] calldata payloads, bytes[] calldata signatures, Basket calldata basket, uint256 seedUSDT)
        external
        returns (uint256[] memory)
    {
        _postPrices(payloads, signatures);
        return previewCreate(basket, seedUSDT);
    }

    /// Posts each signed payload to the oracle, which verifies signatures. A basket (<= 32 assets) needs at most two
    /// Atlas payloads (<= 20 feeds each); empty arrays post nothing.
    function _postPrices(bytes[] calldata payloads, bytes[] calldata signatures) private {
        require(payloads.length == signatures.length && payloads.length <= 4, "IndexFi: prices");
        for (uint256 i; i < payloads.length; ++i) oracle.updatePrices(payloads[i], signatures[i]);
    }

    function createVault(
        uint256 requestId,
        Basket calldata basket,
        uint256 seedUSDT,
        uint256 liquidityUSDT,
        uint256 minCreatorShares,
        uint256[] calldata minimums,
        uint256 deadline,
        bytes calldata authorization
    ) public payable nonReentrant returns (address vault, uint256 seedShares) {
        require(block.timestamp <= deadline, "IndexFi: expired");
        bytes memory args = buildCreateArgs(
            requestId, msg.sender, basket, seedUSDT, liquidityUSDT, minCreatorShares, minimums, deadline, msg.value
        );
        usedRequestIds[requestId] = true;
        address share = core.createToken{value: msg.value}(args, authorization);
        vault = IOpenFourToken(share).vault();
        IndexFiVault v = IndexFiVault(vault);
        require(v.creator() == msg.sender && v.token() == share && v.factory() == address(this), "IndexFi: binding");
        IERC20 cash = IERC20(settlementToken);
        uint256 total = seedUSDT + liquidityUSDT;
        uint256 beforeCash = cash.balanceOf(address(this));
        cash.safeTransferFrom(msg.sender, address(this), total);
        require(cash.balanceOf(address(this)) == beforeCash + total, "IndexFi: transfer");
        cash.forceApprove(vault, total);
        seedShares = v.seed(minimums, deadline);
        cash.forceApprove(vault, 0);
        require(cash.balanceOf(address(this)) == beforeCash, "IndexFi: funding mismatch");
        ICoreMigration(address(core)).migrate(share);
        require(v.phase() == OpenFourTypes.Phase.Migrated && v.pair() != address(0), "IndexFi: migration incomplete");
        vaults.push(vault);
        isVault[vault] = true;
        emit VaultCreated(msg.sender, vault, requestId, seedUSDT);
        emit PortfolioLaunched(vault, share, v.pair(), seedUSDT, liquidityUSDT, v.outstandingSupply());
    }
}
