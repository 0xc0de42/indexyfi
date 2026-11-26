// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IIndexFiFactory, IIndexFiVault} from "../interfaces/IIndexFi.sol";
import {IIndexFiAdapter} from "../interfaces/IIndexFiAdapter.sol";
import {IIndexFiOracle} from "../interfaces/IIndexFiOracle.sol";
import {OpenFourTypes} from "../libraries/OpenFourTypes.sol";
import {IStrategy, ITokenDock, IFlapV2Router, IFlapV2Factory, IFlapV2Pair, IDirectLaunchVault, VaultUISchema, VaultMethodSchema, FieldDescriptor, ApproveAction} from "./FlapSpec.sol";
interface IFlapVaultConfig { function dockRouter() external view returns(address); function portal() external view returns(address); function vaultFactory() external view returns(address); }
/// Independent immutable-code clone: no guardian or creator access to reserves or collateral.
contract IndexFiFlapVault is Initializable, ReentrancyGuard, IIndexFiVault, IStrategy, IDirectLaunchVault {
    using SafeERC20 for IERC20;
    error InvalidLaunch(); error Inactive(); error InvalidAmount(); error Unauthorized(); error Slippage();
    error BalanceMismatch(); error InsufficientInventory();
    uint256 public constant FEE_BPS = 10; uint256 public constant BPS = 10_000;
    address public token; address public override creator; address public override settlementToken;
    address public pair; address public router; address public factory; address public launcher;
    IIndexFiAdapter public adapter; IIndexFiOracle public oracle;
    string public override name; string public override symbol; string public override metadataURI;
    OpenFourTypes.Phase public phase; bool public override closed; bool public funded;
    uint256 public outstandingSupply; uint256 public inventory; uint256 public maxSupply;
    uint256 public settlementScale; uint256 public reservedShares; uint256 public reservedUSDT;
    uint256 private seedValue; uint256 private poolShares; uint256 private liquidityQuote;
    bool private receivedDistribution;
    mapping(address => uint256) public override collateralBalance;
    IIndexFiFactory.Constituent[] private basket; uint256[] private units;
    modifier onlyFactory() { if (msg.sender != factory) revert Unauthorized(); _; }
    modifier active() { if (!funded || closed || phase != OpenFourTypes.Phase.Migrated) revert Inactive(); _; }
    constructor() { _disableInitializers(); }
    function initialize(address creator_, IIndexFiFactory.Basket calldata b, IIndexFiAdapter adapter_, IIndexFiOracle oracle_, address router_, uint256 cap, address launcher_) external initializer {
        if (creator_ == address(0) || launcher_ == address(0) || cap < 100e18 || b.constituents.length == 0 || b.constituents.length > 32) revert InvalidLaunch();
        creator=creator_; factory=msg.sender; launcher=launcher_; adapter=adapter_; oracle=oracle_; router=router_; maxSupply=cap;
        name=b.name; symbol=b.symbol; metadataURI=b.metadataURI; settlementToken=adapter_.settlementToken();
        if (oracle_.settlementToken()!=settlementToken) revert InvalidLaunch();
        uint8 d=IERC20Metadata(settlementToken).decimals(); if(d>18) revert InvalidLaunch(); settlementScale=10**uint256(d);
        uint256 weights;
        for(uint256 i;i<b.constituents.length;++i){
            IIndexFiFactory.Constituent calldata c=b.constituents[i];
            if(c.token==address(0)||c.weightBps==0||!adapter_.supportsAsset(c.token)||!oracle_.supportsAsset(c.token)) revert InvalidLaunch();
            for(uint256 j;j<i;++j) if(b.constituents[j].token==c.token) revert InvalidLaunch();
            uint8 ad=IERC20Metadata(c.token).decimals(); if(ad>18||adapter_.unit(c.token)!=10**uint256(ad)) revert InvalidLaunch();
            units.push(10**uint256(ad)); basket.push(c); weights+=c.weightBps;
        }
        if(weights!=BPS) revert InvalidLaunch();
    }
    function dockRouter() public view returns(address) { return IFlapVaultConfig(factory).dockRouter(); }
    function tokenAddress() external view returns(address) { return token; }
    function quoteAsset() external view returns(address) { return settlementToken; }
    function totalSupply() public view override returns(uint256) { return outstandingSupply; }
    function balanceOf(address holder) external view override returns(uint256) { return IERC20(token).balanceOf(holder); }
    function constituents() external view override returns(IIndexFiFactory.Constituent[] memory) { return basket; }
    function initialLiquidityLocked() external pure returns(bool) { return true; }
    /// Called by the factory in the same transaction as launch/finalize. Actual acquired value sets initial issued supply.
    function acquire(uint256 seed, uint256 liquidity, uint256 minCreator, uint256[] calldata minimums, uint256 deadline) external onlyFactory nonReentrant returns(uint256 p, uint256 c) {
        if(seedValue!=0||seed<100*settlementScale||liquidity<settlementScale||block.timestamp>deadline) revert InvalidLaunch();
        uint256[] memory prices=_prices(); _checkExecutionPrices(prices); _collect(msg.sender,seed); _invest(_allocations(seed,prices,true),minimums,deadline);
        seedValue=_value(prices); p=Math.mulDiv(liquidity,1e18,settlementScale);
        if(seedValue<=p||seedValue>maxSupply||seedValue-p<minCreator) revert Slippage();
        poolShares=p; liquidityQuote=liquidity; c=seedValue-p;
        phase=OpenFourTypes.Phase.MigratePending;
    }
    /// Bind predicted token during native factory callback, before token deployment.
    function bindNativeToken(address predicted) external {
        if(msg.sender!=IFlapVaultConfig(factory).vaultFactory()||token!=address(0)||predicted==address(0)||phase!=OpenFourTypes.Phase.MigratePending) revert InvalidLaunch();
        token=predicted;
    }
    function description() external view returns(string memory) { return "IndexFi: 10 bps deposit and redemption fees to creator. Initial LP burned; reserved shares held in vault-owned Token Dock. Quote tax proceeds above accounted collateral payable to creator."; }
    function vaultUISchema() external pure returns(VaultUISchema memory s){
        s.vaultType="IndexFi"; s.description="NAV-backed portfolio; use IndexFi custom UI for deposits and redemptions.";
        s.methods=new VaultMethodSchema[](1);
        s.methods[0].name="nav"; s.methods[0].description="NAV per backed share"; s.methods[0].outputs=new FieldDescriptor[](1); s.methods[0].outputs[0]=FieldDescriptor("nav","uint256","USD per share",18);
    }
    function taxToken() external view returns(address){return token;}
    function lpToken() external view returns(address){return pair;}
    /// Permissionless forwarding of quote surplus, never accounted collateral. Donations also go to creator.
    function forwardTaxRevenue() external nonReentrant active returns(uint256 amount){
        IERC20 cash=IERC20(settlementToken); amount=cash.balanceOf(address(this))-collateralBalance[settlementToken];
        if(amount!=0) cash.safeTransfer(creator,amount);
    }
    /// Portal has approved exactly the native distribution; pull it, never accept a spoofed callback.
    function initializeDistribution(address token_,uint256 amount,bytes calldata data,bytes32) external override {
        if(msg.sender!=IFlapVaultConfig(factory).portal()||phase!=OpenFourTypes.Phase.MigratePending||receivedDistribution||token_==address(0)||token_!=token||amount!=maxSupply-poolShares||data.length!=0) revert InvalidLaunch();
        for(uint256 i;i<basket.length;++i) if(basket[i].token==token_) revert InvalidLaunch();
        receivedDistribution=true; token=token_;
        uint256 beforeLocal=IERC20(token).balanceOf(address(this)); IERC20(token).safeTransferFrom(msg.sender,address(this),amount);
        if(IERC20(token).balanceOf(address(this))!=beforeLocal+amount) revert BalanceMismatch();
        emit FlapDistributionInitialized(token,amount);
    }
    function finalize(address token_,address pair_,uint256 seed) external onlyFactory nonReentrant returns(uint256 creatorShares) {
        if(!receivedDistribution||funded||token_!=token||pair_==address(0)||IERC20Metadata(token).decimals()!=18||IERC20(token).totalSupply()!=maxSupply) revert InvalidLaunch();
        if(IFlapV2Factory(IFlapV2Router(router).factory()).getPair(token,settlementToken)!=pair_) revert InvalidLaunch();
        IFlapV2Pair p=IFlapV2Pair(pair_); address a=p.token0(); address b=p.token1();
        if(!((a==token&&b==settlementToken)||(b==token&&a==settlementToken))) revert InvalidLaunch();
        (uint112 r0,uint112 r1,)=p.getReserves();
        if((a==token?r0:r1)!=poolShares||(a==token?r1:r0)!=liquidityQuote||IERC20(token).balanceOf(pair_)!=poolShares||IERC20(settlementToken).balanceOf(pair_)!=liquidityQuote) revert BalanceMismatch();
        uint256 lpSupply=IERC20(pair_).totalSupply();
        if(lpSupply==0||IERC20(pair_).balanceOf(address(0xdead))+IERC20(pair_).balanceOf(address(0))!=lpSupply) revert InvalidLaunch();
        if(IERC20(token).balanceOf(address(this))<maxSupply-poolShares) revert BalanceMismatch();
        creatorShares=seedValue-poolShares; inventory=maxSupply-seedValue; outstandingSupply=seedValue;
        if(inventory!=0) _returnToDock(inventory);
        uint256 beforeCreator=IERC20(token).balanceOf(creator); uint256 beforeLocal=IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransfer(creator,creatorShares);
        if(IERC20(token).balanceOf(creator)!=beforeCreator+creatorShares||IERC20(token).balanceOf(address(this))+creatorShares!=beforeLocal) revert BalanceMismatch();
        _assertSupply(); pair=pair_; funded=true; phase=OpenFourTypes.Phase.Migrated;
        emit Seeded(seed,liquidityQuote,outstandingSupply,creatorShares); emit LiquidityMigrated(pair_,creator);
    }
    function _prices() private view returns (uint256[] memory p) {
        p = new uint256[](basket.length);
        for (uint256 i; i < p.length; ++i) { p[i] = oracle.price18(basket[i].token); if (p[i] == 0) revert InvalidAmount(); }
    }
    /// Conservative executable bid/ask probe. Not a manipulation-resistant TWAP; see validation notes.
    function _checkExecutionPrices(uint256[] memory p) private view {
        for(uint256 i;i<p.length;++i){address a=basket[i].token;if(a==settlementToken)continue;
            uint256 q=adapter.quoteBuy(a,settlementScale);
            uint256 expected=1e18;
            uint256 buyValue=Math.mulDiv(q,p[i],units[i]);
            uint256 probe=Math.mulDiv(units[i],1e18,p[i]);
            if(probe==0) revert Slippage();
            uint256 sellValue=Math.mulDiv(adapter.quoteSell(a,probe),1e18,settlementScale);
            if(buyValue<expected*95/100||buyValue>expected*105/100||sellValue<expected*95/100||sellValue>expected*105/100) revert Slippage();
        }
    }
    function _value(uint256[] memory p) private view returns (uint256 v) {
        for (uint256 i; i < p.length; ++i) v += Math.mulDiv(collateralBalance[basket[i].token], p[i], units[i]);
    }
    function collateralValue() external view override returns (uint256) { return _value(_prices()); }
    function nav() external view override returns (uint256) {
        if (outstandingSupply == 0) revert Inactive();
        return Math.mulDiv(_value(_prices()), 1e18, outstandingSupply);
    }
    function _collect(address payer, uint256 amount) private {
        IERC20 cash = IERC20(settlementToken); uint256 b = cash.balanceOf(address(this));
        cash.safeTransferFrom(payer, address(this), amount);
        if (cash.balanceOf(address(this)) != b + amount) revert BalanceMismatch();
    }
    function _allocations(uint256 input, uint256[] memory prices, bool initial) private view returns (uint256[] memory a) {
        a = new uint256[](basket.length); uint256[] memory weights = new uint256[](basket.length);
        uint256 denominator; uint256 last;
        for (uint256 i; i < weights.length; ++i) {
            weights[i] = initial ? basket[i].weightBps : Math.mulDiv(collateralBalance[basket[i].token], prices[i], units[i]);
            denominator += weights[i]; if (weights[i] != 0) last = i;
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
            address a = basket[i].token; uint256 amount = inputs[i]; uint256 received;
            if (a == settlementToken) { received = amount; }
            else if (amount != 0) {
                uint256 beforeCash = cash.balanceOf(address(this)); uint256 beforeAsset = IERC20(a).balanceOf(address(this));
                cash.forceApprove(address(adapter), amount); adapter.buy(a, amount, minimums[i], deadline); cash.forceApprove(address(adapter), 0);
                if (cash.balanceOf(address(this)) + amount != beforeCash) revert BalanceMismatch();
                received = IERC20(a).balanceOf(address(this)) - beforeAsset;
                if (received == 0) revert Slippage();
            }
            if (received < minimums[i]) revert Slippage();
            collateralBalance[a] += received;
        }
    }
    function _assertSupply() private view {
        if (IERC20(token).totalSupply() != maxSupply || outstandingSupply + inventory != maxSupply
            || ITokenDock(dockRouter()).balanceOf(token,address(this)) < inventory) revert BalanceMismatch();
    }
    function _returnToDock(uint256 amount) private {
        IERC20 shares = IERC20(token); ITokenDock dock = ITokenDock(dockRouter());
        uint256 beforeCredit = dock.balanceOf(token,address(this)); uint256 beforeLocal = shares.balanceOf(address(this));
        shares.forceApprove(address(dock),amount); dock.deposit(token,amount); shares.forceApprove(address(dock),0);
        if (dock.balanceOf(token,address(this)) != beforeCredit+amount || shares.balanceOf(address(this))+amount != beforeLocal) revert BalanceMismatch();
    }
    function _release(address to, uint256 shares) private {
        if (shares == 0 || shares > inventory) revert InsufficientInventory();
        _assertSupply(); ITokenDock dock = ITokenDock(dockRouter());
        uint256 beforeCredit = dock.balanceOf(token,address(this)); uint256 beforeRecipient = IERC20(token).balanceOf(to);
        dock.withdraw(token,shares,to);
        if (dock.balanceOf(token,address(this))+shares != beforeCredit || IERC20(token).balanceOf(to) != beforeRecipient+shares) revert BalanceMismatch();
        inventory -= shares; outstandingSupply += shares; _assertSupply();
    }
    function _fee(uint256 amount) private pure returns (uint256) { return Math.mulDiv(amount, FEE_BPS, BPS); }
    function previewDeposit(uint256 input) public view override active returns (uint256 shares, uint256[] memory outputs) {
        if (input < settlementScale) revert InvalidAmount();
        uint256[] memory p = _prices(); _checkExecutionPrices(p); uint256 v = _value(p);
        uint256[] memory a = _allocations(input - _fee(input), p, false); outputs = new uint256[](a.length);
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
    function _postPrices(bytes[] calldata payloads,bytes[] calldata signatures) private {
        if(payloads.length!=signatures.length||payloads.length>4) revert InvalidAmount();
        for(uint256 i;i<payloads.length;++i) oracle.updatePrices(payloads[i],signatures[i]);
    }
    function quoteDepositWithPrices(bytes[] calldata payloads,bytes[] calldata signatures,uint256 input) external nonReentrant returns(uint256,uint256[] memory){
        _postPrices(payloads,signatures); return previewDeposit(input);
    }
    function depositWithPrices(bytes[] calldata payloads,bytes[] calldata signatures,uint256 input,uint256 minShares,uint256[] calldata minimums,uint256 deadline) external active nonReentrant returns(uint256){
        _postPrices(payloads,signatures); return _deposit(input,minShares,minimums,deadline);
    }
    function deposit(uint256 input,uint256 minShares,uint256[] calldata minimums,uint256 deadline) external override active nonReentrant returns(uint256){
        return _deposit(input,minShares,minimums,deadline);
    }
    function _deposit(uint256 input, uint256 minShares, uint256[] calldata minimums, uint256 deadline) private returns (uint256 shares) {
        if (input < settlementScale || block.timestamp > deadline) revert InvalidAmount();
        uint256[] memory p = _prices(); _checkExecutionPrices(p); uint256 v = _value(p);
        if (v == 0) revert InvalidAmount();
        uint256 fee = _fee(input); uint256[] memory allocations = _allocations(input - fee, p, false);
        _collect(msg.sender, input); if (fee != 0) IERC20(settlementToken).safeTransfer(creator, fee);
        _invest(allocations, minimums, deadline);
        // Difference of valuations with the SAME oracle vector. Rounds issuance down.
        shares = Math.mulDiv(_value(p) - v, outstandingSupply, v);
        if (shares < minShares) revert Slippage();
        _release(msg.sender, shares); emit Deposited(msg.sender, input, shares, fee);
    }
    function _checkRedemption(address holder, uint256 shares) private view {
        if (holder == address(this) || holder == pair || holder == dockRouter() || shares == 0 || shares > outstandingSupply || IERC20(token).balanceOf(holder) < shares) revert InvalidAmount();
    }
    function _previewRedeemAssets(address holder,uint256 shares) private view returns(uint256[] memory amounts,uint256[] memory expected,uint256 gross){
        _checkRedemption(holder,shares); amounts=new uint256[](basket.length); expected=new uint256[](basket.length);
        for(uint256 i;i<basket.length;++i){address a=basket[i].token;uint256 q=Math.mulDiv(collateralBalance[a],shares,outstandingSupply);amounts[i]=q;expected[i]=a==settlementToken?q:(q==0?0:adapter.quoteSell(a,q));gross+=expected[i];}
    }
    function previewRedeem(address holder,uint256 shares) external view override active returns(uint256 gross,uint256 fee,uint256 net){
        (,,gross)=_previewRedeemAssets(holder,shares); fee=_fee(gross);net=gross-fee;
    }
    function previewRedeemAssets(address holder,uint256 shares) external view override active returns(uint256[] memory assetAmounts,uint256[] memory expectedUSDT){
        (assetAmounts,expectedUSDT,)=_previewRedeemAssets(holder,shares);
    }
    function redeem(uint256 shares,uint256 minNet,uint256[] calldata minimums,uint256 deadline) external override active nonReentrant returns(uint256,uint256){
        return _redeem(shares,minNet,deadline,minimums);
    }
    function redeemWithPrices(bytes[] calldata payloads,bytes[] calldata signatures,uint256 shares,uint256 minNet,uint256[] calldata minimums,uint256 deadline) external active nonReentrant returns(uint256,uint256){
        _postPrices(payloads,signatures);return _redeem(shares,minNet,deadline,minimums);
    }
    function _redeem(uint256 shares,uint256 minNet,uint256 deadline,uint256[] calldata minimums) private returns(uint256 net,uint256 fee){
        if (block.timestamp > deadline || minimums.length!=basket.length) revert InvalidAmount(); _checkRedemption(msg.sender, shares);
        uint256 supply=_takeShares(shares);
        IERC20 cash = IERC20(settlementToken); uint256 gross;
        for (uint256 i; i < basket.length; ++i) {
            address a = basket[i].token; uint256 q = Math.mulDiv(collateralBalance[a], shares, supply);
            collateralBalance[a] -= q;
            if (a == settlementToken) {if(q<minimums[i]) revert Slippage(); gross += q;}
            else if (q != 0) {
                uint256 beforeCash = cash.balanceOf(address(this)); uint256 beforeAsset = IERC20(a).balanceOf(address(this));
                IERC20(a).forceApprove(address(adapter), q); uint256 minLeg=minimums[i]; adapter.sell(a, q, minLeg, deadline); IERC20(a).forceApprove(address(adapter), 0);
                if (IERC20(a).balanceOf(address(this)) + q != beforeAsset) revert BalanceMismatch();
                uint256 received=cash.balanceOf(address(this))-beforeCash; if(received<minLeg) revert Slippage(); gross += received;
            } else if(minimums[i]!=0) revert Slippage();
        }
        fee = _fee(gross); net = gross - fee;
        if (gross == 0 || net < minNet) revert Slippage();
        if (fee != 0) cash.safeTransfer(creator, fee); cash.safeTransfer(msg.sender, net);
        if (outstandingSupply == 0) { closed = true; emit VaultClosed(); }
        emit Redeemed(msg.sender, shares, gross, fee, net);
    }
    function _takeShares(uint256 shares) private returns(uint256 supply){
        _assertSupply(); supply=outstandingSupply; IERC20 share=IERC20(token);
        uint256 old=share.balanceOf(address(this)); uint256 oldHolder=share.balanceOf(msg.sender);
        share.safeTransferFrom(msg.sender,address(this),shares);
        if(share.balanceOf(address(this))!=old+shares||share.balanceOf(msg.sender)+shares!=oldHolder) revert BalanceMismatch();
        _returnToDock(shares); outstandingSupply-=shares; inventory+=shares; _assertSupply();
    }
    function previewRedeemInKind(address holder,uint256 shares) external view override active returns(uint256[] memory grossAmounts,uint256[] memory creatorFeeAmounts,uint256[] memory netAmounts){
        _checkRedemption(holder,shares); uint256 n=basket.length;
        grossAmounts=new uint256[](n);creatorFeeAmounts=new uint256[](n);netAmounts=new uint256[](n);
        for(uint256 i;i<n;++i){uint256 q=Math.mulDiv(collateralBalance[basket[i].token],shares,outstandingSupply);grossAmounts[i]=q;creatorFeeAmounts[i]=_fee(q);netAmounts[i]=q-creatorFeeAmounts[i];}
    }
    function redeemInKind(uint256 shares,uint256[] calldata minimums,uint256 deadline) external override active nonReentrant returns(uint256[] memory,uint256[] memory){
        return _redeemInKind(shares,minimums,deadline);
    }
    function redeemInKindWithPrices(bytes[] calldata payloads,bytes[] calldata signatures,uint256 shares,uint256[] calldata minimums,uint256 deadline) external active nonReentrant returns(uint256[] memory,uint256[] memory){
        _postPrices(payloads,signatures);return _redeemInKind(shares,minimums,deadline);
    }
    function _redeemInKind(uint256 shares,uint256[] calldata minimums,uint256 deadline) private returns(uint256[] memory netAmounts,uint256[] memory fees){
        if(block.timestamp>deadline||minimums.length!=basket.length) revert InvalidAmount(); _checkRedemption(msg.sender,shares);
        uint256 supply=_takeShares(shares);
        netAmounts=new uint256[](basket.length);fees=new uint256[](basket.length);bool nonzero;
        for(uint256 i;i<basket.length;++i){address a=basket[i].token;uint256 q=Math.mulDiv(collateralBalance[a],shares,supply);collateralBalance[a]-=q;
            fees[i]=_fee(q);netAmounts[i]=q-fees[i];if(netAmounts[i]<minimums[i]) revert Slippage();
            if(q!=0){nonzero=true; IERC20 asset=IERC20(a); _transferExact(asset,creator,fees[i]);_transferExact(asset,msg.sender,netAmounts[i]);}
            emit RedeemedAsset(msg.sender,a,q,fees[i],netAmounts[i]);
        }
        if(!nonzero) revert Slippage();if(outstandingSupply==0){closed=true;emit VaultClosed();}emit RedeemedInKind(msg.sender,shares);
    }
    function _transferExact(IERC20 asset,address to,uint256 amount) private {
        if(amount==0)return;
        uint256 beforeVault=asset.balanceOf(address(this));uint256 beforeTo=asset.balanceOf(to);
        asset.safeTransfer(to,amount);
        if(asset.balanceOf(address(this))+amount!=beforeVault||asset.balanceOf(to)!=beforeTo+amount) revert BalanceMismatch();
    }
}
