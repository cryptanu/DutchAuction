// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {EncryptedInput, FunctionId, ITaskManager} from "cofhe-contracts/ICofhe.sol";

contract MockTaskManager is ITaskManager {
    error UnsupportedFunction(FunctionId functionId);
    error UnknownCiphertext(uint256 ctHash);

    uint256 private nextHandle;
    mapping(uint256 => uint256) private plaintexts;
    mapping(uint256 => bool) private known;
    mapping(uint256 => mapping(address => bool)) private allowed;
    mapping(uint256 => bool) private publiclyAllowed;

    function createTask(
        uint8, /* returnType */
        FunctionId funcId,
        uint256[] memory encryptedInputs,
        uint256[] memory extraInputs
    )
        external
        returns (uint256)
    {
        uint256 value;

        if (funcId == FunctionId.trivialEncrypt) {
            value = extraInputs[0];
        } else if (funcId == FunctionId.cast) {
            value = _resolve(encryptedInputs[0]);
        } else if (funcId == FunctionId.select) {
            uint256 control = _resolve(encryptedInputs[0]);
            value = control != 0 ? _resolve(encryptedInputs[1]) : _resolve(encryptedInputs[2]);
        } else if (funcId == FunctionId.add) {
            value = _resolve(encryptedInputs[0]) + _resolve(encryptedInputs[1]);
        } else if (funcId == FunctionId.sub) {
            value = _resolve(encryptedInputs[0]) - _resolve(encryptedInputs[1]);
        } else if (funcId == FunctionId.mul) {
            value = _resolve(encryptedInputs[0]) * _resolve(encryptedInputs[1]);
        } else if (funcId == FunctionId.and) {
            value = _resolve(encryptedInputs[0]) & _resolve(encryptedInputs[1]);
        } else if (funcId == FunctionId.or) {
            value = _resolve(encryptedInputs[0]) | _resolve(encryptedInputs[1]);
        } else if (funcId == FunctionId.div) {
            value = _resolve(encryptedInputs[0]) / _resolve(encryptedInputs[1]);
        } else if (funcId == FunctionId.rem) {
            value = _resolve(encryptedInputs[0]) % _resolve(encryptedInputs[1]);
        } else if (funcId == FunctionId.eq) {
            value = _resolve(encryptedInputs[0]) == _resolve(encryptedInputs[1]) ? 1 : 0;
        } else if (funcId == FunctionId.ne) {
            value = _resolve(encryptedInputs[0]) != _resolve(encryptedInputs[1]) ? 1 : 0;
        } else if (funcId == FunctionId.lt) {
            value = _resolve(encryptedInputs[0]) < _resolve(encryptedInputs[1]) ? 1 : 0;
        } else if (funcId == FunctionId.lte) {
            value = _resolve(encryptedInputs[0]) <= _resolve(encryptedInputs[1]) ? 1 : 0;
        } else if (funcId == FunctionId.gt) {
            value = _resolve(encryptedInputs[0]) > _resolve(encryptedInputs[1]) ? 1 : 0;
        } else if (funcId == FunctionId.gte) {
            value = _resolve(encryptedInputs[0]) >= _resolve(encryptedInputs[1]) ? 1 : 0;
        } else if (funcId == FunctionId.min) {
            uint256 lhs = _resolve(encryptedInputs[0]);
            uint256 rhs = _resolve(encryptedInputs[1]);
            value = lhs < rhs ? lhs : rhs;
        } else if (funcId == FunctionId.max) {
            uint256 lhs = _resolve(encryptedInputs[0]);
            uint256 rhs = _resolve(encryptedInputs[1]);
            value = lhs > rhs ? lhs : rhs;
        } else if (funcId == FunctionId.not) {
            uint256 input = _resolve(encryptedInputs[0]);
            value = input <= 1 ? (input == 0 ? 1 : 0) : ~input;
        } else {
            revert UnsupportedFunction(funcId);
        }

        uint256 handle = _newHandle(value);
        return handle;
    }

    function createRandomTask(uint8, uint256 seed, int32 securityZone) external returns (uint256) {
        return _newHandle(uint256(keccak256(abi.encodePacked(seed, securityZone, block.number))));
    }

    function createDecryptTask(uint256 ctHash, address requestor) external {
        allowed[ctHash][requestor] = true;
        if (!known[ctHash]) {
            known[ctHash] = true;
            plaintexts[ctHash] = 0;
        }
    }

    function verifyInput(EncryptedInput memory input, address sender) external returns (uint256) {
        known[input.ctHash] = true;
        allowed[input.ctHash][sender] = true;
        return input.ctHash;
    }

    function allow(uint256 ctHash, address account) external {
        allowed[ctHash][account] = true;
    }

    function isAllowed(uint256 ctHash, address account) external view returns (bool) {
        return allowed[ctHash][account];
    }

    function isPubliclyAllowed(uint256 ctHash) external view returns (bool) {
        return publiclyAllowed[ctHash];
    }

    function allowGlobal(uint256 ctHash) external {
        publiclyAllowed[ctHash] = true;
    }

    function allowTransient(uint256 ctHash, address account) external {
        allowed[ctHash][account] = true;
    }

    function getDecryptResultSafe(uint256 ctHash) external view returns (uint256, bool) {
        return (plaintexts[ctHash], known[ctHash]);
    }

    function getDecryptResult(uint256 ctHash) external view returns (uint256) {
        if (!known[ctHash]) revert UnknownCiphertext(ctHash);
        return plaintexts[ctHash];
    }

    function publishDecryptResult(uint256 ctHash, uint256 result, bytes calldata) external {
        plaintexts[ctHash] = result;
        known[ctHash] = true;
    }

    function publishDecryptResultBatch(uint256[] calldata ctHashes, uint256[] calldata results, bytes[] calldata)
        external
    {
        uint256 len = ctHashes.length;
        for (uint256 i = 0; i < len; ++i) {
            plaintexts[ctHashes[i]] = results[i];
            known[ctHashes[i]] = true;
        }
    }

    function verifyDecryptResult(uint256, uint256, bytes calldata) external pure returns (bool) {
        return true;
    }

    function verifyDecryptResultSafe(uint256, uint256, bytes calldata) external pure returns (bool) {
        return true;
    }

    function _newHandle(uint256 value) internal returns (uint256 handle) {
        if (nextHandle == 0) nextHandle = 1;
        handle = nextHandle;
        nextHandle = handle + 1;
        plaintexts[handle] = value;
        known[handle] = true;
    }

    function _resolve(uint256 handle) internal view returns (uint256) {
        if (!known[handle]) revert UnknownCiphertext(handle);
        return plaintexts[handle];
    }
}
