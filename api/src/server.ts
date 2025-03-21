import express, { Request, Response } from 'express';
import redis from 'ioredis';
import fetch from 'node-fetch';

const app = express();
const port = 3000;

const redisClient = new redis();
const CACHE_TTL = 3600;

app.use(express.json()); // Middleware to parse JSON bodies

//
// API Data Types
//

// rosterURL
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

// scoresURL
type Scores = {
  url: string;
  ars: {
    [key: string]: string;
  };
}

//
// Processed Data Types
//

type ArcheryDB = {
  archers: Archer[];
  competitions: {
    [key: string]: Competition;
  };
}

type Archer = {
  aid: number;
  firstName: string;
  lastName: string;
  // competitions: number[];
}

type Competition = {
  id: number;
  name: string;
  categories: CompetitionCategory[];
}

type CompetitionCategory = {
  name: string;
  archers: {
    [key: string]: {
      arrows: string;
      score: number;
    };
  }
}

// if (process.env.NODE_ENV === 'development') {
//   console.log("API: flushing Redis cache");
//   redisClient.flushall();
// }

enum CategoryType {
  BM = "Barebow Senior Men",
  BW = "Barebow Senior Women",
}

const rosterURL = 'https://resultsapi.herokuapp.com/events/4221';
const scoresURL = 'https://resultsapi.herokuapp.com/events/4221/scores';

app.get('/api/archers', async (req: Request, res: Response) => {
  try {
    const [roster, scores]: [Roster, Scores] = await Promise.all([
      fetchOrCacheData(rosterURL, 'roster'),
      fetchOrCacheData(scoresURL, 'scores_4221')
    ]);

    const archers = buildArchers(roster);
    const competitions: { [key: string]: Competition } = {};
    competitions["4221"] = {
      id: roster.id,
      name: roster.enm,
      categories: roster.cgs.map(category => ({
        name: category.nm,
        archers: category.ars.reduce((acc, archer) => {
          acc[archer.aid] = {
            arrows: scores.ars[archer.aid] || '',
            score: sumNumericValues(scores.ars[archer.aid] || '')
          };
          return acc;
        }, {} as { [key: string]: { arrows: string; score: number } })
      })),
    };

    // Combine into ArcheryDB
    const archeryDB: ArcheryDB = {
      archers,
      competitions
    };

    res.json(archeryDB);    
  } catch (error) {
    console.error('Error fetching data:', error);
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

const buildArchers = (roster: Roster): Archer[] => {
  return Object.values(roster.rps).map(entry => ({
    aid: entry.aid,
    firstName: entry.fnm,
    lastName: entry.lnm,
  }));
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
