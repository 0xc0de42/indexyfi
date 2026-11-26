// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IPortal, IPortalTypes, Distribution, DistributionTarget} from "./FlapSpec.sol";
/// One use only. All economic custody remains in the immutable external vault.
contract IndexFiFlapLauncher {
    using SafeERC20 for IERC20;
    address public immutable factory;
    IPortal public immutable portal;
    address public immutable creator;
    address public immutable settlementToken;
    bool public launched;
    string private tokenName; string private tokenSymbol;
    uint256 private targetRaise; uint256 private poolRatio;
    constructor(IPortal portal_,address creator_,address quote_,string memory n,string memory s,uint256 target,uint256 ratio) {
        factory=msg.sender;portal=portal_;creator=creator_;settlementToken=quote_;tokenName=n;tokenSymbol=s;targetRaise=target;poolRatio=ratio;
    }
    function _escape(string memory s) private pure returns(string memory) {
        bytes memory input=bytes(s); bytes memory output=new bytes(input.length*6); uint256 j;
        bytes16 hexChars="0123456789abcdef";
        for(uint256 i;i<input.length;++i){bytes1 c=input[i];
            if(c==0x22||c==0x5c){output[j++]=0x5c;output[j++]=c;}
            else if(uint8(c)<32){output[j++]=0x5c;output[j++]=0x75;output[j++]=0x30;output[j++]=0x30;output[j++]=hexChars[uint8(c)>>4];output[j++]=hexChars[uint8(c)&15];}
            else output[j++]=c;
        }
        assembly { mstore(output,j) } return string(output);
    }
    function description() external view returns(string memory) {
        return string.concat('{"v":1,"name":"',_escape(tokenName),'","symbol":"',_escape(tokenSymbol),
            '","quoteToken":"',Strings.toHexString(uint160(settlementToken),20),'","targetRaise":"',Strings.toString(targetRaise),
            '","poolTokenRatio":"',Strings.toString(poolRatio),'","titleZh":"IndexFi","titleEn":"IndexFi portfolio","summaryZh":"IndexFi","summaryEn":"Direct creator-funded collateral-backed portfolio."}');
    }
    function launch(IPortalTypes.CreateTaxTokenParams calldata p,address /* vault */) external returns(address token,address pair) {
        require(msg.sender==factory&&!launched&&p.quoteToken==settlementToken&&p.creatorBuyQuote==0,"Flap: launch");
        launched=true;
        require(p.totalSupply>=p.poolToken&&p.totalSupply-p.poolToken<=type(uint128).max,"Flap: distribution");
        IERC20 cash=IERC20(settlementToken); uint256 beforeCash=cash.balanceOf(address(this));
        require(beforeCash>=p.poolQuote,"Flap: liquidity funding");
        cash.forceApprove(address(portal),p.poolQuote);
        (token,pair)=portal.launchTaxTokenV2(p,Distribution(DistributionTarget.VAULT,address(0),uint128(p.totalSupply-p.poolToken),""),IPortalTypes.CreatorBuyParams(0,""));
        cash.forceApprove(address(portal),0);
        require(cash.balanceOf(address(this))+p.poolQuote==beforeCash,"Flap: liquidity mismatch");
    }
}
