import express, { Request, Response, NextFunction } from "express";
import { Pool } from "pg";
import Redis from "ioredis";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import cors from "cors";
import dotenv from "dotenv";
import amqp from "amqplib";
import client from "prom-client";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5003;
const JWT_SECRET = process.env.JWT_SECRET || "krypt_shared_jwt_secret_key_12345";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672";

// Prometheus Metrics Setup
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status"],
});
register.registerMetric(httpRequestsTotal);

const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status"],
  buckets: [0.1, 0.5, 1, 2, 5],
});
register.registerMetric(httpRequestDuration);

const streakUpdatesCounter = new client.Counter({
  name: "streak_updates_total",
  help: "Total number of streak cache invalidation and recalculation events processed",
  labelNames: ["source"],
});
register.registerMetric(streakUpdatesCounter);

// PostgreSQL Pool
const dbUrl = process.env.DATABASE_URL || "postgres://postgres:7XlSyzl7dYEJbM1Q@localhost:5432/postgres";
const pool = new Pool({
  connectionString: dbUrl,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});

// Redis setup
const redis = new Redis(REDIS_URL);
redis.on("connect", () => console.log("🎈 Connected to Redis"));
redis.on("error", (err) => console.error("Redis connection error:", err));

app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

// Metrics Middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = process.hrtime();
  res.on("finish", () => {
    const duration = process.hrtime(start);
    const durationInSeconds = duration[0] + duration[1] / 1e9;
    const route = req.route ? req.route.path : req.path;
    const status = res.statusCode.toString();

    httpRequestsTotal.inc({ method: req.method, route, status });
    httpRequestDuration.observe({ method: req.method, route, status }, durationInSeconds);
  });
  next();
});

// Authenticate JWT Middleware
export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
}

const authenticateJWT = (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.cookies.krypt_session || req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Unauthorized: No token provided" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; email: string };
    req.user = { id: decoded.userId, email: decoded.email };
    next();
  } catch (error) {
    return res.status(401).json({ error: "Unauthorized: Invalid token" });
  }
};

// --- STREAK ALGORITHM HELPERS ---

interface StreakData {
  currentStreak: number;
  longestStreak: number;
  lastEntryDate: string | null;
  totalEntries: number;
  streakActive: boolean;
}

const STREAK_CACHE_PREFIX = "user_streak";
const STREAK_CACHE_TTL = 2 * 60 * 60; // 2 hours

function getStreakCacheKey(userId: string): string {
  return `${STREAK_CACHE_PREFIX}:${userId}`;
}

function daysBetween(date1: Date, date2: Date): number {
  const d1 = new Date(date1.getFullYear(), date1.getMonth(), date1.getDate());
  const d2 = new Date(date2.getFullYear(), date2.getMonth(), date2.getDate());
  return Math.round((d1.getTime() - d2.getTime()) / (1000 * 60 * 60 * 24));
}

// Convert DB entry dates to streak details
async function calculateStreaks(userId: string): Promise<StreakData> {
  const result = await pool.query(
    "SELECT entry_date FROM public.diary_entries WHERE user_id = $1 ORDER BY entry_date DESC",
    [userId]
  );

  const entries = result.rows;

  if (!entries || entries.length === 0) {
    return {
      currentStreak: 0,
      longestStreak: 0,
      lastEntryDate: null,
      totalEntries: 0,
      streakActive: false,
    };
  }

  // Remove duplicate dates and convert to unique date strings
  // entry_date returned by PG client could be Date objects or string representations.
  // Normalize date format to YYYY-MM-DD
  const rawDates = entries.map((e) => {
    if (e.entry_date instanceof Date) {
      return e.entry_date.toISOString().split("T")[0];
    }
    return String(e.entry_date).split("T")[0];
  });

  const uniqueDateStrings = [...new Set(rawDates)];
  const totalEntries = uniqueDateStrings.length;

  const entryDates = uniqueDateStrings.map((dateStr) => {
    const [year, month, day] = dateStr.split("-").map(Number);
    return new Date(year, month - 1, day);
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const mostRecentEntry = entryDates[0];
  const daysSinceLastEntry = daysBetween(today, mostRecentEntry);
  const streakActive = daysSinceLastEntry <= 1;

  let currentStreak = 0;

  if (daysSinceLastEntry > 1) {
    currentStreak = 0;
  } else {
    currentStreak = 1;
    for (let i = 0; i < entryDates.length - 1; i++) {
      const diff = daysBetween(entryDates[i], entryDates[i + 1]);
      if (diff === 1) {
        currentStreak++;
      } else if (diff === 0) {
        continue;
      } else {
        break;
      }
    }
  }

  let longestStreak = 1;
  let tempStreak = 1;

  for (let i = 0; i < entryDates.length - 1; i++) {
    const diff = daysBetween(entryDates[i], entryDates[i + 1]);
    if (diff === 1) {
      tempStreak++;
      longestStreak = Math.max(longestStreak, tempStreak);
    } else if (diff > 1) {
      tempStreak = 1;
    }
  }

  longestStreak = Math.max(longestStreak, currentStreak);

  if (entryDates.length === 1) {
    longestStreak = 1;
    currentStreak = streakActive ? 1 : 0;
  }

  return {
    currentStreak,
    longestStreak,
    lastEntryDate: uniqueDateStrings[0],
    totalEntries,
    streakActive,
  };
}

// Perform Invalidation and Pre-calculation
async function invalidateAndRecalculate(userId: string) {
  const cacheKey = getStreakCacheKey(userId);
  try {
    // Invalidate
    await redis.del(cacheKey);
    console.log(`[Cache] Invalidated streak cache for user ${userId}`);

    // Pre-calculate immediately
    const streakData = await calculateStreaks(userId);
    await redis.setex(cacheKey, STREAK_CACHE_TTL, JSON.stringify(streakData));
    console.log(`[Cache] Pre-calculated and saved streak for user ${userId}`);
    
    streakUpdatesCounter.inc({ source: "rabbitmq" });
  } catch (err: any) {
    console.error(`[Cache] Error processing invalidation/recalculation for user ${userId}:`, err.message);
  }
}
// RabbitMQ Integration
let amqpChannel: any = null;
let amqpConnection: any = null;
const EXCHANGE_NAME = "krypt.events";
const QUEUE_NAME = "krypt.streak.update";
const ROUTING_KEY = "diary.entry.saved";

async function connectRabbitMQ() {
  let retries = 5;
  while (retries) {
    try {
      console.log(`[RabbitMQ] Connecting to broker at ${RABBITMQ_URL}...`);
      amqpConnection = await amqp.connect(RABBITMQ_URL);
      amqpChannel = await amqpConnection.createChannel();
      
      await amqpChannel.assertExchange(EXCHANGE_NAME, "topic", { durable: true });
      await amqpChannel.assertQueue(QUEUE_NAME, { durable: true });
      await amqpChannel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, ROUTING_KEY);
      
      console.log(`[RabbitMQ] Listening on queue: ${QUEUE_NAME} for routing: ${ROUTING_KEY}`);
      
      amqpChannel.consume(QUEUE_NAME, async (msg: any) => {
        if (msg !== null) {
          const contentStr = msg.content.toString();
          console.log(`[RabbitMQ] Received message on ${QUEUE_NAME}: ${contentStr}`);
          try {
            const data = JSON.parse(contentStr);
            if (data.userId) {
              await invalidateAndRecalculate(data.userId);
            }
            amqpChannel?.ack(msg);
          } catch (error: any) {
            console.error("[RabbitMQ] Error handling message:", error.message);
            // Re-queue or reject based on type
            amqpChannel?.nack(msg, false, false);
          }
        }
      });
      
      amqpConnection.on("error", (err: any) => {
        console.error("[RabbitMQ] Connection error:", err);
        amqpChannel = null;
        setTimeout(connectRabbitMQ, 5000);
      });
      
      amqpConnection.on("close", () => {
        console.warn("[RabbitMQ] Connection closed. Reconnecting...");
        amqpChannel = null;
        setTimeout(connectRabbitMQ, 5000);
      });
      
      break;
    } catch (err: any) {
      console.error(`[RabbitMQ] Connection failed: ${err.message}. Retries left: ${retries - 1}`);
      retries -= 1;
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

connectRabbitMQ();

// --- STREAK ROUTER ENDPOINTS ---

// GET: Fetch streak data
app.get("/api/streak", authenticateJWT, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const cacheKey = getStreakCacheKey(userId);

  try {
    // Try cache first
    const cached = await redis.get(cacheKey);
    if (cached) {
      console.log(`[Cache] HIT for user streak: ${userId}`);
      return res.status(200).json(JSON.parse(cached));
    }

    // Cache miss, calculate and store
    console.log(`[Cache] MISS, calculating streak from database for user: ${userId}`);
    const streakData = await calculateStreaks(userId);
    
    // Store in Redis
    await redis.setex(cacheKey, STREAK_CACHE_TTL, JSON.stringify(streakData));
    
    return res.status(200).json(streakData);
  } catch (error: any) {
    console.error("Streak endpoint error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST: Direct cache invalidation endpoint
app.post("/api/streak/invalidate", authenticateJWT, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    await redis.del(getStreakCacheKey(userId));
    streakUpdatesCounter.inc({ source: "http" });
    return res.status(200).json({ message: "Streak cache invalidated successfully" });
  } catch (error: any) {
    console.error("Invalidate streak error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Prometheus Metrics Scrape Endpoint
app.get("/metrics", async (req: Request, res: Response) => {
  res.setHeader("Content-Type", register.contentType);
  res.send(await register.metrics());
});

// Health check
app.get("/health", async (req: Request, res: Response) => {
  const checkDetails: any = {
    status: "healthy",
    service: "streak-service",
    database: "unknown",
    redis: "unknown",
    rabbitmq: "unknown",
  };

  try {
    await pool.query("SELECT 1");
    checkDetails.database = "healthy";
  } catch (error: any) {
    checkDetails.status = "unhealthy";
    checkDetails.database = `unhealthy: ${error.message}`;
  }

  try {
    await redis.ping();
    checkDetails.redis = "healthy";
  } catch (error: any) {
    checkDetails.status = "unhealthy";
    checkDetails.redis = `unhealthy: ${error.message}`;
  }

  checkDetails.rabbitmq = amqpChannel ? "healthy" : "unhealthy";
  if (!amqpChannel) checkDetails.status = "unhealthy";

  const statusCode = checkDetails.status === "healthy" ? 200 : 500;
  return res.status(statusCode).json(checkDetails);
});

app.listen(PORT, () => {
  console.log(`🔥 Streak microservice running on port ${PORT}`);
});
