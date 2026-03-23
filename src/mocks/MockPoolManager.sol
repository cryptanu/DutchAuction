// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20Minimal} from "v4-core/interfaces/external/IERC20Minimal.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/types/BeforeSwapDelta.sol";
import {BalanceDelta, toBalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {SwapParams} from "v4-core/types/PoolOperation.sol";
import {Currency} from "v4-core/types/Currency.sol";

contract MockPoolManager {
    using PoolIdLibrary for PoolKey;

    error PoolNotRegistered();
    error PoolKeyMismatch();
    error UnsupportedSwapMode();
    error AmountTooLarge();
    error InvalidHookResponse();

    struct PoolConfig {
        PoolKey key;
        uint256 token1PerToken0;
        uint256 denominator;
        bool exists;
    }

    mapping(PoolId => PoolConfig) public pools;

    event PoolRegistered(PoolId indexed poolId, address token0, address token1, address hook);
    event SwapExecuted(
        PoolId indexed poolId,
        address indexed sender,
        bool zeroForOne,
        uint256 inputAmount,
        uint256 outputAmount,
        bool withHookData
    );

    function registerPool(PoolKey calldata key, uint256 token1PerToken0, uint256 denominator)
        external
        returns (PoolId poolId)
    {
        require(denominator > 0, "denominator=0");
        require(token1PerToken0 > 0, "rate=0");

        poolId = key.toId();
        pools[poolId] = PoolConfig({key: key, token1PerToken0: token1PerToken0, denominator: denominator, exists: true});

        emit PoolRegistered(poolId, Currency.unwrap(key.currency0), Currency.unwrap(key.currency1), address(key.hooks));
    }

    function swap(PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        external
        returns (BalanceDelta delta)
    {
        PoolId poolId = key.toId();
        PoolConfig storage pool = pools[poolId];
        if (!pool.exists) revert PoolNotRegistered();
        if (
            Currency.unwrap(pool.key.currency0) != Currency.unwrap(key.currency0)
                || Currency.unwrap(pool.key.currency1) != Currency.unwrap(key.currency1)
                || address(pool.key.hooks) != address(key.hooks) || pool.key.fee != key.fee
                || pool.key.tickSpacing != key.tickSpacing
        ) revert PoolKeyMismatch();

        (bytes4 beforeSelector, BeforeSwapDelta beforeDelta,) = key.hooks.beforeSwap(msg.sender, key, params, hookData);
        if (
            beforeSelector != IHooks.beforeSwap.selector
                || BeforeSwapDelta.unwrap(beforeDelta) != BeforeSwapDelta.unwrap(BeforeSwapDeltaLibrary.ZERO_DELTA)
        ) {
            revert InvalidHookResponse();
        }

        if (params.amountSpecified >= 0) revert UnsupportedSwapMode();
        uint256 inputAmount = uint256(-params.amountSpecified);
        uint256 outputAmount;

        if (params.zeroForOne) {
            outputAmount = (inputAmount * pool.token1PerToken0) / pool.denominator;

            IERC20Minimal(Currency.unwrap(key.currency0)).transferFrom(msg.sender, address(this), inputAmount);
            IERC20Minimal(Currency.unwrap(key.currency1)).transfer(msg.sender, outputAmount);

            delta = toBalanceDelta(-_toInt128(inputAmount), _toInt128(outputAmount));
        } else {
            outputAmount = (inputAmount * pool.denominator) / pool.token1PerToken0;

            IERC20Minimal(Currency.unwrap(key.currency1)).transferFrom(msg.sender, address(this), inputAmount);
            IERC20Minimal(Currency.unwrap(key.currency0)).transfer(msg.sender, outputAmount);

            delta = toBalanceDelta(_toInt128(outputAmount), -_toInt128(inputAmount));
        }

        (bytes4 afterSelector, int128 hookDelta) = key.hooks.afterSwap(msg.sender, key, params, delta, hookData);
        if (afterSelector != IHooks.afterSwap.selector || hookDelta != 0) {
            revert InvalidHookResponse();
        }

        emit SwapExecuted(poolId, msg.sender, params.zeroForOne, inputAmount, outputAmount, hookData.length > 0);
    }

    function _toInt128(uint256 value) internal pure returns (int128) {
        if (value > uint256(uint128(type(int128).max))) revert AmountTooLarge();
        return int128(uint128(value));
    }
}
