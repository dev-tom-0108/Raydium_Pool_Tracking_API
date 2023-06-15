import { Connection, PublicKey } from "@solana/web3.js";
import { Farm } from "@raydium-io/raydium-sdk";
import {
  JsonPairItemInfo,
  FarmPoolsJsonFile,
  FarmPoolJsonInfo,
  TokenInfo,
} from "./types";
import axios from "axios";
import Decimal from "decimal.js";

// raydium farm id can get from api: https://api.raydium.io/v2/sdk/farm-v2/mainnet.json
const SOL_USDC_FARM_ID = "GUzaohfNuFbBqQTnPgPSNciv3aUvriXYjQduRE3ZkqFw";

export async function demoFarm(pair: string, wallet: string) {
  const connection = new Connection('https://api.mainnet-beta.solana.com', "confirmed");
  const owner = new PublicKey(wallet);

  console.log("fetching farms");
  const { data: farmData } = await axios.get<FarmPoolsJsonFile>(
    "https://api.raydium.io/v2/sdk/farm-v2/mainnet.json"
  );

  console.log("fetching pairs");
  const { data: pairData } = await axios.get<JsonPairItemInfo[]>(
    "https://api.raydium.io/v2/main/pairs"
  );

  const pairApr = Object.fromEntries(
    pairData.map((i) => [
      i.ammId,
      { apr30d: i.apr30d, apr7d: i.apr7d, apr24h: i.apr24h },
    ])
  );

  console.log("fetching liquidity");
  const { data: liquidityData } = await axios.get<{
    official: any[];
    unOfficial: any[];
  }>("https://api.raydium.io/v2/sdk/liquidity/mainnet.json");

  const allLiquidity = [...liquidityData.official, ...liquidityData.unOfficial];

  console.log("fetching token data");
  const { data: tokenData } = await axios.get<{
    official: TokenInfo[];
    unOfficial: TokenInfo[];
  }>("https://api.raydium.io/v2/sdk/token/raydium.mainnet.json");

  const allToken: Map<string, TokenInfo> = [
    ...tokenData.official,
    ...tokenData.unOfficial,
  ].reduce((acc, cur) => {
    acc.set(cur.mint, cur);
    return acc;
  }, new Map());

  const allTokenSymbol: Map<string, TokenInfo> = [
    ...tokenData.official,
    ...tokenData.unOfficial,
  ].reduce((acc, cur) => {
    acc.set(cur.symbol, cur);
    return acc;
  }, new Map());

  const tokenSymbols = pair.split('-');
  let baseToken = allTokenSymbol.get(tokenSymbols[0])?.mint;
  const quoteToken = allTokenSymbol.get(tokenSymbols[1])?.mint;

  if (baseToken === "11111111111111111111111111111111") baseToken = "So11111111111111111111111111111111111111112";

  const liquidity =  allLiquidity.filter(obj => obj.baseMint === baseToken && obj.quoteMint === quoteToken);

  console.log("fetching token prices");
  const { data: tokenPrices } = await axios.get<{ [key: string]: number }>(
    "https://api.raydium.io/v2/main/price"
  );

  console.log("fetching chain time");
  const { data: chainTimeData } = await axios.get<{
    chainTime: number;
    offset: number;
  }>("https://api.raydium.io/v2/sdk/token/raydium.mainnet.json");

  const currentBlockChainDate =
    chainTimeData.chainTime * 1000 + chainTimeData.offset * 1000;

  const allFarms: FarmPoolJsonInfo[] = Object.keys(farmData).reduce(
    // @ts-ignore
    (acc, cur) => [...acc.concat(farmData[cur])],
    []
  );

  const farmInfo = allFarms.find((farm) => farm.lpMint === liquidity[0].lpMint)!;
  const pairInfo = pairData.find((p) => p.lpMint === farmInfo.lpMint)!;
  const liquidityInfo = allLiquidity.find((p) => p.lpMint === farmInfo.lpMint)!;

  const farmInfoWithKeys = {
    ...farmInfo,
    id: new PublicKey(farmInfo.id),
    programId: new PublicKey(farmInfo.programId),
    baseMint: new PublicKey(farmInfo.baseMint),
    quoteMint: new PublicKey(farmInfo.quoteMint),
    lpMint: new PublicKey(farmInfo.lpMint),
    authority: new PublicKey(farmInfo.authority),
    lpVault: new PublicKey(farmInfo.lpVault),
    rewardInfos: farmInfo.rewardInfos.map((r) => ({
      ...r,
      rewardMint: new PublicKey(r.rewardMint),
      rewardVault: new PublicKey(r.rewardVault),
    })),
  };

 
  console.log("decode farm data");
  const parsedFarmInfo = (
    await Farm.fetchMultipleInfoAndUpdate({
      connection,
      pools: [farmInfoWithKeys],
      owner,
      config: { commitment: "confirmed" },
      chainTime: chainTimeData.chainTime
    })
  )[SOL_USDC_FARM_ID];

  const tvl = new Decimal(parsedFarmInfo.lpVault.amount.toString())
    .div(10 ** liquidityInfo.lpDecimals)
    .mul(pairInfo.lpPrice || 0);

  const samples = await connection.getRecentPerformanceSamples(4);
  const slotList = samples.map((item) => item.numSlots);
  const blockSlotCountForSecond =
    slotList.reduce((a, b) => a + b, 0) / slotList.length / 60;

  const rewardsApr = parsedFarmInfo.state.rewardInfos.map((r: any, idx) => {
    if (farmInfo.version === 6) {
      const { rewardPerSecond, rewardOpenTime, rewardEndTime, rewardMint } = r;
      const isRewardBeforeStart =
        rewardOpenTime.toNumber() * 1000 < currentBlockChainDate;
      const isRewardAfterEnd =
        rewardEndTime.toNumber() * 1000 > currentBlockChainDate;
      if (isRewardBeforeStart || isRewardAfterEnd) return 0;

      if (!rewardMint) return 0;
      const rewardPrice = tokenPrices[rewardMint.toString()] || 0;
      if (!rewardPrice) return 0;
      const rewardToken = allToken.get(rewardMint.toString())!;
      if (!rewardToken) return 0;

      const reward = new Decimal(rewardPerSecond.toString())
        .div(10 ** rewardToken.decimals)
        .mul(60 * 60 * 24 * 365)
        .mul(rewardPrice);

      const tvl = new Decimal(parsedFarmInfo.lpVault.amount.toString())
        .div(10 ** liquidityInfo.lpDecimals)
        .mul(pairInfo.lpPrice || 0);

      const apr = reward.div(tvl);

      return apr.toNumber();
    }

    const rewardMint = farmInfo.rewardInfos[idx].rewardMint;
    const rewardPrice = tokenPrices[rewardMint] || 0;
    const rewardToken = allToken.get(rewardMint)!;
    const reward = new Decimal(r.perSlotReward.toString())
      .div(10 ** rewardToken.decimals)
      .mul(blockSlotCountForSecond * 60 * 60 * 24 * 365)
      .mul(rewardPrice);

    const apr = reward.div(tvl);

    return apr.toNumber();
  });

  const totalApr24h = new Decimal(rewardsApr.reduce((acc, cur) => acc + cur, 0))
    .mul(100)
    .add(pairApr[liquidityInfo.id].apr24h);

  const userDeposited = new Decimal(
    parsedFarmInfo.ledger?.deposited.toString() || 0
  ).div(10 ** liquidityInfo.lpDecimals);

  console.log(pairInfo);
  return {
    baseToken: baseToken,
    quoteToken: quoteToken,
    id:liquidity[0].id,
    volume: pairInfo.volume7d,
    userDeposited: userDeposited.toString(),
    tvl: tvl.toString(),
    totalApr24h: totalApr24h.toString(),
    rewards: rewardsApr
      .filter((apr) => apr > 0)
      .map((apr, idx) => ({
        apr: apr * 100 + "%",
        rewardToken: allToken.get(
          farmInfo.rewardInfos[idx].rewardMint ||
            // @ts-ignore
            parsedFarmInfo.state.rewardInfos[idx].rewardMint.toString()
        )!.symbol,
      })),
  };
}

// demoFarm();