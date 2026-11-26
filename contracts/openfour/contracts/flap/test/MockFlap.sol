// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC20,SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {MockV2Factory,MockV2Pair} from "../../helpers/MockV2.sol";
import {IPortal,IPortalTypes,ILauncherFactory,LauncherRecord,Distribution,DistributionTarget,IStrategy,ITokenDock,IDirectLaunchVaultFactory} from "../FlapSpec.sol";
/// Local fixture only. Deliberately NOT Flap production bytecode.
contract MockFlapToken is ERC20 {
    address public immutable portal;
    address public pair;
    uint16 public immutable buyTax;
    uint16 public immutable sellTax;
    uint16 public ordinaryTax;
    bool public trading; bool public expired; uint256 public taxEnds; uint32 public immutable duration;
    constructor(string memory n,string memory s,uint256 cap,uint16 buy,uint16 sell,uint32 duration_) ERC20(n,s){portal=msg.sender;buyTax=buy;sellTax=sell;duration=duration_;_mint(msg.sender,cap);}
    function configure(address p,uint16 ordinary) external {require(msg.sender==portal);pair=p;ordinaryTax=ordinary;trading=true;taxEnds=block.timestamp+duration;}
    function setOrdinaryTax(uint16 rate) external {require(msg.sender==portal);ordinaryTax=rate;}
    function _transfer(address from,address to,uint256 amount) internal override {
        if(trading&&to==pair&&block.timestamp>=taxEnds) expired=true;
        uint16 tax=trading?(from==pair?(expired?0:buyTax):to==pair?(expired?0:sellTax):ordinaryTax):0;
        uint256 fee=Math.mulDiv(amount,tax,10000);
        if(fee!=0) super._transfer(from,address(0xdead),fee);
        super._transfer(from,to,amount-fee);
    }
}
contract MockFlapDock is ITokenDock {
    using SafeERC20 for IERC20;
    mapping(address=>mapping(address=>uint256)) private credits;
    bool public rejectDeposit; bool public rejectWithdraw;
    function setReject(bool d,bool w) external {rejectDeposit=d;rejectWithdraw=w;}
    function balanceOf(address token,address owner) external view returns(uint256){return credits[token][owner];}
    function deposit(address token,uint256 amount) external {
        require(!rejectDeposit,"Dock: rejected deposit");uint256 beforeBalance=IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender,address(this),amount);
        require(IERC20(token).balanceOf(address(this))==beforeBalance+amount,"Dock: delta"); credits[token][msg.sender]+=amount;
    }
    function withdraw(address token,uint256 amount,address to) external {
        require(!rejectWithdraw,"Dock: rejected withdrawal"); credits[token][msg.sender]-=amount; IERC20(token).safeTransfer(to,amount);
    }
}
contract MockFlapPortal is IPortal {
    using SafeERC20 for IERC20;
    struct FactoryConfig {bool enabled;uint16 multiplierBps;}
    mapping(address=>FactoryConfig) public configs;
    mapping(address=>LauncherRecord) private records;
    mapping(address=>bool) public launched;
    mapping(bytes32=>bool) public usedSalt;
    mapping(address=>address) public nativeVault;
    MockV2Factory public immutable dex;
    address public immutable owner;
    bool public badLP; uint16 public ordinaryTax; bool public failLaunch;
    uint256 public launchCount;
    constructor(address d){dex=MockV2Factory(d);owner=msg.sender;}
    function configure(bool badLP_,uint16 ordinaryTax_,bool failLaunch_) external {require(msg.sender==owner);badLP=badLP_;ordinaryTax=ordinaryTax_;failLaunch=failLaunch_;}
    function setOrdinaryTax(address token,uint16 tax) external {require(msg.sender==owner);MockFlapToken(token).setOrdinaryTax(tax);}
    function setLauncherFactoryMultiplier(address f,uint16 m,bool e) external {require(msg.sender==owner&&m<=10000);configs[f]=FactoryConfig(e,m);}
    function launcherFactoryMultiplier(address f) external view returns(bool,uint16){FactoryConfig memory c=configs[f];return(c.enabled,c.multiplierBps);}
    function newLauncher(address f,bytes calldata data) external payable returns(address l){require(configs[f].enabled,"Portal: disabled");l=ILauncherFactory(f).newLauncher{value:msg.value}(msg.sender,data);require(records[l].launcherFactory==address(0));records[l]=LauncherRecord(f);}
    function getLauncher(address l) external view returns(LauncherRecord memory){return records[l];}
    function launchTaxTokenV2(IPortalTypes.CreateTaxTokenParams calldata p,Distribution calldata distribution,IPortalTypes.CreatorBuyParams calldata cb) external payable returns(address token,address pool){
        require(!failLaunch,"Portal: launch rejected");address f=records[msg.sender].launcherFactory; require(configs[f].enabled&&!launched[msg.sender]&&!usedSalt[p.salt],"Portal: unauthorized");
        require(msg.value==0&&(p.buyTaxRate>=100||p.sellTaxRate>=100)&&p.taxDuration>=p.antiFarmerDuration&&p.creatorBuyQuote==0&&cb.minOutputAmount==0,"Portal: params");
        require(p.feeConfigs.length==1&&p.feeConfigs[0].feeType==IPortalTypes.FeeSlotType.VAULT&&p.feeConfigs[0].bps==10000,"Portal: fee");
        require(distribution.target==DistributionTarget.VAULT&&distribution.amount==p.totalSupply-p.poolToken,"Portal: distribution");
        uint256 floor=Math.mulDiv(uint256(750e18)*configs[f].multiplierBps,p.totalSupply,10000*p.poolToken,Math.Rounding.Up);
        // Fixture quote has 6 decimals and $1 price.
        require(Math.mulDiv(p.poolQuote,1e18,10**uint256(IERC20Metadata(p.quoteToken).decimals()))>=floor,"Portal: floor");
        launched[msg.sender]=true;usedSalt[p.salt]=true;++launchCount;
        bytes32 initHash=keccak256(abi.encodePacked(type(MockFlapToken).creationCode,abi.encode(p.name,p.symbol,p.totalSupply,p.buyTaxRate,p.sellTaxRate,p.taxDuration)));
        token=address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff),address(this),p.salt,initHash)))));
        IPortalTypes.FeeConfigVault memory slot=abi.decode(p.feeConfigs[0].configData,(IPortalTypes.FeeConfigVault));
        address v=IDirectLaunchVaultFactory(slot.vaultFactory).newVault(token,msg.sender,0,abi.encode(p,distribution));nativeVault[token]=v;
        MockFlapToken t=new MockFlapToken{salt:p.salt}(p.name,p.symbol,p.totalSupply,p.buyTaxRate,p.sellTaxRate,p.taxDuration);require(address(t)==token);
        pool=dex.createPair(token,p.quoteToken); IERC20(p.quoteToken).safeTransferFrom(msg.sender,pool,p.poolQuote); t.transfer(pool,p.poolToken);
        MockV2Pair(pool).mint(badLP?msg.sender:address(0xdead));
        t.approve(v,distribution.amount); IStrategy(v).initializeDistribution(token,distribution.amount,distribution.configData,p.salt);
        require(t.balanceOf(address(this))==0,"Portal: remainder"); t.configure(pool,ordinaryTax);
    }
}
