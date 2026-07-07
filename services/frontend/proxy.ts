import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const JWT_SECRET = process.env.JWT_SECRET || "krypt_shared_jwt_secret_key_12345";

/**
 * Base64URL to ArrayBuffer helper
 */
function base64UrlToBuffer(base64Url: string): ArrayBuffer {
  let base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Cryptographically verify JWT using HMAC SHA-256 Web Crypto API (Edge compatible)
 */
async function verifyJWT(token: string): Promise<boolean> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;

    const [headerB64, payloadB64, signatureB64] = parts;
    const encoder = new TextEncoder();
    const data = encoder.encode(`${headerB64}.${payloadB64}`);
    const signature = base64UrlToBuffer(signatureB64);

    // Import secret key
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(JWT_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    // Verify signature match
    const isValid = await crypto.subtle.verify("HMAC", key, signature, data);
    if (!isValid) return false;

    // Check expiration (exp claim)
    const payloadJson = JSON.parse(
      atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"))
    );
    
    if (payloadJson.exp && Date.now() >= payloadJson.exp * 1000) {
      console.log("JWT token has expired");
      return false;
    }

    return true;
  } catch (err) {
    console.error("JWT verification error in middleware:", err);
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const token = request.cookies.get("krypt_session")?.value;
  const { pathname } = request.nextUrl;

  // Protect diary and account routes
  if (pathname.startsWith("/diary") || pathname.startsWith("/account")) {
    if (!token) {
      const url = request.nextUrl.clone();
      url.pathname = "/auth/login";
      return NextResponse.redirect(url);
    }

    const isValid = await verifyJWT(token);
    if (!isValid) {
      const url = request.nextUrl.clone();
      url.pathname = "/auth/login";
      
      // Clear invalid cookie
      const response = NextResponse.redirect(url);
      response.cookies.delete("krypt_session");
      return response;
    }
  }

  // Redirect authenticated users trying to access login/signup
  if (pathname.startsWith("/auth/login") || pathname.startsWith("/auth/sign-up")) {
    if (token) {
      const isValid = await verifyJWT(token);
      if (isValid) {
        const url = request.nextUrl.clone();
        url.pathname = "/diary";
        return NextResponse.redirect(url);
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
