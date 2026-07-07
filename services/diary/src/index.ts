import express, { Request, Response, NextFunction } from "express";
import { Pool } from "pg";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import cors from "cors";
import dotenv from "dotenv";
import amqp from "amqplib";
import client from "prom-client";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5002;
const JWT_SECRET = process.env.JWT_SECRET || "krypt_shared_jwt_secret_key_12345";
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

// PostgreSQL Pool
const dbUrl = process.env.DATABASE_URL || "postgres://postgres:7XlSyzl7dYEJbM1Q@localhost:5432/postgres";
const pool = new Pool({
  connectionString: dbUrl,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});

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
// RabbitMQ Integration
let amqpChannel: any = null;
let amqpConnection: any = null;
const EXCHANGE_NAME = "krypt.events";

async function connectRabbitMQ() {
  let retries = 5;
  while (retries) {
    try {
      console.log(`[RabbitMQ] Connecting to broker at ${RABBITMQ_URL}...`);
      amqpConnection = await amqp.connect(RABBITMQ_URL);
      amqpChannel = await amqpConnection.createChannel();
      
      // Assert direct/topic exchange
      await amqpChannel.assertExchange(EXCHANGE_NAME, "topic", { durable: true });
      
      console.log("[RabbitMQ] Successfully connected and declared exchange.");
      
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
      // Wait 5 seconds before retrying
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

connectRabbitMQ();

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

// --- DIARY ROUTER ENDPOINTS ---

// GET: Fetch entries for the user
app.get("/api/diary/entries", authenticateJWT, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  const { date } = req.query;

  try {
    if (date) {
      const result = await pool.query(
        "SELECT * FROM public.diary_entries WHERE user_id = $1 AND entry_date = $2",
        [userId, date]
      );
      if (result.rows.length === 0) {
        return res.status(200).json(null);
      }
      return res.status(200).json(result.rows[0]);
    } else {
      const result = await pool.query(
        "SELECT id, entry_date, word_count, created_at, updated_at FROM public.diary_entries WHERE user_id = $1 ORDER BY entry_date DESC",
        [userId]
      );
      return res.status(200).json(result.rows);
    }
  } catch (error: any) {
    console.error("Fetch entries error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST: Upsert diary entry
app.post("/api/diary/entries", authenticateJWT, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  const { entry_date, content, word_count } = req.body;

  if (!entry_date || content === undefined) {
    return res.status(400).json({ error: "Entry date and content are required" });
  }

  try {
    const query = `
      INSERT INTO public.diary_entries (user_id, entry_date, content, word_count, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (user_id, entry_date)
      DO UPDATE SET content = EXCLUDED.content, word_count = EXCLUDED.word_count, updated_at = NOW()
      RETURNING *
    `;
    const params = [userId, entry_date, content, word_count || 0];
    const result = await pool.query(query, params);
    const savedEntry = result.rows[0];

    // Publish RabbitMQ message for streak calculations
    if (amqpChannel) {
      const message = JSON.stringify({
        userId,
        entryDate: entry_date,
        wordCount: word_count || 0,
        timestamp: new Date().toISOString()
      });
      
      const routingKey = "diary.entry.saved";
      amqpChannel.publish(EXCHANGE_NAME, routingKey, Buffer.from(message));
      console.log(`[RabbitMQ] Published event: ${routingKey} for user ${userId} and date ${entry_date}`);
    } else {
      console.warn("[RabbitMQ] Channel not initialized. Skipping event publishing.");
    }

    return res.status(200).json(savedEntry);
  } catch (error: any) {
    console.error("Save entry error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE: Delete diary entry
app.delete("/api/diary/entries", authenticateJWT, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  const { date } = req.query;

  if (!date) {
    return res.status(400).json({ error: "Date parameter is required" });
  }

  try {
    const result = await pool.query(
      "DELETE FROM public.diary_entries WHERE user_id = $1 AND entry_date = $2 RETURNING *",
      [userId, date]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Entry not found" });
    }

    // Publish RabbitMQ message for streak calculation updates (deletion resets streaks if affected)
    if (amqpChannel) {
      const message = JSON.stringify({
        userId,
        entryDate: date,
        isDeleted: true,
        timestamp: new Date().toISOString()
      });
      
      const routingKey = "diary.entry.saved"; // Reuse key, logic handles deletions
      amqpChannel.publish(EXCHANGE_NAME, routingKey, Buffer.from(message));
      console.log(`[RabbitMQ] Published deletion event: ${routingKey} for user ${userId}`);
    }

    return res.status(200).json({ message: "Entry deleted successfully" });
  } catch (error: any) {
    console.error("Delete entry error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Prometheus Scrape Endpoint
app.get("/metrics", async (req: Request, res: Response) => {
  res.setHeader("Content-Type", register.contentType);
  res.send(await register.metrics());
});

// Health check
app.get("/health", async (req: Request, res: Response) => {
  const checkDetails: any = {
    status: "healthy",
    service: "diary-service",
    database: "unknown",
    rabbitmq: "unknown",
  };

  try {
    await pool.query("SELECT 1");
    checkDetails.database = "healthy";
  } catch (error: any) {
    checkDetails.status = "unhealthy";
    checkDetails.database = `unhealthy: ${error.message}`;
  }

  checkDetails.rabbitmq = amqpChannel ? "healthy" : "unhealthy";
  if (!amqpChannel) checkDetails.status = "unhealthy";

  const statusCode = checkDetails.status === "healthy" ? 200 : 500;
  return res.status(statusCode).json(checkDetails);
});

app.listen(PORT, () => {
  console.log(`📓 Diary microservice running on port ${PORT}`);
});
