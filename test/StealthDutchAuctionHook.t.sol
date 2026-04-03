// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {SwapParams} from "v4-core/types/PoolOperation.sol";
import {InEuint128} from "cofhe-contracts/ICofhe.sol";
import {StealthDutchAuctionHook} from "../src/StealthDutchAuctionHook.sol";
import {MockFHERC20} from "../src/mocks/MockFHERC20.sol";
import {MockPoolManager} from "../src/mocks/MockPoolManager.sol";
import {MockTaskManager} from "../src/mocks/MockTaskManager.sol";

contract StealthDutchAuctionHookTest is Test {
    using PoolIdLibrary for PoolKey;

    address internal constant TASK_MANAGER = 0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9;

    address internal seller = makeAddr("seller");
    address internal buyer = makeAddr("buyer");
    address internal relayer = makeAddr("relayer");

    MockFHERC20 internal weth;
    MockFHERC20 internal paymentToken;
    MockFHERC20 internal auctionToken;
    MockPoolManager internal poolManager;
    StealthDutchAuctionHook internal hook;
    PoolKey internal poolKey;
    PoolId internal poolId;
    uint256 internal auctionId;
    uint256 internal nextCiphertextHandle;

    function setUp() public {
        _installTaskManagerCode();
        nextCiphertextHandle = 1_000_000;

        weth = new MockFHERC20("Wrapped Ether", "WETH", 18);
        paymentToken = new MockFHERC20("FHE USD", "FHUSD", 18);
        auctionToken = new MockFHERC20("Auction Token", "ATKN", 18);

        poolManager = new MockPoolManager();
        hook = new StealthDutchAuctionHook(address(poolManager), address(this));

        poolKey = PoolKey({
            currency0: Currency.wrap(address(weth)),
            currency1: Currency.wrap(address(paymentToken)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        poolId = poolKey.toId();

        poolManager.registerPool(poolKey, 1_000, 1);

        paymentToken.mint(address(poolManager), 2_000_000);
        weth.mint(buyer, 1_000);
        auctionToken.mint(seller, 1_000);

        vm.prank(buyer);
        weth.approve(address(poolManager), type(uint256).max);

        vm.prank(buyer);
        paymentToken.approve(address(hook), type(uint256).max);

        vm.prank(seller);
        auctionToken.approve(address(hook), type(uint256).max);

        auctionId = hook.initializeAuctionPool({
            key: poolKey,
            auctionToken: address(auctionToken),
            startPrice: 100,
            endPrice: 50,
            duration: 1 days,
            supply: 1_000,
            seller: seller
        });
    }

    function test_swapWithAuctionIntent_settlesPaymentAndAuctionToken() public {
        bytes memory hookData = _buildEncryptedSwapIntent(10, 110, 1_900);

        vm.prank(buyer);
        poolManager.swap(
            poolKey,
            SwapParams({zeroForOne: true, amountSpecified: -int256(uint256(2)), sqrtPriceLimitX96: 0}),
            hookData
        );

        assertEq(weth.balanceOf(buyer), 998);
        assertEq(paymentToken.balanceOf(buyer), 2_000);
        assertEq(paymentToken.balanceOf(seller), 0);
        assertEq(auctionToken.balanceOf(buyer), 0);

        _finalizePending(buyer, 1_000, 10);

        assertEq(paymentToken.balanceOf(buyer), 1_000);
        assertEq(paymentToken.balanceOf(seller), 1_000);
        assertEq(auctionToken.balanceOf(buyer), 10);
        assertEq(auctionToken.balanceOf(seller), 990);
    }

    function test_buyWithPaymentTokenEncrypted_settlesWithoutSwap() public {
        paymentToken.mint(buyer, 1_500);
        InEuint128 memory desiredAuctionTokens = _encryptUint128(10);

        vm.prank(buyer);
        uint128 spent = hook.buyWithPaymentTokenEncrypted(poolId, desiredAuctionTokens, 110);

        assertEq(spent, 0);
        assertEq(weth.balanceOf(buyer), 1_000);
        assertEq(paymentToken.balanceOf(buyer), 1_500);
        assertEq(paymentToken.balanceOf(seller), 0);
        assertEq(auctionToken.balanceOf(buyer), 0);

        _finalizePending(buyer, 1_000, 10);

        assertEq(paymentToken.balanceOf(buyer), 500);
        assertEq(paymentToken.balanceOf(seller), 1_000);
        assertEq(auctionToken.balanceOf(buyer), 10);
        assertEq(auctionToken.balanceOf(seller), 990);
    }

    function test_swapWithoutHookData_behavesAsNormalSwap() public {
        vm.prank(buyer);
        poolManager.swap(
            poolKey,
            SwapParams({zeroForOne: true, amountSpecified: -int256(uint256(1)), sqrtPriceLimitX96: 0}),
            bytes("")
        );

        assertEq(weth.balanceOf(buyer), 999);
        assertEq(paymentToken.balanceOf(buyer), 1_000);
        assertEq(paymentToken.balanceOf(seller), 0);
        assertEq(auctionToken.balanceOf(buyer), 0);
    }

    function test_priceAboveUserLimit_resultsInNoAuctionSettlement() public {
        bytes memory hookData = _buildEncryptedSwapIntent(10, 90, 1);

        vm.prank(buyer);
        poolManager.swap(
            poolKey,
            SwapParams({zeroForOne: true, amountSpecified: -int256(uint256(2)), sqrtPriceLimitX96: 0}),
            hookData
        );

        assertEq(weth.balanceOf(buyer), 998);
        assertEq(paymentToken.balanceOf(buyer), 2_000);
        assertEq(paymentToken.balanceOf(seller), 0);
        assertEq(auctionToken.balanceOf(buyer), 0);
        StealthDutchAuctionHook.PendingPurchase memory pending = hook.getPendingPurchase(buyer, poolId);
        assertEq(pending.auctionId, 0);
    }

    function test_buyWithPaymentTokenEncrypted_priceAboveLimit_noSettlement() public {
        paymentToken.mint(buyer, 2_000);
        InEuint128 memory desiredAuctionTokens = _encryptUint128(10);

        vm.prank(buyer);
        hook.buyWithPaymentTokenEncrypted(poolId, desiredAuctionTokens, 90);

        assertEq(paymentToken.balanceOf(buyer), 2_000);
        assertEq(paymentToken.balanceOf(seller), 0);
        assertEq(auctionToken.balanceOf(buyer), 0);
        StealthDutchAuctionHook.PendingPurchase memory pending = hook.getPendingPurchase(buyer, poolId);
        assertEq(pending.auctionId, 0);
    }

    function test_buyWithPaymentToken_plaintextEntryPointDisabled() public {
        vm.prank(buyer);
        vm.expectRevert(StealthDutchAuctionHook.PlaintextIntentDisabled.selector);
        hook.buyWithPaymentToken(poolId, 10, 90);
    }

    function test_swapBelowMinPayment_resultsInNoAuctionSettlement() public {
        bytes memory hookData = _buildEncryptedSwapIntent(10, 110, 2_500);

        vm.prank(buyer);
        poolManager.swap(
            poolKey,
            SwapParams({zeroForOne: true, amountSpecified: -int256(uint256(2)), sqrtPriceLimitX96: 0}),
            hookData
        );

        assertEq(weth.balanceOf(buyer), 998);
        assertEq(paymentToken.balanceOf(buyer), 2_000);
        assertEq(paymentToken.balanceOf(seller), 0);
        assertEq(auctionToken.balanceOf(buyer), 0);
        StealthDutchAuctionHook.PendingPurchase memory pending = hook.getPendingPurchase(buyer, poolId);
        assertEq(pending.auctionId, 0);
    }

    function test_finalizePendingPurchase_revertsOnInvalidProofPayload() public {
        bytes memory hookData = _buildEncryptedSwapIntent(10, 110, 1_900);

        vm.prank(buyer);
        poolManager.swap(
            poolKey,
            SwapParams({zeroForOne: true, amountSpecified: -int256(uint256(2)), sqrtPriceLimitX96: 0}),
            hookData
        );

        vm.prank(buyer);
        vm.expectRevert(StealthDutchAuctionHook.InvalidDecryptProof.selector);
        hook.finalizePendingPurchase(poolId, 999, bytes(""), 10, bytes(""));
    }

    function test_finalizePendingPurchaseFor_allowsRelayerSponsoredFinalize() public {
        bytes memory hookData = _buildEncryptedSwapIntent(10, 110, 1_900);

        vm.prank(buyer);
        poolManager.swap(
            poolKey,
            SwapParams({zeroForOne: true, amountSpecified: -int256(uint256(2)), sqrtPriceLimitX96: 0}),
            hookData
        );

        vm.prank(relayer);
        hook.finalizePendingPurchaseFor(buyer, poolId, 1_000, bytes(""), 10, bytes(""));

        assertEq(paymentToken.balanceOf(buyer), 1_000);
        assertEq(paymentToken.balanceOf(seller), 1_000);
        assertEq(auctionToken.balanceOf(buyer), 10);
        assertEq(auctionToken.balanceOf(seller), 990);

        StealthDutchAuctionHook.PendingPurchase memory pending = hook.getPendingPurchase(buyer, poolId);
        assertEq(pending.auctionId, 0);
    }

    function test_supplyCap_marksAuctionSoldOut_afterFinalize() public {
        bytes memory hookData = _buildEncryptedSwapIntent(1_000, 110, 100_000);

        vm.prank(buyer);
        poolManager.swap(
            poolKey,
            SwapParams({zeroForOne: true, amountSpecified: -int256(uint256(100)), sqrtPriceLimitX96: 0}),
            hookData
        );

        _finalizePending(buyer, 100_000, 1_000);

        assertEq(auctionToken.balanceOf(buyer), 1_000);

        uint256 sellerPaymentAfterFirstFill = paymentToken.balanceOf(seller);
        bytes memory secondHookData = _buildEncryptedSwapIntent(10, 110, 1);
        vm.prank(buyer);
        poolManager.swap(
            poolKey,
            SwapParams({zeroForOne: true, amountSpecified: -int256(uint256(2)), sqrtPriceLimitX96: 0}),
            secondHookData
        );

        assertEq(auctionToken.balanceOf(buyer), 1_000);
        assertEq(paymentToken.balanceOf(seller), sellerPaymentAfterFirstFill);

        (PoolId storedPoolId,,, uint256 activeAuctionId_) = hook.poolAuctions(poolId);
        assertEq(PoolId.unwrap(storedPoolId), PoolId.unwrap(poolId));
        assertEq(activeAuctionId_, 0);

        (, bool isActive,,,,,,,) = hook.getAuctionPlainState(auctionId);
        assertFalse(isActive);
    }

    function test_initializeAuctionPool_revertsWhenTaskManagerUnavailable() public {
        vm.etch(TASK_MANAGER, bytes(""));

        MockFHERC20 localWeth = new MockFHERC20("Wrapped Ether", "WETH", 18);
        MockFHERC20 localPaymentToken = new MockFHERC20("FHE USD", "FHUSD", 18);
        MockFHERC20 localAuctionToken = new MockFHERC20("Auction Token", "ATKN", 18);
        MockPoolManager localPoolManager = new MockPoolManager();
        StealthDutchAuctionHook localHook = new StealthDutchAuctionHook(address(localPoolManager), address(this));

        PoolKey memory localPoolKey = PoolKey({
            currency0: Currency.wrap(address(localWeth)),
            currency1: Currency.wrap(address(localPaymentToken)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(localHook))
        });

        vm.expectRevert();
        localHook.initializeAuctionPool({
            key: localPoolKey,
            auctionToken: address(localAuctionToken),
            startPrice: 100,
            endPrice: 50,
            duration: 1 days,
            supply: 1_000,
            seller: seller
        });
    }

    function _getPoolAndAuctionState()
        internal
        view
        returns (
            address auctionTokenAddress,
            address paymentTokenAddress,
            uint256 activeAuction,
            address seller_,
            bool isActive,
            uint128 sold,
            uint128 supply,
            uint64 start,
            uint64 duration
        )
    {
        (PoolId storedPoolId, address auctionToken_, address paymentToken_, uint256 activeAuctionId_) =
            hook.poolAuctions(poolId);
        assertEq(PoolId.unwrap(storedPoolId), PoolId.unwrap(poolId));

        (seller_, isActive,,,, sold, supply, start, duration) = hook.getAuctionPlainState(auctionId);
        return (auctionToken_, paymentToken_, activeAuctionId_, seller_, isActive, sold, supply, start, duration);
    }

    function _installTaskManagerCode() internal {
        MockTaskManager taskManager = new MockTaskManager();
        vm.etch(TASK_MANAGER, address(taskManager).code);
    }

    function _buildEncryptedSwapIntent(uint128 desiredAuctionTokens, uint128 maxPricePerToken, uint128 minPaymentTokensFromSwap)
        internal
        returns (bytes memory)
    {
        return abi.encode(
            StealthDutchAuctionHook.AuctionIntentEncrypted({
                desiredAuctionTokens: _encryptUint128(desiredAuctionTokens),
                maxPricePerToken: maxPricePerToken,
                minPaymentTokensFromSwap: minPaymentTokensFromSwap
            })
        );
    }

    function _encryptUint128(uint128 value) internal returns (InEuint128 memory) {
        uint256 handle = nextCiphertextHandle++;
        MockTaskManager(TASK_MANAGER).publishDecryptResult(handle, value, "");
        return InEuint128({ctHash: handle, securityZone: 0, utype: 6, signature: bytes("")});
    }

    function _finalizePending(address actor, uint128 paymentResult, uint128 fillResult) internal {
        vm.prank(actor);
        hook.finalizePendingPurchase(poolId, paymentResult, bytes(""), fillResult, bytes(""));
    }
}
