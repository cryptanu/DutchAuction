"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { baseSepolia } from "viem/chains";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth";

type HeaderMenuLink = {
  label: string;
  href: string;
};

const menuLinks: HeaderMenuLink[] = [
  { label: "Auction", href: "/" },
  { label: "Docs", href: "/docs" },
];

const HeaderMenuLinks = () => {
  const pathname = usePathname();

  return (
    <>
      {menuLinks.map(({ label, href }) => {
        const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <li key={href}>
            <Link
              href={href}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                isActive ? "bg-primary text-primary-content" : "hover:bg-base-300"
              }`}
            >
              {label}
            </Link>
          </li>
        );
      })}
    </>
  );
};

export const Header = () => {
  const { targetNetwork } = useTargetNetwork();
  const isBaseSepolia = targetNetwork.id === baseSepolia.id;

  return (
    <header className="sticky top-0 z-40 border-b border-base-300 bg-base-100/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-3 lg:px-8">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex flex-col leading-tight">
            <span className="text-xs uppercase tracking-[0.15em] text-base-content/60">Stealth Dutch Auction</span>
            <span className="text-lg font-semibold">Pool Swap + Hook Settlement</span>
          </Link>
          <ul className="hidden items-center gap-2 md:flex">
            <HeaderMenuLinks />
          </ul>
        </div>

        <div className="flex items-center gap-3">
          <span
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              isBaseSepolia
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700"
                : "border-amber-500/40 bg-amber-500/10 text-amber-700"
            }`}
          >
            {targetNetwork.name}
          </span>
          <RainbowKitCustomConnectButton />
        </div>
      </div>
      <div className="mx-auto block w-full max-w-7xl px-4 pb-3 md:hidden lg:px-8">
        <ul className="flex items-center gap-2">
          <HeaderMenuLinks />
        </ul>
      </div>
    </header>
  );
};
