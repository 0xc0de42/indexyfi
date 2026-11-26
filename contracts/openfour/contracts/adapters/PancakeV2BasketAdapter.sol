// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IIndexFiAdapter} from "../interfaces/IIndexFiAdapter.sol";

interface IV2SwapRouter {
    function factory() external view returns (address);
    function getAmountsOut(uint256, address[] calldata) external view returns (uint256[] memory);
    function swapExactTokensForTokens(uint256, uint256, address[] calldata, address, uint256)
        external
        returns (uint256[] memory);
}

interface IV2RouteFactory {
    function getPair(address, address) external view returns (address);
}

/// Exact-input V2 routes. Immutable allowlist; no arbitrary calldata or approvals.
contract PancakeV2BasketAdapter is IIndexFiAdapter, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Route {
        address asset;
        address[] buyPath;
    }
    address public immutable override settlementToken;
    IV2SwapRouter public immutable router;
    mapping(address => address[]) private paths;
    mapping(address => uint256) private units;

    constructor(address settlement, address router_, Route[] memory routes) {
        require(settlement.code.length != 0 && router_.code.length != 0, "Adapter: addresses");
        settlementToken = settlement;
        router = IV2SwapRouter(router_);
        address factory = router.factory();
        require(factory.code.length != 0, "Adapter: factory");
        units[settlement] = _unit(settlement);
        for (uint256 i; i < routes.length; ++i) {
            Route memory r = routes[i];
            uint256 n = r.buyPath.length;
            require(
                r.asset != settlement && units[r.asset] == 0 && n >= 2 && n <= 4 && r.buyPath[0] == settlement
                    && r.buyPath[n - 1] == r.asset,
                "Adapter: route"
            );
            units[r.asset] = _unit(r.asset);
            for (uint256 j; j < n; ++j) {
                require(r.buyPath[j].code.length != 0, "Adapter: path token");
                for (uint256 k; k < j; ++k) {
                    require(r.buyPath[k] != r.buyPath[j], "Adapter: cyclic route");
                }
                if (j > 0) {
                    require(
                        IV2RouteFactory(factory).getPair(r.buyPath[j - 1], r.buyPath[j]).code.length != 0,
                        "Adapter: no pool"
                    );
                }
                paths[r.asset].push(r.buyPath[j]);
            }
        }
    }

    function _unit(address asset) private view returns (uint256) {
        uint8 d = IERC20Metadata(asset).decimals();
        require(d <= 18, "Adapter: decimals");
        return 10 ** uint256(d);
    }

    function supportsAsset(address asset) external view override returns (bool) {
        return units[asset] != 0;
    }

    function unit(address asset) external view override returns (uint256) {
        require(units[asset] != 0, "Adapter: unsupported");
        return units[asset];
    }

    function route(address asset, bool buySide) public view returns (address[] memory p) {
        require(paths[asset].length != 0, "Adapter: unsupported");
        p = paths[asset];
        if (!buySide) {
            for (uint256 i; i < p.length / 2; ++i) {
                (p[i], p[p.length - 1 - i]) = (p[p.length - 1 - i], p[i]);
            }
        }
    }

    function _quote(address asset, uint256 input, bool buySide) private view returns (uint256) {
        if (asset == settlementToken || input == 0) return input;
        uint256[] memory amounts = router.getAmountsOut(input, route(asset, buySide));
        return amounts[amounts.length - 1];
    }

    function quoteBuy(address asset, uint256 input) external view override returns (uint256) {
        return _quote(asset, input, true);
    }

    function quoteSell(address asset, uint256 input) external view override returns (uint256) {
        return _quote(asset, input, false);
    }

    function buy(address asset, uint256 input, uint256 minimum, uint256 deadline) external override nonReentrant {
        _swap(asset, input, minimum, deadline, true);
    }

    function sell(address asset, uint256 input, uint256 minimum, uint256 deadline) external override nonReentrant {
        _swap(asset, input, minimum, deadline, false);
    }

    function _swap(address asset, uint256 input, uint256 minimum, uint256 deadline, bool buySide) private {
        require(block.timestamp <= deadline && input != 0, "Adapter: execution");
        address[] memory p = route(asset, buySide);
        IERC20 from = IERC20(p[0]);
        IERC20 to = IERC20(p[p.length - 1]);
        uint256 beforeIn = from.balanceOf(address(this));
        uint256 beforeOut = to.balanceOf(msg.sender);
        from.safeTransferFrom(msg.sender, address(this), input);
        require(from.balanceOf(address(this)) == beforeIn + input, "Adapter: transfer tax");
        from.forceApprove(address(router), input);
        router.swapExactTokensForTokens(input, minimum, p, msg.sender, deadline);
        from.forceApprove(address(router), 0);
        require(from.balanceOf(address(this)) == beforeIn, "Adapter: input mismatch");
        uint256 received = to.balanceOf(msg.sender) - beforeOut;
        require(received >= minimum && received > 0, "Adapter: output mismatch");
    }
}
