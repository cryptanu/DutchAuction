import React from "react";

export const Footer = () => {
  return (
    <footer className="border-t border-base-300 bg-base-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-4 py-5 text-xs text-base-content/70 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <p className="m-0">Built with Foundry + Uniswap v4 hooks + cofhe-contracts on Base Sepolia.</p>
        <p className="m-0">Encrypted amount paths supported through pluggable hookData encoding modes.</p>
      </div>
    </footer>
  );
};
