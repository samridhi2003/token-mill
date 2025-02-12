import express, { Request, Response } from 'express';
import { TokenMillClient } from './utils/tokenMill';
import { MarketParams, StakingParams, SwapParams, TokenParams, VestingParams, FreeMarketParams, TokenMetadata } from './types/interfaces';
import { PublicKey } from '@solana/web3.js';

/**
 * Express application instance
 */
const app = express();
app.use(express.json());

/**
 * TokenMill client instance for interacting with the Solana program
 */
const tokenMill = new TokenMillClient();

/**
 * Create a new TokenMill configuration
 * @route POST /api/config
 * @param {Object} req.body
 * @param {string} req.body.authority - Authority public key
 * @param {string} req.body.protocolFeeRecipient - Protocol fee recipient public key
 * @param {number} req.body.protocolFeeShare - Protocol fee share percentage
 * @param {number} req.body.referralFeeShare - Referral fee share percentage
 */
app.post('/api/config', async (req: Request, res: Response) => {
  try {
    const { authority, protocolFeeRecipient, protocolFeeShare, referralFeeShare } = req.body;
    const result = await tokenMill.createConfig(
      new PublicKey(authority),
      new PublicKey(protocolFeeRecipient),
      protocolFeeShare,
      referralFeeShare
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get token badge quote
 * @route POST /api/quote-token-badge
 * @param {Object} req.body - Token badge parameters
 * @returns {Promise<TokenMillResponse<any>>} Quote response
 */
app.post('/api/quote-token-badge', async (req: Request, res:Response) =>{
  try {
    const result = await tokenMill.getTokenBadge(req.body)
    res.json(result)
  }catch(error){
    res.status(500).json({
      success:false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Create a new market
 * @route POST /api/markets
 * @param {MarketParams} req.body - Market creation parameters
 * @returns {Promise<TokenMillResponse<Market>>} Created market details
 */
app.post('/api/markets', async (req: Request<{}, {}, MarketParams>, res: Response) => {
  try {
    const result = await tokenMill.createMarket(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});
app.post("/api/free-market", async (req: express.Request, res: express.Response):Promise<any> => {
  try {
    const { market } = req.body as FreeMarketParams;

    // Validate required parameter
    if (!market) {
      return res.status(400).json({
        success: false,
        message: "Market address is required",
      });
    }

    const tokenMillClient = new TokenMillClient();
    const result = await tokenMillClient.freeMarket(market);

    return res.status(200).json(result);

  } catch (error: any) {
    console.error("Free market error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to free market",
      error: error.message,
    });
  }
});


/**
 * Create a new token
 * @route POST /api/tokens
 * @param {TokenParams} req.body - Token creation parameters
 * @returns {Promise<TokenMillResponse<any>>} Created token details
 */
app.post('/api/tokens', async (req: Request<{}, {}, TokenParams>, res: Response) => {
    try {
      const result = await tokenMill.createToken();
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
  app.post('/api/swap', async (req: Request, res: Response):Promise<any> => {
    try{
      const { 
        action, 
        tradeType, 
        amount, 
        otherAmountThreshold, 
        market, 
        quoteTokenMint } = req.body as SwapParams;
    
        // Calculate otherAmountThreshold if not provided
        const calculatedThreshold = otherAmountThreshold ?? (
          action === "buy" 
            ? Math.floor(amount * 0.99)  // 1% slippage for buy
            : Math.floor(amount * 1.01)  // 1% slippage for sell
        );
    
    const result = await tokenMill.executeSwap({
      market: market,
      quoteTokenMint: quoteTokenMint,
      action,
      tradeType,
      amount,
      otherAmountThreshold: calculatedThreshold
    });
    return res.status(200).json({
      success: true,
      signature: result.signature,
      message: "Swap executed successfully",
      details: {
        action,
        tradeType,
        amount,
        otherAmountThreshold: calculatedThreshold,
        market,
        quoteTokenMint
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }

});
  
/**
 * Create a new staking position
 * @route POST /api/stake
 * @param {StakingParams} req.body - Staking parameters
 */
app.post('/api/stake', async (req: Request<{}, {}, StakingParams>, res: Response) => {
    try {
      const result = await tokenMill.stake(req.body);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
  
/**
 * Create a new vesting schedule
 * @route POST /api/vesting
 * @param {VestingParams} req.body - Vesting schedule parameters
 */
app.post('/api/vesting', async (req: Request<{}, {}, VestingParams>, res: Response) => {
    try {
      const result = await tokenMill.createVesting(req.body);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
  
/**
 * Claim vested tokens for a specific market
 * @route POST /api/vesting/:marketAddress/claim
 * @param {string} req.params.marketAddress - Market address for the vesting schedule
 * @param {Object} req.body - Claim parameters
 */
app.post('/api/vesting/:marketAddress/claim', async (req: Request<{ marketAddress: string }>, res: Response) => {
    try {
      const result = await tokenMill.releaseVesting(req.body);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
  app.get("/api/token-metadata", async (req: express.Request, res: express.Response):Promise<any> => {
    try {
      const { mint } = req.query;
  
      if (!mint || typeof mint !== "string") {
        return res.status(400).json({
          success: false,
          error: "Token mint address is required",
        });
      }
  
      const tokenMillClient = new TokenMillClient();
      const metadata = await tokenMillClient.getTokenMetadata(mint);
  
      return res.status(200).json({
        success: true,
        data: metadata,
      });
  
    } catch (error: any) {
      console.error("Token metadata error:", error);
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

/**
 * Start the Express server
 */
app.listen(3000, () => {
  console.log('Server is running on port 3000');
});

