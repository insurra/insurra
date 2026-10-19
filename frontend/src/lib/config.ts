const explicitApi = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
export const config = {
  apiBaseUrl:
    explicitApi ||
    (process.env.NODE_ENV === "production" ? "" : "http://localhost:8000"),
};
