import express, { Request, Response, NextFunction } from "express";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import cors from "cors";
import dotenv from "dotenv";
import client from "prom-client";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;
const JWT_SECRET = process.env.JWT_SECRET;
const COOKIE_SECURE = process.env.COOKIE_SECURE === "true";
const sessionCookieOptions = {
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

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

// PostgreSQL connection pool
const dbUrl =
  process.env.DATABASE_URL ||
  "postgres://postgres:7XlSyzl7dYEJbM1Q@localhost:5432/postgres";
const pool = new Pool({
  connectionString: dbUrl,
  ssl:
    process.env.DATABASE_SSL === "true"
      ? { rejectUnauthorized: false }
      : undefined,
});

app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: true,
    credentials: true,
  }),
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
    httpRequestDuration.observe(
      { method: req.method, route, status },
      durationInSeconds,
    );
  });
  next();
});

// Middleware: Authenticate JWT
export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
}

const authenticateJWT = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const token =
    req.cookies.krypt_session || req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Unauthorized: No token provided" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: string;
      email: string;
    };
    req.user = { id: decoded.userId, email: decoded.email };
    next();
  } catch (error) {
    return res.status(401).json({ error: "Unauthorized: Invalid token" });
  }
};

// --- AUTH ROUTER ENDPOINTS ---

// Register
app.post("/api/auth/register", async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    // Check if user exists
    const userCheck = await pool.query(
      "SELECT id FROM auth.users WHERE email = $1",
      [email],
    );
    if (userCheck.rows.length > 0) {
      return res
        .status(400)
        .json({ error: "User already exists with this email" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    const insertResult = await pool.query(
      "INSERT INTO auth.users (email, encrypted_password) VALUES ($1, $2) RETURNING id, email",
      [email, hashedPassword],
    );
    const user = insertResult.rows[0];

    // Generate JWT
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, {
      expiresIn: "7d",
    });

    // Set cookie
    res.cookie("krypt_session", token, sessionCookieOptions);

    return res.status(201).json({ user: { id: user.id, email: user.email } });
  } catch (error: any) {
    console.error("Registration error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Login
app.post("/api/auth/login", async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const result = await pool.query(
      "SELECT id, email, encrypted_password FROM auth.users WHERE email = $1",
      [email],
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    const user = result.rows[0];
    const isPasswordValid = await bcrypt.compare(
      password,
      user.encrypted_password,
    );
    if (!isPasswordValid) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    // Generate JWT
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, {
      expiresIn: "7d",
    });

    // Set cookie
    res.cookie("krypt_session", token, sessionCookieOptions);

    return res.status(200).json({ user: { id: user.id, email: user.email } });
  } catch (error: any) {
    console.error("Login error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Logout
app.post("/api/auth/logout", (req: Request, res: Response) => {
  res.clearCookie("krypt_session", {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
  });
  return res.status(200).json({ message: "Logged out successfully" });
});

// Get user profile (me)
app.get("/api/auth/me", authenticateJWT, (req: AuthRequest, res: Response) => {
  return res.status(200).json({ user: req.user });
});

// Check current password
app.post(
  "/api/auth/check-password",
  authenticateJWT,
  async (req: AuthRequest, res: Response) => {
    const userId = req.user?.id;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: "Password is required" });
    }

    try {
      const result = await pool.query(
        "SELECT encrypted_password FROM auth.users WHERE id = $1",
        [userId],
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      const user = result.rows[0];
      const isPasswordValid = await bcrypt.compare(
        password,
        user.encrypted_password,
      );
      if (!isPasswordValid) {
        return res.status(400).json({ error: "Incorrect password" });
      }

      return res.status(200).json({ message: "Password is correct" });
    } catch (error: any) {
      console.error("Check password error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// Change password
app.post(
  "/api/auth/change-password",
  authenticateJWT,
  async (req: AuthRequest, res: Response) => {
    const userId = req.user?.id;
    const { newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({ error: "New password is required" });
    }

    try {
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await pool.query(
        "UPDATE auth.users SET encrypted_password = $1, updated_at = NOW() WHERE id = $2",
        [hashedPassword, userId],
      );

      return res.status(200).json({ message: "Password updated successfully" });
    } catch (error: any) {
      console.error("Change password error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// Get user settings (PIN hash + display name)
app.get(
  "/api/auth/settings",
  authenticateJWT,
  async (req: AuthRequest, res: Response) => {
    const userId = req.user?.id;
    try {
      const result = await pool.query(
        "SELECT pin_enabled, pin_hash, display_name FROM public.user_settings WHERE user_id = $1",
        [userId],
      );
      if (result.rows.length === 0) {
        return res
          .status(200)
          .json({ pin_enabled: false, pin_hash: null, display_name: null });
      }
      return res.status(200).json(result.rows[0]);
    } catch (error: any) {
      console.error("Fetch settings error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// Upsert user settings
app.post(
  "/api/auth/settings",
  authenticateJWT,
  async (req: AuthRequest, res: Response) => {
    const userId = req.user?.id;
    const { pin_enabled, pin_hash, display_name } = req.body;

    try {
      // Check if settings exist to decide update or insert
      const existCheck = await pool.query(
        "SELECT id FROM public.user_settings WHERE user_id = $1",
        [userId],
      );

      let query = "";
      let params: any[] = [];

      if (existCheck.rows.length > 0) {
        // Build dynamic update
        const updates: string[] = [];
        params.push(userId);
        let idx = 2;

        if (pin_enabled !== undefined) {
          updates.push(`pin_enabled = $${idx++}`);
          params.push(pin_enabled);
        }
        if (pin_hash !== undefined) {
          updates.push(`pin_hash = $${idx++}`);
          params.push(pin_hash);
        }
        if (display_name !== undefined) {
          updates.push(`display_name = $${idx++}`);
          params.push(display_name);
        }

        if (updates.length === 0) {
          return res.status(200).json({ message: "No settings modified" });
        }

        query = `UPDATE public.user_settings SET ${updates.join(", ")}, updated_at = NOW() WHERE user_id = $1 RETURNING pin_enabled, pin_hash, display_name`;
      } else {
        query = `INSERT INTO public.user_settings (user_id, pin_enabled, pin_hash, display_name) VALUES ($1, $2, $3, $4) RETURNING pin_enabled, pin_hash, display_name`;
        params = [
          userId,
          pin_enabled || false,
          pin_hash || null,
          display_name || null,
        ];
      }

      const result = await pool.query(query, params);
      return res.status(200).json(result.rows[0]);
    } catch (error: any) {
      console.error("Upsert settings error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// Get user encryption salt
app.get(
  "/api/auth/salt",
  authenticateJWT,
  async (req: AuthRequest, res: Response) => {
    const userId = req.user?.id;
    try {
      const result = await pool.query(
        "SELECT encryption_salt FROM public.user_encryption_keys WHERE user_id = $1",
        [userId],
      );
      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({ error: "Encryption salt not found for user" });
      }
      return res.status(200).json({ salt: result.rows[0].encryption_salt });
    } catch (error: any) {
      console.error("Fetch salt error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// Save user encryption salt
app.post(
  "/api/auth/salt",
  authenticateJWT,
  async (req: AuthRequest, res: Response) => {
    const userId = req.user?.id;
    const { salt } = req.body;

    if (!salt) {
      return res.status(400).json({ error: "Salt is required" });
    }

    try {
      const check = await pool.query(
        "SELECT user_id FROM public.user_encryption_keys WHERE user_id = $1",
        [userId],
      );

      let result;
      if (check.rows.length > 0) {
        result = await pool.query(
          "UPDATE public.user_encryption_keys SET encryption_salt = $2, updated_at = NOW() WHERE user_id = $1 RETURNING encryption_salt",
          [userId, salt],
        );
      } else {
        result = await pool.query(
          "INSERT INTO public.user_encryption_keys (user_id, encryption_salt) VALUES ($1, $2) RETURNING encryption_salt",
          [userId, salt],
        );
      }

      return res.status(200).json({ salt: result.rows[0].encryption_salt });
    } catch (error: any) {
      console.error("Save salt error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// Prometheus Scrape Endpoint
app.get("/metrics", async (req: Request, res: Response) => {
  res.setHeader("Content-Type", register.contentType);
  res.send(await register.metrics());
});

// Health Endpoint
app.get("/health", async (req: Request, res: Response) => {
  try {
    await pool.query("SELECT 1");
    return res.status(200).json({ status: "healthy", service: "auth-service" });
  } catch (error: any) {
    return res.status(500).json({ status: "unhealthy", error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🔑 Auth microservice running on port ${PORT}`);
});
