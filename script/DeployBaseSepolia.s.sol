// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {StealthDutchAuctionHook} from "../src/StealthDutchAuctionHook.sol";
import {MockFHERC20} from "../src/mocks/MockFHERC20.sol";
import {MockPoolManager} from "../src/mocks/MockPoolManager.sol";

contract DeployBaseSepolia is Script {
    using PoolIdLibrary for PoolKey;

    error ValueTooLarge(string field, uint256 value, uint256 maxValue);
    error NegativeTickSpacing(int256 tickSpacing);

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        address seller = vm.envOr("SELLER_ADDRESS", deployer);
        address seedBuyer = vm.envOr("SEED_BUYER_ADDRESS", deployer);

        uint256 poolRate = vm.envOr("POOL_RATE", uint256(1_000));
        uint256 poolDenominator = vm.envOr("POOL_DENOMINATOR", uint256(1));

        uint24 poolFee = _toUint24(vm.envOr("POOL_FEE", uint256(3_000)), "POOL_FEE");
        int24 poolTickSpacing = _toInt24(vm.envOr("POOL_TICK_SPACING", int256(60)));

        uint256 poolPaymentLiquidity = vm.envOr("POOL_PAYMENT_LIQUIDITY", uint256(2_000_000));
        uint256 buyerToken0Mint = vm.envOr("BUYER_TOKEN0_MINT", uint256(1_000));
        uint256 sellerAuctionMint = vm.envOr("SELLER_AUCTION_MINT", uint256(2_000));

        bool startInitialAuction = vm.envOr("START_INITIAL_AUCTION", true);
        uint128 initialStartPrice = _toUint128(vm.envOr("INITIAL_START_PRICE", uint256(100)), "INITIAL_START_PRICE");
        uint128 initialEndPrice = _toUint128(vm.envOr("INITIAL_END_PRICE", uint256(50)), "INITIAL_END_PRICE");
        uint64 initialDuration = _toUint64(vm.envOr("INITIAL_DURATION", uint256(86_400)), "INITIAL_DURATION");
        uint128 initialSupply = _toUint128(vm.envOr("INITIAL_SUPPLY", uint256(1_000)), "INITIAL_SUPPLY");

        vm.startBroadcast(deployerPrivateKey);

        MockFHERC20 token0 = new MockFHERC20("Wrapped Ether", "WETH", 18);
        MockFHERC20 paymentToken = new MockFHERC20("FHE USD", "FHUSD", 18);
        MockFHERC20 auctionToken = new MockFHERC20("Auction Token", "ATKN", 18);
        MockPoolManager poolManager = new MockPoolManager();
        StealthDutchAuctionHook hook = new StealthDutchAuctionHook(address(poolManager), deployer);

        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(paymentToken)),
            fee: poolFee,
            tickSpacing: poolTickSpacing,
            hooks: IHooks(address(hook))
        });

        PoolId poolId = poolKey.toId();

        poolManager.registerPool(poolKey, poolRate, poolDenominator);
        paymentToken.mint(address(poolManager), poolPaymentLiquidity);

        token0.mint(seedBuyer, buyerToken0Mint);
        auctionToken.mint(seller, sellerAuctionMint);

        uint256 auctionId = 0;
        if (startInitialAuction) {
            auctionId = hook.initializeAuctionPool({
                key: poolKey,
                auctionToken: address(auctionToken),
                startPrice: initialStartPrice,
                endPrice: initialEndPrice,
                duration: initialDuration,
                supply: initialSupply,
                seller: seller
            });
        }

        vm.stopBroadcast();

        console2.log("\n=== Deployment Complete (Base Sepolia) ===");
        console2.log("Deployer:", deployer);
        console2.log("Seller:", seller);
        console2.log("Seed buyer:", seedBuyer);
        console2.log("Hook:", address(hook));
        console2.log("PoolManager:", address(poolManager));
        console2.log("Token0 (WETH):", address(token0));
        console2.log("Payment Token:", address(paymentToken));
        console2.log("Auction Token:", address(auctionToken));
        console2.log(string.concat("PoolId: ", vm.toString(PoolId.unwrap(poolId))));
        console2.log("Initial auction id:", auctionId);

        console2.log("\n=== frontend/.env.local ===");
        console2.log(string.concat("NEXT_PUBLIC_HOOK_ADDRESS=", vm.toString(address(hook))));
        console2.log(string.concat("NEXT_PUBLIC_POOL_MANAGER_ADDRESS=", vm.toString(address(poolManager))));
        console2.log(string.concat("NEXT_PUBLIC_TOKEN0_ADDRESS=", vm.toString(address(token0))));
        console2.log(string.concat("NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS=", vm.toString(address(paymentToken))));
        console2.log(string.concat("NEXT_PUBLIC_AUCTION_TOKEN_ADDRESS=", vm.toString(address(auctionToken))));
        console2.log(string.concat("NEXT_PUBLIC_POOL_FEE=", vm.toString(uint256(poolFee))));
        console2.log(string.concat("NEXT_PUBLIC_POOL_TICK_SPACING=", vm.toString(int256(poolTickSpacing))));
        console2.log(string.concat("NEXT_PUBLIC_DEFAULT_SELLER_ADDRESS=", vm.toString(seller)));
        console2.log("NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL=https://sepolia.base.org");
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
