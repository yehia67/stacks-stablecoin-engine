import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatAddress(address: string, chars = 4): string {
  if (!address) return "";
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

export function formatNumber(num: number, decimals = 2): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
}

export function formatCurrency(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amount);
}

export function formatSTX(microSTX: number): string {
  return formatNumber(microSTX / 1_000_000, 6);
}

export function microSTXToSTX(microSTX: number): number {
  return microSTX / 1_000_000;
}

export function stxToMicroSTX(stx: number): number {
  return Math.floor(stx * 1_000_000);
}

export function calculateHealthFactor(
  collateralValue: number,
  debtValue: number,
  minRatio: number = 150
): number {
  if (debtValue === 0) return 999;
  return Math.floor((collateralValue / debtValue) * 100);
}

export function getHealthFactorColor(healthFactor: number): string {
  if (healthFactor >= 200) return "text-success";
  if (healthFactor >= 150) return "text-warning";
  return "text-destructive";
}

export function getHealthFactorStatus(healthFactor: number): string {
  if (healthFactor >= 200) return "Healthy";
  if (healthFactor >= 150) return "Caution";
  return "At Risk";
}
