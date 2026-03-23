import { Address, formatUnits } from "viem";

export const shortAddress = (value: Address | undefined, lead = 6, tail = 4): string => {
  if (!value) return "-";
  return `${value.slice(0, lead + 2)}...${value.slice(-tail)}`;
};

export const formatInt = (value: bigint | number | undefined): string => {
  if (value === undefined) return "-";
  const n = typeof value === "bigint" ? value : BigInt(value);
  return n.toString();
};

export const formatPercent = (sold: bigint | undefined, total: bigint | undefined): string => {
  if (sold === undefined || total === undefined || total === 0n) return "0.00";
  const scaled = (sold * 10_000n) / total;
  const whole = scaled / 100n;
  const fraction = scaled % 100n;
  return `${whole.toString()}.${fraction.toString().padStart(2, "0")}`;
};

export const formatTimeRemaining = (seconds: bigint): string => {
  if (seconds <= 0n) return "Ended";

  const days = seconds / 86_400n;
  const hours = (seconds % 86_400n) / 3_600n;
  const minutes = (seconds % 3_600n) / 60n;
  const secs = seconds % 60n;

  if (days > 0n) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0n) return `${hours}h ${minutes}m ${secs}s`;
  return `${minutes}m ${secs}s`;
};

export const formatTokenUnits = (raw: bigint | undefined, decimals = 18): string => {
  if (raw === undefined) return "-";
  return formatUnits(raw, decimals);
};
