import { aes256gcm } from "@noble/ciphers/aes";
import { pbkdf2 } from "@noble/hashes/pbkdf2";
import { sha256 } from "@noble/hashes/sha256";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }

  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("Invalid hex input length");
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < hex.length; index += 2) {
    bytes[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16);
  }

  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function deriveKeyBytes(userId: string, salt: string): Uint8Array {
  return pbkdf2(sha256, textEncoder.encode(userId + salt), textEncoder.encode(salt), {
    c: 100000,
    dkLen: 32,
  });
}

export function generateSalt(byteLength = 16): string {
  return bytesToHex(randomBytes(byteLength));
}

export function hashPin(pin: string, salt: string): string {
  return bytesToHex(sha256(textEncoder.encode(pin + salt)));
}

export function encryptContentWithSalt(
  content: string,
  userId: string,
  salt: string
): string {
  const key = deriveKeyBytes(userId, salt);
  const iv = randomBytes(12);
  const encrypted = aes256gcm(key, iv).encrypt(textEncoder.encode(content));
  const combined = new Uint8Array(iv.length + encrypted.length);

  combined.set(iv, 0);
  combined.set(encrypted, iv.length);

  return bytesToBase64(combined);
}

export function decryptContentWithSalt(
  encryptedContent: string,
  userId: string,
  salt: string
): string {
  const combined = base64ToBytes(encryptedContent);
  const iv = combined.slice(0, 12);
  const encrypted = combined.slice(12);
  const key = deriveKeyBytes(userId, salt);
  const decrypted = aes256gcm(key, iv).decrypt(encrypted);

  return textDecoder.decode(decrypted);
}