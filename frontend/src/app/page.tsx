"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Shield, Coins, RefreshCw, Layers, Droplets, Loader2, CheckCircle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useWallet } from "@/hooks/useWallet";
import { useContract } from "@/hooks/useContract";
import { FAUCET_COLLATERALS, IS_MAINNET, getExplorerTxUrl } from "@/lib/constants";

const features = [
  {
    icon: Shield,
    title: "Bitcoin-Backed Security",
    description: "Overcollateralized stablecoins backed by sBTC, inheriting Bitcoin's security.",
  },
  {
    icon: Coins,
    title: "Multi-Asset Vaults",
    description: "Deposit multiple collateral types with independent health factors per asset.",
  },
  {
    icon: RefreshCw,
    title: "Cross-Chain Bridge",
    description: "Bridge your stablecoins between Stacks and Ethereum seamlessly.",
  },
  {
    icon: Layers,
    title: "Create Stablecoins",
    description: "Launch your own stablecoin with configurable parameters and fees.",
  },
];

export default function Home() {
  const { isConnected, mounted, connect, address } = useWallet();
  const { faucetMint } = useContract();
  const [mintingToken, setMintingToken] = useState<string | null>(null);
  const [mintSuccess, setMintSuccess] = useState<{ token: string; txId: string } | null>(null);

  // Wait for client-side hydration to check wallet state
  const showDashboardButton = mounted && isConnected;

  const handleFaucetMint = async (collateral: typeof FAUCET_COLLATERALS[0]) => {
    if (!address) return;
    
    setMintingToken(collateral.contractName);
    setMintSuccess(null);
    
    await faucetMint(
      collateral.contractName,
      collateral.mintAmount,
      address,
      (txId) => {
        setMintingToken(null);
        setMintSuccess({ token: collateral.symbol, txId });
      },
      (error) => {
        console.error("Faucet mint error:", error);
        setMintingToken(null);
      }
    );
  };

  return (
    <div className="flex flex-col">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-b from-primary/5 via-background to-background">
        <div className="container px-4 py-24 md:py-32">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
              Bitcoin-Backed{" "}
              <span className="text-primary">Stablecoins</span>{" "}
              on Stacks
            </h1>
            <p className="mt-6 text-lg text-muted-foreground md:text-xl">
              Create, manage, and bridge overcollateralized stablecoins powered by 
              Bitcoin security. The most secure DeFi infrastructure on Stacks.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              {showDashboardButton ? (
                <Button asChild size="lg">
                  <Link href="/dashboard">
                    Go to Dashboard
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
              ) : (
                <Button size="lg" onClick={connect}>
                  Connect Wallet
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              )}
              <Button variant="outline" size="lg" asChild>
                <Link href="https://docs.stacks.co" target="_blank">
                  Read Documentation
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section - Will be populated from contracts */}
      <section className="border-y bg-muted/50">
        <div className="container px-4 py-12">
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
            <div className="text-center">
              <div className="text-3xl font-bold text-primary md:text-4xl">—</div>
              <div className="mt-1 text-sm text-muted-foreground">Total Value Locked</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-primary md:text-4xl">—</div>
              <div className="mt-1 text-sm text-muted-foreground">Active Vaults</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-primary md:text-4xl">—</div>
              <div className="mt-1 text-sm text-muted-foreground">Stablecoins Created</div>
            </div>
          </div>
        </div>
      </section>

      {/* Testnet Faucet Section */}
      {!IS_MAINNET && (
        <section className="container px-4 py-12">
          <Card className="border-dashed border-2 border-primary/30 bg-primary/5">
            <CardHeader className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 mb-2">
                <Droplets className="h-6 w-6 text-primary" />
              </div>
              <CardTitle>Testnet Faucet</CardTitle>
              <CardDescription>
                Get test collateral tokens to try out SSE. Each mint gives you 10 tokens.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!isConnected ? (
                <div className="text-center">
                  <p className="text-sm text-muted-foreground mb-4">
                    Connect your wallet to mint test collateral tokens.
                  </p>
                  <Button onClick={connect}>Connect Wallet</Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md mx-auto">
                    {FAUCET_COLLATERALS.map((collateral) => (
                      <Button
                        key={collateral.contractName}
                        variant="outline"
                        className="h-auto py-4 flex flex-col items-center gap-2"
                        disabled={mintingToken !== null}
                        onClick={() => handleFaucetMint(collateral)}
                      >
                        {mintingToken === collateral.contractName ? (
                          <>
                            <Loader2 className="h-5 w-5 animate-spin" />
                            <span>Minting...</span>
                          </>
                        ) : (
                          <>
                            <Coins className="h-5 w-5" />
                            <span>Mint 10 {collateral.symbol}</span>
                          </>
                        )}
                      </Button>
                    ))}
                  </div>
                  {mintSuccess && (
                    <div className="flex items-center justify-center gap-2 text-sm text-green-600 dark:text-green-400">
                      <CheckCircle className="h-4 w-4" />
                      <span>Minted 10 {mintSuccess.token}!</span>
                      <a
                        href={getExplorerTxUrl(mintSuccess.txId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 underline hover:no-underline"
                      >
                        View tx <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* Features Section */}
      <section className="container px-4 py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Everything You Need for DeFi on Bitcoin
          </h2>
          <p className="mt-4 text-muted-foreground">
            A complete infrastructure for creating and managing stablecoins with 
            Bitcoin-level security.
          </p>
        </div>
        <div className="mx-auto mt-16 grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-2">
          {features.map((feature) => (
            <Card key={feature.title} className="relative overflow-hidden">
              <CardHeader>
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                  <feature.icon className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="mt-4">{feature.title}</CardTitle>
                <CardDescription>{feature.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      {/* How It Works Section */}
      <section className="border-t bg-muted/30">
        <div className="container px-4 py-24">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              How It Works
            </h2>
            <p className="mt-4 text-muted-foreground">
              Get started with SSE in four simple steps.
            </p>
          </div>
          <div className="mx-auto mt-16 grid max-w-4xl grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { step: "1", title: "Connect Wallet", desc: "Link your Stacks wallet" },
              { step: "2", title: "Deposit Collateral", desc: "Add sBTC or other assets" },
              { step: "3", title: "Mint Stablecoins", desc: "Borrow against your collateral" },
              { step: "4", title: "Use Anywhere", desc: "Trade, bridge, or hold" },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary text-xl font-bold text-primary-foreground">
                  {item.step}
                </div>
                <h3 className="mt-4 font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container px-4 py-24">
        <Card className="bg-primary text-primary-foreground">
          <CardContent className="flex flex-col items-center justify-center p-12 text-center">
            <h2 className="text-2xl font-bold sm:text-3xl">
              Ready to Get Started?
            </h2>
            <p className="mt-4 max-w-md text-primary-foreground/80">
              Join thousands of users already using SSE to create and manage 
              Bitcoin-backed stablecoins.
            </p>
            <Button
              size="lg"
              variant="secondary"
              className="mt-8"
              onClick={showDashboardButton ? undefined : connect}
              asChild={showDashboardButton}
            >
              {showDashboardButton ? (
                <Link href="/vaults">Open a Vault</Link>
              ) : (
                <>Connect Wallet</>
              )}
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
