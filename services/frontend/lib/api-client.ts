/**
 * API client helper to communicate with the microservices gateway
 */

const isServer = typeof window === "undefined";
const API_URL = isServer
  ? process.env.NEXT_PUBLIC_API_GATEWAY_URL || "http://gateway:80"
  : "";

async function apiFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_URL}${endpoint}`;
  
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  } // Ensure session cookies are sent

  const mergedOptions: RequestInit = {
    ...options,
    headers,
    credentials: "include", // Ensure session cookies are sent
  };

  try {
    const response = await fetch(url, mergedOptions);
    
    if (response.status === 204) {
      return {} as T;
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `HTTP error! status: ${response.status}`);
    }

    return data as T;
  } catch (error: any) {
    console.error(`API Fetch Error [${endpoint}]:`, error.message || error);
    throw error;
  }
}

export const apiClient = {
  get: <T>(endpoint: string, options?: RequestInit) =>
    apiFetch<T>(endpoint, { ...options, method: "GET", credentials: "include" // Ensure session cookies are sent 
    }),
    
  post: <T>(endpoint: string, body?: any, options?: RequestInit) =>
    apiFetch<T>(endpoint, {
      ...options,
      method: "POST",
      body: body ? JSON.stringify(body) : undefined // Ensure session cookies are sent
    }),
    
  put: <T>(endpoint: string, body?: any, options?: RequestInit) =>
    apiFetch<T>(endpoint, {
      ...options,
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined, credentials: "include" // Ensure session cookies are sent
    }),
    
  delete: <T>(endpoint: string, options?: RequestInit) =>
    apiFetch<T>(endpoint, { ...options, method: "DELETE", credentials: "include" // Ensure session cookies are sent 
    }),
};
