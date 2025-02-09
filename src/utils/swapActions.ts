import anchor, { BN, Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import * as spl from "@solana/spl-token";

import { type TokenMillType } from "../idl/token_mill";
import TokenMillIdl from "../idl/token_mill.json";

const connection = new anchor.web3.Connection(
  process.env.RPC_URL ?? "",
  "confirmed"
);

const wallet = anchor.Wallet.local();

const program = new Program<TokenMillType>(TokenMillIdl as any, {
  connection,
});

// Fetch required accounts
const quoteTokenMint = new PublicKey(process.env.QUOTE_TOKEN ?? "");
const market = new PublicKey(process.env.MARKET ?? "");
async function swap(){
const marketAccount = await program.account.market.fetch(market);
const config = marketAccount.config;
const configAccount = await program.account.tokenMillConfig.fetch(config);
const baseTokenMint = marketAccount.baseTokenMint;

// Fetch required token accounts
const marketBaseTokenAta = spl.getAssociatedTokenAddressSync(
  baseTokenMint,
  market,
  true
);

// The script creates the token ATAs if necessary, but that can be done separately
const userBaseTokenAta = await spl.getOrCreateAssociatedTokenAccount(
  connection,
  wallet.payer,
  baseTokenMint,
  wallet.publicKey,
  true
);

const marketQuoteTokenAta = await spl.getOrCreateAssociatedTokenAccount(
  connection,
  wallet.payer,
  quoteTokenMint,
  market,
  true
);

const userQuoteTokenAta = await spl.getOrCreateAssociatedTokenAccount(
  connection,
  wallet.payer,
  quoteTokenMint,
  wallet.publicKey
);
// Protocol fees of the swap are sent to the set protocol fee recipient ATA
const protocolQuoteTokenAta = spl.getAssociatedTokenAddressSync(
  quoteTokenMint,
  configAccount.protocolFeeRecipient
);

const u64Max = new BN(2).pow(new BN(64)).sub(new BN(1));

// Swaps require 4 parameters:
// 1. Action: Buy or Sell
// 2. TradeType: ExactInput or ExactOutput
// 3. Amount: Main amount provided. Either input or output depending on TradeType and Action
//     For "Buy" and "ExactInput", this is the amount of quote token to spend
//     For "Sell" and "ExactOutput", this is the amount of base token to receive
//     For "Buy" and "ExactOutput", this is the amount of base token to receive
//     For "Sell" and "ExactInput", this is the amount of quote token to spend
// 4. OtherAmountThreshold: Either the maximum amount of quote token to spend or the minimum amount of base token to receive, depending on TradeType and Action. Translates to slippage tolerance.
//     For "Buy" and "ExactInput", this is the minimum amount of base token to receive
//     For "Sell" and "ExactOutput", this is the maximum amount of quote token to spend
//     For "Buy" and "ExactOutput", this is the minimum amount of quote token to spend
//     For "Sell" and "ExactInput", this is the maximum amount of base token to receive
// Best way to compute this value is to simulate the swap with a dummy value for otherAmountThreshold, get the swap outcome and apply the desired slippage tolerance.
// For example, for a "buy" action with 1 SOL as input, simulate the swap with 0 as otherAmountThreshold, get the output amount and apply a 1% slippage tolerance to get the final value for otherAmountThreshold.

const swapActions: any[] = [];
swapActions.push([{ buy: {} }, { exactOutput: {} }, new BN(100e6), u64Max]); // Here maxAmountOut is very high to simplify the example, in practice it should be computed as explained above
swapActions.push([{ sell: {} }, { exactInput: {} }, new BN(50e6), new BN(0)]); // Same here, minAmountOut is 0 to simplify the example
swapActions.push([{ buy: {} }, { exactOutput: {} }, new BN(300e6), u64Max]);
swapActions.push([{ buy: {} }, { exactOutput: {} }, new BN(432e6), u64Max]);
swapActions.push([{ sell: {} }, { exactInput: {} }, new BN(100e6), new BN(0)]);

// Here the swap authority is an EOA, so we can directly call the permissionedSwap instruction, but in most case it would be performed by the program built on top of Token Mill.
for (const action of swapActions) {
  const transaction = await program.methods
    .permissionedSwap(...action)
    .accountsPartial({
      config,
      market,
      baseTokenMint,
      quoteTokenMint,
      marketBaseTokenAta,
      marketQuoteTokenAta: marketQuoteTokenAta.address,
      userBaseTokenAccount: userBaseTokenAta.address,
      userQuoteTokenAccount: userQuoteTokenAta.address,
      protocolQuoteTokenAta,
      referralTokenAccount: program.programId,
      swapAuthority: wallet.publicKey, // Would be the swap authority PDA in most cases
      user: wallet.publicKey,
      baseTokenProgram: spl.TOKEN_PROGRAM_ID,
      quoteTokenProgram: spl.TOKEN_PROGRAM_ID,
    })
    .signers([wallet.payer])
    .transaction();

  const transactionSignature = await connection.sendTransaction(transaction, [
    wallet.payer,
  ]);

  const result = await connection.confirmTransaction(transactionSignature);

  if (result.value.err) {
    console.log("Swap failed:", result.value.err);
    process.exit(1);
  }

  console.log("Swap complete");
}

// This is an example of how to claim creator fees
{
  const transaction = await program.methods
    .claimCreatorFees()
    .accountsPartial({
      market,
      quoteTokenMint,
      marketQuoteTokenAta: marketQuoteTokenAta.address,
      creatorQuoteTokenAta: userQuoteTokenAta.address,
      creator: wallet.publicKey,
      quoteTokenProgram: spl.TOKEN_PROGRAM_ID,
    })
    .signers([wallet.payer])
    .transaction();

  const transactionSignature = await connection.sendTransaction(transaction, [
    wallet.payer,
  ]);

  const result = await connection.confirmTransaction(transactionSignature);

  if (result.value.err) {
    console.log("Creator fees claim failed:", result.value.err);
    process.exit(1);
  }

  console.log("Creator fees claimed");
}
}