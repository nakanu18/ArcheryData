import express, { Request, Response } from 'express';
import redis from 'ioredis';
import fetch from 'node-fetch';

const app = express();
const port = 3000;

const redisClient = new redis();
const CACHE_TTL = 3600;

app.use(express.json()); // Middleware to parse JSON bodies

// if (process.env.NODE_ENV === 'development') {
//   console.log("API: flushing Redis cache");
//   redisClient.flushall();
// }

type Roster = {
  url: string;
  id: number;
  enm: string;
  etp: string;
  dor: number;
  cgs: {
    nm: string;
    dor: number
    ars: {
      aid: number;
    }[];
  }[];
  rps: {
    [key: string]: {
      aid: number;
      fnm: string;
      lnm: string;
      tgt: string[];
      tnl: number[];
      cnd: string;
      tm: string;
      alt: string;
      rtl: string;
      tbs: string;      
    }
  };
};

type Scores = {
  url: string;
  ars: {
    [key: string]: string;
  };
}

app.get('/api/scores', async (req: Request, res: Response) => {
  try {
    const rosterURL = 'https://resultsapi.herokuapp.com/events/4221';
    const scoresURL = 'https://resultsapi.herokuapp.com/events/4221/scores';

    const roster: Roster = await fetchOrCacheData(rosterURL, 'roster');
    const scores: Scores = await fetchOrCacheData(scoresURL, 'scores');

    const aid = findAidByName(roster, 'Alex', 'de Vera');
    console.log("API: Player 1", aid);
    console.log("API: Player 1", roster.rps[aid]);
    console.log("API: Player 1", sumNumericValues(scores.ars[aid]));

    res.json(scores);
  } catch (error) {
    console.error('Error fetching roster data:', error);
    res.status(500).json({ error: 'Error fetching data' });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

//
// Util methods
//

// Helper function to handle caching logic
const fetchOrCacheData = async (url: string, redisKey: string) => {
  // Check if data is cached
  const cachedData = await redisClient.get(redisKey);
  if (cachedData) {
    console.log(`API: cache hit for ${redisKey}`);
    return JSON.parse(cachedData);
  }

  // Fetch data from external API if not cached
  console.log(`API: cache miss for ${redisKey}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API: failed to fetch data: ${response.statusText}`);
  }
  const data = await response.json();

  // Store the fetched data in Redis with a TTL
  await redisClient.setex(redisKey, CACHE_TTL, JSON.stringify(data));

  return data;
};

function findAidByName(roster: Roster, firstName: string, lastName: string): number {
  for (const key in roster.rps) {
    const entry = roster.rps[key];
    if (entry.fnm === firstName && entry.lnm === lastName) {
      return entry.aid;
    }
  }
  return -1;
}

function sumNumericValues(input: string): number {
  // Replace 'M' with 0, 'T' with 10, and leave other characters as they are
  const scores = input.split('').map(char => {
    if (char === 'M') return 0;
    if (char === 'T') return 10;
    return parseInt(char, 10); // Convert other characters to their numeric value
  });
  
  // Sum all the values
  return scores.reduce((acc, score) => acc + score, 0);
}

// Example usage
// console.log(sumNumericValues("123")); // 6
// console.log(sumNumericValues("M12T3")); // 16
// console.log(sumNumericValues("987M65T")); // 45
// console.log(sumNumericValues("TMMM9")); // 19
// console.log(sumNumericValues("T87888")); // 49

