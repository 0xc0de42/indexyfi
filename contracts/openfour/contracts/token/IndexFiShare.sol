// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {OpenFourToken} from "./OpenFourToken.sol";

contract IndexFiShare is OpenFourToken {
    function _mintInitialSupply(address, uint256 initialSupply) internal pure override {
        require(initialSupply == 0, "IndexFi: initialization cannot mint");
    }

    function issue(address holder, uint256 amount) external onlyVault { _mint(holder, amount); }
    function redeemFrom(address holder, uint256 amount) external onlyVault { _burn(holder, amount); }

    // OZ calls _transfer for both transfer and transferFrom; issuance and burns use other hooks.
    function _transfer(address, address, uint256) internal pure override {
        revert("IndexFi: nontransferable shares");
    }

    function _descriptorTag() internal pure override returns (string memory) { return "token.indexfi"; }
}
