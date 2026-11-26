// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {IIndexFiOracle} from "../../interfaces/IIndexFiOracle.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
/// Test-only ECDSA payload format, NOT Atlas wire format. No production deployment.
contract MockSignedFlapOracle is IIndexFiOracle {
    address public immutable settlementToken;
    address public immutable owner;
    mapping(address=>bool) public allowed;
    mapping(address=>uint256) public prices;
    mapping(address=>uint256) public timestamps;
    constructor(address cash){settlementToken=cash;owner=msg.sender;}
    function allow(address asset) external {require(msg.sender==owner);allowed[asset]=true;}
    function supportsAsset(address asset) external view returns(bool){return asset==settlementToken||allowed[asset];}
    function price18(address asset) external view returns(uint256){if(asset==settlementToken)return 1e18;require(allowed[asset]&&prices[asset]!=0&&timestamps[asset]+300>=block.timestamp,"fixture: unavailable price");return prices[asset];}
    function updatePrices(bytes calldata payload,bytes calldata signature) external returns(uint256){
        bytes32 digest=ECDSA.toEthSignedMessageHash(keccak256(abi.encode(block.chainid,address(this),payload)));
        require(ECDSA.recover(digest,signature)==owner,"fixture: bad signature");
        (address asset,uint256 price,uint256 ts)=abi.decode(payload,(address,uint256,uint256));
        require(allowed[asset]&&price!=0&&ts<=block.timestamp&&ts+300>=block.timestamp&&ts>=timestamps[asset],"fixture: invalid price");
        prices[asset]=price; timestamps[asset]=ts; return 1;
    }
}
