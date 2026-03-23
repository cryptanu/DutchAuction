// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FHE, euint128} from "cofhe-contracts/FHE.sol";
import {IFHERC20Encrypted} from "../interfaces/IFHERC20Encrypted.sol";

contract MockFHERC20 is IFHERC20Encrypted {
    error InsufficientBalance();
    error InsufficientAllowance();
    error InvalidAddress();

    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        if (to == address(0)) revert InvalidAddress();
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowedAmount = allowance[from][msg.sender];
        if (allowedAmount < amount) revert InsufficientAllowance();

        allowance[from][msg.sender] = allowedAmount - amount;
        _transfer(from, to, amount);
        emit Approval(from, msg.sender, allowance[from][msg.sender]);
        return true;
    }

    function transferFromEncrypted(address from, address to, euint128 encryptedAmount) external returns (bool) {
        FHE.decrypt(encryptedAmount);
        uint128 amount = FHE.getDecryptResult(encryptedAmount);

        uint256 allowedAmount = allowance[from][msg.sender];
        if (allowedAmount < amount) revert InsufficientAllowance();
        allowance[from][msg.sender] = allowedAmount - amount;
        emit Approval(from, msg.sender, allowance[from][msg.sender]);

        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (to == address(0)) revert InvalidAddress();
        if (balanceOf[from] < amount) revert InsufficientBalance();
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
