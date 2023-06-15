import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  TokenAccount,
  SPL_ACCOUNT_LAYOUT,
  LIQUIDITY_STATE_LAYOUT_V4,
  Token,
  TokenAmount,
  Percent,
} from "@raydium-io/raydium-sdk";
import { OpenOrders } from "@project-serum/serum";
import BN from "bn.js";
import axios from "axios";
import { TokenInfo } from "./types";
import { demoFarm, demoLiquidity } from "./demoScript";
import { getWalletTokenAccount } from "./util";
import { ammAddLiquidity } from "./ammAddLiquidity";


async function getTokenAccounts(connection: Connection, owner: PublicKey) {
  const tokenResp = await connection.getTokenAccountsByOwner(owner, {
    programId: TOKEN_PROGRAM_ID,
  });

  const accounts: TokenAccount[] = [];
  for (const { pubkey, account } of tokenResp.value) {
    accounts.push({
      pubkey,
      accountInfo: SPL_ACCOUNT_LAYOUT.decode(account.data),
    });
  }

  return accounts;
}

const OPENBOOK_PROGRAM_ID = new PublicKey(
  "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX"
);

export async function parseStatusInfo(pair: string, wallet: string, isPool: boolean, isFarm: boolean) {
  const poolInfo = await demoFarm(pair, wallet);
  const connection = new Connection('https://api.mainnet-beta.solana.com', "confirmed");
  const owner = new PublicKey(wallet);

  const tokenAccounts = await getTokenAccounts(connection, owner);
  const balance = (await connection.getBalance(new PublicKey(wallet)))/Math.pow(10, 9);

  // example to get pool info
  const info = await connection.getAccountInfo(new PublicKey(poolInfo.id));
  console.log(poolInfo.id);
  if (!info) return;

  const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(info.data);
  const openOrders = await OpenOrders.load(
    connection,
    poolState.openOrders,
    OPENBOOK_PROGRAM_ID // OPENBOOK_PROGRAM_ID(marketProgramId) of each pool can get from api: https://api.raydium.io/v2/sdk/liquidity/mainnet.json
  );

  const baseDecimal = 10 ** poolState.baseDecimal.toNumber(); // e.g. 10 ^ 6
  const quoteDecimal = 10 ** poolState.quoteDecimal.toNumber();

  const baseTokenAmount = await connection.getTokenAccountBalance(
    poolState.baseVault
  );
  const quoteTokenAmount = await connection.getTokenAccountBalance(
    poolState.quoteVault
  );

  const basePnl = poolState.baseNeedTakePnl.toNumber() / baseDecimal;
  const quotePnl = poolState.quoteNeedTakePnl.toNumber() / quoteDecimal;

  const openOrdersBaseTokenTotal =
    openOrders.baseTokenTotal.toNumber() / baseDecimal;
  const openOrdersQuoteTokenTotal =
    openOrders.quoteTokenTotal.toNumber() / quoteDecimal;

  const base =
    (baseTokenAmount.value?.uiAmount || 0) + openOrdersBaseTokenTotal - basePnl;
  const quote =
    (quoteTokenAmount.value?.uiAmount || 0) +
    openOrdersQuoteTokenTotal -
    quotePnl;

  const denominator = new BN(10).pow(poolState.baseDecimal);

  const addedLpAccount = tokenAccounts.find((a) =>
    a.accountInfo.mint.equals(poolState.lpMint)
  );

  if(quoteTokenAmount.value.uiAmount === null || baseTokenAmount.value.uiAmount === null) return;
    
  const liquidityValue =  quote / base ;
  const lpTokenAmount = (addedLpAccount?.accountInfo.amount.toNumber() || 0) / baseDecimal;
  
  let poolData = {};
  if (isPool) {
    poolData = {
      pair: pair,
      liquidity: poolState.lpReserve.div(denominator).toNumber(),
      volume:poolInfo.volume,
      liquidity_value: liquidityValue,
      lpTokens: lpTokenAmount
    }
  }


  let farmData = {};
  if (isFarm) {
    farmData = {
      pair: pair,
      APR: poolInfo.totalApr24h,
      TVL: poolInfo.tvl,
      deposit_value: poolInfo.userDeposited,
      reward_value: poolInfo.rewards
    }
  }

  console.log({
    walletBalance: balance,
    pairAddress: poolInfo.id,
    address1: poolInfo.baseToken,
    address2: poolInfo.quoteToken,
    pool: poolData,
    farm: farmData
  });

  return {
    walletBalance: "balance",
    pairAddress: poolInfo.id,
    address1: poolInfo.baseToken,
    address2: poolInfo.quoteToken,
    pool: poolData,
    farm: farmData
  }
  // console.log(
  //   "SOL_USDC pool info:\n",
  //   "pool total base " + base + "\n",
  //   "pool total quote " + quote + "\n",

  //   "base vault balance " + baseTokenAmount.value.uiAmount + "\n",
  //   "quote vault balance " + quoteTokenAmount.value.uiAmount + "\n",

  //   "base tokens in openorders " + openOrdersBaseTokenTotal + "\n",
  //   "quote tokens in openorders  " + openOrdersQuoteTokenTotal + "\n",

  //   "base token decimals " + poolState.baseDecimal.toNumber() + "\n",
  //   "quote token decimals " + poolState.quoteDecimal.toNumber() + "\n",
  //   "total lp " + poolState.lpReserve.div(denominator).toString() + "\n",

  //   "addedLpAmount " +
  //     (addedLpAccount?.accountInfo.amount.toNumber() || 0) / baseDecimal + "\n"
  // );
}

export async function addLiquidity(pair: string, wallet: Keypair, isBaseToken: boolean, tokenAmount: number, numerator:number, denominator: number) {
  const liquidityInfo = await demoLiquidity(pair);
  const connection = new Connection('https://api.mainnet-beta.solana.com', "confirmed");

  if (liquidityInfo.baseToken === undefined || liquidityInfo.baseDecimal === undefined) return;
  if (liquidityInfo.quoteToken === undefined || liquidityInfo.quoteDecimal === undefined) return;

  const baseToken = new Token(new PublicKey(liquidityInfo.baseToken), liquidityInfo.baseDecimal, liquidityInfo.baseSymbol, liquidityInfo.baseSymbol);
  const quoteToken = new Token(new PublicKey(liquidityInfo.quoteToken), liquidityInfo.quoteDecimal, liquidityInfo.quoteSymbol, liquidityInfo.quoteSymbol);
  const targetPool = liquidityInfo.id;
  let inputTokenAmount;
  if (isBaseToken) {
    inputTokenAmount = new TokenAmount(baseToken, tokenAmount);
  } else {
    inputTokenAmount = new TokenAmount(quoteToken, tokenAmount);
  }
  const slippage = new Percent(numerator, denominator)
  const walletTokenAccounts = await getWalletTokenAccount(connection, wallet.publicKey)

  ammAddLiquidity({
    baseToken,
    quoteToken,
    targetPool,
    inputTokenAmount,
    slippage,
    walletTokenAccounts,
    wallet: wallet,
  }).then(({ txids, anotherAmount }) => {
    /** continue with txids */
    console.log('txids', txids);

  })
}