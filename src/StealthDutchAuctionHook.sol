// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FHE, ebool, euint64, euint128} from "cofhe-contracts/FHE.sol";
import {EncryptedInput, InEuint128, ITaskManager, Utils} from "cofhe-contracts/ICofhe.sol";
import {IFHERC20Encrypted} from "./interfaces/IFHERC20Encrypted.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/types/PoolOperation.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "v4-core/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/types/BeforeSwapDelta.sol";

contract StealthDutchAuctionHook is IHooks {
    using PoolIdLibrary for PoolKey;
    using BalanceDeltaLibrary for BalanceDelta;

    address internal constant TASK_MANAGER_ADDRESS = 0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9;

    error NotOwner();
    error NotPoolManager();
    error HookAddressMismatch();
    error InvalidPaymentToken();
    error InvalidAuctionConfig();
    error AuctionNotFound();
    error AuctionNotActive();
    error PendingPurchaseExists();
    error PendingPurchaseNotReady();
    error PendingPurchaseExpired();
    error PaymentTransferFailed();
    error AuctionTransferFailed();
    error PlaintextIntentDisabled();
    error InvalidDecryptProof();
    error InvalidBuyer();

    struct AuctionPool {
        PoolId poolId;
        address auctionToken;
        address paymentToken;
        uint256 activeAuctionId;
    }

    struct DutchAuction {
        euint128 startPrice;
        euint128 endPrice;
        euint64 startTime;
        euint64 duration;
        euint128 totalSupply;
        euint128 soldAmount;
        ebool isActive;
        address seller;
        uint128 startPricePlain;
        uint128 endPricePlain;
        uint64 startTimePlain;
        uint64 durationPlain;
        uint128 totalSupplyPlain;
        uint128 soldAmountPlain;
        bool isActivePlain;
    }

    struct AuctionIntentEncrypted {
        InEuint128 desiredAuctionTokens;
        uint128 maxPricePerToken;
        uint128 minPaymentTokensFromSwap;
    }

    struct PendingPurchase {
        uint256 auctionId;
        euint128 encAuctionTokens;
        uint128 maxPricePerToken;
        uint128 minPaymentTokensFromSwap;
        uint128 priceAtIntent;
        uint128 paymentOut;
        uint128 maxAffordableTokens;
        euint128 encFinalFill;
        euint128 encFinalPayment;
        uint64 finalizeDeadline;
        bool ready;
        bool direct;
    }

    address public immutable poolManager;
    address public owner;
    uint256 public nextAuctionId;

    mapping(PoolId => AuctionPool) public poolAuctions;
    mapping(uint256 => DutchAuction) public auctions;
    mapping(address => mapping(PoolId => PendingPurchase)) internal pendingPurchases;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PoolAuctionInitialized(PoolId indexed poolId, uint256 indexed auctionId, address indexed seller);
    event AuctionIntentRegistered(PoolId indexed poolId, uint256 indexed auctionId, address indexed buyer);
    event AuctionSettlementReady(
        PoolId indexed poolId,
        uint256 indexed auctionId,
        address indexed buyer,
        uint256 paymentHandle,
        uint256 fillHandle,
        uint64 finalizeDeadline,
        bool direct
    );
    event AuctionPurchase(PoolId indexed poolId, uint256 indexed auctionId, address indexed buyer, uint64 timestamp);
    event AuctionSoldOut(PoolId indexed poolId, uint256 indexed auctionId);
    event AuctionExpired(PoolId indexed poolId, uint256 indexed auctionId);

    uint64 public constant FINALIZE_WINDOW = 30 minutes;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyPoolManager() {
        if (msg.sender != poolManager) revert NotPoolManager();
        _;
    }

    constructor(address poolManager_, address owner_) {
        require(poolManager_ != address(0), "poolManager=0");
        require(owner_ != address(0), "owner=0");
        poolManager = poolManager_;
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "newOwner=0");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function initializeAuctionPool(
        PoolKey calldata key,
        address auctionToken,
        uint128 startPrice,
        uint128 endPrice,
        uint64 duration,
        uint128 supply,
        address seller
    ) external onlyOwner returns (uint256 auctionId) {
        if (address(key.hooks) != address(this)) revert HookAddressMismatch();
        address paymentToken = Currency.unwrap(key.currency1);
        if (paymentToken == address(0)) revert InvalidPaymentToken();
        if (auctionToken == address(0) || seller == address(0) || duration == 0 || supply == 0 || startPrice < endPrice)
        {
            revert InvalidAuctionConfig();
        }

        PoolId poolId = key.toId();
        auctionId = ++nextAuctionId;

        DutchAuction storage auction = auctions[auctionId];
        auction.startPrice = FHE.asEuint128(startPrice);
        FHE.allowThis(auction.startPrice);
        auction.endPrice = FHE.asEuint128(endPrice);
        FHE.allowThis(auction.endPrice);
        auction.startTime = FHE.asEuint64(block.timestamp);
        FHE.allowThis(auction.startTime);
        auction.duration = FHE.asEuint64(duration);
        FHE.allowThis(auction.duration);
        auction.totalSupply = FHE.asEuint128(supply);
        FHE.allowThis(auction.totalSupply);
        auction.soldAmount = FHE.asEuint128(0);
        FHE.allowThis(auction.soldAmount);
        auction.isActive = FHE.asEbool(true);
        FHE.allowThis(auction.isActive);
        auction.seller = seller;
        auction.startPricePlain = startPrice;
        auction.endPricePlain = endPrice;
        auction.startTimePlain = uint64(block.timestamp);
        auction.durationPlain = duration;
        auction.totalSupplyPlain = supply;
        auction.soldAmountPlain = 0;
        auction.isActivePlain = true;

        poolAuctions[poolId] = AuctionPool({
            poolId: poolId, auctionToken: auctionToken, paymentToken: paymentToken, activeAuctionId: auctionId
        });

        emit PoolAuctionInitialized(poolId, auctionId, seller);
    }

    function currentPrice(uint256 auctionId) public view returns (uint128) {
        DutchAuction storage auction = auctions[auctionId];
        if (auction.seller == address(0)) revert AuctionNotFound();

        uint256 endTime = uint256(auction.startTimePlain) + uint256(auction.durationPlain);
        if (block.timestamp >= endTime) return auction.endPricePlain;

        uint256 elapsed = block.timestamp - uint256(auction.startTimePlain);
        uint256 span = uint256(auction.startPricePlain) - uint256(auction.endPricePlain);
        uint256 decay = (span * elapsed) / uint256(auction.durationPlain);
        return uint128(uint256(auction.startPricePlain) - decay);
    }

    function getAuctionPlainState(uint256 auctionId)
        external
        view
        returns (
            address seller,
            bool isActive,
            uint128 startPrice,
            uint128 endPrice,
            uint128 current,
            uint128 sold,
            uint128 supply,
            uint64 startTime,
            uint64 duration
        )
    {
        DutchAuction storage auction = auctions[auctionId];
        if (auction.seller == address(0)) revert AuctionNotFound();

        seller = auction.seller;
        isActive = auction.isActivePlain;
        startPrice = auction.startPricePlain;
        endPrice = auction.endPricePlain;
        current = currentPrice(auctionId);
        sold = auction.soldAmountPlain;
        supply = auction.totalSupplyPlain;
        startTime = auction.startTimePlain;
        duration = auction.durationPlain;
    }

    function getPendingPurchase(address buyer, PoolId poolId) external view returns (PendingPurchase memory) {
        return pendingPurchases[buyer][poolId];
    }

    /// @notice Legacy plaintext direct-buy entrypoint (disabled).
    function buyWithPaymentToken(PoolId poolId, uint128 desiredAuctionTokens, uint128 maxPricePerToken)
        external
        pure
        returns (uint128)
    {
        poolId;
        desiredAuctionTokens;
        maxPricePerToken;
        revert PlaintextIntentDisabled();
    }

    /// @notice Buy auction tokens directly with FHERC20 payment token (no pool swap leg).
    /// @dev Inputs are encrypted and verified through cofhe TaskManager. Settlement is finalized in a second tx.
    function buyWithPaymentTokenEncrypted(
        PoolId poolId,
        InEuint128 calldata desiredAuctionTokens,
        uint128 maxPricePerToken
    ) external returns (uint128 paymentTokensSpent) {
        AuctionPool storage pool = poolAuctions[poolId];
        if (pool.activeAuctionId == 0) revert AuctionNotActive();
        uint256 auctionId = pool.activeAuctionId;

        DutchAuction storage auction = auctions[auctionId];
        if (!_refreshAuctionStatus(pool, auction)) revert AuctionNotActive();

        PendingPurchase storage pending = pendingPurchases[msg.sender][poolId];
        if (pending.auctionId != 0) revert PendingPurchaseExists();

        euint128 encAuctionTokens = FHE.asEuint128(desiredAuctionTokens);
        uint128 price = currentPrice(auctionId);
        if (price > maxPricePerToken) return 0;

        euint128 encPrice = FHE.asEuint128(price);
        euint128 encRemainingSupply = FHE.sub(auction.totalSupply, auction.soldAmount);
        euint128 encFinalFill = FHE.min(encAuctionTokens, encRemainingSupply);
        euint128 encPaymentTokens = FHE.mul(encFinalFill, encPrice);
        FHE.allow(encPaymentTokens, msg.sender);
        FHE.allow(encFinalFill, msg.sender);
        // Step-2 finalize currently decrypts with `withoutPermit()` in the UI path.
        // Mark these handles globally decryptable so threshold decryption does not require a permit.
        FHE.allowGlobal(encPaymentTokens);
        FHE.allowGlobal(encFinalFill);
        pending.auctionId = auctionId;
        pending.encAuctionTokens = encAuctionTokens;
        pending.maxPricePerToken = maxPricePerToken;
        pending.minPaymentTokensFromSwap = 0;
        pending.priceAtIntent = price;
        pending.paymentOut = 0;
        pending.maxAffordableTokens = type(uint128).max;
        pending.encFinalFill = encFinalFill;
        pending.encFinalPayment = encPaymentTokens;
        pending.finalizeDeadline = _finalizeDeadline();
        pending.ready = true;
        pending.direct = true;

        emit AuctionIntentRegistered(poolId, auctionId, msg.sender);
        emit AuctionSettlementReady(
            poolId,
            auctionId,
            msg.sender,
            uint256(euint128.unwrap(encPaymentTokens)),
            uint256(euint128.unwrap(encFinalFill)),
            pending.finalizeDeadline,
            true
        );
        paymentTokensSpent = 0;
    }

    function beforeInitialize(address, PoolKey calldata, uint160) external pure override returns (bytes4) {
        return IHooks.beforeInitialize.selector;
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure override returns (bytes4) {
        return IHooks.afterInitialize.selector;
    }

    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return IHooks.beforeAddLiquidity.selector;
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure override returns (bytes4, BalanceDelta) {
        return (IHooks.afterAddLiquidity.selector, BalanceDeltaLibrary.ZERO_DELTA);
    }

    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return IHooks.beforeRemoveLiquidity.selector;
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure override returns (bytes4, BalanceDelta) {
        return (IHooks.afterRemoveLiquidity.selector, BalanceDeltaLibrary.ZERO_DELTA);
    }

    function beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        external
        override
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (hookData.length == 0) return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);

        PoolId poolId = key.toId();
        AuctionPool storage pool = poolAuctions[poolId];
        if (pool.activeAuctionId == 0) return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        if (!params.zeroForOne) return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);

        DutchAuction storage auction = auctions[pool.activeAuctionId];
        if (!_refreshAuctionStatus(pool, auction)) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        AuctionIntentEncrypted memory intent = abi.decode(hookData, (AuctionIntentEncrypted));
        InEuint128 memory desiredAuctionInput = intent.desiredAuctionTokens;
        EncryptedInput memory desiredEncryptedInput = Utils.inputFromEuint128(desiredAuctionInput);
        uint256 desiredHandle = ITaskManager(TASK_MANAGER_ADDRESS).verifyInput(desiredEncryptedInput, sender);
        euint128 encDesiredAuctionTokens = euint128.wrap(bytes32(desiredHandle));
        uint128 priceAtIntent = currentPrice(pool.activeAuctionId);

        PendingPurchase storage pending = pendingPurchases[sender][poolId];
        if (pending.auctionId != 0) revert PendingPurchaseExists();

        pending.auctionId = pool.activeAuctionId;
        pending.encAuctionTokens = encDesiredAuctionTokens;
        pending.maxPricePerToken = intent.maxPricePerToken;
        pending.minPaymentTokensFromSwap = intent.minPaymentTokensFromSwap;
        pending.priceAtIntent = priceAtIntent;
        pending.paymentOut = 0;
        pending.maxAffordableTokens = 0;
        pending.encFinalFill = euint128.wrap(bytes32(0));
        pending.encFinalPayment = euint128.wrap(bytes32(0));
        pending.finalizeDeadline = 0;
        pending.ready = false;
        pending.direct = false;

        emit AuctionIntentRegistered(poolId, pending.auctionId, sender);
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) external override onlyPoolManager returns (bytes4, int128) {
        PoolId poolId = key.toId();
        PendingPurchase storage pending = pendingPurchases[sender][poolId];
        if (pending.auctionId == 0) return (IHooks.afterSwap.selector, 0);

        AuctionPool storage pool = poolAuctions[poolId];
        DutchAuction storage auction = auctions[pending.auctionId];
        if (!_refreshAuctionStatus(pool, auction)) {
            delete pendingPurchases[sender][poolId];
            return (IHooks.afterSwap.selector, 0);
        }

        uint128 paymentOut = _extractSwapOutput(params, delta);
        if (pending.priceAtIntent > pending.maxPricePerToken) {
            delete pendingPurchases[sender][poolId];
            return (IHooks.afterSwap.selector, 0);
        }
        if (paymentOut < pending.minPaymentTokensFromSwap) {
            delete pendingPurchases[sender][poolId];
            return (IHooks.afterSwap.selector, 0);
        }
        if (pending.priceAtIntent == 0) {
            delete pendingPurchases[sender][poolId];
            return (IHooks.afterSwap.selector, 0);
        }
        uint128 maxAffordableTokens = paymentOut / pending.priceAtIntent;
        if (maxAffordableTokens == 0) {
            delete pendingPurchases[sender][poolId];
            return (IHooks.afterSwap.selector, 0);
        }

        euint128 encPriceAtIntent = FHE.asEuint128(pending.priceAtIntent);
        euint128 encAffordableTokens = FHE.asEuint128(maxAffordableTokens);
        euint128 encRemainingSupply = FHE.sub(auction.totalSupply, auction.soldAmount);
        euint128 encRequestedFill = FHE.min(pending.encAuctionTokens, encRemainingSupply);
        euint128 encFinalFill = FHE.min(encRequestedFill, encAffordableTokens);
        euint128 encFinalPayment = FHE.mul(encFinalFill, encPriceAtIntent);
        FHE.allow(encFinalPayment, sender);
        FHE.allow(encFinalFill, sender);
        // Step-2 finalize currently decrypts with `withoutPermit()` in the UI path.
        // Mark these handles globally decryptable so threshold decryption does not require a permit.
        FHE.allowGlobal(encFinalPayment);
        FHE.allowGlobal(encFinalFill);
        pending.paymentOut = paymentOut;
        pending.maxAffordableTokens = maxAffordableTokens;
        pending.encFinalFill = encFinalFill;
        pending.encFinalPayment = encFinalPayment;
        pending.finalizeDeadline = _finalizeDeadline();
        pending.ready = true;
        pending.direct = false;

        emit AuctionSettlementReady(
            poolId,
            pending.auctionId,
            sender,
            uint256(euint128.unwrap(encFinalPayment)),
            uint256(euint128.unwrap(encFinalFill)),
            pending.finalizeDeadline,
            false
        );

        return (IHooks.afterSwap.selector, 0);
    }

    function finalizePendingPurchase(
        PoolId poolId,
        uint128 paymentResult,
        bytes calldata paymentSignature,
        uint128 fillResult,
        bytes calldata fillSignature
    ) external returns (uint128 paymentTokensSpent, uint128 auctionTokensFilled) {
        return _finalizePendingPurchaseFor(msg.sender, poolId, paymentResult, paymentSignature, fillResult, fillSignature);
    }

    function finalizePendingPurchaseFor(
        address buyer,
        PoolId poolId,
        uint128 paymentResult,
        bytes calldata paymentSignature,
        uint128 fillResult,
        bytes calldata fillSignature
    ) external returns (uint128 paymentTokensSpent, uint128 auctionTokensFilled) {
        if (buyer == address(0)) revert InvalidBuyer();
        return _finalizePendingPurchaseFor(buyer, poolId, paymentResult, paymentSignature, fillResult, fillSignature);
    }

    function cancelPendingPurchase(PoolId poolId) external {
        PendingPurchase storage pending = pendingPurchases[msg.sender][poolId];
        if (pending.auctionId == 0) revert PendingPurchaseNotReady();
        delete pendingPurchases[msg.sender][poolId];
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return IHooks.beforeDonate.selector;
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return IHooks.afterDonate.selector;
    }

    function _extractSwapOutput(SwapParams calldata params, BalanceDelta delta)
        internal
        pure
        returns (uint128 outputAmount)
    {
        int128 output = params.zeroForOne ? delta.amount1() : delta.amount0();
        if (output <= 0) return 0;
        outputAmount = uint128(uint256(int256(output)));
    }

    function _transferFromEncrypted(address token, address from, address to, euint128 encryptedAmount)
        internal
        returns (bool)
    {
        try IFHERC20Encrypted(token).transferFromEncrypted(from, to, encryptedAmount) returns (bool success) {
            return success;
        } catch {
            return false;
        }
    }

    function _refreshAuctionStatus(AuctionPool storage pool, DutchAuction storage auction) internal returns (bool) {
        if (!auction.isActivePlain) return false;

        if (block.timestamp >= uint256(auction.startTimePlain) + uint256(auction.durationPlain)) {
            uint256 auctionId = pool.activeAuctionId;
            _deactivateAuction(pool, auction);
            emit AuctionExpired(pool.poolId, auctionId);
            return false;
        }

        return true;
    }

    function _verifyAndPublishDecryptResult(euint128 encryptedValue, uint128 plaintextValue, bytes calldata signature)
        internal
    {
        uint256 handle = uint256(euint128.unwrap(encryptedValue));
        if (handle == 0) revert InvalidDecryptProof();
        if (!ITaskManager(TASK_MANAGER_ADDRESS).verifyDecryptResultSafe(handle, plaintextValue, signature)) {
            revert InvalidDecryptProof();
        }
        ITaskManager(TASK_MANAGER_ADDRESS).publishDecryptResult(handle, plaintextValue, signature);
    }

    function _finalizeDeadline() internal view returns (uint64) {
        return uint64(block.timestamp + FINALIZE_WINDOW);
    }

    function _finalizePendingPurchaseFor(
        address buyer,
        PoolId poolId,
        uint128 paymentResult,
        bytes calldata paymentSignature,
        uint128 fillResult,
        bytes calldata fillSignature
    ) internal returns (uint128 paymentTokensSpent, uint128 auctionTokensFilled) {
        PendingPurchase storage pending = pendingPurchases[buyer][poolId];
        if (pending.auctionId == 0 || !pending.ready) revert PendingPurchaseNotReady();
        uint256 pendingAuctionId = pending.auctionId;
        if (block.timestamp > pending.finalizeDeadline) {
            delete pendingPurchases[buyer][poolId];
            revert PendingPurchaseExpired();
        }

        AuctionPool storage pool = poolAuctions[poolId];
        DutchAuction storage auction = auctions[pendingAuctionId];
        if (!_refreshAuctionStatus(pool, auction)) {
            delete pendingPurchases[buyer][poolId];
            revert AuctionNotActive();
        }

        if (pending.priceAtIntent == 0) revert InvalidDecryptProof();
        if (pending.paymentOut != 0 && paymentResult > pending.paymentOut) revert InvalidDecryptProof();
        if (pending.maxAffordableTokens != 0 && fillResult > pending.maxAffordableTokens) revert InvalidDecryptProof();

        uint256 expectedPayment = uint256(fillResult) * uint256(pending.priceAtIntent);
        if (expectedPayment > type(uint128).max) revert InvalidDecryptProof();
        if (paymentResult != uint128(expectedPayment)) revert InvalidDecryptProof();

        uint128 remainingPlain = auction.totalSupplyPlain - auction.soldAmountPlain;
        if (fillResult > remainingPlain) revert AuctionTransferFailed();

        _verifyAndPublishDecryptResult(pending.encFinalPayment, paymentResult, paymentSignature);
        _verifyAndPublishDecryptResult(pending.encFinalFill, fillResult, fillSignature);

        FHE.allow(pending.encFinalPayment, pool.paymentToken);
        FHE.allow(pending.encFinalFill, pool.auctionToken);

        if (!_transferFromEncrypted(pool.paymentToken, buyer, auction.seller, pending.encFinalPayment)) {
            revert PaymentTransferFailed();
        }
        if (!_transferFromEncrypted(pool.auctionToken, auction.seller, buyer, pending.encFinalFill)) {
            revert AuctionTransferFailed();
        }

        auction.soldAmount = FHE.add(auction.soldAmount, pending.encFinalFill);
        FHE.allowThis(auction.soldAmount);
        auction.soldAmountPlain += fillResult;

        paymentTokensSpent = paymentResult;
        auctionTokensFilled = fillResult;

        delete pendingPurchases[buyer][poolId];

        if (auction.soldAmountPlain >= auction.totalSupplyPlain) {
            uint256 soldOutAuctionId = pool.activeAuctionId;
            _deactivateAuction(pool, auction);
            emit AuctionSoldOut(pool.poolId, soldOutAuctionId);
        }

        emit AuctionPurchase(poolId, pendingAuctionId, buyer, uint64(block.timestamp));
    }

    function _deactivateAuction(AuctionPool storage pool, DutchAuction storage auction) internal {
        auction.isActivePlain = false;
        auction.isActive = FHE.asEbool(false);
        FHE.allowThis(auction.isActive);
        pool.activeAuctionId = 0;
    }
}
