// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IIndexFiFactory, IIndexFiVault} from "../../interfaces/IIndexFi.sol";
import {IIndexFiAdapter} from "../../interfaces/IIndexFiAdapter.sol";
import {IIndexFiOracle} from "../../interfaces/IIndexFiOracle.sol";
import {IOpenFourVault} from "../../interfaces/IOpenFourVault.sol";
import {IOpenFourCore} from "../../interfaces/IOpenFourCore.sol";
import {OpenFourTypes} from "../../libraries/OpenFourTypes.sol";
import {OpenFourToken} from "../../token/OpenFourToken.sol";

/// Standard OpenFourToken inventory: only released/LP-reserved shares are backed claims.
contract IndexFiVault is Initializable, ReentrancyGuard, IIndexFiVault, IOpenFourVault {
    using SafeERC20 for IERC20;
    error InvalidLaunch();
    error Inactive();
    error InvalidAmount();
    error Unauthorized();
    error Slippage();
    error BalanceMismatch();
    error InsufficientInventory();
    error CoreTradeDisabled();
    uint256 public constant FEE_BPS = 10;
    /// A basket has at most 32 assets and one Atlas payload carries at most 20 feeds, so two payloads always suffice.
    uint256 public constant MAX_PRICE_PAYLOADS = 4;
    uint256 public constant BPS = 10_000;
    address public override token;
    address public override tokenAddress;
    address public override creator;
    address public override settlementToken;
    address public override quoteAsset;
    address public override fourCore;
    address public override wrappedNative;
    OpenFourTypes.Phase public override phase;
    bool public override closed;
    bool public funded;
    uint256 public override totalRaised;
    uint256 public override antiSniperQuoteAccrued;
    uint256 public override initialSaleAmount;
    uint256 public override remainingForSale;
    uint256 public outstandingSupply;
    uint256 public inventory;
    uint256 public reservedShares;
    uint256 public reservedUSDT;
    address public pair;
    address public migrationPair;
    address public migrateModule;
    address public router;
    address public factory;
    IIndexFiAdapter public adapter;
    IIndexFiOracle public oracle;
    uint256 public settlementScale;
    mapping(address => uint256) public override collateralBalance;
    IIndexFiFactory.Constituent[] private basket;
    uint256[] private units;
    bytes private initialParameters;
    string private moduleVersion;
    modifier onlyCore() {
        if (msg.sender != fourCore) revert Unauthorized();
        _;
    }
    modifier onlyFactory() {
        if (msg.sender != factory) revert Unauthorized();
        _;
    }
    modifier onlyMigration() {
        if (msg.sender != migrateModule) revert Unauthorized();
        _;
    }
    modifier active() {
        if (!funded || closed || phase != OpenFourTypes.Phase.Migrated) revert Inactive();
        _;
    }

    constructor() {
        _disableInitializers();
    }

    function init(
        address token_,
        address core_,
        address coreCreator,
        address migrate_,
        OpenFourTypes.TokenCreateParams calldata p,
        bytes calldata raw,
        string calldata version_
    ) external override initializer {
        IIndexFiFactory.LaunchConfig memory c = abi.decode(raw, (IIndexFiFactory.LaunchConfig));
        if (
            c.creator == address(0) || c.factory != coreCreator || c.factory.code.length == 0 || token_ == address(0)
                || core_ == address(0) || migrate_ == address(0) || c.router.code.length == 0 || p.maxSupply == 0
                || c.assets.length == 0 || c.assets.length > 32
        ) revert InvalidLaunch();
        token = token_;
        tokenAddress = token_;
        fourCore = core_;
        migrateModule = migrate_;
        creator = c.creator;
        factory = c.factory;
        router = c.router;
        adapter = IIndexFiAdapter(c.adapter);
        oracle = IIndexFiOracle(c.oracle);
        settlementToken = p.quoteAsset;
        quoteAsset = p.quoteAsset;
        if (adapter.settlementToken() != quoteAsset || oracle.settlementToken() != quoteAsset) revert InvalidLaunch();
        uint8 d = IERC20Metadata(quoteAsset).decimals();
        if (d > 18) revert InvalidLaunch();
        settlementScale = 10 ** uint256(d);
        if (c.collateralUSDT < 100 * settlementScale || c.liquidityUSDT < settlementScale) revert InvalidLaunch();
        wrappedNative = IOpenFourCore(core_).wrappedNative();
        initialSaleAmount = p.saleAmount;
        remainingForSale = p.saleAmount;
        inventory = p.maxSupply;
        uint256 weights;
        for (uint256 i; i < c.assets.length; ++i) {
            address a = c.assets[i].token;
            if (
                a == token_ || a == address(0) || c.assets[i].weightBps == 0 || !adapter.supportsAsset(a)
                    || !oracle.supportsAsset(a)
            ) revert InvalidLaunch();
            for (uint256 j; j < i; ++j) {
                if (c.assets[j].token == a) revert InvalidLaunch();
            }
            uint8 ad = IERC20Metadata(a).decimals();
            if (ad > 18 || adapter.unit(a) != 10 ** uint256(ad)) revert InvalidLaunch();
            units.push(10 ** uint256(ad));
            basket.push(c.assets[i]);
            weights += c.assets[i].weightBps;
        }
        if (weights != BPS) revert InvalidLaunch();
        initialParameters = raw;
        moduleVersion = version_;
        phase = OpenFourTypes.Phase.Created;
    }

    function descriptor() external view override returns (bytes8, string memory, string memory) {
        string memory tag = "module.vault.indexfi.v5";
        return (bytes8(keccak256(bytes(tag))), tag, moduleVersion);
    }

    function name() external view override returns (string memory) {
        return OpenFourToken(token).name();
    }

    function symbol() external view override returns (string memory) {
        return OpenFourToken(token).symbol();
    }

    function metadataURI() external view override returns (string memory) {
        return OpenFourToken(token).tokenURI();
    }

    function totalSupply() public view override returns (uint256) {
        return outstandingSupply;
    }

    function balanceOf(address holder) external view override returns (uint256) {
        return IERC20(token).balanceOf(holder);
    }

    function constituents() external view override returns (IIndexFiFactory.Constituent[] memory) {
        return basket;
    }

    function getInitParams() external view override returns (bytes memory) {
        return initialParameters;
    }

    function soldAmount() external pure override returns (uint256) {
        return 0;
    }

    function isSoldOut() external pure override returns (bool) {
        return false;
    }

    function sellViaVault() external pure override returns (bool) {
        return false;
    }

    function _prices() private view returns (uint256[] memory p) {
        p = new uint256[](basket.length);
        for (uint256 i; i < p.length; ++i) {
            p[i] = oracle.price18(basket[i].token);
            if (p[i] == 0) revert InvalidAmount();
        }
    }

    function _value(uint256[] memory p) private view returns (uint256 v) {
        for (uint256 i; i < p.length; ++i) {
            v += Math.mulDiv(collateralBalance[basket[i].token], p[i], units[i]);
        }
    }

    function collateralValue() external view override returns (uint256) {
        return _value(_prices());
    }

    function nav() external view override returns (uint256) {
        if (outstandingSupply == 0) revert Inactive();
        return Math.mulDiv(_value(_prices()), 1e18, outstandingSupply);
    }

    function _collect(address payer, uint256 amount) private {
        IERC20 cash = IERC20(settlementToken);
        uint256 b = cash.balanceOf(address(this));
        cash.safeTransferFrom(payer, address(this), amount);
        if (cash.balanceOf(address(this)) != b + amount) revert BalanceMismatch();
    }

    function _allocations(uint256 input, uint256[] memory prices, bool initial)
        private
        view
        returns (uint256[] memory a)
    {
        a = new uint256[](basket.length);
        uint256[] memory weights = new uint256[](basket.length);
        uint256 denominator;
        uint256 last;
        for (uint256 i; i < weights.length; ++i) {
            weights[i] =
                initial ? basket[i].weightBps : Math.mulDiv(collateralBalance[basket[i].token], prices[i], units[i]);
            denominator += weights[i];
            if (weights[i] != 0) last = i;
        }
        if (denominator == 0) revert InvalidAmount();
        uint256 left = input;
        for (uint256 i; i < a.length; ++i) {
            a[i] = i == last ? left : Math.mulDiv(input, weights[i], denominator);
            left -= a[i];
        }
    }

    function _invest(uint256[] memory inputs, uint256[] calldata minimums, uint256 deadline) private {
        if (minimums.length != basket.length || block.timestamp > deadline) revert InvalidAmount();
        IERC20 cash = IERC20(settlementToken);
        for (uint256 i; i < inputs.length; ++i) {
            address a = basket[i].token;
            uint256 amount = inputs[i];
            uint256 received;
            if (a == settlementToken) {
                received = amount;
            } else if (amount != 0) {
                uint256 beforeCash = cash.balanceOf(address(this));
                uint256 beforeAsset = IERC20(a).balanceOf(address(this));
                cash.forceApprove(address(adapter), amount);
                adapter.buy(a, amount, minimums[i], deadline);
                cash.forceApprove(address(adapter), 0);
                if (cash.balanceOf(address(this)) + amount != beforeCash) revert BalanceMismatch();
                received = IERC20(a).balanceOf(address(this)) - beforeAsset;
                if (received == 0) revert Slippage();
            }
            if (received < minimums[i]) revert Slippage();
            collateralBalance[a] += received;
        }
    }

    function _release(address to, uint256 shares) private {
        if (shares == 0 || shares > inventory) revert InsufficientInventory();
        inventory -= shares;
        outstandingSupply += shares;
        IERC20(token).safeTransfer(to, shares);
    }

    function seed(uint256[] calldata minimums, uint256 deadline)
        external
        onlyFactory
        nonReentrant
        returns (uint256 creatorShares)
    {
        if (
            funded || block.timestamp > deadline || IERC20(token).balanceOf(address(this)) != inventory
                || IERC20(token).totalSupply() != inventory
        ) revert InvalidLaunch();
        IIndexFiFactory.LaunchConfig memory c = abi.decode(initialParameters, (IIndexFiFactory.LaunchConfig));
        if (keccak256(abi.encode(minimums)) != c.minimumsHash) revert InvalidLaunch();
        uint256[] memory p = _prices();
        _collect(msg.sender, c.collateralUSDT + c.liquidityUSDT);
        reservedUSDT = c.liquidityUSDT;
        _invest(_allocations(c.collateralUSDT, p, true), minimums, deadline);
        uint256 value = _value(p); // initial NAV = 1e18 USD per whole token
        uint256 lpShares = Math.mulDiv(c.liquidityUSDT, 1e18, settlementScale);
        if (value <= lpShares || value > inventory || value - lpShares < c.minCreatorShares) revert Slippage();
        reservedShares = lpShares;
        inventory -= lpShares;
        outstandingSupply = lpShares;
        creatorShares = value - lpShares;
        _release(creator, creatorShares);
        totalRaised = reservedUSDT;
        funded = true;
        emit Seeded(c.collateralUSDT, c.liquidityUSDT, outstandingSupply, creatorShares);
    }

    function _fee(uint256 amount) private pure returns (uint256) {
        return Math.mulDiv(amount, FEE_BPS, BPS);
    }

    /// Quote for eth_call only: posts signed prices, then returns previewDeposit, so a quote works even before any
    /// fresh price is stored on chain. Sending it as a transaction only updates the oracle.
    function quoteDepositWithPrices(bytes[] calldata payloads, bytes[] calldata signatures, uint256 input)
        external
        returns (uint256, uint256[] memory)
    {
        _postPrices(payloads, signatures);
        return previewDeposit(input);
    }

    function previewDeposit(uint256 input)
        public
        view
        override
        active
        returns (uint256 shares, uint256[] memory outputs)
    {
        if (input < settlementScale) revert InvalidAmount();
        uint256[] memory p = _prices();
        uint256 v = _value(p);
        uint256[] memory a = _allocations(input - _fee(input), p, false);
        outputs = new uint256[](a.length);
        uint256 contributed;
        for (uint256 i; i < a.length; ++i) {
            address asset = basket[i].token;
            outputs[i] = asset == settlementToken ? a[i] : (a[i] == 0 ? 0 : adapter.quoteBuy(asset, a[i]));
            uint256 holding = collateralBalance[asset];
            contributed += Math.mulDiv(holding + outputs[i], p[i], units[i]) - Math.mulDiv(holding, p[i], units[i]);
        }
        if (v == 0) revert InvalidAmount();
        shares = Math.mulDiv(contributed, outstandingSupply, v);
        if (shares == 0 || shares > inventory) revert InsufficientInventory();
    }

    /// Same as deposit, after posting signed oracle prices in the same transaction (see _postPrices).
    function depositWithPrices(
        bytes[] calldata payloads,
        bytes[] calldata signatures,
        uint256 input,
        uint256 minShares,
        uint256[] calldata minimums,
        uint256 deadline
    ) external returns (uint256) {
        _postPrices(payloads, signatures);
        return deposit(input, minShares, minimums, deadline);
    }

    function deposit(uint256 input, uint256 minShares, uint256[] calldata minimums, uint256 deadline)
        public
        override
        active
        nonReentrant
        returns (uint256 shares)
    {
        if (input < settlementScale || block.timestamp > deadline) revert InvalidAmount();
        uint256[] memory p = _prices();
        uint256 v = _value(p);
        if (v == 0) revert InvalidAmount();
        uint256 fee = _fee(input);
        uint256[] memory allocations = _allocations(input - fee, p, false);
        _collect(msg.sender, input);
        if (fee != 0) IERC20(settlementToken).safeTransfer(creator, fee);
        _invest(allocations, minimums, deadline);
        // Difference of valuations with the SAME oracle vector. Rounds issuance down.
        shares = Math.mulDiv(_value(p) - v, outstandingSupply, v);
        if (shares < minShares) revert Slippage();
        _release(msg.sender, shares);
        emit Deposited(msg.sender, input, shares, fee);
    }

    function _checkRedemption(address holder, uint256 shares) private view {
        if (
            holder == address(this) || shares == 0 || shares > outstandingSupply
                || IERC20(token).balanceOf(holder) < shares
        ) revert InvalidAmount();
    }

    function _acceptRedeemedShares(address holder, uint256 shares) private returns (uint256 supply) {
        _checkRedemption(holder, shares);
        supply = outstandingSupply;
        IERC20(token).safeTransferFrom(holder, address(this), shares);
        outstandingSupply = supply - shares;
        inventory += shares;
    }

    function _closeIfEmpty() private {
        if (outstandingSupply == 0) {
            closed = true;
            emit VaultClosed();
        }
    }

    function _transferExact(IERC20 asset, address recipient, uint256 amount) private {
        if (amount == 0) return;
        uint256 vaultBefore = asset.balanceOf(address(this));
        uint256 recipientBefore = asset.balanceOf(recipient);
        asset.safeTransfer(recipient, amount);
        if (
            asset.balanceOf(address(this)) + amount != vaultBefore
                || asset.balanceOf(recipient) != recipientBefore + amount
        ) revert BalanceMismatch();
    }

    function _previewRedeemAssets(address holder, uint256 shares)
        private
        view
        returns (uint256[] memory assetAmounts, uint256[] memory expectedUSDT, uint256 gross)
    {
        _checkRedemption(holder, shares);
        uint256 count = basket.length;
        assetAmounts = new uint256[](count);
        expectedUSDT = new uint256[](count);
        for (uint256 i; i < count; ++i) {
            address a = basket[i].token;
            uint256 q = Math.mulDiv(collateralBalance[a], shares, outstandingSupply);
            uint256 output = a == settlementToken ? q : (q == 0 ? 0 : adapter.quoteSell(a, q));
            assetAmounts[i] = q;
            expectedUSDT[i] = output;
            gross += output;
        }
    }

    function previewRedeem(address holder, uint256 shares)
        external
        view
        override
        active
        returns (uint256 gross, uint256 fee, uint256 net)
    {
        (,, gross) = _previewRedeemAssets(holder, shares);
        fee = _fee(gross);
        net = gross - fee;
    }

    function previewRedeemAssets(address holder, uint256 shares)
        external
        view
        override
        active
        returns (uint256[] memory assetAmounts, uint256[] memory expectedUSDT)
    {
        (assetAmounts, expectedUSDT,) = _previewRedeemAssets(holder, shares);
    }

    /// Same as redeem, after posting signed oracle prices (redemption itself needs no price; this keeps NAV current).
    function redeemWithPrices(
        bytes[] calldata payloads,
        bytes[] calldata signatures,
        uint256 shares,
        uint256 minNet,
        uint256[] calldata minAssetOut,
        uint256 deadline
    ) external returns (uint256, uint256) {
        _postPrices(payloads, signatures);
        return redeem(shares, minNet, minAssetOut, deadline);
    }

    function redeem(uint256 shares, uint256 minNet, uint256[] calldata minAssetOut, uint256 deadline)
        public
        override
        active
        nonReentrant
        returns (uint256 net, uint256 fee)
    {
        if (block.timestamp > deadline || minAssetOut.length != basket.length) revert InvalidAmount();
        uint256 supply = _acceptRedeemedShares(msg.sender, shares);
        IERC20 cash = IERC20(settlementToken);
        uint256 gross;
        for (uint256 i; i < basket.length; ++i) {
            address a = basket[i].token;
            uint256 q = Math.mulDiv(collateralBalance[a], shares, supply);
            collateralBalance[a] -= q;
            if (a == settlementToken) {
                if (q < minAssetOut[i]) revert Slippage();
                gross += q;
            } else if (q != 0) {
                uint256 beforeCash = cash.balanceOf(address(this));
                uint256 beforeAsset = IERC20(a).balanceOf(address(this));
                IERC20(a).forceApprove(address(adapter), q);
                adapter.sell(a, q, minAssetOut[i], deadline);
                IERC20(a).forceApprove(address(adapter), 0);
                if (IERC20(a).balanceOf(address(this)) + q != beforeAsset) revert BalanceMismatch();
                gross += cash.balanceOf(address(this)) - beforeCash;
            } else if (minAssetOut[i] != 0) {
                revert Slippage();
            }
        }
        fee = _fee(gross);
        net = gross - fee;
        if (gross == 0 || net < minNet) revert Slippage();
        if (fee != 0) cash.safeTransfer(creator, fee);
        cash.safeTransfer(msg.sender, net);
        _closeIfEmpty();
        emit Redeemed(msg.sender, shares, gross, fee, net);
    }

    function previewRedeemInKind(address holder, uint256 shares)
        public
        view
        override
        active
        returns (uint256[] memory grossAmounts, uint256[] memory creatorFeeAmounts, uint256[] memory netAmounts)
    {
        _checkRedemption(holder, shares);
        uint256 count = basket.length;
        grossAmounts = new uint256[](count);
        creatorFeeAmounts = new uint256[](count);
        netAmounts = new uint256[](count);
        for (uint256 i; i < count; ++i) {
            uint256 gross = Math.mulDiv(collateralBalance[basket[i].token], shares, outstandingSupply);
            uint256 creatorFee = _fee(gross);
            grossAmounts[i] = gross;
            creatorFeeAmounts[i] = creatorFee;
            netAmounts[i] = gross - creatorFee;
        }
    }

    /// Same as redeemInKind, after posting signed oracle prices.
    function redeemInKindWithPrices(
        bytes[] calldata payloads,
        bytes[] calldata signatures,
        uint256 shares,
        uint256[] calldata minAmountsOut,
        uint256 deadline
    ) external returns (uint256[] memory, uint256[] memory) {
        _postPrices(payloads, signatures);
        return redeemInKind(shares, minAmountsOut, deadline);
    }

    /// Posts each signed payload to the bound oracle. The oracle verifies signatures; empty arrays post nothing.
    function _postPrices(bytes[] calldata payloads, bytes[] calldata signatures) private {
        if (payloads.length != signatures.length || payloads.length > MAX_PRICE_PAYLOADS) revert InvalidAmount();
        for (uint256 i; i < payloads.length; ++i) oracle.updatePrices(payloads[i], signatures[i]);
    }

    function redeemInKind(uint256 shares, uint256[] calldata minAmountsOut, uint256 deadline)
        public
        override
        active
        nonReentrant
        returns (uint256[] memory netAmounts, uint256[] memory creatorFeeAmounts)
    {
        if (block.timestamp > deadline || minAmountsOut.length != basket.length) revert InvalidAmount();
        uint256 supply = _acceptRedeemedShares(msg.sender, shares);
        uint256 count = basket.length;
        uint256 totalReleased;
        netAmounts = new uint256[](count);
        creatorFeeAmounts = new uint256[](count);
        for (uint256 i; i < count; ++i) {
            address assetAddress = basket[i].token;
            uint256 gross = Math.mulDiv(collateralBalance[assetAddress], shares, supply);
            uint256 creatorFee = _fee(gross);
            uint256 netAmount = gross - creatorFee;
            if (netAmount < minAmountsOut[i]) revert Slippage();
            collateralBalance[assetAddress] -= gross;
            IERC20 asset = IERC20(assetAddress);
            _transferExact(asset, creator, creatorFee);
            _transferExact(asset, msg.sender, netAmount);
            creatorFeeAmounts[i] = creatorFee;
            netAmounts[i] = netAmount;
            totalReleased += gross;
            emit RedeemedAsset(msg.sender, assetAddress, gross, creatorFee, netAmount);
        }
        if (totalReleased == 0) revert Slippage();
        _closeIfEmpty();
        emit RedeemedInKind(msg.sender, shares);
    }

    function prepareMigration(address pair_) external onlyMigration {
        if (
            !funded || pair != address(0) || migrationPair != address(0) || pair_ == address(0)
                || phase != OpenFourTypes.Phase.MigratePending
        ) revert InvalidLaunch();
        migrationPair = pair_;
    }

    function finishMigration(address pair_) external onlyMigration {
        if (migrationPair != pair_ || pair_ == address(0) || reservedShares != 0 || reservedUSDT != 0) {
            revert InvalidLaunch();
        }
        pair = pair_;
        migrationPair = address(0);
        emit LiquidityMigrated(pair_, creator);
    }

    function transferQuoteForMigration(address to, uint256 amount) external override onlyMigration {
        if (to == address(0) || to != migrationPair || amount == 0 || amount != reservedUSDT) revert InvalidLaunch();
        reservedUSDT = 0;
        IERC20(settlementToken).safeTransfer(to, amount);
    }

    function transferTokenForMigration(address to, uint256 amount) external override onlyMigration {
        if (to == address(0) || to != migrationPair || amount == 0 || amount != reservedShares) revert InvalidLaunch();
        reservedShares = 0;
        IERC20(token).safeTransfer(to, amount);
    }

    function setPhase(OpenFourTypes.Phase next) external override onlyCore {
        if (phase == OpenFourTypes.Phase.Migrated || (next == OpenFourTypes.Phase.Migrated && pair == address(0))) {
            revert InvalidLaunch();
        }
        phase = next;
        OpenFourToken(token).setPhase(next);
    }

    function onBuy(OpenFourTypes.VaultTradeParams calldata) external pure override returns (uint256, uint256) {
        revert CoreTradeDisabled();
    }

    function onSell(OpenFourTypes.VaultTradeParams calldata) external pure override returns (uint256, uint256) {
        revert CoreTradeDisabled();
    }

    function transferQuote(address, uint256) external pure override {
        revert CoreTradeDisabled();
    }

    function burnToken(uint256) external pure override {
        revert CoreTradeDisabled();
    }

    function collectSellAsset(address, uint256, bytes calldata) external pure override {
        revert CoreTradeDisabled();
    }
}
