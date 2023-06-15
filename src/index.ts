import express from 'express';
import http from 'http';
import bodyParser from 'body-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import { Keypair } from "@solana/web3.js";

// load the environment variables from the .env file
dotenv.config({
  path: '.env'
});

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

import { addLiquidity, parseStatusInfo } from './script';

app.get('/', async (req, res) => {
  res.send(JSON.stringify(0));
});

app.post('/getStatus', async (req, res) => {
  try{
    console.log(req.body)
    const wallet = req.body.wallet as string;
    const pair = req.body.pair as string;
    const method = req.body.method as string;
    const isPool = req.body.pool as string;
    const isFarm = req.body.farm as string;

    if (!wallet || !pair || !method || !isPool || !isFarm) {
      res.send(JSON.stringify(-100));
    }

    let showPool = false;
    let showFarm = false;
    if (isPool === "1") showPool = true;
    if (isFarm === "1") showFarm = true;

    const result = await parseStatusInfo(pair, wallet, showPool, showFarm);
    res.send(JSON.stringify(result ? result : -200));
  } catch(e) {
    console.log(e, ">> error occured from get Status");
    res.send(JSON.stringify(-200));
    
  }
});


app.post('/addLiquidity', async (req, res) => {
  try{
    console.log(req.body)
    const privateKey = req.body.privateKey as string;
    const pair = req.body.pair as string;
    const isBase = req.body.isBase as string;
    const tokenAmount = req.body.amount as string;
    const numerator = req.body.numerator as string;
    const denominator = req.body.denominator as string;

    const keypair = Keypair.fromSecretKey(Buffer.from(privateKey, 'hex'));
    if (!privateKey || !pair || !isBase|| !tokenAmount|| !numerator|| !denominator) {
      res.send(JSON.stringify(-100));
    }

    let isBaseToken = false;
    if (isBase === "1") isBaseToken = true;
    await addLiquidity(pair, keypair, isBaseToken, parseFloat(tokenAmount), parseFloat(numerator), parseFloat(denominator));
  
  } catch(e) {
    console.log(e, ">> error occured from get Status");
    res.send(JSON.stringify(-200));
    
  }
});

// make server listen on some port
((port = process.env.APP_PORT || 5000) => {
  server.listen(port, () => {
    console.log(`>> Listening on port ${port}`);
    return;
  });
})();