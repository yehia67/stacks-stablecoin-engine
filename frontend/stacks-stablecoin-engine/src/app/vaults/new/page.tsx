"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Info, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useWallet } from "@/hooks/useWallet";
import { useContract } from "@/hooks/useContract";
import { formatNumber, stxToMicroSTX, calculateHealthFactor } from "@/lib/utils";

const collateralTypes = [
  { id: "STX", name: "STX", icon: "S", minRatio: 150, price: 0.50 },
  { id: "sBTC", name: "sBTC", icon: "₿", minRatio: 130, price: 65000 },
];

export default function NewVaultPage() {
  const router = useRouter();
  const { isConnected } = useWallet();
  const { openVault, depositCollateral, mint } = useContract();

  const [selectedCollateral, setSelectedCollateral] = useState(collateralTypes[0]);
  const [collateralAmount, setCollateralAmount] = useState("");
  const [borrowAmount, setBorrowAmount] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [step, setStep] = useState(1);

  const collateralValue = parseFloat(collateralAmount || "0") * selectedCollateral.price;
  const borrowValue = parseFloat(borrowAmount || "0");
  const healthFactor = calculateHealthFactor(collateralValue, borrowValue, selectedCollateral.minRatio);
  const maxBorrow = (collateralValue / selectedCollateral.minRatio) * 100;

  const isValidPosition = 
    parseFloat(collateralAmount) > 0 && 
    parseFloat(borrowAmount) > 0 && 
    healthFactor >= selectedCollateral.minRatio;

  const handleCreateVault = async () => {
    if (!isValidPosition) return;
    
    setIsLoading(true);
    try {
      await openVault(
        (txId) => {
          console.log("Vault opened:", txId);
          setStep(2);
        },
        (error) => {
          console.error("Failed to open vault:", error);
          setIsLoading(false);
        }
      );
    } catch (error) {
      console.error(error);
      setIsLoading(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="container flex flex-col items-center justify-center px-4 py-24">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <CardTitle>Connect Wallet</CardTitle>
            <CardDescription>
              Please connect your wallet to create a vault.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-2xl px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <Button variant="ghost" size="sm" asChild className="mb-4">
          <Link href="/vaults">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Vaults
          </Link>
        </Button>
        <h1 className="text-3xl font-bold">Open New Vault</h1>
        <p className="text-muted-foreground">
          Deposit collateral and borrow stablecoins
        </p>
      </div>

      {/* Progress Steps */}
      <div className="mb-8 flex items-center justify-between">
        {["Select Collateral", "Set Amount", "Confirm"].map((label, index) => (
          <div key={label} className="flex items-center">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                step > index + 1
                  ? "bg-primary text-primary-foreground"
                  : step === index + 1
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {index + 1}
            </div>
            <span className="ml-2 hidden text-sm sm:inline">{label}</span>
            {index < 2 && (
              <div className="mx-4 h-px w-8 bg-border sm:w-16" />
            )}
          </div>
        ))}
      </div>

      {/* Step 1: Select Collateral Type */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Select Collateral Type</CardTitle>
            <CardDescription>
              Choose the asset you want to use as collateral
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {collateralTypes.map((type) => (
              <button
                key={type.id}
                onClick={() => {
                  setSelectedCollateral(type);
                  setStep(2);
                }}
                className={`flex w-full items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted ${
                  selectedCollateral.id === type.id ? "border-primary" : ""
                }`}
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-xl font-bold text-primary">
                    {type.icon}
                  </div>
                  <div className="text-left">
                    <p className="font-medium">{type.name}</p>
                    <p className="text-sm text-muted-foreground">
                      Min. Ratio: {type.minRatio}%
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-medium">${formatNumber(type.price)}</p>
                  <p className="text-sm text-muted-foreground">Current Price</p>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Step 2: Set Amounts */}
      {step === 2 && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Deposit Collateral</CardTitle>
              <CardDescription>
                Enter the amount of {selectedCollateral.name} to deposit
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium">
                  Collateral Amount
                </label>
                <div className="relative">
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={collateralAmount}
                    onChange={(e) => setCollateralAmount(e.target.value)}
                    className="pr-16"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    {selectedCollateral.name}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  ≈ ${formatNumber(collateralValue)}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Borrow Stablecoins</CardTitle>
              <CardDescription>
                Enter the amount of sUSD to borrow
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium">
                  Borrow Amount
                </label>
                <div className="relative">
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={borrowAmount}
                    onChange={(e) => setBorrowAmount(e.target.value)}
                    className="pr-16"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    sUSD
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Max: ${formatNumber(maxBorrow)} sUSD
                </p>
              </div>

              {/* Health Factor Preview */}
              <div className="rounded-lg bg-muted p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium">Health Factor</span>
                  <span
                    className={`font-bold ${
                      healthFactor >= 200
                        ? "text-green-500"
                        : healthFactor >= 150
                        ? "text-yellow-500"
                        : "text-red-500"
                    }`}
                  >
                    {borrowValue > 0 ? `${healthFactor}%` : "—"}
                  </span>
                </div>
                <Progress
                  value={Math.min(healthFactor, 100)}
                  className="h-2"
                  indicatorClassName={
                    healthFactor >= 200
                      ? "bg-green-500"
                      : healthFactor >= 150
                      ? "bg-yellow-500"
                      : "bg-red-500"
                  }
                />
                {healthFactor < selectedCollateral.minRatio && borrowValue > 0 && (
                  <div className="mt-2 flex items-center gap-2 text-sm text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    Health factor too low. Reduce borrow amount.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-4">
            <Button variant="outline" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button
              className="flex-1"
              disabled={!isValidPosition}
              onClick={() => setStep(3)}
            >
              Continue
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Confirm */}
      {step === 3 && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Confirm Your Vault</CardTitle>
              <CardDescription>
                Review your vault details before creating
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Collateral Type</span>
                  <span className="font-medium">{selectedCollateral.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Collateral Amount</span>
                  <span className="font-medium">
                    {collateralAmount} {selectedCollateral.name}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Collateral Value</span>
                  <span className="font-medium">${formatNumber(collateralValue)}</span>
                </div>
                <div className="h-px bg-border" />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Borrow Amount</span>
                  <span className="font-medium">{borrowAmount} sUSD</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Health Factor</span>
                  <span
                    className={`font-bold ${
                      healthFactor >= 200
                        ? "text-green-500"
                        : healthFactor >= 150
                        ? "text-yellow-500"
                        : "text-red-500"
                    }`}
                  >
                    {healthFactor}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Liquidation Price</span>
                  <span className="font-medium">
                    ${formatNumber((borrowValue * selectedCollateral.minRatio) / (parseFloat(collateralAmount) * 100))}
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-lg bg-muted p-4 text-sm">
                <Info className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <p className="text-muted-foreground">
                  By creating this vault, you agree to maintain a minimum collateral 
                  ratio of {selectedCollateral.minRatio}%. If your health factor drops 
                  below this threshold, your vault may be liquidated.
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-4">
            <Button variant="outline" onClick={() => setStep(2)}>
              Back
            </Button>
            <Button
              className="flex-1"
              onClick={handleCreateVault}
              loading={isLoading}
            >
              Create Vault
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
