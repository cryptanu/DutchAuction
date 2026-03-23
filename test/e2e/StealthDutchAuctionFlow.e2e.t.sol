// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {SwapParams} from "v4-core/types/PoolOperation.sol";
import {InEuint128} from "cofhe-contracts/ICofhe.sol";
import {StealthDutchAuctionHook} from "../../src/StealthDutchAuctionHook.sol";
import {MockFHERC20} from "../../src/mocks/MockFHERC20.sol";
import {MockPoolManager} from "../../src/mocks/MockPoolManager.sol";
import {MockTaskManager} from "../../src/mocks/MockTaskManager.sol";

contract StealthDutchAuctionFlowE2ETest is Test {
    using PoolIdLibrary for PoolKey;

    address internal constant TASK_MANAGER = 0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9;

    address internal seller = makeAddr("seller");
    address internal buyerA = makeAddr("buyerA");
    address internal buyerB = makeAddr("buyerB");

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
        MockTaskManager taskManager = new MockTaskManager();
        vm.etch(TASK_MANAGER, address(taskManager).code);
        nextCiphertextHandle = 2_000_000;

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

        paymentToken.mint(address(poolManager), 3_000_000);
        auctionToken.mint(seller, 500);
        weth.mint(buyerA, 1_000);
        weth.mint(buyerB, 1_000);

        vm.prank(seller);
        auctionToken.approve(address(hook), type(uint256).max);

        vm.prank(buyerA);
        weth.approve(address(poolManager), type(uint256).max);
        vm.prank(buyerA);
        paymentToken.approve(address(hook), type(uint256).max);

        vm.prank(buyerB);
        weth.approve(address(poolManager), type(uint256).max);
        vm.prank(buyerB);
        paymentToken.approve(address(hook), type(uint256).max);

        auctionId = hook.initializeAuctionPool({
            key: poolKey,
            auctionToken: address(auctionToken),
            startPrice: 100,
            endPrice: 40,
            duration: 1_000,
            supply: 500,
            seller: seller
        });
    }

    function test_e2e_twoBuyersFillAuctionThroughSwapHook() public {
        bytes memory firstBuy = _buildEncryptedSwapIntent(200, 101, 29_000);

        vm.prank(buyerA);
        poolManager.swap(
            poolKey,
            SwapParams({zeroForOne: true, amountSpecified: -int256(uint256(30)), sqrtPriceLimitX96: 0}),
            firstBuy
        );

        assertEq(auctionToken.balanceOf(buyerA), 200);
        assertEq(paymentToken.balanceOf(seller), 20_000);
        assertEq(paymentToken.balanceOf(buyerA), 10_000);

        vm.warp(block.timestamp + 400);
        assertEq(hook.currentPrice(auctionId), 76);

        bytes memory secondBuy = _buildEncryptedSwapIntent(300, 80, 29_000);

        vm.prank(buyerB);
        poolManager.swap(
            poolKey,
            SwapParams({zeroForOne: true, amountSpecified: -int256(uint256(30)), sqrtPriceLimitX96: 0}),
            secondBuy
        );

        assertEq(auctionToken.balanceOf(buyerB), 300);
        assertEq(auctionToken.balanceOf(seller), 0);

        uint256 expectedSellerPayment = 20_000 + 22_800;
        assertEq(paymentToken.balanceOf(seller), expectedSellerPayment);
        assertEq(paymentToken.balanceOf(buyerB), 7_200);

        (PoolId storedPoolId,,, uint256 activeAuctionId) = hook.poolAuctions(poolId);
        assertEq(PoolId.unwrap(storedPoolId), PoolId.unwrap(poolId));
        assertEq(activeAuctionId, auctionId);

        (, bool isActive,,,, uint128 sold, uint128 supply,,) = hook.getAuctionPlainState(auctionId);
        assertTrue(isActive);
        assertEq(sold, 0);
        assertEq(supply, 500);
    }

    function _buildEncryptedSwapIntent(uint128 desiredAuctionTokens, uint128 maxPricePerToken, uint128 minPaymentTokensFromSwap)
        internal
        returns (bytes memory)
    {
        return abi.encode(
            StealthDutchAuctionHook.AuctionIntentEncrypted({
                desiredAuctionTokens: _encryptUint128(desiredAuctionTokens),
                maxPricePerToken: _encryptUint128(maxPricePerToken),
                minPaymentTokensFromSwap: _encryptUint128(minPaymentTokensFromSwap)
            })
        );
    }

    function _encryptUint128(uint128 value) internal returns (InEuint128 memory) {
        uint256 handle = nextCiphertextHandle++;
        MockTaskManager(TASK_MANAGER).publishDecryptResult(handle, value, "");
        return InEuint128({ctHash: handle, securityZone: 0, utype: 6, signature: bytes("")});
    }
}
