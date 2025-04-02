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
  events: TournamentData_Event[];
}

type TournamentData_Event = {
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
  cgs: EventData_Category[];
  rps: {
    [aid: string]: EventData_Archer
  };
};

type EventData_Category = {
  nm: string;
  dor: number
  ars: {
    aid: number;
  }[];
};

type EventData_Archer = {
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

type ArcheryData = {
  archers: { [alt: string]: Archer };
  tournaments: { [id: string]: Tournament };
}

type Tournament = {
  id: number;
  tournamentName: string;
  event: Tournament_Event; // TODO: expand this to more than 1 event?
}

type Tournament_Event = {
  eventId: number; // event id
  eventName: string;
  categories: {
    [categoryName: string]: Tournament_EventCategory;
  };
}

type Tournament_EventCategory = {
  categoryName: string;
  archers: {
    [aid: string]: Archer;
  }
}

type Archer = {
  alt: string;
  firstName: string;
  lastName: string;
  fullName: string;
  results?: {
    [tournamentId: string]: Archer_Result;
  }
}

type Archer_Result = {
  tournamentId: number;
  tournamentName: string;
  eventId: number; // Taken from main tournament file - events[i].id
  categoryName: string;
}

// if (process.env.NODE_ENV === 'development') {
//   console.log("API: flushing Redis cache");
//   redisClient.flushall();
// }

// BUG: betweenends sometimes messes up the alt for archers with the same name
//      see Steven Wu - alt 206191

const tournamentURL = "https://resultsapi.herokuapp.com/tournaments/";
const eventURL = "https://resultsapi.herokuapp.com/events/";

app.get('/api/archers', async (req: Request, res: Response) => {
  try {


    // // Find archer with alt 162635
    // const archerAlt = '162635';
    // if (archers[archerAlt]) {
    //   console.log(`Archer with alt ${archerAlt}:`, archers[archerAlt]);
    // } else {
    //   console.log(`Archer with alt ${archerAlt} not found`);
    // }

    let archeryData: ArcheryData;
    let cachedData = await redisClient.get('archeryData');
    if (cachedData) {
      console.log("REDIS: cache hit for archeryData");
      archeryData = JSON.parse(cachedData);
    } else {
      console.log("REDIS: cache miss for archeryData");
      archeryData = await parseData();
      await redisClient.setex('archeryData', CACHE_TTL, JSON.stringify(archeryData));
    }
    res.json(archeryData);
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
const fetchData = async (url: string, redisKey: string) => {
  // Check if data is cached
  const cachedData = await redisClient.get(redisKey);
  if (cachedData) {
    console.log(`REDIS: cache hit for ${redisKey}`);
    return JSON.parse(cachedData);
  }

  // Fetch data from external API if not cached
  console.log(`REDIS: cache miss for ${redisKey}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API: failed to fetch data: ${response.statusText}`);
  }
  const data = await response.json();

  // Store the fetched data in Redis with a TTL
  await redisClient.setex(redisKey, CACHE_TTL, JSON.stringify(data));

  return data;
};

const parseData = async (): Promise<ArcheryData> => {
  const tournamentIds = [1695, 2510];
  let archers: { [alt: string]: Archer } = {};
  let tournaments: { [id: string]: Tournament } = {};

  for (const tournamentId of tournamentIds) {
    const tournamentData: TournamentData = await fetchData(tournamentURL + tournamentId, `tournament_` + tournamentId);
    const eventId = tournamentData.events[0].id;
    const eventData: EventData = await fetchData(eventURL + eventId, `event_${eventId}`);
    let aidToAlt: { [aid: string]: string } = {};

    // Build all archers from the event data
    console.log("Adding archers from tournamentId:", tournamentId);
    addArchers(archers, aidToAlt, eventData);

    // Create the tournament data
    tournaments[tournamentId] = createTournament(archers, aidToAlt, tournamentId, tournamentData, eventId, eventData);
  }

  return { archers, tournaments };
}

const addArchers = (archers: { [aid: string]: Archer }, aidToAlt: { [alt: string]: string }, eventData: EventData) => {
  Object.values(eventData.rps).forEach(archer => {
    if (!archers[archer.alt]) {
      archers[archer.alt] = {
        alt: archer.alt,
        firstName: archer.fnm,
        lastName: archer.lnm,
        fullName: `${archer.fnm} ${archer.lnm}`,
        results: {}
      };
    }    
    aidToAlt[archer.aid] = archer.alt;
  });
};

const createTournament = (archers: { [aid: string]: Archer }, aidToAlt: { [aid: string]: string }, tournamentId: number, tournamentData: TournamentData, eventId: number, eventData: EventData): Tournament => {
  let newTournament: Tournament = {
    id: tournamentId,
    tournamentName: tournamentData.tournament_name,
    event: {
      eventId: eventId,
      eventName: eventData.enm,
      categories: {}
    }
  };

  // Loop through the categories in eventData
  console.log("Processing Tournament:", tournamentData.tournament_name);
  for (const category of eventData.cgs) {
    newTournament.event.categories[category.nm] = {
      categoryName: category.nm,
      archers: {}
    };

    // console.log("    *", category.nm, "with", category.ars.length, "archers");

    // Loop through the archers in a category
    for (const archer of category.ars) {
      const alt = aidToAlt[archer.aid]; // Get the alt from the aid

      // Add an archer to the tournament.event category
      newTournament.event.categories[category.nm].archers[alt] = { // TODO: should this be using alt?
        alt: alt,
        firstName: archers[alt].firstName,
        lastName: archers[alt].lastName,
        fullName: `${archers[alt].firstName} ${archers[alt].lastName}`
      };

      // Update archers[alt] with the tournament result
      if (!archers[alt].results) {
        archers[alt].results = {};
      }
      archers[alt].results[tournamentId] = {
        tournamentId: tournamentId,
        tournamentName: tournamentData.tournament_name,
        eventId: eventId,
        categoryName: category.nm
      };
    }
  }
  return newTournament;  
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
