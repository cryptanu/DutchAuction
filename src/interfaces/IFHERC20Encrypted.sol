// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {euint128} from "cofhe-contracts/FHE.sol";

interface IFHERC20Encrypted {
    function transferFromEncrypted(address from, address to, euint128 encryptedAmount) external returns (bool);
}
