"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Info, Coins, CheckCircle, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useWallet } from "@/hooks/useWallet";
import { useContract } from "@/hooks/useContract";
import { formatNumber } from "@/lib/utils";
import { useRegistrationFee, useRegisteredStablecoins, useStablecoinCount } from "@/hooks/useContractRead";

export default function FactoryPage() {
  const { isConnected, address } = useWallet();
  const { registerStablecoin } = useContract();

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [txSuccess, setTxSuccess] = useState(false);

  // Fetch registered stablecoins from contract
  const { stablecoins: registeredStablecoins, isLoading: coinsLoading, refetch: refetchCoins } = useRegisteredStablecoins();
  const { count: stablecoinCount } = useStablecoinCount();
  
  // Fetch registration fee from blockchain
  const { fee: registrationFee, isLoading: feeLoading, error: feeError } = useRegistrationFee();
  const isValidForm = name.length >= 3 && symbol.length >= 2 && symbol.length <= 5;

  const handleRegister = async () => {
    if (!isValidForm) return;

    setIsLoading(true);
    try {
      await registerStablecoin(
        name,
        symbol.toUpperCase(),
        (txId) => {
          console.log("Stablecoin registered:", txId);
          setTxSuccess(true);
          setIsLoading(false);
          // Refetch stablecoins after a delay to allow transaction to be mined
          setTimeout(() => refetchCoins(), 5000);
        },
        (error) => {
          console.error("Registration failed:", error);
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
            <Coins className="mx-auto h-12 w-12 text-muted-foreground" />
            <CardTitle className="mt-4">Connect Wallet</CardTitle>
            <CardDescription>
              Connect your wallet to create a new stablecoin.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (txSuccess) {
    return (
      <div className="container flex flex-col items-center justify-center px-4 py-24">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <CheckCircle className="mx-auto h-16 w-16 text-green-500" />
            <CardTitle className="mt-4">Stablecoin Registered!</CardTitle>
            <CardDescription>
              Your stablecoin "{name}" ({symbol.toUpperCase()}) has been successfully registered.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              You can now link a token contract to your stablecoin and start minting.
            </p>
            <div className="flex gap-4">
              <Button variant="outline" className="flex-1" onClick={() => {
                setTxSuccess(false);
                setName("");
                setSymbol("");
              }}>
                Create Another
              </Button>
              <Button className="flex-1" asChild>
                <Link href="/dashboard">Go to Dashboard</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Stablecoin Factory</h1>
        <p className="text-muted-foreground">
          Create and register your own stablecoin on the SSE platform
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Registration Form */}
        <Card>
          <CardHeader>
            <CardTitle>Register New Stablecoin</CardTitle>
            <CardDescription>
              Pay a one-time registration fee to create your stablecoin
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <label className="mb-2 block text-sm font-medium">
                Stablecoin Name
              </label>
              <Input
                placeholder="e.g., My Stablecoin"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Minimum 3 characters
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                Symbol
              </label>
              <Input
                placeholder="e.g., MUSD"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                maxLength={5}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                2-5 uppercase characters
              </p>
            </div>

            <div className="rounded-lg bg-muted p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Registration Fee</span>
                <span className="font-bold">
                  {feeLoading ? "Loading..." : feeError ? "Error" : `${registrationFee} STX`}
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {feeError ? "Could not fetch fee from blockchain" : "This fee is sent to the protocol treasury"}
              </p>
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm dark:border-blue-900 dark:bg-blue-950">
              <Info className="mt-0.5 h-4 w-4 text-blue-500" />
              <div className="text-blue-700 dark:text-blue-300">
                <p className="font-medium">What happens next?</p>
                <p className="mt-1">
                  After registration, you'll need to deploy a SIP-010 compliant token 
                  contract and link it to your stablecoin entry.
                </p>
              </div>
            </div>

            <Button
              className="w-full"
              disabled={!isValidForm || feeLoading || registrationFee === null}
              onClick={handleRegister}
              loading={isLoading}
            >
              {feeLoading ? "Loading fee..." : feeError ? "Error loading fee" : `Register Stablecoin (${registrationFee} STX)`}
            </Button>
          </CardContent>
        </Card>

        {/* Registered Stablecoins */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Registered Stablecoins</CardTitle>
                <CardDescription>
                  {stablecoinCount !== null ? `${stablecoinCount} stablecoin${stablecoinCount !== 1 ? 's' : ''} registered` : 'Loading...'}
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => refetchCoins()}>
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {coinsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : registeredStablecoins.length === 0 ? (
              <div className="text-center py-8">
                <Coins className="mx-auto h-12 w-12 text-muted-foreground" />
                <p className="mt-4 text-muted-foreground">No stablecoins registered yet</p>
                <p className="text-sm text-muted-foreground">Be the first to create one!</p>
              </div>
            ) : (
              <div className="space-y-4">
                {registeredStablecoins.map((coin) => (
                  <div
                    key={coin.id}
                    className="flex items-center justify-between rounded-lg border p-4 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">
                        {coin.symbol.charAt(0)}
                      </div>
                      <div>
                        <p className="font-medium">{coin.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {coin.symbol}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge variant="outline">{coin.symbol}</Badge>
                      <p className="mt-1 text-xs text-muted-foreground">
                        ID: {coin.id}
                      </p>
                      {coin.creator === address && (
                        <Badge variant="secondary" className="mt-1">Your coin</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Info Section */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>How It Works</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 sm:grid-cols-3">
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary text-xl font-bold text-primary-foreground">
                1
              </div>
              <h3 className="mt-4 font-semibold">Register</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Pay the registration fee and reserve your stablecoin name and symbol
              </p>
            </div>
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary text-xl font-bold text-primary-foreground">
                2
              </div>
              <h3 className="mt-4 font-semibold">Deploy Token</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Deploy a SIP-010 compliant token contract for your stablecoin
              </p>
            </div>
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary text-xl font-bold text-primary-foreground">
                3
              </div>
              <h3 className="mt-4 font-semibold">Link & Mint</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Link your token contract and start minting through vaults
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
