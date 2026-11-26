// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IIndexFiOracle} from "../interfaces/IIndexFiOracle.sol";

/// @title AtlasSignedOracle
/// @notice IndexFi oracle fed by Atlas signed prices (Pull API `/v1/price/latest` with `signed: true`, or WebSocket
///         `d.payload` / `d.signature`). Needs no Atlas contract on the chain: anyone may post a signed payload, the
///         oracle checks Atlas's ECDSA signature over keccak256(payload), keeps only newer prices, and refuses stale
///         reads. Implements the existing IIndexFiOracle interface, so IndexFiVault and IndexFiFactory are unchanged.
/// @dev Atlas payload: N records of 20 bytes (feedId uint32 | price uint80, 18 decimals | timestamp uint48 seconds)
///      followed by one count byte. Only the payload is signed; Atlas consensus scores are unsigned and not used here.
contract AtlasSignedOracle is IIndexFiOracle {
    error InvalidBinding(address asset, uint32 feedId);
    error InvalidSigner(address recovered);
    error InvalidPayload(uint256 length);
    error InvalidPrice(uint32 feedId);
    error FutureTimestamp(uint32 feedId, uint256 timestamp);
    error UnsupportedAsset(address asset);
    error NoPrice(address asset);
    error StalePrice(address asset, uint256 timestamp, uint256 maxAge);

    struct Binding {
        address asset;
        uint32 feedId;
        uint32 maxAge;
    }

    struct Feed {
        address asset;
        uint32 maxAge;
    }

    struct Observation {
        uint128 price; // USD per whole token, 18 decimals (Atlas uint80 fits)
        uint64 timestamp; // Atlas price time, Unix seconds
    }

    uint256 public constant RECORD_BYTES = 20;
    /// Atlas Pull API returns at most 20 feeds per request, so a valid payload never carries more.
    uint256 public constant MAX_RECORDS = 20;
    /// Tolerated clock skew between Atlas timestamps and block time.
    uint256 public constant MAX_FUTURE_DRIFT = 60;

    address public immutable signer;
    address public immutable override settlementToken;

    mapping(uint32 => Feed) public feedOf;
    mapping(address => uint32) public feedIdOf;
    mapping(uint32 => Observation) public latest;

    event PriceUpdated(uint32 indexed feedId, address indexed asset, uint256 price18, uint256 timestamp);

    constructor(address atlasSigner, address settlement, Binding[] memory bindings) {
        require(atlasSigner != address(0), "Oracle: signer");
        require(settlement.code.length != 0, "Oracle: settlement");
        signer = atlasSigner;
        settlementToken = settlement;
        for (uint256 i; i < bindings.length; ++i) {
            Binding memory b = bindings[i];
            if (
                b.asset.code.length == 0 || b.asset == settlement || b.feedId == 0 || b.maxAge == 0
                    || feedOf[b.feedId].asset != address(0) || feedIdOf[b.asset] != 0
            ) revert InvalidBinding(b.asset, b.feedId);
            feedOf[b.feedId] = Feed(b.asset, b.maxAge);
            feedIdOf[b.asset] = b.feedId;
        }
    }

    /// @notice Verify an Atlas signed payload and store its prices. Permissionless.
    /// @dev Records for feeds this oracle does not bind, and records not newer than the stored one, are skipped,
    ///      so an old signed payload can never roll a price back.
    /// @return updated Number of feeds whose stored price moved forward.
    function updatePrices(bytes calldata payload, bytes calldata signature) external returns (uint256 updated) {
        address recovered = ECDSA.recover(keccak256(payload), signature);
        if (recovered != signer) revert InvalidSigner(recovered);
        uint256 length = payload.length;
        uint256 count = length == 0 ? 0 : uint8(payload[length - 1]);
        if (count == 0 || count > MAX_RECORDS || length != count * RECORD_BYTES + 1) revert InvalidPayload(length);
        for (uint256 i; i < count; ++i) {
            uint256 o = i * RECORD_BYTES;
            uint32 feedId = uint32(bytes4(payload[o:o + 4]));
            uint256 price = uint80(bytes10(payload[o + 4:o + 14]));
            uint256 timestamp = uint48(bytes6(payload[o + 14:o + 20]));
            Feed memory f = feedOf[feedId];
            if (f.asset == address(0)) continue;
            if (price == 0) revert InvalidPrice(feedId);
            if (timestamp > block.timestamp + MAX_FUTURE_DRIFT) revert FutureTimestamp(feedId, timestamp);
            if (timestamp <= latest[feedId].timestamp) continue;
            latest[feedId] = Observation(uint128(price), uint64(timestamp));
            emit PriceUpdated(feedId, f.asset, price, timestamp);
            ++updated;
        }
    }

    /// @inheritdoc IIndexFiOracle
    function supportsAsset(address asset) external view override returns (bool) {
        return asset == settlementToken || feedIdOf[asset] != 0;
    }

    /// @inheritdoc IIndexFiOracle
    /// @dev Reverts when the asset has no price yet or its price is older than the feed's maxAge.
    function price18(address asset) external view override returns (uint256) {
        if (asset == settlementToken) return 1e18;
        uint32 feedId = feedIdOf[asset];
        if (feedId == 0) revert UnsupportedAsset(asset);
        Observation memory o = latest[feedId];
        if (o.timestamp == 0) revert NoPrice(asset);
        uint32 maxAge = feedOf[feedId].maxAge;
        if (block.timestamp > o.timestamp && block.timestamp - o.timestamp > maxAge) {
            revert StalePrice(asset, o.timestamp, maxAge);
        }
        return o.price;
    }

    /// @notice Frontend helper: stored price, its Atlas timestamp, and whether it is fresh enough to use now.
    function priceInfo(address asset) external view returns (uint256 price, uint256 timestamp, bool fresh) {
        uint32 feedId = feedIdOf[asset];
        if (feedId == 0) revert UnsupportedAsset(asset);
        Observation memory o = latest[feedId];
        price = o.price;
        timestamp = o.timestamp;
        fresh = o.timestamp != 0 && (block.timestamp <= o.timestamp || block.timestamp - o.timestamp <= feedOf[feedId].maxAge);
    }
}
