// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {IIndexFiFactory} from "../interfaces/IIndexFi.sol";
import {IIndexFiAdapter} from "../interfaces/IIndexFiAdapter.sol";
import {IIndexFiOracle} from "../interfaces/IIndexFiOracle.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IndexFiFlapVaultFactory} from "./IndexFiFlapVaultFactory.sol";
import {IPortal, IPortalTypes, LauncherDataSchema, FieldDescriptor, Distribution, DistributionTarget} from "./FlapSpec.sol";
import {LauncherFactoryBase} from "./LauncherFactoryBase.sol";
import {IndexFiFlapLauncher} from "./IndexFiFlapLauncher.sol";
import {IndexFiFlapVault} from "./IndexFiFlapVault.sol";
/// Direct creator-funded launcher and V5-compatible portfolio directory.
contract IndexFiFlapFactory is IIndexFiFactory, LauncherFactoryBase, ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public immutable override settlementToken;
    uint256 public immutable override minimumSeed;
    uint256 public immutable minimumLiquidity;
    uint256 public immutable maxSupply;
    IPortal public immutable portal;
    address public immutable dockRouter;
    address public immutable guardian;
    IIndexFiAdapter public immutable adapter;
    IIndexFiOracle public immutable oracle;
    address public immutable router;
    address public immutable vaultImplementation;
    IndexFiFlapVaultFactory public immutable vaultFactory;
    uint16 public immutable buyTaxRate; uint16 public immutable sellTaxRate;
    uint32 public immutable taxDuration; uint32 public immutable antiFarmerDuration;
    uint8 public immutable dexId;
    address[] private vaults;
    mapping(uint256 => bool) public override usedRequestIds;
    mapping(address => bool) public override isVault;
    error InvalidRequest();
    error InvalidPrices();
    bytes32 private pending;
    address private pendingLauncher;
    event FlapLauncherRegistered(address indexed creator,address indexed launcher);
    struct Config { address portal; address dock; address guardian; address adapter; address oracle; address router; uint256 cap; uint16 buyTax; uint16 sellTax; uint32 taxDuration; uint32 antiFarmerDuration; uint8 dexId; address vaultImplementation; }
    constructor(Config memory c) {
        require(c.portal.code.length!=0&&c.dock.code.length!=0&&c.adapter.code.length!=0&&c.oracle.code.length!=0&&c.router.code.length!=0&&c.guardian!=address(0)&&c.cap>=100e18&&c.cap<=1e33,"Flap: config");
        require((c.buyTax>=100||c.sellTax>=100)&&c.buyTax<=1000&&c.sellTax<=1000&&c.antiFarmerDuration<=c.taxDuration&&c.dexId==0,"Flap: tax");
        // Real networks cannot accidentally use a fixture Portal or Dock.
        if(block.chainid!=31337){require(block.chainid==97||block.chainid==56,"Flap: chain");
            require(c.portal==0x000042108465206185A077Edc3F3fd2b49060000&&c.dock==0x000048E888aBf09f690a952E1b386b2D031a0000,"Flap: official addresses");
            require(c.guardian==(block.chainid==56?0x9e27098dcD8844bcc6287a557E0b4D09C86B8a4b:0x00004d58290854c5E9880F4b5B1993c6Ad8b0000),"Flap: guardian");}
        portal=IPortal(c.portal); dockRouter=c.dock; guardian=c.guardian; adapter=IIndexFiAdapter(c.adapter); oracle=IIndexFiOracle(c.oracle); router=c.router;
        maxSupply=c.cap; buyTaxRate=c.buyTax; sellTaxRate=c.sellTax; taxDuration=c.taxDuration; antiFarmerDuration=c.antiFarmerDuration; dexId=c.dexId;
        settlementToken=adapter.settlementToken(); require(oracle.settlementToken()==settlementToken,"Flap: settlement");
        uint8 d=IERC20Metadata(settlementToken).decimals(); require(d<=18,"Flap: decimals"); minimumLiquidity=10**uint256(d); minimumSeed=100*minimumLiquidity;
        vaultFactory=new IndexFiFlapVaultFactory(c.portal,c.guardian,settlementToken,c.vaultImplementation); vaultImplementation=vaultFactory.implementation();
        if(block.chainid==97) require(settlementToken==0x190C989D5665a0e404B444b53CAE9AbCfb600157&&d==18,"Flap: testnet USD");
    }
    function _getHub() internal view override returns(address){return address(portal);}
    function _getGuardian() internal view override returns(address){return guardian;}
    function upgradeVaultImplementation(address) external override onlyGuardian { revert("Flap: immutable launchers"); }
    function launcherDataSchema() external pure override returns(LauncherDataSchema memory schema){
        schema.description="IndexFi atomic launch: use createVault; the Portal registration is made internally.";
        schema.fields=new FieldDescriptor[](5); schema.fields[0]=FieldDescriptor("creator","address","Creator bound to pending IndexFi launch",0);
        schema.fields[1]=FieldDescriptor("name","string","Portfolio token name",0); schema.fields[2]=FieldDescriptor("symbol","string","Portfolio token symbol",0);
        schema.fields[3]=FieldDescriptor("targetRaise","uint256","Quote liquidity in 18-decimal units",18); schema.fields[4]=FieldDescriptor("poolRatio","uint256","Pool share of total supply (1e18 = 100%)",18);
    }
    function _newLauncher(address caller,bytes calldata data) internal override returns(address l){
        require(msg.value==0&&caller==address(this)&&pending!=bytes32(0)&&pending==keccak256(data)&&pendingLauncher==address(0),"Flap: use createVault");
        (address creator,string memory name,string memory symbol,uint256 targetRaise,uint256 poolRatio)=abi.decode(data,(address,string,string,uint256,uint256));
        l=address(new IndexFiFlapLauncher(portal,creator,settlementToken,name,symbol,targetRaise,poolRatio)); pendingLauncher=l;
        emit FlapLauncherRegistered(creator,l);
    }
    function vaultCount() external view returns(uint256){return vaults.length;}
    function vaultAt(uint256 index) external view returns(address){return vaults[index];}
    function previewCreate(Basket calldata basket, uint256 seedUSDT) public view returns (uint256[] memory out) {
        uint256 n = basket.constituents.length;
        require(seedUSDT >= minimumSeed && n != 0 && n <= 32, "IndexFi: seed or count");
        require(bytes(basket.name).length != 0 && bytes(basket.symbol).length != 0, "IndexFi: identity");
        out = new uint256[](n); uint256 weights; uint256 left = seedUSDT;
        for (uint256 i; i < n; ++i) {
            Constituent calldata a = basket.constituents[i];
            require(a.weightBps != 0 && adapter.supportsAsset(a.token) && oracle.supportsAsset(a.token), "IndexFi: asset");
            for (uint256 j; j < i; ++j) require(basket.constituents[j].token != a.token, "IndexFi: duplicate");
            weights += a.weightBps; require(weights <= 10000, "IndexFi: weights");
            uint256 input = i+1 == n ? left : Math.mulDiv(seedUSDT,a.weightBps,10000); left -= input;
            out[i] = a.token == settlementToken ? input : adapter.quoteBuy(a.token,input); require(out[i] != 0,"IndexFi: zero leg");
        }
        require(weights == 10000,"IndexFi: weights");
    }

    /// Provider-specific opaque request encoding; NOT OpenFour Core's signed CreateTokenArgs.
    function buildCreateArgs(uint256 requestId,address creator,Basket calldata basket,uint256 seedUSDT,uint256 liquidityUSDT,uint256 minCreatorShares,uint256[] calldata minimums,uint256 deadline,uint256 createFee) external view returns(bytes memory) {
        if(requestId==0||usedRequestIds[requestId]||creator==address(0)||liquidityUSDT<minimumLiquidity||minimums.length!=basket.constituents.length||createFee!=0) revert InvalidRequest();
        previewCreate(basket,seedUSDT);
        return abi.encode(address(this),block.chainid,requestId,creator,basket,seedUSDT,liquidityUSDT,minCreatorShares,minimums,deadline,createFee);
    }
    function _postPrices(bytes[] calldata payloads,bytes[] calldata signatures) private {
        if(payloads.length!=signatures.length||payloads.length>4) revert InvalidPrices();
        for(uint256 i;i<payloads.length;++i) oracle.updatePrices(payloads[i],signatures[i]);
    }
    function quoteCreateWithPrices(bytes[] calldata payloads,bytes[] calldata signatures,Basket calldata basket,uint256 seedUSDT) external nonReentrant returns(uint256[] memory){
        _postPrices(payloads,signatures); return previewCreate(basket,seedUSDT);
    }
    function createVaultWithPrices(bytes[] calldata payloads,bytes[] calldata signatures,uint256 requestId,Basket calldata basket,uint256 seedUSDT,uint256 liquidityUSDT,uint256 minCreatorShares,uint256[] calldata minimums,uint256 deadline,bytes calldata authorization) external payable nonReentrant returns(address,uint256){
        _postPrices(payloads,signatures); return _createVault(requestId,basket,seedUSDT,liquidityUSDT,minCreatorShares,minimums,deadline,authorization);
    }
    /// Same current financial signature. Flap authorization bytes encode the caller-mined vanity salt (bytes32), not a Core signature.
    /// No native payment / salt locking: ERC-20 quote requires zero msg.value. Use a fresh salt for each launch.
    function createVault(uint256 requestId,Basket calldata basket,uint256 seedUSDT,uint256 liquidityUSDT,uint256 minCreatorShares,
        uint256[] calldata minimums,uint256 deadline,bytes calldata launchAuthorization) external payable nonReentrant returns(address vault,uint256 seedShares){
        return _createVault(requestId,basket,seedUSDT,liquidityUSDT,minCreatorShares,minimums,deadline,launchAuthorization);
    }
    function _createVault(uint256 requestId,Basket calldata basket,uint256 seedUSDT,uint256 liquidityUSDT,uint256 minCreatorShares,uint256[] calldata minimums,uint256 deadline,bytes calldata launchAuthorization) private returns(address vault,uint256 seedShares){
        if(requestId==0||usedRequestIds[requestId]) revert InvalidRequest();
        usedRequestIds[requestId]=true;
        require(msg.value==0&&block.timestamp<=deadline&&liquidityUSDT>=minimumLiquidity&&minimums.length==basket.constituents.length,"Flap: funding");
        require(launchAuthorization.length==32,"Flap: encode mined salt");
        bytes32 salt=abi.decode(launchAuthorization,(bytes32));
        (bool enabled,uint16 multiplier)=portal.launcherFactoryMultiplier(address(this)); require(enabled&&multiplier<=10000,"Flap: factory configuration");
        previewCreate(basket,seedUSDT);
        uint256 targetRaise=Math.mulDiv(liquidityUSDT,1e18,minimumLiquidity);
        bytes memory data=abi.encode(msg.sender,basket.name,basket.symbol,targetRaise,Math.mulDiv(targetRaise,1e18,maxSupply)); pending=keccak256(data);
        address l=portal.newLauncher(address(this),data); require(l==pendingLauncher&&l!=address(0)&&portal.getLauncher(l).launcherFactory==address(this),"Flap: registration");
        pending=bytes32(0); pendingLauncher=address(0);
        vault=vaultFactory.prepare(); IndexFiFlapVault v=IndexFiFlapVault(vault);
        v.initialize(msg.sender,basket,adapter,oracle,router,maxSupply,l);
        IERC20 cash=IERC20(settlementToken); uint256 beforeCash=cash.balanceOf(address(this)); uint256 total=seedUSDT+liquidityUSDT;
        cash.safeTransferFrom(msg.sender,address(this),total); require(cash.balanceOf(address(this))==beforeCash+total,"Flap: transfer");
        cash.forceApprove(vault,seedUSDT); (uint256 poolShares,uint256 creatorShares)=v.acquire(seedUSDT,liquidityUSDT,minCreatorShares,minimums,deadline); cash.forceApprove(vault,0);
        uint256 beforeLauncher=cash.balanceOf(l); cash.safeTransfer(l,liquidityUSDT); require(cash.balanceOf(l)==beforeLauncher+liquidityUSDT&&cash.balanceOf(address(this))==beforeCash,"Flap: funding mismatch");
        IPortalTypes.CreateTaxTokenParams memory p;
        p.name=basket.name; p.symbol=basket.symbol; p.meta=basket.metadataURI; p.totalSupply=maxSupply; p.salt=salt; p.quoteToken=settlementToken; p.dexId=dexId;
        p.poolQuote=liquidityUSDT; p.poolToken=poolShares; p.buyTaxRate=buyTaxRate; p.sellTaxRate=sellTaxRate; p.taxDuration=taxDuration; p.antiFarmerDuration=antiFarmerDuration;
        p.feeConfigs=new IPortalTypes.FeeConfig[](1); p.feeConfigs[0]=IPortalTypes.FeeConfig(IPortalTypes.FeeSlotType.VAULT,10000,abi.encode(IPortalTypes.FeeConfigVault(address(vaultFactory),bytes("")))); p.exemptAddrs=new address[](0); p.extensionID=keccak256("flap.extension.creator.v1"); p.extensionData=abi.encode(msg.sender);
        Distribution memory distribution=Distribution(DistributionTarget.VAULT,address(0),uint128(maxSupply-poolShares),"");
        vaultFactory.arm(vault,l,keccak256(abi.encode(p,distribution)));
        (address share,address pair)=IndexFiFlapLauncher(l).launch(p,vault);
        require(vaultFactory.lastVault()==vault,"Flap: native vault");
        seedShares=v.finalize(share,pair,seedUSDT); require(seedShares==creatorShares,"Flap: shares");
        vaults.push(vault); isVault[vault]=true; emit VaultCreated(msg.sender,vault,requestId,seedUSDT); emit PortfolioLaunched(vault,share,pair,seedUSDT,liquidityUSDT,v.outstandingSupply());
    }
}
