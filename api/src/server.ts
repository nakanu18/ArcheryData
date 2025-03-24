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

type TournamentData = {
  URL: string;
  id: number;
  tournament_name: string;
  location: string;
  start_date: string;
  end_date: string;
  updated_at: string;
  limg: string;
  rimg: string;
  bimg: string;
  msg: string;
  msg_link: string;
  events: Tournament_EventData[];
}

type Tournament_EventData = {
  id: number;
  display_order: number;
  event_type: string;
  event_name: string;
  msg: string;
  msg_link: string;
}

type EventData = {
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

//
// Processed Data Types
//

type ArcheryDB = {
  archers: Archer[];
}

type Tournament = {
  id: number;
  tournamentName: string;
  events: number[];
}

type Archer = {
  aid: number;
  alt: string;
  firstName: string;
  lastName: string;
  events: number[]; // Taken from main tournament file - events[i].id
}

// if (process.env.NODE_ENV === 'development') {
//   console.log("API: flushing Redis cache");
//   redisClient.flushall();
// }

enum CategoryType {
  BM = "Barebow Senior Men",
  BW = "Barebow Senior Women",
}

const tournamentURL = "https://resultsapi.herokuapp.com/tournaments/";
const eventURL = "https://resultsapi.herokuapp.com/events/";

app.get('/api/archers', async (req: Request, res: Response) => {
  try {
    const tournaments = [1695, 2510];
    let archers: { [alt: string]: Archer } = {};

    for (const tournament of tournaments) {
      const tournamentData: TournamentData = await fetchOrCacheData(tournamentURL + tournament, `tournament_${tournament}`);
      const eventId = tournamentData.events[0].id;
      const eventData: EventData = await fetchOrCacheData(eventURL + eventId, `event_${eventId}`);
      buildAllArchers(archers, eventData, eventId);
    }

    res.json(archers);
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

const buildAllArchers = (archers: { [alt: string]: Archer }, event: EventData, eventId: number) => {
  Object.values(event.rps).forEach(entry => {
    if (!archers[entry.alt]) {
      archers[entry.alt] = {
        aid: entry.aid,
        alt: entry.alt,
        firstName: entry.fnm,
        lastName: entry.lnm,
        events: []
      };
    }    
    archers[entry.alt].events.push(eventId);
  });
};

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
