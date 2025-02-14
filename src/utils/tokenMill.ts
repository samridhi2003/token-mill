import dotenv from "dotenv";
import bs58 from "bs58";
import * as anchor from "@coral-xyz/anchor";
import * as spl from "@solana/spl-token";
import { Connection, PublicKey, Keypair, Transaction } from "@solana/web3.js";
import TokenMillIDL from "../idl/token_mill.json";
import BN from "bn.js";
import {
  TokenParams,
  StakingParams,
  VestingParams,
  TokenMillResponse,
  SwapParams,
  TokenMetadata,
  SwapAmounts
} from "../types/interfaces";
import { TokenMillType } from "../idl/token_mill";
import axios from "axios";

// Initialize dotenv
dotenv.config();

// Cast the imported IDL to the correct type
const idl = TokenMillIDL as unknown as TokenMillType;

/**
 * Parameters for releasing vested tokens
 */
interface ReleaseVestingParams {
  marketAddress: string;
  stakingAddress: string;
  stakePositionAddress: string;
  vestingPlanAddress: string;
  baseTokenMint: string;
}

/**
 * Response data for vesting creation
 */
interface CreateVestingResponse {
  vestingAccount: string;
  signature: string;
}

/**
 * Response data for vesting release
 */
interface ReleaseVestingResponse {
  signature: string;
}

/**
 * Client for interacting with the TokenMill program on Solana.
 * Handles token creation, market management, staking, and vesting functionality.
 */
export class TokenMillClient {
  connection: anchor.web3.Connection;
  wallet: anchor.web3.Keypair;
  program: anchor.Program<TokenMillType>;
  config: PublicKey = new PublicKey(process.env.TOKEN_MILL_CONFIG_PDA!);

  /**
   * Initializes a new TokenMillClient instance.
   * Requires RPC_URL and WALLET_PRIVATE_KEY environment variables to be set.
   */
  constructor() {
    this.connection = new Connection(process.env.RPC_URL!);

    // Initialize wallet from private key
    const privateKey = bs58.decode(process.env.WALLET_PRIVATE_KEY!);
    this.wallet = Keypair.fromSecretKey(privateKey);

    const provider = new anchor.AnchorProvider(
      this.connection,
      new anchor.Wallet(this.wallet),
      anchor.AnchorProvider.defaultOptions()
    );

    // Initialize program
    this.program = new anchor.Program<TokenMillType>(
      idl as TokenMillType,
      provider
    );
  }

  /**
   * Creates a new TokenMill configuration.
   * @param authority - The authority address that can manage the config
   * @param protocolFeeRecipient - Address to receive protocol fees
   * @param protocolFeeShare - Percentage of fees allocated to protocol
   * @param referralFeeShare - Percentage of fees allocated to referrals
   */
  async createConfig(
    authority: PublicKey,
    protocolFeeRecipient: PublicKey,
    protocolFeeShare: number,
    referralFeeShare: number
  ) {
    try {
      const config = Keypair.generate();

      const tx = await this.program.methods
        .createConfig(
          authority,
          protocolFeeRecipient,
          protocolFeeShare,
          referralFeeShare
        )
        .accountsPartial({
          config: config.publicKey,
          payer: this.wallet.publicKey,
        })
        .signers([config])
        .rpc();

      console.log("Config created:", config.publicKey.toString());
      this.config = config.publicKey;
    } catch (error) {
      console.error("Error creating config:", error);
    }
  }

  /**
   * Creates a quote token badge for wSOL.
   * @param params - Parameters for badge creation (currently unused)
   */
  async getTokenBadge(params: any) {
    const wSol = new PublicKey("So11111111111111111111111111111111111111112");
    const wSolAccount = await this.connection.getAccountInfo(wSol);

    const transaction = await this.program.methods
      .createQuoteAssetBadge()
      .accountsPartial({
        config: this.config,
        tokenMint: wSol,
        authority: this.wallet.publicKey,
      })
      .signers([this.wallet])
      .transaction();
    const transactionSignature = await this.connection.sendTransaction(
      transaction,
      [this.wallet]
    );

    await this.connection.confirmTransaction(transactionSignature);

    console.log("wSol quote token badge created", wSolAccount);
  }

  /**
   * Creates a new market for token trading.
   * @param params - Market creation parameters including:
   *   - name: Token name
   *   - symbol: Token symbol
   *   - uri: Metadata URI
   *   - totalSupply: Total token supply
   *   - creatorFeeShare: Percentage of fees for creator
   *   - stakingFeeShare: Percentage of fees for staking
   *   - quoteTokenMint: Address of quote token mint
   * @returns Object containing market address, base token mint, and transaction signature
   */
  async lockMarket(market: PublicKey, swapAuthority: PublicKey) {
    try {
      const transaction = await this.program.methods
        .lockMarket(swapAuthority)
        .accountsPartial({
          market,
          creator: this.wallet.publicKey,
        })
        .signers([this.wallet])
        .transaction();

      const transactionSignature = await this.connection.sendTransaction(
        transaction,
        [this.wallet]
      );

      const result = await this.connection.confirmTransaction(
        transactionSignature
      );

      if (result.value.err) {
        console.log("Market lock failed:", result.value.err);
        throw new Error(`Market lock failed: ${result.value.err}`);
      }

      console.log(
        "Market locked successfully with authority:",
        swapAuthority.toString()
      );
      return transactionSignature;
    } catch (error: any) {
      console.error("Error locking market:", error);
      throw error;
    }
  }

  async createMarket(params: any) {
    const { name, symbol, uri, totalSupply, creatorFeeShare, stakingFeeShare } =
      params;

    console.log("Wallet:", this.wallet.publicKey.toString());

    // Only wSOL is currently supported as quote token
    // So11111111111111111111111111111111111111112
    const quoteTokenMint = new PublicKey(
      "So11111111111111111111111111111111111111112"
    );

    try {
      const baseTokenMint = Keypair.generate();

      const quoteTokenBadge = PublicKey.findProgramAddressSync(
        [
          Buffer.from("quote_token_badge"),
          this.config.toBuffer(),
          new PublicKey(quoteTokenMint).toBuffer(),
        ],
        this.program.programId
      )[0];

      const market = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), baseTokenMint.publicKey.toBuffer()],
        this.program.programId
      )[0];

      console.log("Market:", market.toString());
      console.log("Base Token Mint:", baseTokenMint.publicKey.toString());
      console.log("Quote Token Badge:", quoteTokenBadge.toString());

      // Creating the market requires providing its base token ATA
      // As the whole token supply is minted and sent to the market account
      const marketBaseTokenAta = spl.getAssociatedTokenAddressSync(
        baseTokenMint.publicKey,
        market,
        true
      );

      const metaplexProgramId = new PublicKey(
        "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
      );

      const baseTokenMetadata = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata"),
          metaplexProgramId.toBuffer(),
          baseTokenMint.publicKey.toBuffer(),
        ],
        metaplexProgramId
      )[0];

      const tx = await this.program.methods
        .createMarketWithSpl(
          name,
          symbol,
          uri,
          new anchor.BN(totalSupply * 10 ** 6),
          creatorFeeShare,
          stakingFeeShare
        )
        .accountsPartial({
          config: this.config,
          market: market,
          baseTokenMint: baseTokenMint.publicKey,
          baseTokenMetadata: baseTokenMetadata,
          marketBaseTokenAta: marketBaseTokenAta,
          quoteTokenMint: new PublicKey(quoteTokenMint),
          quoteTokenBadge: quoteTokenBadge,
          creator: this.wallet.publicKey,
        })
        .signers([baseTokenMint, this.wallet])
        .rpc({
          commitment: "finalized",
        });

      console.log("Market created:", market.toString());

      const swapAuthority = Keypair.fromSecretKey(
        bs58.decode(process.env.SWAP_AUTHORITY_KEY!)
      );

      const swapAuthorityBadge = PublicKey.findProgramAddressSync(
        [
          Buffer.from("swap_authority"),
          market.toBuffer(),
          swapAuthority.publicKey.toBuffer(),
        ],
        this.program.programId
      )[0];

      const lockTX = await this.program.methods
        .lockMarket(swapAuthority.publicKey)
        .accountsPartial({
          market: market,
          swapAuthorityBadge: swapAuthorityBadge,
          creator: this.wallet.publicKey,
        })
        .signers([this.wallet])
        .transaction();

      const lockSignature = await this.connection.sendTransaction(lockTX, [
        this.wallet,
      ]);

      const lockResult = await this.connection.confirmTransaction(
        lockSignature
      );

      if (lockResult.value.err) {
        console.log("Market lock failed:", lockResult.value.err);
        throw new Error(`Market lock failed: ${lockResult.value.err}`);
      }

      console.log(
        "Market locked successfully with authority:",
        swapAuthority.publicKey.toString()
      );
      console.log(baseTokenMint.publicKey);

      await this.setPrices(market);

      return {
        success: true,
        marketAddress: market.toString(),
        baseTokenMint: baseTokenMint.publicKey.toString(),
        signature: tx,
      };
    } catch (error: any) {
      console.error("Error creating market:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Sets the prices for a market.
   * @param market - The market to set prices for
   */
  async setPrices(market: PublicKey) {
    const bidPrices: BN[] = [];
    const askPrices: BN[] = [];

    for (let i = 0; i < 11; i++) {
      bidPrices.push(new BN(i * 9e5));
      askPrices.push(new BN(i * 1e6));
    }

    const transaction = await this.program.methods
      .setMarketPrices(bidPrices, askPrices)
      .accountsPartial({
        market: market,
        creator: this.wallet.publicKey,
      })
      .signers([this.wallet])
      .transaction();

    const transactionSignature = await this.connection.sendTransaction(
      transaction,
      [this.wallet]
    );

    const result = await this.connection.confirmTransaction(
      transactionSignature
    );

    console.log("Prices set successfully");

    if (result.value.err) {
      console.log("Set prices failed:", result.value.err);
      process.exit(1);
    }
  }
  async freeMarket(
    market: string
  ): Promise<{ success: boolean; signature?: string; message: string }> {
    try {
      // Validate market address
      if (!market) {
        throw new Error("Market address is required");
      }
      const marketPubkey = new PublicKey(market);

      // Fetch market account
      const marketAccount = await this.program.account.market.fetch(
        marketPubkey
      );
      const quoteTokenMint = new PublicKey(
        "So11111111111111111111111111111111111111112"
      );

      // Get market base token ATA
      const marketQuoteTokenAta = spl.getAssociatedTokenAddressSync(
        quoteTokenMint,
        marketPubkey,
        true
      );

      // Fetch market base token balance
      const marketBaseTokenAccount =
        await this.connection.getTokenAccountBalance(marketQuoteTokenAta);
      const baseTokenBalance = marketBaseTokenAccount.value.uiAmount || 0;

      // Check if balance is at least 69 WSOL
      const REQUIRED_WSOL_AMOUNT = 69;

      if (baseTokenBalance < REQUIRED_WSOL_AMOUNT) {
        throw new Error(
          `Market cannot be freed yet. Current balance: ${baseTokenBalance} WSOL. Required: ${REQUIRED_WSOL_AMOUNT} WSOL`
        );
      }

      console.log("Market balance:", baseTokenBalance, "WSOL");
      console.log("Market:", marketPubkey.toString());

      // Get swap authority
      const swapAuthorityKeypair = Keypair.fromSecretKey(
        bs58.decode(process.env.SWAP_AUTHORITY_KEY!)
      );
      const swapAuthority = swapAuthorityKeypair.publicKey;
      console.log("Swap Authority Public Key:", swapAuthority.toString());
      const [swapAuthorityBadge] = PublicKey.findProgramAddressSync(
        [Buffer.from("swap_authority"), marketPubkey.toBuffer()],
        this.program.programId
      );
      // Build and send transaction
      const transaction = await this.program.methods
        .freeMarket()
        .accountsPartial({
          market,
          swapAuthority,
        })
        .signers([this.wallet, swapAuthorityKeypair])
        .transaction();

      const signature = await this.connection.sendTransaction(transaction, [
        this.wallet,
        swapAuthorityKeypair,
      ]);

      const confirmation = await this.connection.confirmTransaction(signature);

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${confirmation.value.err}`);
      }

      return {
        success: true,
        signature,
        message: "Market freed successfully",
      };
    } catch (error: any) {
      console.error("Failed to free market:", error);
      throw new Error(`Failed to free market: ${error.message}`);
    }
  }

  /**
   * Creates a new token with associated market.
   * @param params - Token creation parameters including:
   *   - name: Token name
   *   - symbol: Token symbol
   *   - uri: Metadata URI
   *   - totalSupply: Total token supply
   *   - recipient: Token recipient address
   *   - creatorFeeShare: Percentage of fees for creator
   *   - stakingFeeShare: Percentage of fees for staking
   *   - quoteTokenMint: Address of quote token mint
   * @returns TokenMillResponse containing market address, base token mint, and transaction signatures
   */
  async createToken(): Promise<
    TokenMillResponse<{
      mint: string;
      mintSignature: string;
    }>
  > {
    try {
      const mint = Keypair.generate();
      await spl.createMint(
        this.connection,
        this.wallet,
        this.wallet.publicKey,
        null,
        6,
        mint,
        {
          commitment: "confirmed",
        },
        spl.TOKEN_PROGRAM_ID
      );

      console.log("Token created:", mint.publicKey.toBase58());
      const userAta = await spl.createAssociatedTokenAccount(
        this.connection,
        this.wallet,
        mint.publicKey,
        this.wallet.publicKey,
        {
          commitment: "confirmed",
        },
        spl.TOKEN_PROGRAM_ID,
        spl.ASSOCIATED_TOKEN_PROGRAM_ID,
        true
      );
      console.log("Associated token account created:", userAta.toBase58());
      const mintSignature = await spl.mintTo(
        this.connection,
        this.wallet,
        mint.publicKey,
        userAta,
        this.wallet.publicKey,
        100_000_000e6,
        [],
        {
          commitment: "confirmed",
        },
        spl.TOKEN_PROGRAM_ID
      );

      console.log(
        "Minted 100,000,000 tokens to:",
        this.wallet.publicKey.toBase58()
      );
      return {
        success: true,
        data: {
          mint: mint.publicKey.toString(),
          mintSignature: mintSignature,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Retrieves the Program Derived Address (PDA) for the config account.
   * @returns Promise resolving to the config PDA
   */
  async getConfigPDA(): Promise<PublicKey> {
    try {
      // Calculate the PDA for the config account
      const [configPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("config")], // Seed must match the program's logic
        this.program.programId // Program ID
      );
      return configPDA;
    } catch (error) {
      console.error("Error calculating config PDA:", error);
      throw new Error("Failed to calculate config PDA");
    }
  }

  /**
   * Creates a new staking position for a market.
   * @param params - Staking parameters including market address
   * @returns TokenMillResponse containing transaction signature
   */
  async stake(params: StakingParams): Promise<
    TokenMillResponse<{
      signature: string;
    }>
  > {
    try {
      const marketPubkey = new PublicKey(params.marketAddress);
      const market = await this.program.account.market.fetch(marketPubkey);

      const stakingAccount = await this.getStakingAccount(
        marketPubkey,
        this.wallet.publicKey
      );

      const tx = await this.program.methods
        .createStaking()
        .accountsPartial({
          market: marketPubkey,
          staking: stakingAccount,
          payer: this.wallet.publicKey,
        })
        .signers([this.wallet])
        .rpc();

      return {
        success: true,
        data: { signature: tx },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Creates a new vesting plan for token distribution.
   * @param params - Vesting parameters including:
   *   - marketAddress: Address of the market
   *   - recipient: Recipient of vested tokens
   *   - baseTokenMint: Token mint address
   *   - amount: Amount to vest
   *   - startTime: Vesting start timestamp
   *   - duration: Vesting duration in seconds
   *   - cliffDuration: Optional cliff duration in seconds
   * @returns TokenMillResponse containing vesting account address and transaction signature
   */
  async createVesting(
    params: VestingParams
  ): Promise<TokenMillResponse<CreateVestingResponse>> {
    try {
      // Initialize key variables
      const marketPubkey = new PublicKey(params.marketAddress);
      const recipientPubkey = new PublicKey(params.recipient);
      const vestingAccount = Keypair.generate();

      const marketAccount = await this.program.account.market.fetch(
        marketPubkey
      );
      const baseTokenMint = marketAccount.baseTokenMint;

      console.log("Base Token Mint:", baseTokenMint.toString());

      // Get ATAs
      const userBaseTokenAta = spl.getAssociatedTokenAddressSync(
        baseTokenMint,
        this.wallet.publicKey,
        true,
        spl.TOKEN_2022_PROGRAM_ID,
        spl.ASSOCIATED_TOKEN_PROGRAM_ID
      );

      // Get user base token balance
      const userBaseTokenBalance = await this.connection.getTokenAccountBalance(
        userBaseTokenAta
      );
      console.log(
        "User Base Token Balance:",
        userBaseTokenBalance.value.uiAmount
      );

      const marketBaseTokenAta = spl.getAssociatedTokenAddressSync(
        baseTokenMint,
        marketPubkey,
        true,
        spl.TOKEN_2022_PROGRAM_ID,
        spl.ASSOCIATED_TOKEN_PROGRAM_ID
      );

      // Create user ATA if needed
      const doesUserHaveBaseTokenATA = await this.connection.getAccountInfo(
        userBaseTokenAta
      );
      console.log("Does User Have Base Token ATA:", doesUserHaveBaseTokenATA);
      if (!doesUserHaveBaseTokenATA) {
        await spl.createAssociatedTokenAccount(
          this.connection,
          this.wallet,
          baseTokenMint,
          this.wallet.publicKey,
          { commitment: "confirmed" },
          spl.TOKEN_2022_PROGRAM_ID,
          spl.ASSOCIATED_TOKEN_PROGRAM_ID,
          true
        );
      }

      // Setup staking if needed
      const staking = PublicKey.findProgramAddressSync(
        [Buffer.from("market_staking"), marketPubkey.toBuffer()],
        this.program.programId
      )[0];

      const stakePositionAccountInfo = await this.connection.getAccountInfo(
        staking
      );
      console.log("Stake Position Account Info:", stakePositionAccountInfo);

      await this.setupStakingIfNeeded(staking, marketPubkey);
      await this.setupStakePositionIfNeeded(marketPubkey);

      // Create vesting plan
      const tx = await this.program.methods
        .createVestingPlan(
          new BN(Date.now() / 1000),
          new BN(params.amount),
          new BN(params.duration),
          params.cliffDuration ? new BN(params.cliffDuration) : new BN(0)
        )
        .accountsPartial({
          market: marketPubkey,
          staking,
          stakePosition: await this.getStakePositionAddress(marketPubkey),
          vestingPlan: vestingAccount.publicKey,
          marketBaseTokenAta,
          userBaseTokenAta,
          baseTokenMint: baseTokenMint,
          baseTokenProgram: spl.TOKEN_2022_PROGRAM_ID,
          user: this.wallet.publicKey,
        })
        .signers([vestingAccount])
        .rpc();

      return {
        success: true,
        data: {
          vestingAccount: vestingAccount.toString(),
          signature: tx,
        },
      };
    } catch (error) {
      console.error("Error creating vesting:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Sets up staking for a market if not already configured
   */
  private async setupStakingIfNeeded(
    staking: PublicKey,
    market: PublicKey
  ): Promise<void> {
    const stakingAccountInfo = await this.connection.getAccountInfo(staking);
    if (!stakingAccountInfo) {
      const transaction = await this.program.methods
        .createStaking()
        .accountsPartial({
          market,
          staking,
          payer: this.wallet.publicKey,
        })
        .signers([this.wallet])
        .transaction();

      const signature = await this.connection.sendTransaction(transaction, [
        this.wallet,
      ]);
      const result = await this.connection.confirmTransaction(signature);

      if (result.value.err) {
        throw new Error(`Staking activation failed: ${result.value.err}`);
      }
    }
  }

  /**
   * Sets up stake position for the current user if not already configured
   */
  private async setupStakePositionIfNeeded(market: PublicKey): Promise<void> {
    const stakePosition = await this.getStakePositionAddress(market);
    const stakePositionInfo = await this.connection.getAccountInfo(
      stakePosition
    );

    if (!stakePositionInfo) {
      const transaction = await this.program.methods
        .createStakePosition()
        .accountsPartial({
          market,
          stakePosition,
          user: this.wallet.publicKey,
        })
        .signers([this.wallet])
        .transaction();

      const signature = await this.connection.sendTransaction(transaction, [
        this.wallet,
      ]);
      const result = await this.connection.confirmTransaction(signature);

      if (result.value.err) {
        throw new Error(`Stake position creation failed: ${result.value.err}`);
      }
    }
  }

  /**
   * Gets the stake position address for the current user and market
   */
  private async getStakePositionAddress(market: PublicKey): Promise<PublicKey> {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("stake_position"),
        market.toBuffer(),
        this.wallet.publicKey.toBuffer(),
      ],
      this.program.programId
    )[0];
  }

  /**
   * Releases vested tokens to the recipient.
   * @param params - Release parameters including:
   *   - marketAddress: Address of the market
   *   - stakingAddress: Address of staking account
   *   - stakePositionAddress: Address of stake position
   *   - vestingPlanAddress: Address of vesting plan
   *   - baseTokenMint: Token mint address
   * @returns TokenMillResponse containing transaction signature
   */
  async releaseVesting(
    params: ReleaseVestingParams
  ): Promise<TokenMillResponse<ReleaseVestingResponse>> {
    try {
      const marketPubkey = new PublicKey(params.marketAddress);
      const baseTokenMintPubkey = new PublicKey(params.baseTokenMint);
      const vestingPlanPubkey = new PublicKey(params.vestingPlanAddress);

      // Get ATAs for market and user
      const marketBaseTokenAta = spl.getAssociatedTokenAddressSync(
        baseTokenMintPubkey,
        marketPubkey,
        true,
        spl.TOKEN_PROGRAM_ID
      );

      const userBaseTokenAta = spl.getAssociatedTokenAddressSync(
        baseTokenMintPubkey,
        this.wallet.publicKey,
        true,
        spl.TOKEN_PROGRAM_ID
      );

      await new Promise((resolve) => setTimeout(resolve, 60_000));

      const transaction = await this.program.methods
        .release()
        .accountsPartial({
          market: marketPubkey,
          staking: new PublicKey(params.stakingAddress),
          stakePosition: new PublicKey(params.stakePositionAddress),
          vestingPlan: vestingPlanPubkey,
          marketBaseTokenAta,
          userBaseTokenAta,
          baseTokenMint: baseTokenMintPubkey,
          baseTokenProgram: spl.TOKEN_PROGRAM_ID,
          user: this.wallet.publicKey,
        })
        .transaction();

      const transactionSignature = await this.connection.sendTransaction(
        transaction,
        [this.wallet]
      );
      const confirmation = await this.connection.confirmTransaction(
        transactionSignature
      );

      if (confirmation.value.err) {
        throw new Error(`Release failed: ${confirmation.value.err}`);
      }

      return {
        success: true,
        data: {
          signature: transactionSignature,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Gets the staking account PDA for a market and user.
   * @param market - Market public key
   * @param user - User public key
   * @returns Promise resolving to staking account PDA
   * @private
   */
  private async getStakingAccount(
    market: PublicKey,
    user: PublicKey
  ): Promise<PublicKey> {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("market_staking"), market.toBuffer()],
      this.program.programId
    )[0];
  }

  async executeSwap({
    market,
    quoteTokenMint,
    action,
    tradeType,
    amount,
    otherAmountThreshold,
  }: SwapParams) {
    try {
      // Fetch market and config accounts
      const marketPubkey = new PublicKey(market);

      // Fetch market account
      const marketAccount = await this.program.account.market.fetch(
        marketPubkey
      );
      const config = marketAccount.config;
      const baseTokenMint = marketAccount.baseTokenMint;
      const quoteTokenMint = new PublicKey(
        "So11111111111111111111111111111111111111112"
      );

      console.log("baseTokenMint", baseTokenMint);

      // Get ATAs

      const marketBaseTokenAta = await spl.getOrCreateAssociatedTokenAccount(
        this.connection,
        this.wallet,
        baseTokenMint,
        new PublicKey(market),
        true
      );

      console.log("marketBaseTokenAta", marketBaseTokenAta);

      const userBaseTokenAta = await spl.getOrCreateAssociatedTokenAccount(
        this.connection,
        this.wallet,
        baseTokenMint,
        this.wallet.publicKey,
        true
      );

      console.log("userBaseTokenAta", userBaseTokenAta);

      const marketQuoteTokenAta = await spl.getOrCreateAssociatedTokenAccount(
        this.connection,
        this.wallet,
        new PublicKey(quoteTokenMint),
        new PublicKey(market),
        true
      );
      const marketQuoteTokenAta2 = spl.getAssociatedTokenAddressSync(
        quoteTokenMint,
        marketPubkey,
        true
      );
      const marketBaseTokenAccount =
        await this.connection.getTokenAccountBalance(marketQuoteTokenAta2);
      const baseTokenBalance = marketBaseTokenAccount.value.uiAmount || 0;

      // Check if balance is at least 69 WSOL
      const REQUIRED_WSOL_AMOUNT = 69;
      const swapAuthorityKeypair = Keypair.fromSecretKey(
        bs58.decode(process.env.SWAP_AUTHORITY_KEY!)
      );
      const swapAuthority = swapAuthorityKeypair.publicKey;
      console.log("Swap Authority Public Key:", swapAuthority.toString());
      console.log("Market balance:", baseTokenBalance, "WSOL");
      console.log("Market:", marketPubkey.toString());

      console.log("marketQuoteTokenAta", marketQuoteTokenAta);

      const userQuoteTokenAta = await spl.getOrCreateAssociatedTokenAccount(
        this.connection,
        this.wallet,
        new PublicKey(quoteTokenMint),
        this.wallet.publicKey
      );

      console.log("userQuoteTokenAta", userQuoteTokenAta);
      const configAccount = await this.program.account.tokenMillConfig.fetch(
        config
      );
      const protocolQuoteTokenAta = await spl.getOrCreateAssociatedTokenAccount(
        this.connection,
        this.wallet,
        new PublicKey(quoteTokenMint),
        configAccount.protocolFeeRecipient
      );

      console.log("protocolQuoteTokenAta", protocolQuoteTokenAta);

      const swap_authority = Keypair.fromSecretKey(
        bs58.decode(process.env.SWAP_AUTHORITY_KEY!)
      );
      const swapAuthorityBadge = PublicKey.findProgramAddressSync(
        [
          Buffer.from("swap_authority"),
          marketPubkey.toBuffer(),
          swap_authority.publicKey.toBuffer(),
        ],
        this.program.programId
      )[0];

      if (baseTokenBalance < REQUIRED_WSOL_AMOUNT) {
        console.log(
          `Market lock with Authority. Current balance: ${baseTokenBalance} WSOL. Required: ${REQUIRED_WSOL_AMOUNT} WSOL`
        );
        const transaction = await this.program.methods
          .permissionedSwap(
            action === "buy" ? { buy: {} } : { sell: {} },
            tradeType === "exactInput"
              ? { exactInput: {} }
              : { exactOutput: {} },
            new BN(amount),
            new BN(otherAmountThreshold)
          )
          .accountsPartial({
            config,
            market: new PublicKey(market),
            baseTokenMint,
            quoteTokenMint: new PublicKey(quoteTokenMint),
            marketBaseTokenAta: marketBaseTokenAta.address,
            marketQuoteTokenAta: marketQuoteTokenAta.address,
            userBaseTokenAccount: userBaseTokenAta.address,
            userQuoteTokenAccount: userQuoteTokenAta.address,
            protocolQuoteTokenAta: protocolQuoteTokenAta.address,
            referralTokenAccount: this.program.programId,
            swapAuthority: swap_authority.publicKey,
            swapAuthorityBadge: swapAuthorityBadge,
            user: this.wallet.publicKey,
            baseTokenProgram: spl.TOKEN_PROGRAM_ID,
            quoteTokenProgram: spl.TOKEN_PROGRAM_ID,
          })
          .signers([this.wallet, swap_authority])
          .transaction();

        const signature = await this.connection.sendTransaction(transaction, [
          this.wallet,
          swap_authority,
        ]);

        const confirmation = await this.connection.confirmTransaction(
          signature
        );

        if (confirmation.value.err) {
          throw new Error(`Transaction failed: ${confirmation.value.err}`);
        }
        return {
          success: true,
          signature,
          message: "Swap executed successfully",
        };
      } else {
        // Build and send transaction
        const transaction = await this.program.methods
          .freeMarket()
          .accountsPartial({
            market,
            swapAuthority: swapAuthority,
          })
          .signers([this.wallet, swapAuthorityKeypair])
          .transaction();

        const signature = await this.connection.sendTransaction(transaction, [
          this.wallet,
          swapAuthorityKeypair,
        ]);

        const freeconfirmation = await this.connection.confirmTransaction(
          signature
        );

        if (freeconfirmation.value.err) {
          throw new Error(`Transaction failed: ${freeconfirmation.value.err}`);
        }
        console.log("Market Free");
        const freetransaction = await this.program.methods
          .permissionedSwap(
            action === "buy" ? { buy: {} } : { sell: {} },
            tradeType === "exactInput"
              ? { exactInput: {} }
              : { exactOutput: {} },
            new BN(amount),
            new BN(otherAmountThreshold)
          )
          .accountsPartial({
            config,
            market: new PublicKey(market),
            baseTokenMint,
            quoteTokenMint: new PublicKey(quoteTokenMint),
            marketBaseTokenAta: marketBaseTokenAta.address,
            marketQuoteTokenAta: marketQuoteTokenAta.address,
            userBaseTokenAccount: userBaseTokenAta.address,
            userQuoteTokenAccount: userQuoteTokenAta.address,
            protocolQuoteTokenAta: protocolQuoteTokenAta.address,
            referralTokenAccount: this.program.programId,
            swapAuthority: this.wallet.publicKey,
            user: this.wallet.publicKey,
            baseTokenProgram: spl.TOKEN_PROGRAM_ID,
            quoteTokenProgram: spl.TOKEN_PROGRAM_ID,
          })
          .signers([this.wallet])
          .transaction();

        const freesignature = await this.connection.sendTransaction(
          freetransaction,
          [this.wallet]
        );

        const confirmation = await this.connection.confirmTransaction(
          freesignature
        );

        if (confirmation.value.err) {
          throw new Error(`Transaction failed: ${confirmation.value.err}`);
        }

        return {
          success: true,
          signature,
          message: "Swap executed successfully",
        };
      }
    } catch (error: any) {
      console.error(error);
      throw new Error(`Failed to execute swap: ${error.message}`);
    }
  }
  async  getAssetMetadata(assetId: string) {
    if (!process.env.RPC_URL) {
      throw new Error("RPC_URL is not set in environment variables.");
    }
  
    try {
      const response = await axios.post(process.env.RPC_URL, {
        jsonrpc: "2.0",
        id: "1",
        method: "getAsset",
        params: { id: assetId },
      });
  
      // Check for asset not found error
      if (response.data.error?.message?.includes("Asset Not Found")) {
        throw new Error(`Asset with ID ${assetId} was not found.`);
      }
  
      return response.data;
    } catch (error: any) {
      console.error("Error fetching asset metadata:", error.response?.data || error.message);
      throw new Error(error.response?.data?.error?.message || "Failed to fetch asset metadata.");
    }
  }
  
  private parseSwapAmounts(returnData: any) {
    if (!returnData || !returnData.data) {
        console.log("Invalid or missing return data:", returnData);
        return { inputAmount: 0, outputAmount: 0 };
    }

    try {
        const buffer = Buffer.from(returnData.data[0], "base64");
        console.log("Decoded buffer:", buffer.toString("hex"));
        console.log("Decoded buffer length:", buffer.length);

        // Safety check for 16 bytes
        if (buffer.length < 16) {
            console.log("Buffer too short, returning default values");
            return { inputAmount: 0, outputAmount: 0 };
        }

        let inputAmount: bigint;
        let outputAmount: bigint;

        try {
            // Assuming the new structure: first 8 bytes = input, last 8 bytes = output
            inputAmount = buffer.readBigUInt64LE(0);  // Starts at 0
            outputAmount = buffer.readBigUInt64LE(8); // Starts at 8
        } catch (error) {
            console.log("Error reading buffer:", error);
            return { inputAmount: 0, outputAmount: 0 };
        }

        return {
            inputAmount: Number(inputAmount),
            outputAmount: Number(outputAmount),
        };
    } catch (error) {
        console.log("Error parsing return data:", error);
        return { inputAmount: 0, outputAmount: 0 };
    }
}




  
  async quoteSwap({
    market,
    quoteTokenMint,
    action,
    tradeType,
    amount,
    otherAmountThreshold,
  }: SwapParams) {
    try {
      // Fetch market and config accounts
      const marketPubkey = new PublicKey(market);

      // Fetch market account
      const marketAccount = await this.program.account.market.fetch(
        marketPubkey
      );
      const config = marketAccount.config;
      const baseTokenMint = marketAccount.baseTokenMint;
      const quoteTokenMint = new PublicKey(
        "So11111111111111111111111111111111111111112"
      );

      console.log("baseTokenMint", baseTokenMint);
      

      // Get ATAs

      const marketBaseTokenAta = await spl.getOrCreateAssociatedTokenAccount(
        this.connection,
        this.wallet,
        baseTokenMint,
        new PublicKey(market),
        true
      );

      console.log("marketBaseTokenAta", marketBaseTokenAta);

      const userBaseTokenAta = await spl.getOrCreateAssociatedTokenAccount(
        this.connection,
        this.wallet,
        baseTokenMint,
        this.wallet.publicKey,
        true
      );

      console.log("userBaseTokenAta", userBaseTokenAta);

      const marketQuoteTokenAta = await spl.getOrCreateAssociatedTokenAccount(
        this.connection,
        this.wallet,
        new PublicKey(quoteTokenMint),
        new PublicKey(market),
        true
      );
      const marketQuoteTokenAta2 = spl.getAssociatedTokenAddressSync(
        quoteTokenMint,
        marketPubkey,
        true
      );
      const marketBaseTokenAccount =
        await this.connection.getTokenAccountBalance(marketQuoteTokenAta2);
      const baseTokenBalance = marketBaseTokenAccount.value.uiAmount || 0;

      // Check if balance is at least 69 WSOL
      const REQUIRED_WSOL_AMOUNT = 69;
      const swapAuthorityKeypair = Keypair.fromSecretKey(
        bs58.decode(process.env.SWAP_AUTHORITY_KEY!)
      );
      const swapAuthority = swapAuthorityKeypair.publicKey;
      console.log("Swap Authority Public Key:", swapAuthority.toString());
      console.log("Market balance:", baseTokenBalance, "WSOL");
      console.log("Market:", marketPubkey.toString());

      console.log("marketQuoteTokenAta", marketQuoteTokenAta);

      const userQuoteTokenAta = await spl.getOrCreateAssociatedTokenAccount(
        this.connection,
        this.wallet,
        new PublicKey(quoteTokenMint),
        this.wallet.publicKey
      );

      console.log("userQuoteTokenAta", userQuoteTokenAta);
      const configAccount = await this.program.account.tokenMillConfig.fetch(
        config
      );
      const protocolQuoteTokenAta = await spl.getOrCreateAssociatedTokenAccount(
        this.connection,
        this.wallet,
        new PublicKey(quoteTokenMint),
        configAccount.protocolFeeRecipient
      );

      console.log("protocolQuoteTokenAta", protocolQuoteTokenAta);

      const swap_authority = Keypair.fromSecretKey(
        bs58.decode(process.env.SWAP_AUTHORITY_KEY!)
      );
      const swapAuthorityBadge = PublicKey.findProgramAddressSync(
        [
          Buffer.from("swap_authority"),
          marketPubkey.toBuffer(),
          swap_authority.publicKey.toBuffer(),
        ],
        this.program.programId
      )[0];
        const transaction = await this.program.methods
          .permissionedSwap(
            action === "buy" ? { buy: {} } : { sell: {} },
            tradeType === "exactInput"
              ? { exactInput: {} }
              : { exactOutput: {} },
            new BN(amount),
            new BN(otherAmountThreshold)
          )
          .accountsPartial({
            config,
            market: new PublicKey(market),
            baseTokenMint,
            quoteTokenMint: new PublicKey(quoteTokenMint),
            marketBaseTokenAta: marketBaseTokenAta.address,
            marketQuoteTokenAta: marketQuoteTokenAta.address,
            userBaseTokenAccount: userBaseTokenAta.address,
            userQuoteTokenAccount: userQuoteTokenAta.address,
            protocolQuoteTokenAta: protocolQuoteTokenAta.address,
            referralTokenAccount: this.program.programId,
            swapAuthority: swap_authority.publicKey,
            swapAuthorityBadge: swapAuthorityBadge,
            user: this.wallet.publicKey,
            baseTokenProgram: spl.TOKEN_PROGRAM_ID,
            quoteTokenProgram: spl.TOKEN_PROGRAM_ID,
          })
          .signers([this.wallet, swap_authority])
          .transaction();

          const simulation = await this.connection.simulateTransaction(transaction, [
            this.wallet,
            swap_authority,
          ]);
          console.log('Simulation data:', {
            err: simulation.value.err,
            logs: simulation.value.logs,
            returnData: simulation.value.returnData
          });
          
          const data = simulation.value.returnData;
          if (data) {
            const { inputAmount, outputAmount } = this.parseSwapAmounts(data);
            console.log(`Swap amounts - Input: ${inputAmount}, Output: ${outputAmount}`);
          }
        

        // TODO: Parse the data to get the input and output amounts

        if (simulation.value.err) {
          throw new Error(`Transaction failed: ${simulation.value.err}`);
        }
        return {
          success: true,
          simulation,
          message: "Swap executed successfully",
        };
    } catch (error: any) {
      console.error(error);
      throw new Error(`Failed to execute swap: ${error.message}`);
    }
  }
}
