// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {StealthDutchAuctionHook} from "../src/StealthDutchAuctionHook.sol";
import {MockFHERC20} from "../src/mocks/MockFHERC20.sol";

contract TryPayWithFHERC20 is Script {
    using PoolIdLibrary for PoolKey;

    error ValueTooLarge(string field, uint256 value, uint256 maxValue);
    error NegativeTickSpacing(int256 tickSpacing);
    error SellerNotHookOwner(address seller, address hookOwner);
    error EthFundingFailed();

    function run() external {
        uint256 sellerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        uint256 buyerPrivateKey = vm.envOr("BUYER_PRIVATE_KEY", sellerPrivateKey);
        address seller = vm.addr(sellerPrivateKey);
        address buyer = vm.addr(buyerPrivateKey);

        // Defaults point to latest deployment in broadcast/run-latest.json.
        address hookAddress = vm.envOr("HOOK_ADDRESS", address(0xa5fCaaCD7F99D064934748fA22f520D1863cCAFA));
        address token0Address = vm.envOr("TOKEN0_ADDRESS", address(0xD94585CB6d294Cc9b1Eb1F8802934B4724aB39a4));
        address paymentTokenAddress = vm.envOr("PAYMENT_TOKEN_ADDRESS", address(0x17A6b66e6ebEF2CB7Fa77Cfd0830E8a5786fEaf1));
        address auctionTokenAddress = vm.envOr("AUCTION_TOKEN_ADDRESS", address(0xC1CdDeFD833d40F1e3f7A005bf75e88aeC8B24F6));

        uint24 poolFee = _toUint24(vm.envOr("POOL_FEE", uint256(3_000)), "POOL_FEE");
        int24 poolTickSpacing = _toInt24(vm.envOr("POOL_TICK_SPACING", int256(60)));

        uint128 startPrice = _toUint128(vm.envOr("TEST_AUCTION_START_PRICE", uint256(100)), "TEST_AUCTION_START_PRICE");
        uint128 endPrice = _toUint128(vm.envOr("TEST_AUCTION_END_PRICE", uint256(90)), "TEST_AUCTION_END_PRICE");
        uint64 duration = _toUint64(vm.envOr("TEST_AUCTION_DURATION", uint256(86_400)), "TEST_AUCTION_DURATION");
        uint128 supply = _toUint128(vm.envOr("TEST_AUCTION_SUPPLY", uint256(100)), "TEST_AUCTION_SUPPLY");

        uint128 desiredAuctionTokens = _toUint128(vm.envOr("TEST_BUY_AMOUNT", uint256(10)), "TEST_BUY_AMOUNT");
        uint128 maxPricePerToken = _toUint128(vm.envOr("TEST_MAX_PRICE", uint256(150)), "TEST_MAX_PRICE");
        uint256 buyerEthTopUp = vm.envOr("BUYER_ETH_TOPUP_WEI", uint256(3e15)); // 0.003 ETH

        StealthDutchAuctionHook hook = StealthDutchAuctionHook(hookAddress);
        MockFHERC20 paymentToken = MockFHERC20(paymentTokenAddress);
        MockFHERC20 auctionToken = MockFHERC20(auctionTokenAddress);

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(token0Address),
            currency1: Currency.wrap(paymentTokenAddress),
            fee: poolFee,
            tickSpacing: poolTickSpacing,
            hooks: IHooks(hookAddress)
        });
        PoolId poolId = key.toId();

        console2.log("=== pay-with-FHERC20 setup ===");
        console2.log("Hook:", hookAddress);
        console2.log("PoolId:", vm.toString(PoolId.unwrap(poolId)));
        console2.log("Seller:", seller);
        console2.log("Buyer:", buyer);

        vm.startBroadcast(sellerPrivateKey);

        if (seller != buyer && buyer.balance < buyerEthTopUp) {
            (bool funded,) = payable(buyer).call{value: buyerEthTopUp}("");
            if (!funded) revert EthFundingFailed();
            console2.log("Funded buyer wei:", buyerEthTopUp);
        }

        if (auctionToken.balanceOf(seller) < supply) {
            uint256 mintAmount = uint256(supply) * 2;
            auctionToken.mint(seller, mintAmount);
            console2.log("Minted seller auction tokens:", mintAmount);
        }

        // Ensure hook can move seller auction inventory.
        auctionToken.approve(hookAddress, type(uint256).max);

        uint256 auctionId;
        (,,, uint256 activeAuctionId) = hook.poolAuctions(poolId);
        bool needsNewAuction = activeAuctionId == 0;
        if (!needsNewAuction) {
            (, bool isActive,,,,,,,) = hook.getAuctionPlainState(activeAuctionId);
            needsNewAuction = !isActive;
            auctionId = activeAuctionId;
        }

        if (needsNewAuction) {
            address hookOwner = hook.owner();
            if (hookOwner != seller) revert SellerNotHookOwner(seller, hookOwner);
            auctionId = hook.initializeAuctionPool({
                key: key,
                auctionToken: auctionTokenAddress,
                startPrice: startPrice,
                endPrice: endPrice,
                duration: duration,
                supply: supply,
                seller: seller
            });
            console2.log("Initialized auction id:", auctionId);
        } else {
            console2.log("Using existing active auction id:", auctionId);
        }

        uint128 current = hook.currentPrice(auctionId);
        uint256 paymentNeeded = uint256(current) * uint256(desiredAuctionTokens);
        uint256 paymentMint = vm.envOr("TEST_PAYMENT_MINT", paymentNeeded * 2);

        if (paymentToken.balanceOf(buyer) < paymentNeeded) {
            paymentToken.mint(buyer, paymentMint);
            console2.log("Minted buyer payment tokens:", paymentMint);
        }

        vm.stopBroadcast();

        vm.startBroadcast(buyerPrivateKey);
        paymentToken.approve(hookAddress, type(uint256).max);

        uint256 buyerPaymentBefore = paymentToken.balanceOf(buyer);
        uint256 buyerAuctionBefore = auctionToken.balanceOf(buyer);

        uint128 spent = hook.buyWithPaymentToken(poolId, desiredAuctionTokens, maxPricePerToken);

        uint256 buyerPaymentAfter = paymentToken.balanceOf(buyer);
        uint256 buyerAuctionAfter = auctionToken.balanceOf(buyer);
        vm.stopBroadcast();

        (, bool isActiveAfter,,, uint128 currentAfter, uint128 soldAfter, uint128 supplyAfter,,) =
            hook.getAuctionPlainState(auctionId);

        console2.log("\n=== pay-with-FHERC20 result ===");
        console2.log("Auction id:", auctionId);
        console2.log("Spent payment tokens:", spent);
        console2.log("Buyer payment before:", buyerPaymentBefore);
        console2.log("Buyer payment after:", buyerPaymentAfter);
        console2.log("Buyer auction before:", buyerAuctionBefore);
        console2.log("Buyer auction after:", buyerAuctionAfter);
        console2.log("Auction sold:", soldAfter);
        console2.log("Auction supply:", supplyAfter);
        console2.log("Auction current price:", currentAfter);
        console2.log("Auction active:", isActiveAfter);
    }

    function _toUint24(uint256 value, string memory field) internal pure returns (uint24) {
        if (value > type(uint24).max) revert ValueTooLarge(field, value, type(uint24).max);
        return uint24(value);
    }

    function _toUint128(uint256 value, string memory field) internal pure returns (uint128) {
        if (value > type(uint128).max) revert ValueTooLarge(field, value, type(uint128).max);
        return uint128(value);
    }

    function _toUint64(uint256 value, string memory field) internal pure returns (uint64) {
        if (value > type(uint64).max) revert ValueTooLarge(field, value, type(uint64).max);
        return uint64(value);
    }

    function _toInt24(int256 value) internal pure returns (int24) {
        if (value < 0) revert NegativeTickSpacing(value);
        if (uint256(value) > uint256(uint24(type(int24).max))) {
            revert ValueTooLarge("POOL_TICK_SPACING", uint256(value), uint256(uint24(type(int24).max)));
        }
        return int24(value);
    }
}
