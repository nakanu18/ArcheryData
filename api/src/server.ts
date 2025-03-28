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

type ArcheryDB = {
  archers: Archer[];
}

type Tournament = {
  id: number;
  tournamentName: string;
  event: Tournament_Event; // TODO: expand this to more than 1 event?
}

type Tournament_Event = {
  id: number;
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
  events?: number[]; // Taken from main tournament file - events[i].id
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
    const tournamentIds = [1695, 2510];
    let archers: { [alt: string]: Archer } = {};
    let tournaments: { [id: string]: Tournament } = {};

    for (const tournamentId of tournamentIds) {
      const tournamentIdStr = tournamentId.toString();
      const tournamentData: TournamentData = await fetchData(tournamentURL + tournamentId, `tournament_` + tournamentIdStr);
      const eventId = tournamentData.events[0].id;
      const eventData: EventData = await fetchData(eventURL + eventId, `event_${eventId}`);
      let aidToAlt: { [aid: string]: string } = {};

      // Build all archers from the event data
      console.log("Adding archers from tournamentId:", tournamentId);
      buildAllArchers(archers, aidToAlt, eventData, eventId);

      // Create the tournament data
      let newTournament: Tournament = {
        id: tournamentId,
        tournamentName: tournamentData.tournament_name,
        event: {
          id: eventId,
          eventName: eventData.enm,
          categories: {}
        }
      };

      // Add categories to the tournament data
      console.log("Processing Tournament:", tournamentData.tournament_name);
      for (const category of eventData.cgs) {
        const categoryName = category.nm;
        newTournament.event.categories[categoryName] = {
          categoryName: categoryName,
          archers: {}
        };

        console.log("    *", categoryName, "with", category.ars.length, "archers");

        // Populate the archers in the category
        for (const archer of category.ars) {
          const aid = archer.aid.toString();
          const alt = aidToAlt[aid]; // Get the alt from the aid
          newTournament.event.categories[categoryName].archers[aid] = {
            alt: alt,
            firstName: archers[alt].firstName,
            lastName: archers[alt].lastName,
            fullName: `${archers[alt].firstName} ${archers[alt].lastName}`
          };
          // console.log(`Processing Archer: aid=${aid}, alt=${alt} - ${archers[alt].fullName}`);
        }
      }
      tournaments[tournamentIdStr] = newTournament;
    }

    res.json({ archers , tournaments });
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

const buildAllArchers = (archers: { [alt: string]: Archer }, aidToAlt: { [alt: string]: string}, event: EventData, eventId: number) => {
  Object.values(event.rps).forEach(archer => {
    if (!archers[archer.alt]) {
      archers[archer.alt] = {
        alt: archer.alt,
        firstName: archer.fnm,
        lastName: archer.lnm,
        fullName: `${archer.fnm} ${archer.lnm}`,
        events: []
      };
    }    
    archers[archer.alt].events?.push(eventId);
    aidToAlt[archer.aid.toString()] = archer.alt;
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
