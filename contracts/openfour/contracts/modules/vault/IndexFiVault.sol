// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IIndexFiFactory, IIndexFiVault} from "../../interfaces/IIndexFi.sol";
import {IIndexFiAdapter} from "../../interfaces/IIndexFiAdapter.sol";
import {IOpenFourVault} from "../../interfaces/IOpenFourVault.sol";
import {OpenFourTypes} from "../../libraries/OpenFourTypes.sol";
import {IndexFiShare} from "../../token/IndexFiShare.sol";

contract IndexFiVault is Initializable, ReentrancyGuard, IIndexFiVault, IOpenFourVault {
    using SafeERC20 for IERC20;

    address public override token;
    address public override tokenAddress;
    address public override creator;
    address public override settlementToken;
    address public override quoteAsset;
    address public override fourCore;
    address public override wrappedNative;
    OpenFourTypes.Phase public override phase;
    bool public override closed;
    uint256 public override totalRaised;
    uint256 public override antiSniperQuoteAccrued;
    uint256 public override initialSaleAmount;
    uint256 public override remainingForSale;

    IIndexFiAdapter public adapter;
    address public factory;
    uint256 private settlementScale;
    IIndexFiFactory.Constituent[] private basket;
    mapping(address => uint256) public override costBasisUSDT;
    bytes private initialParameters;
    string private moduleVersion;

    modifier onlyCore() {
        require(msg.sender == fourCore, "IndexFi: only core");
        _;
    }

    modifier onlyFactory() {
        require(msg.sender == factory, "IndexFi: only factory");
        _;
    }

    constructor() { _disableInitializers(); }

    function init(address token_, address core_, address, address,
        OpenFourTypes.TokenCreateParams calldata tokenParams, bytes calldata vaultParams,
        string calldata version_) external override initializer {
        (address creator_, IIndexFiFactory.Constituent[] memory assets, address adapter_, address factory_) =
            abi.decode(vaultParams, (address, IIndexFiFactory.Constituent[], address, address));
        require(token_ != address(0) && core_ != address(0) && creator_ != address(0), "IndexFi: zero binding");
        require(factory_ != address(0) && adapter_ != address(0), "IndexFi: zero service");
        require(tokenParams.quoteAsset == IIndexFiAdapter(adapter_).settlementToken(), "IndexFi: settlement mismatch");
        token = token_;
        tokenAddress = token_;
        creator = creator_;
        fourCore = core_;
        adapter = IIndexFiAdapter(adapter_);
        factory = factory_;
        settlementToken = tokenParams.quoteAsset;
        quoteAsset = tokenParams.quoteAsset;
        settlementScale = 10 ** uint256(IERC20Metadata(settlementToken).decimals());
        phase = OpenFourTypes.Phase.Created;
        initialParameters = vaultParams;
        moduleVersion = version_;
        for (uint256 i; i < assets.length; ++i) basket.push(assets[i]);
    }

    function descriptor() external view override returns (bytes8 id, string memory tag, string memory version) {
        tag = "module.vault.indexfi";
        return (bytes8(keccak256(bytes(tag))), tag, moduleVersion);
    }

    function name() external view override returns (string memory) { return IndexFiShare(token).name(); }
    function symbol() external view override returns (string memory) { return IndexFiShare(token).symbol(); }
    function metadataURI() external view override returns (string memory) { return IndexFiShare(token).tokenURI(); }
    function totalSupply() public view override returns (uint256) { return IndexFiShare(token).totalSupply(); }
    function balanceOf(address holder) external view override returns (uint256) { return IndexFiShare(token).balanceOf(holder); }
    function constituents() external view override returns (IIndexFiFactory.Constituent[] memory) { return basket; }
    function getInitParams() external view override returns (bytes memory) { return initialParameters; }
    function soldAmount() external pure override returns (uint256) { return 0; }
    function isSoldOut() external pure override returns (bool) { return false; }
    function sellViaVault() external pure override returns (bool) { return false; }

    function seed(uint256 usdtIn, uint256[] calldata minimums, uint256 deadline)
        external onlyFactory nonReentrant returns (uint256 shares) {
        require(totalSupply() == 0, "IndexFi: already seeded");
        shares = Math.mulDiv(usdtIn, 1e18, settlementScale);
        require(shares != 0, "IndexFi: zero shares");
        _collectAndInvest(msg.sender, usdtIn, minimums, deadline, true);
        costBasisUSDT[creator] = usdtIn;
        IndexFiShare(token).issue(creator, shares);
        phase = OpenFourTypes.Phase.Trading;
        IndexFiShare(token).setPhase(OpenFourTypes.Phase.Trading);
        emit Deposited(creator, usdtIn, shares);
    }

    function previewDeposit(uint256 usdtIn)
        public view override returns (uint256 shares, uint256[] memory tokenOut) {
        uint256 supply = totalSupply();
        require(!closed && supply != 0 && usdtIn != 0, "IndexFi: inactive");
        uint256 value = _basketValue();
        require(value != 0, "IndexFi: empty basket");
        shares = Math.mulDiv(usdtIn, supply, value);
        require(shares != 0, "IndexFi: zero shares");
        tokenOut = _previewInvestment(usdtIn, value);
    }

    function deposit(uint256 usdtIn, uint256 minSharesOut, uint256[] calldata minimums,
        uint256 deadline) external override nonReentrant returns (uint256 shares) {
        (shares,) = previewDeposit(usdtIn);
        require(shares >= minSharesOut, "IndexFi: shares slippage");
        _collectAndInvest(msg.sender, usdtIn, minimums, deadline, false);
        costBasisUSDT[msg.sender] += usdtIn;
        IndexFiShare(token).issue(msg.sender, shares);
        emit Deposited(msg.sender, usdtIn, shares);
    }

    function previewRedeem(address holder, uint256 shares) public view override
        returns (uint256 grossUSDT, uint256 creatorFeeUSDT, uint256 netUSDT) {
        uint256 holderShares = IndexFiShare(token).balanceOf(holder);
        uint256 supply = totalSupply();
        require(!closed && shares != 0 && shares <= holderShares, "IndexFi: invalid shares");
        bool finalExit = shares == supply;
        for (uint256 i; i < basket.length; ++i) {
            address asset = basket[i].token;
            uint256 holding = IERC20(asset).balanceOf(address(this));
            uint256 amount = finalExit ? holding : Math.mulDiv(holding, shares, supply);
            grossUSDT += asset == settlementToken ? amount : adapter.quoteSell(asset, amount);
        }
        uint256 basis = shares == holderShares
            ? costBasisUSDT[holder]
            : Math.mulDiv(costBasisUSDT[holder], shares, holderShares);
        if (holder != creator && grossUSDT > basis) creatorFeeUSDT = Math.mulDiv(grossUSDT - basis, 1000, 10000);
        netUSDT = grossUSDT - creatorFeeUSDT;
    }

    function redeem(uint256 shares, uint256 minNetUSDT, uint256 deadline) external override nonReentrant
        returns (uint256 netUSDT, uint256 creatorFeeUSDT) {
        require(block.timestamp <= deadline, "IndexFi: expired");
        uint256 holderShares = IndexFiShare(token).balanceOf(msg.sender);
        uint256 supply = totalSupply();
        require(shares != 0 && shares <= holderShares, "IndexFi: invalid shares");
        uint256 basis = shares == holderShares
            ? costBasisUSDT[msg.sender]
            : Math.mulDiv(costBasisUSDT[msg.sender], shares, holderShares);
        uint256 beforeCash = IERC20(settlementToken).balanceOf(address(this));
        bool finalExit = shares == supply;
        for (uint256 i; i < basket.length; ++i) {
            address asset = basket[i].token;
            uint256 holding = IERC20(asset).balanceOf(address(this));
            uint256 amount = finalExit ? holding : Math.mulDiv(holding, shares, supply);
            if (asset != settlementToken && amount != 0) {
                IERC20(asset).forceApprove(address(adapter), amount);
                adapter.sell(asset, amount, 0, deadline);
            }
        }
        uint256 grossUSDT = IERC20(settlementToken).balanceOf(address(this)) - beforeCash;
        if (basketContainsSettlement()) {
            uint256 currentCash = beforeCash;
            uint256 cashAmount = finalExit ? currentCash : Math.mulDiv(currentCash, shares, supply);
            grossUSDT += cashAmount;
        }
        require(grossUSDT != 0, "IndexFi: zero proceeds");
        if (msg.sender != creator && grossUSDT > basis) creatorFeeUSDT = Math.mulDiv(grossUSDT - basis, 1000, 10000);
        netUSDT = grossUSDT - creatorFeeUSDT;
        require(netUSDT >= minNetUSDT, "IndexFi: redemption slippage");
        costBasisUSDT[msg.sender] -= basis;
        IndexFiShare(token).redeemFrom(msg.sender, shares);
        IERC20 cash = IERC20(settlementToken);
        if (creatorFeeUSDT != 0) cash.safeTransfer(creator, creatorFeeUSDT);
        cash.safeTransfer(msg.sender, netUSDT);
        if (finalExit) { closed = true; phase = OpenFourTypes.Phase.Migrated; emit VaultClosed(); }
        emit Redeemed(msg.sender, shares, basis, grossUSDT, creatorFeeUSDT, netUSDT);
    }

    function _collectAndInvest(address payer, uint256 usdtIn, uint256[] calldata minimums,
        uint256 deadline, bool useWeights) private {
        require(block.timestamp <= deadline && minimums.length == basket.length, "IndexFi: execution params");
        uint256 basketValue = useWeights ? 0 : _basketValue();
        IERC20 cash = IERC20(settlementToken);
        uint256 beforeCash = cash.balanceOf(address(this));
        cash.safeTransferFrom(payer, address(this), usdtIn);
        require(cash.balanceOf(address(this)) - beforeCash == usdtIn, "IndexFi: transfer behavior");
        uint256 left = usdtIn;
        for (uint256 i; i < basket.length; ++i) {
            uint256 input;
            if (i + 1 == basket.length) input = left;
            else if (useWeights) input = Math.mulDiv(usdtIn, basket[i].weightBps, 10000);
            else input = Math.mulDiv(usdtIn, _assetValue(basket[i].token), basketValue);
            left -= input;
            if (basket[i].token == settlementToken) {
                require(input >= minimums[i], "IndexFi: cash slippage");
            } else {
                cash.forceApprove(address(adapter), input);
                adapter.buy(basket[i].token, input, minimums[i], deadline);
            }
        }
    }

    function _previewInvestment(uint256 usdtIn, uint256 basketValue) private view returns (uint256[] memory out) {
        out = new uint256[](basket.length);
        uint256 left = usdtIn;
        for (uint256 i; i < basket.length; ++i) {
            uint256 input = i + 1 == basket.length ? left : Math.mulDiv(usdtIn, _assetValue(basket[i].token), basketValue);
            left -= input;
            out[i] = basket[i].token == settlementToken ? input : adapter.quoteBuy(basket[i].token, input);
        }
    }

    function _assetValue(address asset) private view returns (uint256) {
        uint256 holding = IERC20(asset).balanceOf(address(this));
        return asset == settlementToken ? holding : adapter.quoteSell(asset, holding);
    }

    function _basketValue() private view returns (uint256 total) {
        for (uint256 i; i < basket.length; ++i) total += _assetValue(basket[i].token);
    }

    function basketContainsSettlement() private view returns (bool) {
        for (uint256 i; i < basket.length; ++i) if (basket[i].token == settlementToken) return true;
        return false;
    }

    function onBuy(OpenFourTypes.VaultTradeParams calldata) external pure override returns (uint256, uint256) { revert("IndexFi: use deposit"); }
    function onSell(OpenFourTypes.VaultTradeParams calldata) external pure override returns (uint256, uint256) { revert("IndexFi: use redeem"); }
    function collectSellAsset(address, uint256, bytes calldata) external pure override { revert("IndexFi: unsupported"); }
    function transferQuote(address, uint256) external pure override { revert("IndexFi: unsupported"); }
    function transferQuoteForMigration(address, uint256) external pure override { revert("IndexFi: unsupported"); }
    function transferTokenForMigration(address, uint256) external pure override { revert("IndexFi: unsupported"); }
    function burnToken(uint256) external pure override { revert("IndexFi: unsupported"); }
    function setPhase(OpenFourTypes.Phase newPhase) external override onlyCore { phase = newPhase; IndexFiShare(token).setPhase(newPhase); }
}
