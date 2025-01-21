import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

/**
 * Parameters for creating a new market
 */
export interface MarketParams {
  /** Name of the market */
  name: string;
  /** Symbol for the market token */
  symbol: string;
  /** URI for market metadata */
  uri: string;
  /** Total supply of tokens (as string or number) */
  totalSupply: string | number;
  /** Fee share percentage for creator (0-100) */
  creatorFeeShare: number;
  /** Fee share percentage for staking (0-100) */
  stakingFeeShare: number;
  /** Public key of quote token mint */
  quoteTokenMint: string;
}

/**
 * Market information
 */
export interface Market {
  /** Public key of base token mint */
  baseTokenMint: PublicKey;
  /** Public key of quote token mint */
  quoteTokenMint: PublicKey;
  /** Public key of market authority */
  authority: PublicKey;
  /** Fee share percentage for creator */
  creatorFeeShare: number;
  /** Fee share percentage for staking */
  stakingFeeShare: number;
  /** Total supply of tokens */
  totalSupply: BN;
}

/**
 * Parameters for swap operations
 */
export interface SwapParams {
  /** Amount to swap */
  amount: string | number;
  /** Whether amount is input (true) or output (false) */
  isExactIn: boolean;
}

/**
 * Parameters for staking operations
 */
export interface StakingParams {
  /** Address of the market to stake in */
  marketAddress: string;
  /** Amount to stake */
  amount: string | number;
  /** Optional lockup period in seconds */
  lockupPeriod?: number;
}

/**
 * Parameters for vesting operations
 */
export interface VestingParams {
  /** Address of the market */
  marketAddress: string;
  /** Address of vesting recipient */
  recipient: string;
  /** Amount to vest */
  amount: string | number;
  /** Start time of vesting (unix timestamp) */
  startTime: number;
  /** Duration of vesting period in seconds */
  duration: number;
  /** Optional cliff duration in seconds */
  cliffDuration?: number;
  /** Base token mint address */
  baseTokenMint: string;
}

/**
 * Parameters for token creation
 */
export interface TokenParams {
  /** Name of the token */
  name: string;
  /** Symbol of the token */
  symbol: string;
  /** Number of decimal places */
  decimals: number;
  /** Total supply of tokens */
  totalSupply: string | number;
  /** URI for token metadata */
  uri: string;
}

/**
 * Information about staking position
 */
export interface StakingInfo {
  /** Amount currently staked */
  stakedAmount: string;
  /** Pending rewards amount */
  rewardsPending: string;
  /** Timestamp when lockup ends */
  lockupEndTime: number;
  /** Last time rewards were updated */
  lastUpdateTime: number;
}

/**
 * Information about a vesting schedule
 */
export interface VestingSchedule {
  /** Address of beneficiary */
  beneficiary: string;
  /** Total amount to be vested */
  totalAmount: string;
  /** Amount already released */
  releasedAmount: string;
  /** Start time of vesting (unix timestamp) */
  startTime: number;
  /** Duration of vesting period in seconds */
  duration: number;
  /** Cliff duration in seconds */
  cliffDuration: number;
}

/**
 * Generic response wrapper for TokenMill operations
 * @template T Type of the response data
 */
export interface TokenMillResponse<T> {
  /** Whether the operation was successful */
  success: boolean;
  /** Optional response data */
  data?: T;
  /** Optional error message */
  error?: string;
}